package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	minPassword     = 6
	maxPassword     = 64
	maxResetAttempt = 5
)

var (
	usernameRe = regexp.MustCompile(`^[a-z0-9_]{3,20}$`)
	emailRe    = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

	errBadUsername   = newErr(http.StatusBadRequest, "bad_username", "Tên tài khoản dài 3–20 ký tự, chỉ gồm chữ không dấu, số và dấu _")
	errBadEmail      = newErr(http.StatusBadRequest, "bad_email", "Email không hợp lệ")
	errBadPassword   = newErr(http.StatusBadRequest, "bad_password", "Mật khẩu dài 6–64 ký tự")
	errUsernameTaken = newErr(http.StatusConflict, "username_taken", "Tên tài khoản đã có người dùng")
	errWrongLogin       = newErr(http.StatusUnauthorized, "wrong_login", "Sai tên tài khoản hoặc mật khẩu")
	errWrongPassword    = newErr(http.StatusUnauthorized, "wrong_password", "Mật khẩu hiện tại không đúng")
	errBadCode          = newErr(http.StatusBadRequest, "bad_code", "Mã xác nhận không đúng hoặc đã hết hạn")
	errLoggedElsewhere  = newErr(http.StatusUnauthorized, "logged_in_elsewhere", "Tài khoản vừa đăng nhập ở thiết bị khác")
)

type server struct {
	cfg        Config
	keys       *keyring
	db         *pgxpool.Pool
	redis      *redisClient
	mail       *mailer
	ipRL       *rateLimiter // mọi API tài khoản, theo IP
	http       *http.Client
	googleKeys *googleKeySet
	userRL     *rateLimiter // đăng nhập sai / quên mật khẩu, theo tên tài khoản
}

type sessionResp struct {
	AccessToken  string      `json:"access_token"`
	RefreshToken string      `json:"refresh_token"`
	ExpiresIn    int         `json:"expires_in"`
	Account      accountView `json:"account"`
}

type accountView struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	Email       string `json:"email"`
	HasPassword bool   `json:"has_password"`
	Google      bool   `json:"google_linked"`
	IsGM        bool   `json:"is_gm"`
}

type accountRow struct {
	ID           int64
	Username     string
	Email        string
	PasswordHash string
	GoogleSub    *string
	Status       string
	BannedUntil  *time.Time
	BanReason    string
	// Token cấp trước mốc này bị từ chối (đổi/đặt lại mật khẩu = đá mọi phiên đang mở, kể cả access token còn hạn).
	PasswordChangedAt time.Time
	IsGM         bool
	LastLoginAt  *time.Time
}

func (s *server) isGM(a accountRow) bool {
	if a.IsGM {
		return true
	}
	for _, gm := range s.cfg.GMAccounts {
		if strings.EqualFold(a.Username, strings.TrimSpace(gm)) {
			return true
		}
	}
	var role string
	if err := s.db.QueryRow(context.Background(), `SELECT role FROM admins WHERE lower(username)=lower($1) AND NOT disabled`, a.Username).Scan(&role); err == nil {
		if role == "gm" || role == "super" {
			return true
		}
	}
	return false
}

func (s *server) accountView(a accountRow) accountView {
	return accountView{
		ID:          a.ID,
		Username:    a.Username,
		Email:       a.Email,
		HasPassword: a.PasswordHash != "",
		Google:      a.GoogleSub != nil,
		IsGM:        s.isGM(a),
	}
}

const accountCols = `id, username, email, password_hash, google_sub, status, banned_until, ban_reason, password_changed_at, is_gm, last_login_at`

func scanAccount(row pgx.Row) (accountRow, error) {
	var a accountRow
	err := row.Scan(&a.ID, &a.Username, &a.Email, &a.PasswordHash, &a.GoogleSub, &a.Status, &a.BannedUntil, &a.BanReason, &a.PasswordChangedAt, &a.IsGM, &a.LastLoginAt)
	return a, err
}

func (s *server) accountByName(ctx context.Context, username string) (accountRow, error) {
	return scanAccount(s.db.QueryRow(ctx, `SELECT `+accountCols+` FROM accounts WHERE username=$1`, username))
}

func (s *server) accountByID(ctx context.Context, id int64) (accountRow, error) {
	return scanAccount(s.db.QueryRow(ctx, `SELECT `+accountCols+` FROM accounts WHERE id=$1`, id))
}

