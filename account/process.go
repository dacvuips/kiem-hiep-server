package main

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// VẬN HÀNH GAME SERVER từ web Admin (trang Máy chủ):
//   - Nhịp tim: mỗi tiến trình game server (thế giới / Tống Kim / Đấu trường / Phòng train chung) gửi POST /internal/game/heartbeat
//     mỗi vài giây (khoá dịch vụ): bản code, số người, số phòng, thời gian tick, băng thông. Chỉ giữ trong bộ nhớ.
//   - Khởi động lại êm: admin (vai trò super + 2FA + lý do, ghi nhật ký) đặt lệnh cho 1 tiến trình; lệnh đi kèm câu trả lời nhịp tim kế
//     tiếp. Game server báo đếm ngược cho người chơi, ngừng nhận người mới, LƯU mọi nhân vật rồi tự thoát; Docker (restart:
//     unless-stopped) bật lại. Không cần — và KHÔNG cấp — quyền Docker cho server này. Lệnh chưa giao mất khi server tài khoản khởi động lại.
//   - Thông số game: hệ số kinh nghiệm / rơi đồ / rơi tiền (bảng game_settings), chỉ khoá trong gameSettingDefs, trong khoảng cho phép;
//     game server nhận qua câu trả lời nhịp tim và tự kẹp lại theo khoảng của nó.
const (
	procAliveAfter    = 15 * time.Second // quá lâu không có nhịp tim = mất tín hiệu
	procForgetAfter   = 24 * time.Hour   // bỏ hẳn tiến trình im lặng quá lâu khỏi danh sách
	restartMinSeconds = 10
	restartMaxSeconds = 1800
)

type procBeat struct {
	ServerID   int            `json:"server_id"`
	Kind       string         `json:"kind"` // world | battle | arena | field
	Index      int            `json:"index"`
	Host       string         `json:"host"`
	Port       int            `json:"port"`
	Build      map[string]any `json:"build"`
	Online     int            `json:"online"`
	Rooms      int            `json:"rooms"`
	Monsters   int            `json:"monsters"`
	TickAvgMs  float64        `json:"tick_avg_ms"`
	TickMaxMs  float64        `json:"tick_max_ms"`
	SendKBs    float64        `json:"send_kbs"`
	UptimeSec  int            `json:"uptime_sec"`
	Draining   bool           `json:"draining"`
	DrainLeft  int            `json:"drain_left"`
	AckCommand int64          `json:"ack_command"`
	received   time.Time
}

type procCommand struct {
	ID      int64  `json:"id"`
	Action  string `json:"action"` // restart
	Seconds int    `json:"seconds"`
	Message string `json:"message"`
	By      string `json:"by"`
}

var procs = struct {
	sync.Mutex
	beats    map[string]procBeat
	commands map[string]procCommand
}{beats: map[string]procBeat{}, commands: map[string]procCommand{}}

var procKinds = map[string]bool{"world": true, "battle": true, "arena": true, "field": true}

func procKey(serverID int, kind string, index int) string {
	return fmt.Sprintf("%d-%s-%d", serverID, kind, index)
}

// Thông số game chỉnh được: khoá -> [mặc định, nhỏ nhất, lớn nhất] + tên hiển thị. Khoá ngoài danh sách bị từ chối.
type settingDef struct {
	Def, Min, Max float64
	Label         string
}

var gameSettingDefs = map[string]settingDef{
	"exp_mult":        {1, 1, 10, "Hệ số kinh nghiệm hạ quái"},
	"drop_item_mult":  {1, 1, 20, "Hệ số rơi trang bị"},
	"drop_money_mult": {1, 1, 10, "Hệ số rơi tiền"},
}

func (s *server) gameSettings(ctx context.Context) map[string]float64 {
	out := map[string]float64{}
	for k, d := range gameSettingDefs {
		out[k] = d.Def
	}
	rows, err := s.db.Query(ctx, `SELECT key, value FROM game_settings`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		var v float64
		if rows.Scan(&k, &v) == nil {
			if d, ok := gameSettingDefs[k]; ok && v >= d.Min && v <= d.Max {
				out[k] = v
			}
		}
	}
	return out
}

// POST /internal/game/heartbeat — 1 game server báo trạng thái; trả lệnh đang chờ (nếu có) + thông số game.
func (s *server) handleInternalHeartbeat(w http.ResponseWriter, r *http.Request) error {
	if err := s.requireService(r); err != nil {
		return err
	}
	var b procBeat
	if err := readJSON(r, &b); err != nil {
		return err
	}
	if b.ServerID <= 0 || !procKinds[b.Kind] || b.Index < 0 || b.Index > 8 {
		return errBadRequest
	}
	b.received = time.Now()
	key := procKey(b.ServerID, b.Kind, b.Index)
	procs.Lock()
	procs.beats[key] = b
	cmd, has := procs.commands[key]
	if has && b.AckCommand >= cmd.ID {
		delete(procs.commands, key) // game đã nhận lệnh
		has = false
	}
	procs.Unlock()
	resp := map[string]any{"ok": true, "settings": s.gameSettings(r.Context())}
	if has {
		resp["command"] = cmd
	}
	return writeJSON(w, http.StatusOK, resp)
}

