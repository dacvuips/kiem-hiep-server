package main

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// API nội bộ bang hội cho game server (khoá dịch vụ). Game server giữ bang trong RAM, lưu lại mỗi lần đổi.

// GET /internal/game/guilds?server_id=N -> {guilds: [{name, data}]}
func (s *server) handleInternalGuilds(w http.ResponseWriter, r *http.Request) error {
	if err := s.requireService(r); err != nil {
		return err
	}
	sid, err := strconv.Atoi(r.URL.Query().Get("server_id"))
	if err != nil {
		return errBadRequest
	}
	rows, err := s.db.Query(r.Context(), `SELECT name, data FROM guilds WHERE server_id=$1 ORDER BY name`, sid)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var name string
		var data json.RawMessage
		if err := rows.Scan(&name, &data); err != nil {
			return err
		}
		out = append(out, map[string]any{"name": name, "data": data})
	}
	return writeJSON(w, http.StatusOK, map[string]any{"guilds": out})
}

// PUT /internal/game/guilds {server_id, name, data, old_name?} — lưu (đổi tên thì xoá bản tên cũ trong cùng giao dịch).
func (s *server) handleInternalSaveGuild(w http.ResponseWriter, r *http.Request) error {
	if err := s.requireService(r); err != nil {
		return err
	}
	var req struct {
		ServerID int             `json:"server_id"`
		Name     string          `json:"name"`
		OldName  string          `json:"old_name"`
		Data     json.RawMessage `json:"data"`
	}
	if err := readLargeJSON(r, &req); err != nil {
		return err
	}
	if req.Name == "" || len(req.Data) == 0 {
		return errBadRequest
	}
	ctx := r.Context()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if req.OldName != "" && req.OldName != req.Name {
		if _, err := tx.Exec(ctx, `DELETE FROM guilds WHERE server_id=$1 AND name=$2`, req.ServerID, req.OldName); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO guilds(server_id, name, data) VALUES ($1,$2,$3)
		ON CONFLICT (server_id, name) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, req.ServerID, req.Name, req.Data); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// DELETE /internal/game/guilds?server_id=N&name=X — giải tán.
func (s *server) handleInternalDeleteGuild(w http.ResponseWriter, r *http.Request) error {
	if err := s.requireService(r); err != nil {
		return err
	}
	sid, err := strconv.Atoi(r.URL.Query().Get("server_id"))
	if err != nil {
		return errBadRequest
	}
	if _, err := s.db.Exec(r.Context(), `DELETE FROM guilds WHERE server_id=$1 AND name=$2`, sid, r.URL.Query().Get("name")); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
