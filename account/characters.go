package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/text/unicode/norm"
)

// Nhân vật: mỗi tài khoản tối đa maxCharacters nhân vật trên mỗi máy chủ. Dữ liệu nhân vật (PlayerProfile) lưu nguyên khối JSON.
//
// LƯU Ý: hiện client tự gửi dữ liệu nhân vật lên (chưa có game server) nên người chơi sửa client vẫn gian lận được chỉ số/đồ.
// Khi game server (bước B) chạy, chỉ game server được ghi data; API PUT này sẽ chỉ còn cho phần cài đặt giao diện.
const (
	maxCharacters    = 4
	minNameRunes     = 2
	maxNameRunes     = 16
	maxCharacterData = 256 << 10
)

var (
	errBadName      = newErr(http.StatusBadRequest, "bad_name", "Tên nhân vật dài 2–16 ký tự, chỉ gồm chữ, số và dấu cách")
	errNameTaken    = newErr(http.StatusConflict, "name_taken", "Tên nhân vật đã có người dùng trên máy chủ này")
	errSlotTaken    = newErr(http.StatusConflict, "slot_taken", "Ô nhân vật này đã có nhân vật")
	errTooMany      = newErr(http.StatusConflict, "too_many_characters", "Mỗi tài khoản chỉ được tạo tối đa 4 nhân vật trên 1 máy chủ")
	errNoCharacter  = newErr(http.StatusNotFound, "character_not_found", "Không tìm thấy nhân vật")
	errNoServer     = newErr(http.StatusBadRequest, "bad_server", "Máy chủ không tồn tại")
	errMaintenance  = newErr(http.StatusServiceUnavailable, "maintenance", "Máy chủ đang bảo trì")
	errStaleSave    = newErr(http.StatusConflict, "stale_save", "Nhân vật vừa được lưu từ máy khác — hãy vào lại game")
	errDataTooLarge = newErr(http.StatusRequestEntityTooLarge, "data_too_large", "Dữ liệu nhân vật quá lớn")
)

type characterView struct {
	ID        int64           `json:"id"`
	ServerID  int             `json:"server_id"`
	Slot      int             `json:"slot"`
	Name      string          `json:"name"`
	Gender    int             `json:"gender"`
	SectID    string          `json:"sect_id"`
	Level     int             `json:"level"`
	Version   int             `json:"version"`
	UpdatedAt time.Time       `json:"updated_at"`
	Data      json.RawMessage `json:"data"`
}

const characterCols = `id, server_id, slot, name, gender, sect_id, level, version, updated_at, data`

func scanCharacter(row pgx.Row) (characterView, error) {
	var c characterView
	err := row.Scan(&c.ID, &c.ServerID, &c.Slot, &c.Name, &c.Gender, &c.SectID, &c.Level, &c.Version, &c.UpdatedAt, &c.Data)
	return c, err
}

// normalizeName: NFC, gộp khoảng trắng; trả về tên hiển thị + khóa so trùng. Chỉ cho chữ (mọi ngôn ngữ, có dấu), số, dấu cách.
func normalizeName(raw string) (name, key string, err error) {
	name = strings.Join(strings.Fields(norm.NFC.String(raw)), " ")
	n := utf8.RuneCountInString(name)
	if n < minNameRunes || n > maxNameRunes {
		return "", "", errBadName
	}
	for _, r := range name {
		if !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == ' ' || unicode.Is(unicode.Mn, r)) {
			return "", "", errBadName
		}
	}
	return name, strings.ToLower(name), nil
}

// profileSummary đọc vài trường từ PlayerProfile.to_dict() để hiện ở danh sách nhân vật; ép display_name = tên trên server.
func profileSummary(raw json.RawMessage, name string) (data []byte, gender int, sect string, level int, err error) {
	if len(raw) > maxCharacterData {
		return nil, 0, "", 0, errDataTooLarge
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return nil, 0, "", 0, errBadRequest
	}
	m["name"] = name
	delete(m, "display_name")
	num := func(k string) int {
		if f, ok := m[k].(float64); ok {
			return int(f)
		}
		return 0
	}
	gender = num("gender")
	level = max(1, num("level"))
	sect, _ = m["sect_id"].(string)
	data, err = json.Marshal(m)
	return data, gender, sect, level, err
}

// Đồ web Admin tặng chưa sinh (admin_grants) chỉ web Admin / game server đổi — game gửi gì cũng giữ bản đã lưu.
func keepAdminGrants(oldRaw json.RawMessage, incoming map[string]any) {
	var old map[string]any
	_ = json.Unmarshal(oldRaw, &old)
	if v, ok := old["admin_grants"]; ok {
		incoming["admin_grants"] = v
	} else {
		delete(incoming, "admin_grants")
	}
}

func stripAdminGrants(raw json.RawMessage) json.RawMessage {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return raw
	}
	if _, ok := m["admin_grants"]; !ok {
		return raw
	}
	delete(m, "admin_grants")
	out, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return out
}

func (s *server) checkServer(r *http.Request, id int) error {
	var status string
	err := s.db.QueryRow(r.Context(), `SELECT status FROM game_servers WHERE id=$1`, id).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNoServer
	}
	if err != nil {
		return err
	}
	if status == "maintenance" {
		return errMaintenance
	}
	return nil
}

func readLargeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, maxCharacterData+16<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return errBadRequest
	}
	return nil
}