type procView struct {
	procBeat
	Key      string       `json:"key"`
	Alive    bool         `json:"alive"`
	AgeSec   int          `json:"age_sec"`
	Pending  *procCommand `json:"pending,omitempty"`
}

// GET /admin/api/processes — danh sách tiến trình game server (mới nhất trước theo loại / index).
func (s *server) handleAdminProcesses(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAdmin(r, permRead); err != nil {
		return err
	}
	now := time.Now()
	var list []procView
	procs.Lock()
	for key, b := range procs.beats {
		age := now.Sub(b.received)
		if age > procForgetAfter {
			delete(procs.beats, key)
			continue
		}
		v := procView{procBeat: b, Key: key, Alive: age <= procAliveAfter, AgeSec: int(age.Seconds())}
		if c, ok := procs.commands[key]; ok {
			c := c
			v.Pending = &c
		}
		list = append(list, v)
	}
	procs.Unlock()
	order := map[string]int{"world": 0, "battle": 1, "arena": 2, "field": 3}
	sort.Slice(list, func(i, j int) bool {
		a, b := list[i], list[j]
		if a.ServerID != b.ServerID {
			return a.ServerID < b.ServerID
		}
		if order[a.Kind] != order[b.Kind] {
			return order[a.Kind] < order[b.Kind]
		}
		return a.Index < b.Index
	})
	if list == nil {
		list = []procView{}
	}
	return writeJSON(w, http.StatusOK, map[string]any{"items": list, "alive_after_sec": int(procAliveAfter.Seconds())})
}

// POST /admin/api/processes/{key}/restart — khởi động lại êm 1 tiến trình (super + 2FA + lý do; ghi nhật ký).
func (s *server) handleAdminProcessRestart(w http.ResponseWriter, r *http.Request) error {
	ac, err := s.requireAdmin(r, permServerControl)
	if err != nil {
		return err
	}
	key := r.PathValue("key")
	var req struct {
		Seconds int    `json:"seconds"`
		Message string `json:"message"`
		Reason  string `json:"reason"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	reason, err := needReason(req.Reason)
	if err != nil {
		return err
	}
	if req.Seconds < restartMinSeconds || req.Seconds > restartMaxSeconds {
		return newErr(http.StatusBadRequest, "bad_seconds", fmt.Sprintf("Thời gian chờ phải từ %d đến %d giây", restartMinSeconds, restartMaxSeconds))
	}
	msg := strings.TrimSpace(req.Message)
	if len([]rune(msg)) > 200 {
		msg = string([]rune(msg)[:200])
	}
	procs.Lock()
	b, ok := procs.beats[key]
	alive := ok && time.Since(b.received) <= procAliveAfter
	var cmd procCommand
	if alive {
		cmd = procCommand{ID: time.Now().UnixNano(), Action: "restart", Seconds: req.Seconds, Message: msg, By: ac.Username}
		procs.commands[key] = cmd
	}
	procs.Unlock()
	if !alive {
		return newErr(http.StatusConflict, "process_offline", "Tiến trình này đang mất tín hiệu — không gửi lệnh được")
	}
	s.audit(r.Context(), r, ac.ID, "process.restart", "process", key, reason, map[string]any{"seconds": req.Seconds, "message": msg})
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true, "command": cmd})
}

// GET / PUT /admin/api/game-settings — thông số game (PUT: super + 2FA + lý do; ghi nhật ký giá trị cũ -> mới).
func (s *server) handleAdminGameSettings(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	if r.Method == http.MethodPut {
		ac, err := s.requireAdmin(r, permGameSettings)
		if err != nil {
			return err
		}
		var req struct {
			Values map[string]float64 `json:"values"`
			Reason string             `json:"reason"`
		}
		if err := readJSON(r, &req); err != nil {
			return err
		}
		reason, err := needReason(req.Reason)
		if err != nil {
			return err
		}
		if len(req.Values) == 0 {
			return errBadRequest
		}
		for k, v := range req.Values {
			d, ok := gameSettingDefs[k]
			if !ok {
				return newErr(http.StatusBadRequest, "bad_setting", "Thông số không hợp lệ: "+k)
			}
			if v < d.Min || v > d.Max {
				return newErr(http.StatusBadRequest, "bad_setting", fmt.Sprintf("%s phải từ %g đến %g", d.Label, d.Min, d.Max))
			}
		}
		before := s.gameSettings(ctx)
		for k, v := range req.Values {
			if _, err := s.db.Exec(ctx, `INSERT INTO game_settings(key, value) VALUES ($1,$2)
				ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, k, v); err != nil {
				return err
			}
		}
		s.audit(ctx, r, ac.ID, "game.settings", "game", "", reason, map[string]any{"before": before, "after": req.Values})
	} else if _, err := s.requireAdmin(r, permRead); err != nil {
		return err
	}
	defs := map[string]any{}
	for k, d := range gameSettingDefs {
		defs[k] = map[string]any{"default": d.Def, "min": d.Min, "max": d.Max, "label": d.Label}
	}
	return writeJSON(w, http.StatusOK, map[string]any{"values": s.gameSettings(ctx), "defs": defs})
}
