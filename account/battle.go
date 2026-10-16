package main

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Chiến trường Tống Kim: tiến trình game server riêng (GAME_BATTLE=1) đẩy trạng thái trận lên đây vài giây 1 lần
// (POST /internal/game/battle); game đọc qua GET /v1/battle để hiện số người mỗi phe / giai đoạn / địa chỉ vào trận
// TRƯỚC khi kết nối. Trạng thái chỉ giữ trong bộ nhớ — mất thì battle server gửi lại ngay lần sau.
const battleStaleAfter = 15 * time.Second

type battleState struct {
	ServerID   int    `json:"server_id"`
	MapID      int    `json:"map_id"`
	MapName    string `json:"map_name"`
	Phase      string `json:"phase"`       // signup | fight | ended
	PhaseLeft  int    `json:"phase_left"`  // giây còn lại của giai đoạn hiện tại
	Song       int    `json:"song"`        // số người phe Tống
	Jin        int    `json:"jin"`         // số người phe Kim
	SongPoints int    `json:"song_points"` // điểm tích luỹ phe Tống
	JinPoints  int    `json:"jin_points"`
	Balance    int    `json:"balance"` // chênh lệch tối đa: phe đông hơn đối phương >= balance thì không vào được
	SideCap    int    `json:"side_cap"`
	MinLevel   int    `json:"min_level"`
	Winner     string `json:"winner"` // trận vừa xong: song | jin | ""
	Host       string `json:"host"`   // địa chỉ battle server (ENet / WebSocket)
	Port       int    `json:"port"`
	WSURL      string `json:"ws_url"`
	Open       bool   `json:"open"` // false = battle server không báo về (tắt / mất kết nối)
	received   time.Time
}

var battleStates = struct {
	sync.Mutex
	m map[int]battleState
}{m: map[int]battleState{}}

// POST /internal/game/battle — battle server báo trạng thái.
func (s *server) handleInternalBattle(w http.ResponseWriter, r *http.Request) error {
	if err := s.requireService(r); err != nil {
		return err
	}
	var st battleState
	if err := readLargeJSON(r, &st); err != nil {
		return err
	}
	if st.ServerID <= 0 {
		return errBadRequest
	}
	st.received = time.Now()
	battleStates.Lock()
	battleStates.m[st.ServerID] = st
	battleStates.Unlock()
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// GET /v1/battle?server_id=N
func (s *server) handleBattle(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAccount(r); err != nil {
		return err
	}
	serverID, err := strconv.Atoi(r.URL.Query().Get("server_id"))
	if err != nil || serverID <= 0 {
		return errBadRequest
	}
	battleStates.Lock()
	st, ok := battleStates.m[serverID]
	battleStates.Unlock()
	if !ok || time.Since(st.received) > battleStaleAfter {
		return writeJSON(w, http.StatusOK, battleState{ServerID: serverID, Open: false})
	}
	// Trừ phần thời gian đã trôi kể từ lần báo gần nhất để đếm ngược ở game không bị "đứng" giữa 2 lần báo.
	st.PhaseLeft = max(0, st.PhaseLeft-int(time.Since(st.received).Seconds()))
	st.Open = true
	return writeJSON(w, http.StatusOK, st)
}