// GET /v1/characters?server_id=N
func (s *server) handleListCharacters(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	serverID, err := strconv.Atoi(r.URL.Query().Get("server_id"))
	if err != nil {
		return errBadRequest
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+characterCols+` FROM characters
		WHERE account_id=$1 AND server_id=$2 AND deleted_at IS NULL ORDER BY slot`, a.ID, serverID)
	if err != nil {
		return err
	}
	defer rows.Close()
	list := []characterView{}
	for rows.Next() {
		c, err := scanCharacter(rows)
		if err != nil {
			return err
		}
		list = append(list, c)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"characters": list, "max": maxCharacters})
}

// POST /v1/characters {server_id, slot, name, data}
func (s *server) handleCreateCharacter(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	var req struct {
		ServerID int             `json:"server_id"`
		Slot     int             `json:"slot"`
		Name     string          `json:"name"`
		Data     json.RawMessage `json:"data"`
	}
	if err := readLargeJSON(r, &req); err != nil {
		return err
	}
	if req.Slot < 0 || req.Slot >= maxCharacters {
		return errBadRequest
	}
	if err := s.checkServer(r, req.ServerID); err != nil {
		return err
	}
	name, key, err := normalizeName(req.Name)
	if err != nil {
		return err
	}
	data, gender, sect, level, err := profileSummary(stripAdminGrants(req.Data), name)
	if err != nil {
		return err
	}
	ctx := r.Context()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Khóa theo tài khoản để 2 yêu cầu tạo cùng lúc không vượt quá 4 nhân vật.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, a.ID); err != nil {
		return err
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM characters WHERE account_id=$1 AND server_id=$2 AND deleted_at IS NULL`,
		a.ID, req.ServerID).Scan(&count); err != nil {
		return err
	}
	if count >= maxCharacters {
		return errTooMany
	}
	c, err := scanCharacter(tx.QueryRow(ctx, `INSERT INTO characters(account_id, server_id, slot, name, name_key, gender, sect_id, level, data)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING `+characterCols,
		a.ID, req.ServerID, req.Slot, name, key, gender, sect, level, data))
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		if pgErr.ConstraintName == "characters_slot_uniq" {
			return errSlotTaken
		}
		return errNameTaken
	}
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return writeJSON(w, http.StatusCreated, c)
}

// PUT /v1/characters/{id} {version, data} — lưu tiến trình. version phải khớp bản đang lưu (chống 2 máy ghi đè nhau).
func (s *server) handleSaveCharacter(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return errBadRequest
	}
	var req struct {
		Version int             `json:"version"`
		Data    json.RawMessage `json:"data"`
	}
	if err := readLargeJSON(r, &req); err != nil {
		return err
	}
	ctx := r.Context()
	var name string
	var version int
	var oldData json.RawMessage
	err = s.db.QueryRow(ctx, `SELECT name, version, data FROM characters WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL`, id, a.ID).
		Scan(&name, &version, &oldData)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNoCharacter
	}
	if err != nil {
		return err
	}
	// Lưu từ game (ngoài map): không cho tăng cấp / tiền / đồ / điểm — xem guardClientSave.
	var incoming map[string]any
	if err := json.Unmarshal(req.Data, &incoming); err != nil || incoming == nil {
		return errBadRequest
	}
	// Lưu từ game (ngoài map): tài khoản GM (hoặc DevTrustClientSaves) được lưu nguyên vẹn mọi thay đổi từ test.
	if !s.cfg.DevTrustClientSaves && !s.isGM(a) {
		incoming = guardClientSave(oldData, incoming)
	}
	keepAdminGrants(oldData, incoming)
	guarded, err := json.Marshal(incoming)
	if err != nil {
		return err
	}
	data, gender, sect, level, err := profileSummary(guarded, name)
	if err != nil {
		return err
	}
	var newVersion int
	var updated time.Time
	err = s.db.QueryRow(ctx, `UPDATE characters SET data=$3, gender=$4, sect_id=$5, level=$6, version=version+1, updated_at=now()
		WHERE id=$1 AND account_id=$2 AND version=$7 AND deleted_at IS NULL RETURNING version, updated_at`,
		id, a.ID, data, gender, sect, level, req.Version).Scan(&newVersion, &updated)
	if errors.Is(err, pgx.ErrNoRows) {
		return errStaleSave
	}
	if err != nil {
		return err
	}
	if s.redis != nil {
		_ = s.redis.Set(ctx, fmt.Sprintf("game:char:%d", id), string(guarded), 30*time.Minute)
	}
	return writeJSON(w, http.StatusOK, map[string]any{"version": newVersion, "updated_at": updated})
}

// DELETE /v1/characters/{id} {password} — xóa mềm (admin khôi phục được). Bắt nhập lại mật khẩu để tránh xóa nhầm / bị người khác xóa.
func (s *server) handleDeleteCharacter(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return errBadRequest
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	if !s.userRL.allow("delchar:" + a.Username) {
		return errRateLimited
	}
	if a.PasswordHash != "" {
		if ok, _ := s.keys.checkPassword(req.Password, a.PasswordHash); !ok {
			return errWrongPassword
		}
	}
	tag, err := s.db.Exec(r.Context(), `UPDATE characters SET deleted_at=now() WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL`, id, a.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errNoCharacter
	}
	return writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
