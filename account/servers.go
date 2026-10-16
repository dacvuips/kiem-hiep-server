package main

import "net/http"

type gameServerView struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	Region     string `json:"region"`
	Status     string `json:"status"`
	IsNew      bool   `json:"is_new"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	WSURL      string `json:"ws_url"`
	Characters int    `json:"characters"` // số nhân vật của tài khoản trên máy chủ này
}

// handleServers trả danh sách máy chủ đúng định dạng màn Chọn máy chủ đang đọc ({"servers": [...]}).
func (s *server) handleServers(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	rows, err := s.db.Query(r.Context(),
		`SELECT g.id, g.name, g.region, g.status, g.is_new, g.host, g.port, g.ws_url,
		        (SELECT count(*) FROM characters c WHERE c.server_id=g.id AND c.account_id=$1 AND c.deleted_at IS NULL)
		 FROM game_servers g ORDER BY g.sort_order, g.id`, a.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	list := []gameServerView{}
	for rows.Next() {
		var g gameServerView
		if err := rows.Scan(&g.ID, &g.Name, &g.Region, &g.Status, &g.IsNew, &g.Host, &g.Port, &g.WSURL, &g.Characters); err != nil {
			return err
		}
		list = append(list, g)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"servers": list})
}