// banError trả lỗi nếu tài khoản đang bị khóa; khóa có hạn đã hết thì tự mở.
func (s *server) banError(ctx context.Context, a accountRow) error {
	if a.Status != "banned" {
		return nil
	}
	if a.BannedUntil != nil && time.Now().After(*a.BannedUntil) {
		_, err := s.db.Exec(ctx, `UPDATE accounts SET status='active', banned_until=NULL, ban_reason='' WHERE id=$1`, a.ID)
		return err
	}
	msg := "Tài khoản đã bị khóa vĩnh viễn"
	if a.BannedUntil != nil {
		msg = "Tài khoản bị khóa đến " + a.BannedUntil.In(vnZone).Format("15:04 02/01/2006")
	}
	if a.BanReason != "" {
		msg += ". Lý do: " + a.BanReason
	}
	return newErr(http.StatusForbidden, "banned", msg)
}

var vnZone = time.FixedZone("ICT", 7*3600)

func normUsername(u string) string { return strings.ToLower(strings.TrimSpace(u)) }

var errPasswordIsName = newErr(http.StatusBadRequest, "password_is_username", "Mật khẩu không được trùng tên tài khoản")

func checkNewPassword(p, username string) error {
	if n := utf8.RuneCountInString(p); n < minPassword || n > maxPassword {
		return errBadPassword
	}
	if strings.Contains(strings.ToLower(p), username) {
		return errPasswordIsName
	}
	return nil
}

// ---------------------------------------------------------------- token

// accessToken ký JWT bằng Ed25519 (EdDSA). Header mang "kid" để đổi khóa mà không làm hỏng token đang dùng.
func (s *server) accessToken(a accountRow) (string, string, error) {
	now := time.Now()
	jti, err := randomToken()
	if err != nil {
		return "", "", err
	}
	jtiStr := jti[:16]
	claims := jwt.MapClaims{
		"iss":  s.cfg.JWTIssuer,
		"aud":  s.cfg.JWTAudience,
		"sub":  strconv.FormatInt(a.ID, 10),
		"name": a.Username,
		"typ":  "access",
		"jti":  jtiStr,
		"iat":  now.Unix(),
		"nbf":  now.Unix(),
		"exp":  now.Add(s.cfg.AccessTTL).Unix(),
	}
	t := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	t.Header["kid"] = s.keys.signKID
	tok, err := t.SignedString(s.keys.signKey)
	return tok, jtiStr, err
}

// parseAccess kiểm tra access token (chữ ký theo kid, thuật toán, iss, aud, hạn), trả về id tài khoản.
// Game server làm đúng các bước này với khóa công khai lấy từ /.well-known/jwks.json.
func (s *server) parseAccess(tok string) (id int64, issuedAt time.Time, jti string, err error) {
	t, err := jwt.Parse(tok, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		if pub, ok := s.keys.verify[kid]; ok {
			return pub, nil
		}
		return nil, errUnauthorized
	},
		jwt.WithValidMethods([]string{"EdDSA"}),
		jwt.WithIssuer(s.cfg.JWTIssuer),
		jwt.WithAudience(s.cfg.JWTAudience),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(30*time.Second))
	if err != nil {
		return 0, time.Time{}, "", errUnauthorized
	}
	claims, _ := t.Claims.(jwt.MapClaims)
	if claims["typ"] != "access" {
		return 0, time.Time{}, "", errUnauthorized
	}
	sub, _ := claims["sub"].(string)
	id, err = strconv.ParseInt(sub, 10, 64)
	if err != nil {
		return 0, time.Time{}, "", errUnauthorized
	}
	iat, err := claims.GetIssuedAt()
	if err != nil || iat == nil {
		return 0, time.Time{}, "", errUnauthorized
	}
	jti, _ = claims["jti"].(string)
	return id, iat.Time, jti, nil
}

