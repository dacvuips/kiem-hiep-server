package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// API nội bộ cho GAME SERVER (không mở cho người chơi): xác thực bằng header X-Service-Key = GAME_SERVICE_KEY.
// Game server không tự kiểm tra JWT (Godot không có Ed25519) mà hỏi ở đây — kèm luôn kiểm tra khóa tài khoản, quyền sở hữu nhân vật.
var errServiceKey = newErr(http.StatusUnauthorized, "service_key", "Sai khóa dịch vụ")

func (s *server) requireService(r *http.Request) error {
	k := r.Header.Get("X-Service-Key")
	if s.cfg.GameServiceKey == "" || subtle.ConstantTimeCompare([]byte(k), []byte(s.cfg.GameServiceKey)) != 1 {
		return errServiceKey
	}
	return nil
}

// POST /internal/game/join {access_token, character_id, server_id}
func (s *server) handleInternalJoin(w http.ResponseWriter, r *http.Request) error {
	if err := s.requireService(r); err != nil {
		return err
	}
	var req struct {
		AccessToken string `json:"access_token"`
		CharacterID int64  `json:"character_id"`
		ServerID    int    `json:"server_id"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	// Dùng lại đúng đường kiểm tra token của API người chơi (chữ ký, hạn, đổi mật khẩu, khóa tài khoản).
	pr := r.Clone(r.Context())
	pr.Header.Set("Authorization", "Bearer "+req.AccessToken)
	a, err := s.requireAccount(pr)
	if err != nil {
		return err
	}
	var c characterView
	c, err = scanCharacter(s.db.QueryRow(r.Context(), `SELECT `+characterCols+` FROM characters
		WHERE id=$1 AND account_id=$2 AND server_id=$3 AND deleted_at IS NULL`, req.CharacterID, a.ID, req.ServerID))
	if errors.Is(err, pgx.ErrNoRows) {
		return errNoCharacter
	}
	if err != nil {
		return err
	}
	// Vừa nạp bản mới nhất -> bỏ cờ "admin vừa sửa, đá ra" (không đá nhầm phiên mới này).
	if _, err := s.db.Exec(r.Context(), `UPDATE characters SET admin_reload=false, online_at=now() WHERE id=$1`, c.ID); err != nil {
		return err
	}
	var muted *time.Time
	s.db.QueryRow(r.Context(), `SELECT muted_until FROM accounts WHERE id=$1`, a.ID).Scan(&muted)
	return writeJSON(w, http.StatusOK, map[string]any{
		"account":   map[string]any{"id": a.ID, "username": a.Username, "muted_until": muted},
		"character": c,
	})
}

// PUT /internal/game/characters/{id} {version, data} — game server lưu nhân vật (không cần token người chơi).
func (s *server) handleInternalSave(w http.ResponseWriter, r *http.Request) error {
	if err := s.requireService(r); err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return errBadRequest
	}
	var req struct {
		Version  int             `json:"version"`
		Data     json.RawMessage `json:"data"`
		GrantIDs []int64         `json:"grant_ids"` // quà chờ đã cộng vào bản nhân vật này (đánh dấu cùng lúc lưu)
	}
	if err := readLargeJSON(r, &req); err != nil {
		return err
	}
	ctx := r.Context()
	var name string
	if err := s.db.QueryRow(ctx, `SELECT name FROM characters WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&name); errors.Is(err, pgx.ErrNoRows) {
		return errNoCharacter
	} else if err != nil {
		return err
	}
	data, gender, sect, level, err := profileSummary(req.Data, name)
	if err != nil {
		return err
	}
	var version int
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `UPDATE characters SET data=$2, gender=$3, sect_id=$4, level=$5, version=version+1, updated_at=now()
			WHERE id=$1 AND version=$6 AND deleted_at IS NULL RETURNING version`, id, data, gender, sect, level, req.Version).Scan(&version)
		if errors.Is(err, pgx.ErrNoRows) {
			return errStaleSave
		}
		if err != nil || len(req.GrantIDs) == 0 {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE character_grants SET status='applied', applied_at=now()
			WHERE id = ANY($1) AND character_id=$2 AND status='pending'`, req.GrantIDs, id)
		return err
	})
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]int{"version": version})
}

// onlineCharacters: ghi mốc online cho nhân vật game server đang giữ; trả các nhân vật web Admin vừa sửa (game server đá ra để
// nạp lại) và bỏ cờ của chúng.
func (s *server) onlineCharacters(ctx context.Context, characterIDs []int64) ([]int64, error) {
	reload := []int64{}
	if len(characterIDs) == 0 {
		return reload, nil
	}
	rows, err := s.db.Query(ctx, `WITH old AS (SELECT id, admin_reload FROM characters WHERE id = ANY($1) FOR UPDATE)
		UPDATE characters c SET online_at=now(), admin_reload=false FROM old WHERE c.id=old.id RETURNING c.id, old.admin_reload`, characterIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var flagged bool
		if err := rows.Scan(&id, &flagged); err != nil {
			return nil, err
		}
		if flagged {
			reload = append(reload, id)
		}
	}
	return reload, rows.Err()
}

// POST /internal/game/status {account_ids:[...]} — game server hỏi định kỳ (30 giây) để áp ngay lệnh khoá / cấm chat từ web Admin
// cho người đang online: {statuses: {id: {banned, ban_message, muted_until}}}.
func (s *server) handleInternalStatus(w http.ResponseWriter, r *http.Request) error {
	if err := s.requireService(r); err != nil {
		return err
	}
	var req struct {
		AccountIDs   []int64 `json:"account_ids"`
		CharacterIDs []int64 `json:"character_ids"`
	}
	if err := readLargeJSON(r, &req); err != nil {
		return err
	}
	if len(req.AccountIDs) > 10000 || len(req.CharacterIDs) > 10000 {
		return errBadRequest
	}
	grants, err := s.pendingGrants(r.Context(), req.CharacterIDs)
	if err != nil {
		return err
	}
	reload, err := s.onlineCharacters(r.Context(), req.CharacterIDs)
	if err != nil {
		return err
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+accountCols+`, muted_until FROM accounts WHERE id = ANY($1)`, req.AccountIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := map[string]any{}
	for rows.Next() {
		var a accountRow
		var muted *time.Time
		if err := rows.Scan(&a.ID, &a.Username, &a.Email, &a.PasswordHash, &a.GoogleSub, &a.Status, &a.BannedUntil, &a.BanReason,
			&a.PasswordChangedAt, &muted); err != nil {
			return err
		}
		banned := a.Status == "banned" && (a.BannedUntil == nil || a.BannedUntil.After(time.Now()))
		msg := ""
		if banned {
			if e := s.banError(r.Context(), a); e != nil {
				msg = e.(*apiError).Message
			}
		}
		out[strconv.FormatInt(a.ID, 10)] = map[string]any{"banned": banned, "ban_message": msg, "muted_until": muted}
	}
	return writeJSON(w, http.StatusOK, map[string]any{"statuses": out, "grants": grants, "reload": reload})
}

// Quà chờ của các nhân vật đang online: {character_id: [{id, jade}]}. Game server cộng vào nhân vật rồi gửi grant_ids khi lưu.
func (s *server) pendingGrants(ctx context.Context, characterIDs []int64) (map[string][]map[string]int64, error) {
	out := map[string][]map[string]int64{}
	if len(characterIDs) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(ctx, `SELECT id, character_id, jade FROM character_grants WHERE character_id = ANY($1) AND status='pending' ORDER BY id`, characterIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, cid, jade int64
		if err := rows.Scan(&id, &cid, &jade); err != nil {
			return nil, err
		}
		k := strconv.FormatInt(cid, 10)
		out[k] = append(out[k], map[string]int64{"id": id, "jade": jade})
	}
	return out, nil
}

