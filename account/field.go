package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"
)

// Phòng train chung của màn Vượt Ải (map luyện công / Địa Ngục): tiến trình game server riêng (GAME_FIELD=1) đẩy danh sách phòng
// lên đây vài giây 1 lần (POST /internal/game/field); game đọc qua GET /v1/field để lấy địa chỉ field server (tạo phòng) và tra
// phòng theo ID (biết map + tiến trình để nạp / kết nối) TRƯỚC khi kết nối. Chỉ giữ trong bộ nhớ như đấu trường.
//
// NHIỀU TIẾN TRÌNH (giảm tải): mỗi field server có 1 index (GAME_FIELD_INDEX, chữ số đầu ID phòng = index + 1 nên ID không trùng).
// GET gộp phòng của mọi tiến trình còn sống — mỗi phòng kèm địa chỉ tiến trình giữ nó; host/port ở gốc = tiến trình ÍT NGƯỜI NHẤT
// (game tạo phòng mới ở đó).
const fieldStaleAfter = 10 * time.Second

type fieldRoom struct {
	ID      string `json:"id"`
	MapID   int    `json:"map_id"`
	Tier    int    `json:"tier"`  // 0 = Thường, 10-12 = Địa Ngục
	Stars   int    `json:"stars"` // Địa Ngục 1-5, Thường 0
	Host    string `json:"host"`  // tên chủ phòng
	Members int    `json:"members"`
	Max     int    `json:"max"`
	// Phòng có mật khẩu (mật khẩu gốc chỉ nằm ở field server, không bao giờ gửi lên đây).
	Locked bool `json:"locked"`
	// Field server gửi kèm muối ngẫu nhiên + sha256(muối + mật khẩu) để POST /v1/field/check báo sai mật khẩu TRƯỚC khi
	// game nạp map. Hai trường này KHÔNG BAO GIỜ trả về người chơi (handleField xoá trước khi ghi).
	PassSalt string `json:"pass_salt,omitempty"`
	PassHash string `json:"pass_hash,omitempty"`
	// "" = phòng train Vượt Ải; "guild" = Tổng Đà Bang Hội; "boss" = Săn Boss — danh sách phòng ở game chỉ hiện "".
	Kind string `json:"kind,omitempty"`
	// Địa chỉ tiến trình field server giữ phòng (server tài khoản điền khi gộp).
	Addr  string `json:"addr"`
	Port  int    `json:"port"`
	WSURL string `json:"ws_url"`
}

type fieldState struct {
	ServerID int         `json:"server_id"`
	Index    int         `json:"index"`
	Host     string      `json:"host"` // địa chỉ field server (ENet / WebSocket)
	Port     int         `json:"port"`
	WSURL    string      `json:"ws_url"`
	Open     bool        `json:"open"`
	Players  int         `json:"players"`
	Rooms    []fieldRoom `json:"rooms"`
	received time.Time
}

type fieldKey struct{ server, index int }

var fieldStates = struct {
	sync.Mutex
	m map[fieldKey]fieldState
}{m: map[fieldKey]fieldState{}}

// POST /internal/game/field — 1 field server báo danh sách phòng của nó.
func (s *server) handleInternalField(w http.ResponseWriter, r *http.Request) error {
	if err := s.requireService(r); err != nil {
		return err
	}
	var st fieldState
	if err := readLargeJSON(r, &st); err != nil {
		return err
	}
	if st.ServerID <= 0 || st.Index < 0 || st.Index > 8 {
		return errBadRequest
	}
	if st.Rooms == nil {
		st.Rooms = []fieldRoom{}
	}
	st.received = time.Now()
	fieldStates.Lock()
	fieldStates.m[fieldKey{st.ServerID, st.Index}] = st
	fieldStates.Unlock()

	if s.redis != nil {
		if raw, err := json.Marshal(st); err == nil {
			_ = s.redis.Set(r.Context(), fmt.Sprintf("game:field:%d:%d", st.ServerID, st.Index), string(raw), 15*time.Second)
		}
	}

	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// GET /v1/field?server_id=N — gộp mọi field server còn sống của máy chủ N.
func (s *server) handleField(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAccount(r); err != nil {
		return err
	}
	serverID, err := strconv.Atoi(r.URL.Query().Get("server_id"))
	if err != nil || serverID <= 0 {
		return errBadRequest
	}
	var live []fieldState
	fieldStates.Lock()
	for k, st := range fieldStates.m {
		if k.server == serverID && time.Since(st.received) <= fieldStaleAfter {
			live = append(live, st)
		}
	}
	fieldStates.Unlock()
	out := fieldState{ServerID: serverID, Open: len(live) > 0, Rooms: []fieldRoom{}}
	if len(live) == 0 {
		return writeJSON(w, http.StatusOK, out)
	}
	sort.Slice(live, func(i, j int) bool {
		if live[i].Players != live[j].Players {
			return live[i].Players < live[j].Players
		}
		return live[i].Index < live[j].Index
	})
	best := live[0]
	out.Index, out.Host, out.Port, out.WSURL, out.Players = best.Index, best.Host, best.Port, best.WSURL, best.Players
	for _, st := range live {
		for _, room := range st.Rooms {
			room.Addr, room.Port, room.WSURL = st.Host, st.Port, st.WSURL
			room.PassSalt, room.PassHash = "", ""
			out.Rooms = append(out.Rooms, room)
		}
	}
	return writeJSON(w, http.StatusOK, out)
}

// POST /v1/field/check {server_id, room, password} — kiểm mật khẩu phòng trước khi game nạp map (để báo sai ngay ở màn Vượt Ải,
// không phải vào map rồi mới bị đá). Field server vẫn kiểm lại khi vào phòng thật. Sai mật khẩu tính vào userRL (chống dò).
// Trả {ok: true} hoặc {ok: false, code: "not_found" | "bad_password", msg}.
func (s *server) handleFieldCheck(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	return s.fieldCheck(w, r, a)
}

func (s *server) fieldCheck(w http.ResponseWriter, r *http.Request, a accountRow) error {
	var req struct {
		ServerID int    `json:"server_id"`
		Room     string `json:"room"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	if req.ServerID <= 0 || len(req.Room) != 6 || len(req.Password) > 64 {
		return errBadRequest
	}
	var room *fieldRoom
	fieldStates.Lock()
	for k, st := range fieldStates.m {
		if k.server != req.ServerID || time.Since(st.received) > fieldStaleAfter {
			continue
		}
		for i := range st.Rooms {
			if st.Rooms[i].ID == req.Room {
				rm := st.Rooms[i]
				room = &rm
			}
		}
	}
	fieldStates.Unlock()
	if room == nil {
		return writeJSON(w, http.StatusOK, map[string]any{"ok": false, "code": "not_found",
			"msg": fmt.Sprintf("Không có phòng #%s (phòng đã đóng hoặc sai ID).", req.Room)})
	}
	if !room.Locked || room.PassHash == "" {
		return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
	sum := sha256.Sum256([]byte(room.PassSalt + req.Password))
	if subtle.ConstantTimeCompare([]byte(hex.EncodeToString(sum[:])), []byte(room.PassHash)) == 1 {
		return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
	if !s.userRL.allow(fmt.Sprintf("fieldpw:%d", a.ID)) {
		return errRateLimited
	}
	msg := "Sai mật khẩu phòng."
	if req.Password == "" {
		msg = "Phòng có mật khẩu — hãy nhập mật khẩu."
	}
	return writeJSON(w, http.StatusOK, map[string]any{"ok": false, "code": "bad_password", "msg": msg})
}
