package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Đấu trường PK (popup PK: Đại hội võ lâm / Võ lâm Liên đấu / Thách đấu / Tống Kim LOL / Loạn Đả):
// tiến trình game server riêng (GAME_ARENA=1) đẩy danh sách phòng lên đây vài giây 1 lần (POST /internal/game/arena);
// game đọc qua GET /v1/arena để hiện phòng chờ / đang đánh + địa chỉ đấu trường TRƯỚC khi kết nối.
// Mật khẩu phòng không bao giờ gửi ra (chỉ cờ "locked"). Chỉ giữ trong bộ nhớ như chiến trường.
const arenaStaleAfter = 15 * time.Second

type arenaMember struct {
	Cid      int    `json:"cid"`
	Name     string `json:"name"`
	Level    int    `json:"level"`
	SectID   int    `json:"sect_id"`
	SectName string `json:"sect_name"`
	Ready    bool   `json:"ready"`
	IsHost   bool   `json:"is_host"`
}

type arenaRoom struct {
	ID          string        `json:"id"`
	Mode        int           `json:"mode"` // PkRules.Mode: 0 Đại hội, 1 Liên đấu, 2 Thách đấu, 3 LOL, 4 Loạn đả
	TeamSize    int           `json:"team_size"`
	BrawlType   string        `json:"brawl_type,omitempty"`
	MapID       int           `json:"map_id,omitempty"`
	TargetKills int           `json:"target_kills,omitempty"`
	Host        string        `json:"host"`
	Level       int           `json:"level"`
	SectName    string        `json:"sect_name"`
	Locked      bool          `json:"locked"`
	State       string        `json:"state"` // waiting | prepare | fight | ended
	Fighters    []string      `json:"fighters"`
	TeamA       []arenaMember `json:"team_a,omitempty"`
	TeamB       []arenaMember `json:"team_b,omitempty"`
	Spectators  int           `json:"spectators"`
	Left        int           `json:"left"`
	Winner      string        `json:"winner,omitempty"`
}

type arenaState struct {
	ServerID int         `json:"server_id"`
	Host     string      `json:"host"` // địa chỉ arena server (ENet / WebSocket)
	Port     int         `json:"port"`
	WSURL    string      `json:"ws_url"`
	Open     bool        `json:"open"`
	Rooms    []arenaRoom `json:"rooms"`
	received time.Time
}

var arenaStates = struct {
	sync.Mutex
	m map[int]arenaState
}{m: map[int]arenaState{}}

// POST /internal/game/arena — arena server báo danh sách phòng.
func (s *server) handleInternalArena(w http.ResponseWriter, r *http.Request) error {
	if err := s.requireService(r); err != nil {
		return err
	}
	var st arenaState
	// Dùng decoder thông thường, không DisallowUnknownFields để tương thích tiến hoá giữa các bản server/client
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if err := dec.Decode(&st); err != nil {
		return errBadRequest
	}
	if st.ServerID <= 0 {
		return errBadRequest
	}
	if st.Rooms == nil {
		st.Rooms = []arenaRoom{}
	}
	st.received = time.Now()
	arenaStates.Lock()
	arenaStates.m[st.ServerID] = st
	arenaStates.Unlock()

	// Lưu vào Redis cache (TTL 20s)
	if s.redis != nil {
		if raw, err := json.Marshal(st); err == nil {
			_ = s.redis.Set(r.Context(), fmt.Sprintf("game:arena:%d", st.ServerID), string(raw), 20*time.Second)
		}
	}

	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// GET /v1/arena?server_id=N
func (s *server) handleArena(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAccount(r); err != nil {
		return err
	}
	serverID, err := strconv.Atoi(r.URL.Query().Get("server_id"))
	if err != nil || serverID <= 0 {
		return errBadRequest
	}

	var st arenaState
	var found bool

	// Thử lấy từ Redis trước
	if s.redis != nil {
		if val, err := s.redis.Get(r.Context(), fmt.Sprintf("game:arena:%d", serverID)); err == nil && val != "" {
			if err := json.Unmarshal([]byte(val), &st); err == nil {
				found = true
			}
		}
	}

	// Fallback sang in-memory
	if !found {
		arenaStates.Lock()
		cached, ok := arenaStates.m[serverID]
		arenaStates.Unlock()
		if ok && time.Since(cached.received) <= arenaStaleAfter {
			st = cached
			found = true
		}
	}

	if !found {
		return writeJSON(w, http.StatusOK, arenaState{ServerID: serverID, Open: false, Rooms: []arenaRoom{}})
	}

	elapsed := int(time.Since(st.received).Seconds())
	rooms := make([]arenaRoom, len(st.Rooms))
	for i, room := range st.Rooms {
		room.Left = max(0, room.Left-elapsed)
		rooms[i] = room
	}
	st.Rooms = rooms
	st.Open = true
	return writeJSON(w, http.StatusOK, st)
}
