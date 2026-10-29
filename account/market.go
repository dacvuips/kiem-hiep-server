package main

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// API nội bộ Chợ Giao Thương cho game server (khoá dịch vụ). Game server giữ sổ chợ trong RAM, lưu từng món mỗi lần đổi.

// GET /internal/game/market?server_id=N -> {listings: [{id, data}]}
func (s *server) handleInternalMarket(w http.ResponseWriter, r *http.Request) error {
	if err := s.requireService(r); err != nil {
		return err
	}
	sid, err := strconv.Atoi(r.URL.Query().Get("server_id"))
	if err != nil {
		return errBadRequest
	}
	rows, err := s.db.Query(r.Context(), `SELECT id, data FROM market_listings WHERE server_id=$1`, sid)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id string
		var data json.RawMessage
		if err := rows.Scan(&id, &data); err != nil {
			return err
		}
		out = append(out, map[string]any{"id": id, "data": data})
	}
	return writeJSON(w, http.StatusOK, map[string]any{"listings": out})
}

// PUT /internal/game/market {server_id, id, data} — thêm / cập nhật 1 món.
func (s *server) handleInternalSaveMarket(w http.ResponseWriter, r *http.Request) error {
	if err := s.requireService(r); err != nil {
		return err
	}
	var req struct {
		ServerID int             `json:"server_id"`
		ID       string          `json:"id"`
		Data     json.RawMessage `json:"data"`
	}
	if err := readLargeJSON(r, &req); err != nil {
		return err
	}
	if req.ID == "" || len(req.ID) > 64 || len(req.Data) == 0 {
		return errBadRequest
	}
	// KHÓA BẢO MẬT TỪ BE: Chỉ lưu những món của nhân vật thật (sid > 0), cấm tuyệt đối bot/chợ giả (sid <= 0).
	var itemMeta struct {
		SID int `json:"sid"`
	}
	if err := json.Unmarshal(req.Data, &itemMeta); err != nil || itemMeta.SID <= 0 {
		return errBadRequest
	}
	if _, err := s.db.Exec(r.Context(), `INSERT INTO market_listings(server_id, id, data) VALUES ($1,$2,$3)
		ON CONFLICT (server_id, id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, req.ServerID, req.ID, req.Data); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// DELETE /internal/game/market?server_id=N&id=X — món đã ra khỏi sổ (huỷ treo / người bán đã nhận tiền).
func (s *server) handleInternalDeleteMarket(w http.ResponseWriter, r *http.Request) error {
	if err := s.requireService(r); err != nil {
		return err
	}
	sid, err := strconv.Atoi(r.URL.Query().Get("server_id"))
	if err != nil {
		return errBadRequest
	}
	if _, err := s.db.Exec(r.Context(), `DELETE FROM market_listings WHERE server_id=$1 AND id=$2`, sid, r.URL.Query().Get("id")); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
