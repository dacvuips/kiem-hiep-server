package main

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// API web Admin: thống kê, tài khoản (xem / khóa / cấm chat / đặt lại mật khẩu...), nhân vật, máy chủ, nhật ký, quản lý admin.
// Mọi thao tác thay đổi dữ liệu đều ghi admin_audit (ai, lúc nào, với ai, lý do, chi tiết).

var errNotFound = newErr(http.StatusNotFound, "not_found", "Không tìm thấy")

func pageParams(r *http.Request) (page, size, offset int) {
	page, _ = strconv.Atoi(r.URL.Query().Get("page"))
	size, _ = strconv.Atoi(r.URL.Query().Get("size"))
	page = max(page, 1)
	if size <= 0 || size > 100 {
		size = 20
	}
	return page, size, (page - 1) * size
}

func likeEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func pathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return 0, errBadRequest
	}
	return id, nil
}

// ---------------------------------------------------------------- thống kê

type dayCount struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

func (s *server) daySeries(r *http.Request, sql string) ([]dayCount, error) {
	rows, err := s.db.Query(r.Context(), sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []dayCount{}
	for rows.Next() {
		var d time.Time
		var c dayCount
		if err := rows.Scan(&d, &c.Count); err != nil {
			return nil, err
		}
		c.Day = d.Format("2006-01-02")
		out = append(out, c)
	}
	return out, rows.Err()
}

const vnToday = `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`

func (s *server) handleAdminStats(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAdmin(r, permRead); err != nil {
		return err
	}
	ctx := r.Context()
	var st struct {
		Accounts    int `json:"accounts"`
		NewToday    int `json:"new_today"`
		New7d       int `json:"new_7d"`
		Banned      int `json:"banned"`
		Muted       int `json:"muted"`
		Characters  int `json:"characters"`
		ActiveToday int `json:"active_today"`
		Active7d    int `json:"active_7d"`
		// Số người đang online: có khi game server chạy (bước B).
		Online        *int         `json:"online"`
		Registrations []dayCount   `json:"registrations"`
		ActiveDaily   []dayCount   `json:"active_daily"`
		Servers       []serverStat `json:"servers"`
		RecentAudit   []auditView  `json:"recent_audit"`
	}
	err := s.db.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM accounts),
		(SELECT count(*) FROM accounts WHERE (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = `+vnToday+`),
		(SELECT count(*) FROM accounts WHERE created_at > now() - interval '7 days'),
		(SELECT count(*) FROM accounts WHERE status='banned' AND (banned_until IS NULL OR banned_until > now())),
		(SELECT count(*) FROM accounts WHERE muted_until > now()),
		(SELECT count(*) FROM characters WHERE deleted_at IS NULL),
		(SELECT count(DISTINCT account_id) FROM login_history WHERE ok AND (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = `+vnToday+`),
		(SELECT count(DISTINCT account_id) FROM login_history WHERE ok AND created_at > now() - interval '7 days')`).
		Scan(&st.Accounts, &st.NewToday, &st.New7d, &st.Banned, &st.Muted, &st.Characters, &st.ActiveToday, &st.Active7d)
	if err != nil {
		return err
	}
	series := func(table, cond, expr string) string {
		return `SELECT d::date, count(t.*) FROM generate_series(` + vnToday + ` - 29, ` + vnToday + `, interval '1 day') d
			LEFT JOIN (SELECT ` + expr + ` FROM ` + table + ` WHERE created_at > now() - interval '31 days' ` + cond + `) t
			ON t.day = d::date GROUP BY d ORDER BY d`
	}
	if st.Registrations, err = s.daySeries(r, series("accounts", "", `(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day`)); err != nil {
		return err
	}
	if st.ActiveDaily, err = s.daySeries(r, series("login_history", "AND ok",
		`DISTINCT account_id, (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day`)); err != nil {
		return err
	}
	if st.Servers, err = s.serverStats(r); err != nil {
		return err
	}
	if st.RecentAudit, _, err = s.queryAudit(r, "", nil, 8, 0); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, st)
}

// ---------------------------------------------------------------- tài khoản

type adminAccountView struct {
	ID          int64      `json:"id"`
	Username    string     `json:"username"`
	Email       string     `json:"email"`
	Status      string     `json:"status"`
	BannedUntil *time.Time `json:"banned_until"`
	BanReason   string     `json:"ban_reason"`
	MutedUntil  *time.Time `json:"muted_until"`
	Google      bool       `json:"google_linked"`
	CreatedAt   time.Time  `json:"created_at"`
	CreatedIP   string     `json:"created_ip"`
	LastLoginAt *time.Time `json:"last_login_at"`
	LastLoginIP string     `json:"last_login_ip"`
	Characters  int        `json:"characters"`
}

const adminAccountCols = `a.id, a.username, a.email,
	CASE WHEN a.status='banned' AND (a.banned_until IS NULL OR a.banned_until > now()) THEN 'banned' ELSE 'active' END,
	a.banned_until, a.ban_reason, a.muted_until, a.google_sub IS NOT NULL, a.created_at, a.created_ip, a.last_login_at, a.last_login_ip,
	(SELECT count(*) FROM characters c WHERE c.account_id=a.id AND c.deleted_at IS NULL)`

func scanAdminAccount(row pgx.Row) (adminAccountView, error) {
	var v adminAccountView
	err := row.Scan(&v.ID, &v.Username, &v.Email, &v.Status, &v.BannedUntil, &v.BanReason, &v.MutedUntil, &v.Google,
		&v.CreatedAt, &v.CreatedIP, &v.LastLoginAt, &v.LastLoginIP, &v.Characters)
	return v, err
}

// GET /admin/api/accounts?q=&status=all|active|banned|muted&page=&size=
// q: id, tên (bắt đầu bằng), email (chứa), IP đăng ký / đăng nhập (đúng bằng), tên nhân vật (đúng bằng).
func (s *server) handleAdminAccounts(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAdmin(r, permRead); err != nil {
		return err
	}
	page, size, offset := pageParams(r)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	where := []string{"true"}
	args := []any{}
	arg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	if q != "" {
		lq := strings.ToLower(q)
		cond := `a.username LIKE ` + arg(likeEscape(lq)+"%") + ` OR lower(a.email) LIKE ` + arg("%"+likeEscape(lq)+"%") +
			` OR a.last_login_ip = ` + arg(q) + ` OR a.created_ip = ` + arg(q) +
			` OR EXISTS (SELECT 1 FROM characters c WHERE c.account_id=a.id AND c.name_key = ` + arg(lq) + `)`
		if id, err := strconv.ParseInt(q, 10, 64); err == nil {
			cond += ` OR a.id = ` + arg(id)
		}
		where = append(where, "("+cond+")")
	}
	switch r.URL.Query().Get("status") {
	case "banned":
		where = append(where, `a.status='banned' AND (a.banned_until IS NULL OR a.banned_until > now())`)
	case "active":
		where = append(where, `NOT (a.status='banned' AND (a.banned_until IS NULL OR a.banned_until > now()))`)
	case "muted":
		where = append(where, `a.muted_until > now()`)
	}
	w2 := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(r.Context(), `SELECT count(*) FROM accounts a WHERE `+w2, args...).Scan(&total); err != nil {
		return err
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+adminAccountCols+` FROM accounts a WHERE `+w2+
		` ORDER BY a.id DESC LIMIT `+arg(size)+` OFFSET `+arg(offset), args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []adminAccountView{}
	for rows.Next() {
		v, err := scanAdminAccount(rows)
		if err != nil {
			return err
		}
		items = append(items, v)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "page": page, "size": size})
}

type adminCharacterView struct {
	ID        int64      `json:"id"`
	ServerID  int        `json:"server_id"`
	Server    string     `json:"server"`
	Slot      int        `json:"slot"`
	Name      string     `json:"name"`
	Gender    int        `json:"gender"`
	SectID    string     `json:"sect_id"`
	Level     int        `json:"level"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `json:"deleted_at"`
	Online    bool       `json:"online"`
}

type loginView struct {
	OK        bool      `json:"ok"`
	Method    string    `json:"method"`
	IP        string    `json:"ip"`
	UserAgent string    `json:"user_agent"`
	CreatedAt time.Time `json:"created_at"`
}

type sessionView struct {
	ID         int64     `json:"id"`
	CreatedAt  time.Time `json:"created_at"`
	LastUsedAt time.Time `json:"last_used_at"`
	ExpiresAt  time.Time `json:"expires_at"`
	IP         string    `json:"ip"`
	UserAgent  string    `json:"user_agent"`
}

// GET /admin/api/accounts/{id} — chi tiết: tài khoản, nhân vật (cả đã xóa), lịch sử đăng nhập, phiên đang mở, nhật ký admin.
func (s *server) handleAdminAccount(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAdmin(r, permRead); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	acc, err := scanAdminAccount(s.db.QueryRow(ctx, `SELECT `+adminAccountCols+` FROM accounts a WHERE a.id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return err
	}
	chars := []adminCharacterView{}
	rows, err := s.db.Query(ctx, `SELECT c.id, c.server_id, g.name, c.slot, c.name, c.gender, c.sect_id, c.level, c.created_at, c.updated_at, c.deleted_at,
		coalesce(c.online_at > now() - $2::interval, false)
		FROM characters c JOIN game_servers g ON g.id=c.server_id WHERE c.account_id=$1 ORDER BY c.deleted_at NULLS FIRST, c.server_id, c.slot`, id, onlineWindow)
	if err != nil {
		return err
	}
	for rows.Next() {
		var c adminCharacterView
		if err := rows.Scan(&c.ID, &c.ServerID, &c.Server, &c.Slot, &c.Name, &c.Gender, &c.SectID, &c.Level, &c.CreatedAt, &c.UpdatedAt, &c.DeletedAt, &c.Online); err != nil {
			rows.Close()
			return err
		}
		chars = append(chars, c)
	}
	rows.Close()
	logins := []loginView{}
	rows, err = s.db.Query(ctx, `SELECT ok, method, ip, user_agent, created_at FROM login_history WHERE account_id=$1 ORDER BY id DESC LIMIT 50`, id)
	if err != nil {
		return err
	}
	for rows.Next() {
		var l loginView
		if err := rows.Scan(&l.OK, &l.Method, &l.IP, &l.UserAgent, &l.CreatedAt); err != nil {
			rows.Close()
			return err
		}
		logins = append(logins, l)
	}
	rows.Close()
	sessions := []sessionView{}
	rows, err = s.db.Query(ctx, `SELECT id, created_at, last_used_at, expires_at, ip, user_agent FROM sessions
		WHERE account_id=$1 AND revoked_at IS NULL AND expires_at > now() ORDER BY id DESC`, id)
	if err != nil {
		return err
	}
	for rows.Next() {
		var v sessionView
		if err := rows.Scan(&v.ID, &v.CreatedAt, &v.LastUsedAt, &v.ExpiresAt, &v.IP, &v.UserAgent); err != nil {
			rows.Close()
			return err
		}
		sessions = append(sessions, v)
	}
	rows.Close()
	audit, _, err := s.queryAudit(r, `a.target_type='account' AND a.target_id=$1`, []any{strconv.FormatInt(id, 10)}, 50, 0)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"account": acc, "characters": chars, "logins": logins, "sessions": sessions, "audit": audit})
}

// POST /admin/api/accounts/{id}/{action}
//
//	ban {hours (0 = vĩnh viễn), reason}   unban {reason}   mute {hours, reason}   unmute {reason}   — quyền GM
//	logout-all {reason}   reset-password {reason}   email {email, reason}                          — quyền Hỗ trợ
func (s *server) handleAdminAccountAction(w http.ResponseWriter, r *http.Request) error {
	action := r.PathValue("action")
	perm := permSupport
	switch action {
	case "ban", "unban", "mute", "unmute":
		perm = permPunish
	case "logout-all", "reset-password", "email":
	default:
		return errNotFound
	}
	ad, err := s.requireAdmin(r, perm)
	if err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var req struct {
		Hours  int    `json:"hours"`
		Reason string `json:"reason"`
		Email  string `json:"email"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	reason, err := needReason(req.Reason)
	if err != nil {
		return err
	}
	ctx := r.Context()
	var username, oldEmail string
	if err := s.db.QueryRow(ctx, `SELECT username, email FROM accounts WHERE id=$1`, id).Scan(&username, &oldEmail); errors.Is(err, pgx.ErrNoRows) {
		return errNotFound
	} else if err != nil {
		return err
	}
	until := func() *time.Time {
		if req.Hours <= 0 {
			return nil
		}
		t := time.Now().Add(time.Duration(req.Hours) * time.Hour)
		return &t
	}
	detail := map[string]any{"username": username}
	resp := map[string]any{"ok": true}
	// Đăng xuất mọi nơi: thu hồi refresh token + dời mốc password_changed_at để access token đang dùng hết hiệu lực ngay.
	const kickAll = `UPDATE sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL`
	const kickAccess = `UPDATE accounts SET password_changed_at=now() WHERE id=$1`
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	switch action {
	case "ban":
		if req.Hours < 0 || req.Hours > 24*365*10 {
			return errBadRequest
		}
		u := until()
		detail["hours"] = req.Hours
		if _, err := tx.Exec(ctx, `UPDATE accounts SET status='banned', banned_until=$2, ban_reason=$3 WHERE id=$1`, id, u, reason); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, kickAll, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, kickAccess, id); err != nil {
			return err
		}
	case "unban":
		if _, err := tx.Exec(ctx, `UPDATE accounts SET status='active', banned_until=NULL, ban_reason='' WHERE id=$1`, id); err != nil {
			return err
		}
	case "mute":
		if req.Hours <= 0 || req.Hours > 24*365 {
			return errBadRequest
		}
		detail["hours"] = req.Hours
		if _, err := tx.Exec(ctx, `UPDATE accounts SET muted_until=$2 WHERE id=$1`, id, until()); err != nil {
			return err
		}
	case "unmute":
		if _, err := tx.Exec(ctx, `UPDATE accounts SET muted_until=NULL WHERE id=$1`, id); err != nil {
			return err
		}
	case "logout-all":
		if _, err := tx.Exec(ctx, kickAll, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, kickAccess, id); err != nil {
			return err
		}
	case "reset-password":
		// Mật khẩu tạm chỉ trả về 1 lần cho admin đọc cho người chơi; không ghi vào nhật ký.
		temp, err := randomToken()
		if err != nil {
			return err
		}
		temp = strings.NewReplacer("-", "", "_", "").Replace(temp)[:10]
		hash, err := s.keys.hashPassword(temp)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE accounts SET password_hash=$2, password_changed_at=now() WHERE id=$1`, id, hash); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, kickAll, id); err != nil {
			return err
		}
		resp["temp_password"] = temp
	case "email":
		email := strings.TrimSpace(req.Email)
		if len(email) > 254 || !emailRe.MatchString(email) {
			return errBadEmail
		}
		detail["old_email"], detail["new_email"] = oldEmail, email
		if _, err := tx.Exec(ctx, `UPDATE accounts SET email=$2 WHERE id=$1`, id, email); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.audit(ctx, r, ad.ID, "account."+action, "account", strconv.FormatInt(id, 10), reason, detail)
	return writeJSON(w, http.StatusOK, resp)
}

// POST /admin/api/characters/{id}/restore {reason} — khôi phục nhân vật đã xóa (nếu tên và ô còn trống).
func (s *server) handleAdminRestoreCharacter(w http.ResponseWriter, r *http.Request) error {
	ad, err := s.requireAdmin(r, permPunish)
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
	err = s.db.QueryRow(r.Context(), `UPDATE characters SET deleted_at=NULL WHERE id=$1 AND deleted_at IS NOT NULL RETURNING account_id, name`, id).
		Scan(&accountID, &name)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		if pgErr.ConstraintName == "characters_slot_uniq" {
			return errSlotTaken
		}
		return errNameTaken
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return err
	}
	s.audit(r.Context(), r, ad.ID, "character.restore", "account", strconv.FormatInt(accountID, 10), reason,
		map[string]any{"character_id": id, "name": name})
	return writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------- máy chủ

type serverStat struct {
	ID         int       `json:"id"`
	Name       string    `json:"name"`
	Region     string    `json:"region"`
	Status     string    `json:"status"`
	IsNew      bool      `json:"is_new"`
	Host       string    `json:"host"`
	Port       int       `json:"port"`
	WSURL      string    `json:"ws_url"`
	SortOrder  int       `json:"sort_order"`
	OpenedAt   time.Time `json:"opened_at"`
	Characters int       `json:"characters"`
}

func (s *server) serverStats(r *http.Request) ([]serverStat, error) {
	rows, err := s.db.Query(r.Context(), `SELECT g.id, g.name, g.region, g.status, g.is_new, g.host, g.port, g.ws_url, g.sort_order, g.opened_at,
		(SELECT count(*) FROM characters c WHERE c.server_id=g.id AND c.deleted_at IS NULL) FROM game_servers g ORDER BY g.sort_order, g.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []serverStat{}
	for rows.Next() {
		var g serverStat
		if err := rows.Scan(&g.ID, &g.Name, &g.Region, &g.Status, &g.IsNew, &g.Host, &g.Port, &g.WSURL, &g.SortOrder, &g.OpenedAt, &g.Characters); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (s *server) handleAdminServers(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAdmin(r, permRead); err != nil {
		return err
	}
	list, err := s.serverStats(r)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"items": list})
}

// POST /admin/api/servers (tạo) và PUT /admin/api/servers/{id} (sửa) — chỉ Super Admin.
func (s *server) handleAdminSaveServer(w http.ResponseWriter, r *http.Request) error {
	ad, err := s.requireAdmin(r, permServers)
	if err != nil {
		return err
	}
	var req struct {
		ID        int    `json:"id"`
		Name      string `json:"name"`
		Region    string `json:"region"`
		Status    string `json:"status"`
		IsNew     bool   `json:"is_new"`
		Host      string `json:"host"`
		Port      int    `json:"port"`
		WSURL     string `json:"ws_url"`
		SortOrder int    `json:"sort_order"`
		Reason    string `json:"reason"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	reason, err := needReason(req.Reason)
	if err != nil {
		return err
	}
	req.Name = strings.TrimSpace(req.Name)
	validRegion := map[string]bool{"north": true, "central": true, "south": true}
	validStatus := map[string]bool{"normal": true, "crowded": true, "maintenance": true}
	if req.Name == "" || len([]rune(req.Name)) > 40 || !validRegion[req.Region] || !validStatus[req.Status] || req.Port < 0 || req.Port > 65535 {
		return errBadRequest
	}
	ctx := r.Context()
	action := "server.create"
	if r.Method == http.MethodPut {
		action = "server.update"
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			return errBadRequest
		}
		tag, err := s.db.Exec(ctx, `UPDATE game_servers SET name=$2, region=$3, status=$4, is_new=$5, host=$6, port=$7, ws_url=$8, sort_order=$9 WHERE id=$1`,
			id, req.Name, req.Region, req.Status, req.IsNew, req.Host, req.Port, req.WSURL, req.SortOrder)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errNotFound
		}
		req.ID = id
	} else {
		if req.ID <= 0 {
			return errBadRequest
		}
		_, err := s.db.Exec(ctx, `INSERT INTO game_servers(id, name, region, status, is_new, host, port, ws_url, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			req.ID, req.Name, req.Region, req.Status, req.IsNew, req.Host, req.Port, req.WSURL, req.SortOrder)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return newErr(http.StatusConflict, "id_taken", "Mã máy chủ đã tồn tại")
		}
		if err != nil {
			return err
		}
	}
	s.audit(ctx, r, ad.ID, action, "server", strconv.Itoa(req.ID), reason,
		map[string]any{"name": req.Name, "status": req.Status, "region": req.Region})
	return writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------- nhật ký

type auditView struct {
	ID         int64          `json:"id"`
	AdminID    *int64         `json:"admin_id"`
	Admin      string         `json:"admin"`
	Action     string         `json:"action"`
	TargetType string         `json:"target_type"`
	TargetID   string         `json:"target_id"`
	Target     string         `json:"target"`
	Reason     string         `json:"reason"`
	Detail     map[string]any `json:"detail"`
	IP         string         `json:"ip"`
	CreatedAt  time.Time      `json:"created_at"`
}

func (s *server) queryAudit(r *http.Request, where string, args []any, limit, offset int) ([]auditView, int, error) {
	if where == "" {
		where = "true"
	}
	var total int
	if err := s.db.QueryRow(r.Context(), `SELECT count(*) FROM admin_audit a WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	n := len(args)
	rows, err := s.db.Query(r.Context(), `SELECT a.id, a.admin_id, coalesce(ad.username, ''), a.action, a.target_type, a.target_id,
		CASE a.target_type
			WHEN 'account' THEN (SELECT username FROM accounts WHERE id::text = a.target_id)
			WHEN 'admin'   THEN (SELECT username FROM admins WHERE id::text = a.target_id)
			WHEN 'server'  THEN (SELECT name FROM game_servers WHERE id::text = a.target_id)
			ELSE '' END,
		a.reason, a.detail, a.ip, a.created_at
		FROM admin_audit a LEFT JOIN admins ad ON ad.id = a.admin_id WHERE `+where+
		` ORDER BY a.id DESC LIMIT $`+strconv.Itoa(n+1)+` OFFSET $`+strconv.Itoa(n+2), append(args, limit, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []auditView{}
	for rows.Next() {
		var v auditView
		var target *string
		if err := rows.Scan(&v.ID, &v.AdminID, &v.Admin, &v.Action, &v.TargetType, &v.TargetID, &target, &v.Reason, &v.Detail, &v.IP, &v.CreatedAt); err != nil {
			return nil, 0, err
		}
		if target != nil {
			v.Target = *target
		}
		out = append(out, v)
	}
	return out, total, rows.Err()
}

// GET /admin/api/audit?admin_id=&action=&target_type=&target_id=&page=&size=
func (s *server) handleAdminAudit(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAdmin(r, permRead); err != nil {
		return err
	}
	page, size, offset := pageParams(r)
	q := r.URL.Query()
	conds := []string{}
	args := []any{}
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, strings.ReplaceAll(cond, "?", "$"+strconv.Itoa(len(args))))
	}
	if v, err := strconv.ParseInt(q.Get("admin_id"), 10, 64); err == nil {
		add("a.admin_id = ?", v)
	}
	if v := q.Get("action"); v != "" {
		add("a.action LIKE ?", likeEscape(v)+"%")
	}
	if v := q.Get("target_type"); v != "" {
		add("a.target_type = ?", v)
	}
	if v := q.Get("target_id"); v != "" {
		add("a.target_id = ?", v)
	}
	items, total, err := s.queryAudit(r, strings.Join(conds, " AND "), args, size, offset)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "page": page, "size": size})
}

// ---------------------------------------------------------------- quản lý admin (Super Admin)

func (s *server) handleAdminAdmins(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAdmin(r, permManageAdmins); err != nil {
		return err
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+adminCols+` FROM admins ORDER BY id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []adminRow{}
	for rows.Next() {
		a, err := scanAdmin(rows)
		if err != nil {
			return err
		}
		items = append(items, a)
	}
	return writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func tempAdminPassword() (string, error) {
	t, err := randomToken()
	if err != nil {
		return "", err
	}
	return strings.NewReplacer("-", "", "_", "").Replace(t)[:16], nil
}

// POST /admin/api/admins {username, display_name, role, reason} — trả mật khẩu tạm 1 lần; admin mới phải đổi mật khẩu + bật 2FA.
func (s *server) handleAdminCreateAdmin(w http.ResponseWriter, r *http.Request) error {
	ad, err := s.requireAdmin(r, permManageAdmins)
	if err != nil {
		return err
	}
	var req struct {
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
		Role        string `json:"role"`
		Reason      string `json:"reason"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	reason, err := needReason(req.Reason)
	if err != nil {
		return err
	}
	username := normUsername(req.Username)
	if !usernameRe.MatchString(username) {
		return errBadUsername
	}
	if _, ok := roleRank[req.Role]; !ok {
		return errBadRequest
	}
	temp, err := tempAdminPassword()
	if err != nil {
		return err
	}
	hash, err := s.keys.hashPassword(temp)
	if err != nil {
		return err
	}
	var id int64
	err = s.db.QueryRow(r.Context(), `INSERT INTO admins(username, display_name, password_hash, role) VALUES ($1,$2,$3,$4)
		ON CONFLICT (username) DO NOTHING RETURNING id`, username, strings.TrimSpace(req.DisplayName), hash, req.Role).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return errUsernameTaken
	}
	if err != nil {
		return err
	}
	s.audit(r.Context(), r, ad.ID, "admin.create", "admin", strconv.FormatInt(id, 10), reason, map[string]any{"username": username, "role": req.Role})
	return writeJSON(w, http.StatusCreated, map[string]any{"id": id, "temp_password": temp})
}

// POST /admin/api/admins/{id}/{action}: update {display_name, role, disabled, reason} | reset-2fa {reason} | reset-password {reason}
func (s *server) handleAdminAdminAction(w http.ResponseWriter, r *http.Request) error {
	ad, err := s.requireAdmin(r, permManageAdmins)
	if err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var req struct {
		DisplayName *string `json:"display_name"`
		Role        *string `json:"role"`
		Disabled    *bool   `json:"disabled"`
		Reason      string  `json:"reason"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	reason, err := needReason(req.Reason)
	if err != nil {
		return err
	}
	ctx := r.Context()
	target, err := scanAdmin(s.db.QueryRow(ctx, `SELECT `+adminCols+` FROM admins WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return err
	}
	action := r.PathValue("action")
	resp := map[string]any{"ok": true}
	detail := map[string]any{"username": target.Username}
	switch action {
	case "update":
		if id == ad.ID && ((req.Role != nil && *req.Role != target.Role) || (req.Disabled != nil && *req.Disabled)) {
			return newErr(http.StatusBadRequest, "self_change", "Không thể tự đổi vai trò hoặc tự khóa chính mình")
		}
		role, disabled, name := target.Role, target.Disabled, target.DisplayName
		if req.Role != nil {
			if _, ok := roleRank[*req.Role]; !ok {
				return errBadRequest
			}
			role = *req.Role
		}
		if req.Disabled != nil {
			disabled = *req.Disabled
		}
		if req.DisplayName != nil {
			name = strings.TrimSpace(*req.DisplayName)
		}
		// Luôn còn ít nhất 1 Super Admin đang hoạt động.
		if target.Role == "super" && !target.Disabled && (role != "super" || disabled) {
			var n int
			if err := s.db.QueryRow(ctx, `SELECT count(*) FROM admins WHERE role='super' AND NOT disabled AND id<>$1`, id).Scan(&n); err != nil {
				return err
			}
			if n == 0 {
				return newErr(http.StatusBadRequest, "last_super", "Phải còn ít nhất 1 Super Admin")
			}
		}
		if _, err := s.db.Exec(ctx, `UPDATE admins SET role=$2, disabled=$3, display_name=$4,
			session_epoch = session_epoch + CASE WHEN $3 OR role<>$2 THEN 1 ELSE 0 END WHERE id=$1`, id, role, disabled, name); err != nil {
			return err
		}
		detail["role"], detail["disabled"], detail["old_role"] = role, disabled, target.Role
	case "reset-2fa":
		if _, err := s.db.Exec(ctx, `UPDATE admins SET totp_enabled=false, totp_secret='', totp_last_step=0, session_epoch=session_epoch+1 WHERE id=$1`, id); err != nil {
			return err
		}
	case "reset-password":
		temp, err := tempAdminPassword()
		if err != nil {
			return err
		}
		hash, err := s.keys.hashPassword(temp)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec(ctx, `UPDATE admins SET password_hash=$2, must_change_password=true, password_changed_at=now(),
			session_epoch=session_epoch+1 WHERE id=$1`, id, hash); err != nil {
			return err
		}
		resp["temp_password"] = temp
	default:
		return errNotFound
	}
	s.audit(ctx, r, ad.ID, "admin."+action, "admin", strconv.FormatInt(id, 10), reason, detail)
	return writeJSON(w, http.StatusOK, resp)
}