// issue tạo phiên mới: refresh token (lưu hash trong DB) + access token.
func (s *server) issue(ctx context.Context, a accountRow, r *http.Request) (sessionResp, error) {
	// Thu hồi tất cả phiên cũ của tài khoản này để 1 tài khoản chỉ mở được 1 phiên
	_, _ = s.db.Exec(ctx, `UPDATE sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL`, a.ID)

	refresh, err := randomToken()
	if err != nil {
		return sessionResp{}, err
	}
	_, err = s.db.Exec(ctx, `INSERT INTO sessions(account_id, token_hash, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5)`,
		a.ID, s.keys.tokenHash(refresh), time.Now().Add(s.cfg.RefreshTTL), clientIP(r, s.cfg.TrustProxy), userAgent(r))
	if err != nil {
		return sessionResp{}, err
	}
	access, jti, err := s.accessToken(a)
	if err != nil {
		return sessionResp{}, err
	}

	// Đánh dấu session jti mới nhất vào Redis
	if s.redis != nil && jti != "" {
		_ = s.redis.Set(ctx, fmt.Sprintf("auth:active_jti:%d", a.ID), jti, s.cfg.AccessTTL)
	}

	// Cập nhật last_login_at
	_, _ = s.db.Exec(ctx, `UPDATE accounts SET last_login_at=now() WHERE id=$1`, a.ID)

	return sessionResp{AccessToken: access, RefreshToken: refresh, ExpiresIn: int(s.cfg.AccessTTL.Seconds()), Account: s.accountView(a)}, nil
}

func (s *server) logLogin(ctx context.Context, id int64, ok bool, method string, r *http.Request) {
	ip := clientIP(r, s.cfg.TrustProxy)
	if _, err := s.db.Exec(ctx, `INSERT INTO login_history(account_id, ok, method, ip, user_agent) VALUES ($1,$2,$3,$4,$5)`,
		id, ok, method, ip, userAgent(r)); err != nil {
		log.Printf("login_history: %v", err)
	}
	if ok {
		s.db.Exec(ctx, `UPDATE accounts SET last_login_at=now(), last_login_ip=$2 WHERE id=$1`, id, ip)
	}
}

// requireAccount đọc "Authorization: Bearer <access>" và nạp tài khoản (kiểm tra luôn khóa).
func (s *server) requireAccount(r *http.Request) (accountRow, error) {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return accountRow{}, errUnauthorized
	}
	id, issuedAt, jti, err := s.parseAccess(strings.TrimPrefix(h, "Bearer "))
	if err != nil {
		return accountRow{}, err
	}

	// 1. Kiểm tra session qua Redis nếu có
	if s.redis != nil && jti != "" {
		if activeJTI, err := s.redis.Get(r.Context(), fmt.Sprintf("auth:active_jti:%d", id)); err == nil && activeJTI != "" {
			if activeJTI != jti {
				return accountRow{}, errLoggedElsewhere
			}
		}
	}

	a, err := s.accountByID(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		return accountRow{}, errUnauthorized
	}
	if err != nil {
		return accountRow{}, err
	}
	// iat chỉ chính xác tới giây: so với mốc đổi mật khẩu làm tròn xuống giây để token mới cấp ngay sau đó vẫn hợp lệ.
	if issuedAt.Before(a.PasswordChangedAt.Truncate(time.Second)) {
		return accountRow{}, errUnauthorized
	}

	// 2. Kiểm tra nếu có phiên đăng nhập mới hơn trên DB (fallback khi Redis chưa có hoặc đã hết hạn)
	if a.LastLoginAt != nil && a.LastLoginAt.After(issuedAt.Add(2*time.Second)) {
		return accountRow{}, errLoggedElsewhere
	}

	return a, s.banError(r.Context(), a)
}

// handleCheckSession kiểm tra xem phiên của token hiện tại còn hiệu lực không (chưa bị đá)
func (s *server) handleCheckSession(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"account_id": a.ID,
		"username":   a.Username,
	})
}

func (s *server) limitIP(r *http.Request) error {
	if !s.ipRL.allow(clientIP(r, s.cfg.TrustProxy)) {
		return errRateLimited
	}
	return nil
}

// ---------------------------------------------------------------- handlers

