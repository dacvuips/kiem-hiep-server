package main

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Đấu trường PK (popup PK: Đại hội võ lâm / Võ lâm Liên đấu): tiến trình game server riêng (GAME_ARENA=1) đẩy danh sách phòng
// lên đây vài giây 1 lần (POST /internal/game/arena); game đọc qua GET /v1/arena để hiện phòng chờ / đang đánh + địa chỉ đấu trường
// TRƯỚC khi kết nối. Mật khẩu phòng không bao giờ gửi ra (chỉ cờ "locked"). Chỉ giữ trong bộ nhớ như chiến trường.
const arenaStaleAfter = 10 * time.Second

type arenaRoom struct {
	ID         string   `json:"id"`
	Mode       int      `json:"mode"` // PkRules.Mode: 0 Đại hội võ lâm, 1 Võ lâm Liên đấu
	Host       string   `json:"host"`
	Level      int      `json:"level"`
	SectName   string   `json:"sect_name"`
	Locked     bool     `json:"locked"`
	State      string   `json:"state"` // waiting | prepare | fight | ended
	Fighters   []string `json:"fighters"`
	Spectators int      `json:"spectators"`
	Left       int      `json:"left"`
	Winner     string   `json:"winner"`
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
	if err := readLargeJSON(r, &st); err != nil {
		return err
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
	arenaStates.Lock()
	st, ok := arenaStates.m[serverID]
	arenaStates.Unlock()
	if !ok || time.Since(st.received) > arenaStaleAfter {
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
