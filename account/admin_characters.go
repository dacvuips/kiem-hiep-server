package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Web Admin sửa nhân vật: xem / sửa toàn bộ dữ liệu (PlayerProfile.to_dict) — tên, cấp, tiền, điểm tiềm năng / kỹ năng, cấp skill,
// trang bị, hành trang, rương — và tặng đồ (data.admin_grants: game server sinh thành món thật khi nhân vật vào map).
// Lưu xong bật cờ admin_reload: game server (hỏi trạng thái mỗi GAME_STATUS_POLL giây) đá người chơi đang online ra KHÔNG lưu,
// vào lại là nạp bản mới. Chống ghi đè: phải gửi đúng version đang lưu (game vừa lưu thì admin phải tải lại).

// Nhân vật coi là đang online nếu game server vừa báo trong khoảng này (gấp 3 nhịp hỏi trạng thái mặc định 30 giây).
const onlineWindow = 90 * time.Second

var errStaleAdminEdit = newErr(http.StatusConflict, "stale_save", "Nhân vật vừa được game lưu sau khi bạn mở — hãy tải lại rồi sửa lại")

type adminCharacterFull struct {
	characterView
	AccountID int64      `json:"account_id"`
	Username  string     `json:"username"`
	Server    string     `json:"server"`
	DeletedAt *time.Time `json:"deleted_at"`
	Online    bool       `json:"online"`
	Reload    bool       `json:"reload_pending"`
}

func (s *server) loadAdminCharacter(r *http.Request, id int64) (adminCharacterFull, error) {
	var c adminCharacterFull
	var onlineAt *time.Time
	err := s.db.QueryRow(r.Context(), `SELECT c.id, c.server_id, c.slot, c.name, c.gender, c.sect_id, c.level, c.version, c.updated_at, c.data,
		c.account_id, a.username, g.name, c.deleted_at, c.online_at, c.admin_reload
		FROM characters c JOIN accounts a ON a.id=c.account_id JOIN game_servers g ON g.id=c.server_id WHERE c.id=$1`, id).
		Scan(&c.ID, &c.ServerID, &c.Slot, &c.Name, &c.Gender, &c.SectID, &c.Level, &c.Version, &c.UpdatedAt, &c.Data,
			&c.AccountID, &c.Username, &c.Server, &c.DeletedAt, &onlineAt, &c.Reload)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, errNotFound
	}
	c.Online = onlineAt != nil && time.Since(*onlineAt) < onlineWindow
	return c, err
}

// GET /admin/api/characters/{id}
func (s *server) handleAdminCharacter(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAdmin(r, permRead); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	c, err := s.loadAdminCharacter(r, id)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, c)
}

// PUT /admin/api/characters/{id} {version, name, data, reason}
func (s *server) handleAdminSaveCharacter(w http.ResponseWriter, r *http.Request) error {
	ad, err := s.requireAdmin(r, permCharEdit)
	if err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var req struct {
		Version int             `json:"version"`
		Name    string          `json:"name"`
		Data    json.RawMessage `json:"data"`
		Reason  string          `json:"reason"`
	}
	if err := readLargeJSON(r, &req); err != nil {
		return err
	}
	reason, err := needReason(req.Reason)
	if err != nil {
		return err
	}
	name, key, err := normalizeName(req.Name)
	if err != nil {
		return err
	}
	var incoming map[string]any
	if err := json.Unmarshal(req.Data, &incoming); err != nil || incoming == nil {
		return newErr(http.StatusBadRequest, "bad_data", "Dữ liệu nhân vật không phải JSON object hợp lệ")
	}
	old, err := s.loadAdminCharacter(r, id)
	if err != nil {
		return err
	}
	data, gender, sect, level, err := profileSummary(req.Data, name)
	if err != nil {
		return err
	}
	ctx := r.Context()
	var version int
	err = s.db.QueryRow(ctx, `UPDATE characters SET name=$2, name_key=$3, data=$4, gender=$5, sect_id=$6, level=$7,
		version=version+1, updated_at=now(), admin_reload=true WHERE id=$1 AND version=$8 RETURNING version`,
		id, name, key, data, gender, sect, level, req.Version).Scan(&version)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return errNameTaken
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return errStaleAdminEdit
	}
	if err != nil {
		return err
	}
	detail := map[string]any{"character_id": id, "name": name, "changes": diffProfile(old.Data, data)}
	if old.Name != name {
		detail["old_name"] = old.Name
	}
	s.audit(ctx, r, ad.ID, "character.edit", "account", strconv.FormatInt(old.AccountID, 10), reason, detail)
	return writeJSON(w, http.StatusOK, map[string]any{"version": version, "online": old.Online})
}

// POST /admin/api/characters/{id}/kick {reason} — đá khỏi game (không lưu phần chơi chưa lưu), VD trước khi sửa cho chắc.
func (s *server) handleAdminKickCharacter(w http.ResponseWriter, r *http.Request) error {
	ad, err := s.requireAdmin(r, permCharEdit)
	if err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	reason, err := needReason(req.Reason)
	if err != nil {
		return err
	}
	var accountID int64
	var name string
	err = s.db.QueryRow(r.Context(), `UPDATE characters SET admin_reload=true WHERE id=$1 AND deleted_at IS NULL RETURNING account_id, name`, id).
		Scan(&accountID, &name)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return err
	}
	s.audit(r.Context(), r, ad.ID, "character.kick", "account", strconv.FormatInt(accountID, 10), reason,
		map[string]any{"character_id": id, "name": name})
	return writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// diffProfile: tóm tắt thay đổi cho nhật ký — trường đơn (số / chữ) ghi "cũ → mới", trường phức tạp (đồ, skill...) chỉ ghi tên.
func diffProfile(oldRaw, newRaw []byte) []string {
	var a, b map[string]any
	_ = json.Unmarshal(oldRaw, &a)
	_ = json.Unmarshal(newRaw, &b)
	keys := map[string]bool{}
	for k := range a {
		keys[k] = true
	}
	for k := range b {
		keys[k] = true
	}
	out := []string{}
	for k := range keys {
		oa, _ := json.Marshal(a[k])
		nb, _ := json.Marshal(b[k])
		if bytes.Equal(oa, nb) {
			continue
		}
		switch b[k].(type) {
		case map[string]any, []any:
			out = append(out, k)
		default:
			out = append(out, fmt.Sprintf("%s: %s → %s", k, oa, nb))
		}
	}
	sort.Strings(out)
	if len(out) > 60 {
		out = append(out[:60], fmt.Sprintf("… và %d mục khác", len(out)-60))
	}
	return out
}