func (s *server) handleRegister(w http.ResponseWriter, r *http.Request) error {
	if err := s.limitIP(r); err != nil {
		return err
	}
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	username := normUsername(req.Username)
	email := strings.TrimSpace(req.Email)
	switch {
	case !usernameRe.MatchString(username):
		return errBadUsername
	case len(email) > 254 || !emailRe.MatchString(email):
		return errBadEmail
	}
	if err := checkNewPassword(req.Password, username); err != nil {
		return err
	}
	hash, err := s.keys.hashPassword(req.Password)
	if err != nil {
		return err
	}
	a, err := scanAccount(s.db.QueryRow(r.Context(),
		`INSERT INTO accounts(username, email, password_hash, created_ip) VALUES ($1,$2,$3,$4)
		 ON CONFLICT (username) DO NOTHING RETURNING `+accountCols,
		username, email, hash, clientIP(r, s.cfg.TrustProxy)))
	if errors.Is(err, pgx.ErrNoRows) {
		return errUsernameTaken
	}
	if err != nil {
		return err
	}
	s.logLogin(r.Context(), a.ID, true, "register", r)
	resp, err := s.issue(r.Context(), a, r)
	if err != nil {
		return err
	}
	return s.writeSession(w, r, http.StatusCreated, resp)
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) error {
	if err := s.limitIP(r); err != nil {
		return err
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	username := normUsername(req.Username)
	if !s.userRL.allow("login:" + username) {
		return errRateLimited
	}
	a, err := s.accountByName(r.Context(), username)
	if errors.Is(err, pgx.ErrNoRows) {
		s.keys.burnPasswordCheck(req.Password)
		return errWrongLogin
	}
	if err != nil {
		return err
	}
	if a.PasswordHash == "" {
		s.keys.burnPasswordCheck(req.Password)
		s.logLogin(r.Context(), a.ID, false, "password", r)
		return errWrongLogin
	}
	ok, needRehash := s.keys.checkPassword(req.Password, a.PasswordHash)
	if !ok {
		s.logLogin(r.Context(), a.ID, false, "password", r)
		return errWrongLogin
	}
	if needRehash {
		if hash, err := s.keys.hashPassword(req.Password); err == nil {
			s.db.Exec(r.Context(), `UPDATE accounts SET password_hash=$2 WHERE id=$1`, a.ID, hash)
		}
	}
	if err := s.banError(r.Context(), a); err != nil {
		return err
	}
	s.logLogin(r.Context(), a.ID, true, "password", r)
	resp, err := s.issue(r.Context(), a, r)
	if err != nil {
		return err
	}
	return s.writeSession(w, r, http.StatusOK, resp)
}

// handleRefresh đổi refresh token cũ lấy cặp token mới (xoay vòng). Dùng lại token đã đổi = dấu hiệu
// token bị đánh cắp -> thu hồi mọi phiên của tài khoản.
func (s *server) handleRefresh(w http.ResponseWriter, r *http.Request) error {
	if err := s.limitIP(r); err != nil {
		return err
	}
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	ctx := r.Context()
	var sid, accountID int64
	var expires time.Time
	var revoked *time.Time
	err := s.db.QueryRow(ctx, `SELECT id, account_id, expires_at, revoked_at FROM sessions WHERE token_hash=$1`, s.keys.tokenHash(refreshTokenOf(r, req.RefreshToken))).
		Scan(&sid, &accountID, &expires, &revoked)
	if errors.Is(err, pgx.ErrNoRows) {
		return errUnauthorized
	}
	if err != nil {
		return err
	}
	if revoked != nil {
		s.db.Exec(ctx, `UPDATE sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL`, accountID)
		log.Printf("refresh token tái sử dụng: tài khoản %d — đã thu hồi mọi phiên", accountID)
		return errUnauthorized
	}
	if time.Now().After(expires) {
		return errUnauthorized
	}
	tag, err := s.db.Exec(ctx, `UPDATE sessions SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL`, sid)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 { // 2 yêu cầu refresh cùng lúc: chỉ 1 cái thắng
		return errUnauthorized
	}
	a, err := s.accountByID(ctx, accountID)
	if err != nil {
		return err
	}
	if err := s.banError(ctx, a); err != nil {
		return err
	}
	resp, err := s.issue(ctx, a, r)
	if err != nil {
		return err
	}
	return s.writeSession(w, r, http.StatusOK, resp)
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	if _, err := s.db.Exec(r.Context(), `UPDATE sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`, s.keys.tokenHash(refreshTokenOf(r, req.RefreshToken))); err != nil {
		return err
	}
	if isWeb(r) {
		s.setWebCookie(w, "", -1)
	}
	return writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleForgot luôn trả "ok" như nhau dù tên/email có khớp hay không (chống dò tài khoản).
// Thư gửi ở goroutine riêng để thời gian trả lời không lộ việc có gửi thư hay không.
func (s *server) handleForgot(w http.ResponseWriter, r *http.Request) error {
	if err := s.limitIP(r); err != nil {
		return err
	}
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	username := normUsername(req.Username)
	if !s.userRL.allow("forgot:" + username) {
		return errRateLimited
	}
	ok := map[string]any{"ok": true, "expires_in": int(s.cfg.ResetTTL.Seconds())}
	a, err := s.accountByName(r.Context(), username)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !strings.EqualFold(a.Email, strings.TrimSpace(req.Email))) {
		return writeJSON(w, http.StatusOK, ok)
	}
	if err != nil {
		return err
	}
	code, err := randomDigits(6)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(r.Context(),
		`INSERT INTO password_resets(account_id, code_hash, expires_at) VALUES ($1,$2,$3)
		 ON CONFLICT (account_id) DO UPDATE SET code_hash=EXCLUDED.code_hash, expires_at=EXCLUDED.expires_at, attempts=0, created_at=now()`,
		a.ID, s.keys.tokenHash(code), time.Now().Add(s.cfg.ResetTTL))
	if err != nil {
		return err
	}
	go func() {
		if err := s.mail.sendResetCode(a.Email, a.Username, code, s.cfg.ResetTTL); err != nil {
			log.Printf("gửi mail quên mật khẩu cho tài khoản %d: %v", a.ID, err)
		}
	}()
	return writeJSON(w, http.StatusOK, ok)
}

func (s *server) handleReset(w http.ResponseWriter, r *http.Request) error {
	if err := s.limitIP(r); err != nil {
		return err
	}
	var req struct {
		Username    string `json:"username"`
		Code        string `json:"code"`
		NewPassword string `json:"new_password"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	if err := checkNewPassword(req.NewPassword, normUsername(req.Username)); err != nil {
		return err
	}
	ctx := r.Context()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var id int64
	var codeHash []byte
	var expires time.Time
	var attempts int
	err = tx.QueryRow(ctx, `SELECT a.id, p.code_hash, p.expires_at, p.attempts FROM password_resets p
		JOIN accounts a ON a.id=p.account_id WHERE a.username=$1 FOR UPDATE OF p`, normUsername(req.Username)).
		Scan(&id, &codeHash, &expires, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return errBadCode
	}
	if err != nil {
		return err
	}
	if time.Now().After(expires) || attempts >= maxResetAttempt {
		tx.Exec(ctx, `DELETE FROM password_resets WHERE account_id=$1`, id)
		tx.Commit(ctx)
		return errBadCode
	}
	if subtle.ConstantTimeCompare(codeHash, s.keys.tokenHash(strings.TrimSpace(req.Code))) != 1 {
		tx.Exec(ctx, `UPDATE password_resets SET attempts=attempts+1 WHERE account_id=$1`, id)
		tx.Commit(ctx)
		return errBadCode
	}
	hash, err := s.keys.hashPassword(req.NewPassword)
	if err != nil {
		return err
	}
	for _, q := range []string{
		`UPDATE accounts SET password_hash=$2, password_changed_at=now() WHERE id=$1`,
		`UPDATE sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL`,
		`DELETE FROM password_resets WHERE account_id=$1`,
	} {
		args := []any{id}
		if strings.Contains(q, "$2") {
			args = append(args, hash)
		}
		if _, err := tx.Exec(ctx, q, args...); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleChangePassword: đổi mật khẩu trong game. Thu hồi mọi phiên cũ (các máy khác bị đăng xuất), trả phiên mới cho máy này.
func (s *server) handleChangePassword(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	if !s.userRL.allow("change:" + a.Username) {
		return errRateLimited
	}
	if a.PasswordHash != "" {
		if ok, _ := s.keys.checkPassword(req.OldPassword, a.PasswordHash); !ok {
			return errWrongPassword
		}
	}
	if err := checkNewPassword(req.NewPassword, a.Username); err != nil {
		return err
	}
	hash, err := s.keys.hashPassword(req.NewPassword)
	if err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := s.db.Exec(ctx, `UPDATE accounts SET password_hash=$2, password_changed_at=now() WHERE id=$1`, a.ID, hash); err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx, `UPDATE sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL`, a.ID); err != nil {
		return err
	}
	a.PasswordHash = hash
	resp, err := s.issue(ctx, a, r)
	if err != nil {
		return err
	}
	return s.writeSession(w, r, http.StatusOK, resp)
}

func (s *server) handleMe(w http.ResponseWriter, r *http.Request) error {
	a, err := s.requireAccount(r)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, s.accountView(a))
}
