package main

import (
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Đăng nhập Google (OAuth 2.0 + OpenID Connect, PKCE) qua trình duyệt hệ thống:
//
//	game  --POST /v1/auth/google/start-->  server  (tạo state + poll_secret, trả auth_url)
//	game  mở trình duyệt auth_url -> người chơi đăng nhập Google -> Google chuyển về GET /v1/auth/google/callback
//	server đổi code lấy ID token (client secret chỉ nằm ở server), xác minh chữ ký + aud + iss + nonce + email_verified
//	game  --POST /v1/auth/google/poll {state, poll_secret}-->  nhận phiên đăng nhập (1 lần duy nhất)
//
// Có Bearer token khi /start = LIÊN KẾT Google vào tài khoản đang đăng nhập. Không tự gộp theo email
// (email tài khoản thường chưa được xác thực -> gộp tự động có thể bị chiếm tài khoản).
const (
	googleLoginTTL     = 5 * time.Minute
	googlePollInterval = 2
)

var (
	errGoogleDisabled = newErr(http.StatusServiceUnavailable, "google_disabled", "Đăng nhập Google chưa được bật trên máy chủ")
	errGoogleExpired  = newErr(http.StatusGone, "google_expired", "Phiên đăng nhập Google đã hết hạn, hãy thử lại")
	errGoogleInUse    = newErr(http.StatusConflict, "google_in_use", "Tài khoản Google này đã liên kết với tài khoản game khác")
	errGoogleLinked   = newErr(http.StatusConflict, "google_already_linked", "Tài khoản đã liên kết với một tài khoản Google khác")
	errGoogleFailed   = newErr(http.StatusBadGateway, "google_failed", "Không xác minh được đăng nhập Google, hãy thử lại")
	errGoogleCanceled = newErr(http.StatusBadRequest, "google_canceled", "Đã hủy đăng nhập Google")
)

func (s *server) googleEnabled() bool {
	return s.cfg.GoogleClientID != "" && s.cfg.GoogleClientSecret != "" && s.cfg.PublicBaseURL != ""
}

func (s *server) googleRedirectURI() string {
	return strings.TrimSuffix(s.cfg.PublicBaseURL, "/") + "/v1/auth/google/callback"
}

func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// POST /v1/auth/google/start
func (s *server) handleGoogleStart(w http.ResponseWriter, r *http.Request) error {
	if !s.googleEnabled() {
		return errGoogleDisabled
	}
	if err := s.limitIP(r); err != nil {
		return err
	}
	var linkID any
	if r.Header.Get("Authorization") != "" {
		a, err := s.requireAccount(r)
		if err != nil {
			return err
		}
		if a.GoogleSub != nil {
			return errGoogleLinked
		}
		linkID = a.ID
	}
	state, err1 := randomToken()
	poll, err2 := randomToken()
	verifier, err3 := randomToken()
	nonce, err4 := randomToken()
	if err := errors.Join(err1, err2, err3, err4); err != nil {
		return err
	}
	_, err := s.db.Exec(r.Context(), `INSERT INTO oauth_logins(state, poll_hash, code_verifier, nonce, link_account_id, created_ip, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, state, s.keys.tokenHash(poll), verifier, nonce, linkID, clientIP(r, s.cfg.TrustProxy), time.Now().Add(googleLoginTTL))
	if err != nil {
		return err
	}
	challenge := sha256.Sum256([]byte(verifier))
	q := url.Values{
		"client_id": {s.cfg.GoogleClientID}, "redirect_uri": {s.googleRedirectURI()}, "response_type": {"code"},
		"scope": {"openid email profile"}, "state": {state}, "nonce": {nonce},
		"code_challenge": {b64url(challenge[:])}, "code_challenge_method": {"S256"},
		"prompt": {"select_account"}, "access_type": {"online"},
	}
	return writeJSON(w, http.StatusOK, map[string]any{
		"auth_url": s.cfg.GoogleAuthURL + "?" + q.Encode(), "state": state, "poll_secret": poll,
		"interval": googlePollInterval, "expires_in": int(googleLoginTTL.Seconds()),
	})
}

// GET /v1/auth/google/callback — Google chuyển trình duyệt về đây. Trả trang HTML báo người chơi quay lại game.
func (s *server) handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	state := q.Get("state")
	ctx := r.Context()
	var verifier, nonce string
	var linkID *int64
	err := s.db.QueryRow(ctx, `SELECT code_verifier, nonce, link_account_id FROM oauth_logins
		WHERE state=$1 AND completed_at IS NULL AND expires_at > now()`, state).Scan(&verifier, &nonce, &linkID)
	if err != nil {
		googlePage(w, http.StatusBadRequest, false, "Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Hãy quay lại game và thử lại.")
		return
	}
	finish := func(accountID *int64, code string) {
		if _, err := s.db.Exec(ctx, `UPDATE oauth_logins SET completed_at=now(), account_id=$2, error_code=$3 WHERE state=$1`, state, accountID, code); err != nil {
			log.Printf("google callback: %v", err)
		}
	}
	if q.Get("error") != "" || q.Get("code") == "" {
		finish(nil, errGoogleCanceled.Code)
		googlePage(w, http.StatusOK, false, "Bạn đã hủy đăng nhập Google. Có thể đóng trang này và quay lại game.")
		return
	}
	claims, err := s.googleExchange(ctx, q.Get("code"), verifier, nonce)
	if err != nil {
		log.Printf("google exchange: %v", err)
		finish(nil, errGoogleFailed.Code)
		googlePage(w, http.StatusOK, false, "Không xác minh được tài khoản Google. Hãy quay lại game và thử lại.")
		return
	}
	id, err := s.googleAccount(ctx, r, claims, linkID)
	var ae *apiError
	if errors.As(err, &ae) {
		finish(nil, ae.Code)
		googlePage(w, http.StatusOK, false, ae.Message+". Có thể đóng trang này và quay lại game.")
		return
	}
	if err != nil {
		log.Printf("google account: %v", err)
		finish(nil, errInternal.Code)
		googlePage(w, http.StatusOK, false, "Máy chủ gặp sự cố. Hãy quay lại game và thử lại.")
		return
	}
	finish(&id, "")
	msg := "Đăng nhập thành công! Hãy quay lại game — có thể đóng trang này."
	if linkID != nil {
		msg = "Đã liên kết tài khoản Google! Hãy quay lại game — có thể đóng trang này."
	}
	googlePage(w, http.StatusOK, true, msg)
}

// POST /v1/auth/google/poll {state, poll_secret} — 202 khi chưa xong; xong thì trả phiên đăng nhập và xóa bản ghi.
func (s *server) handleGooglePoll(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		State      string `json:"state"`
		PollSecret string `json:"poll_secret"`
	}
	if err := readJSON(r, &req); err != nil {
		return err
	}
	ctx := r.Context()
	var pollHash []byte
	var accountID, linkID *int64
	var code string
	var expires time.Time
	var completed *time.Time
	err := s.db.QueryRow(ctx, `SELECT poll_hash, account_id, link_account_id, error_code, expires_at, completed_at FROM oauth_logins WHERE state=$1`,
		req.State).Scan(&pollHash, &accountID, &linkID, &code, &expires, &completed)
	if errors.Is(err, pgx.ErrNoRows) {
		return errGoogleExpired
	}
	if err != nil {
		return err
	}
	if subtle.ConstantTimeCompare(pollHash, s.keys.tokenHash(req.PollSecret)) != 1 {
		return errUnauthorized
	}
	if completed == nil {
		if time.Now().After(expires) {
			s.db.Exec(ctx, `DELETE FROM oauth_logins WHERE state=$1`, req.State)
			return errGoogleExpired
		}
		return writeJSON(w, http.StatusAccepted, map[string]string{"status": "pending"})
	}
	// Kết quả chỉ lấy được 1 lần.
	tag, err := s.db.Exec(ctx, `DELETE FROM oauth_logins WHERE state=$1`, req.State)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errGoogleExpired
	}
	if code != "" || accountID == nil {
		for _, e := range []*apiError{errGoogleCanceled, errGoogleInUse, errGoogleLinked, errGoogleFailed} {
			if e.Code == code {
				return e
			}
		}
		return errGoogleFailed
	}
	a, err := s.accountByID(ctx, *accountID)
	if err != nil {
		return err
	}
	if err := s.banError(ctx, a); err != nil {
		return err
	}
	s.logLogin(ctx, a.ID, true, "google", r)
	resp, err := s.issue(ctx, a, r)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, resp)
}

// ---------------------------------------------------------------- Google

type googleClaims struct {
	Sub           string
	Email         string
	EmailVerified bool
	Name          string
}

func (s *server) googleExchange(ctx context.Context, code, verifier, nonce string) (googleClaims, error) {
	form := url.Values{
		"code": {code}, "client_id": {s.cfg.GoogleClientID}, "client_secret": {s.cfg.GoogleClientSecret},
		"redirect_uri": {s.googleRedirectURI()}, "grant_type": {"authorization_code"}, "code_verifier": {verifier},
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.GoogleTokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := s.http.Do(req)
	if err != nil {
		return googleClaims{}, err
	}
	defer res.Body.Close()
	var body struct {
		IDToken string `json:"id_token"`
		Error   string `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return googleClaims{}, err
	}
	if res.StatusCode != http.StatusOK || body.IDToken == "" {
		return googleClaims{}, fmt.Errorf("token endpoint %d: %s", res.StatusCode, body.Error)
	}
	return s.verifyGoogleIDToken(ctx, body.IDToken, nonce)
}

func (s *server) verifyGoogleIDToken(ctx context.Context, raw, nonce string) (googleClaims, error) {
	t, err := jwt.Parse(raw, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		return s.googleKeys.key(ctx, kid)
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithAudience(s.cfg.GoogleClientID), jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(), jwt.WithLeeway(time.Minute))
	if err != nil {
		return googleClaims{}, err
	}
	m, _ := t.Claims.(jwt.MapClaims)
	iss, _ := m["iss"].(string)
	if iss != "accounts.google.com" && iss != "https://accounts.google.com" && iss != s.cfg.GoogleIssuer {
		return googleClaims{}, fmt.Errorf("iss lạ: %s", iss)
	}
	if n, _ := m["nonce"].(string); subtle.ConstantTimeCompare([]byte(n), []byte(nonce)) != 1 {
		return googleClaims{}, errors.New("nonce không khớp")
	}
	c := googleClaims{}
	c.Sub, _ = m["sub"].(string)
	c.Email, _ = m["email"].(string)
	c.Name, _ = m["name"].(string)
	switch v := m["email_verified"].(type) {
	case bool:
		c.EmailVerified = v
	case string:
		c.EmailVerified = v == "true"
	}
	if c.Sub == "" || c.Email == "" || !c.EmailVerified {
		return googleClaims{}, errors.New("thiếu sub/email hoặc email chưa xác minh")
	}
	return c, nil
}

// googleAccount tìm tài khoản theo google_sub, tạo mới nếu chưa có, hoặc liên kết vào linkID.
func (s *server) googleAccount(ctx context.Context, r *http.Request, c googleClaims, linkID *int64) (int64, error) {
	var id int64
	err := s.db.QueryRow(ctx, `SELECT id FROM accounts WHERE google_sub=$1`, c.Sub).Scan(&id)
	found := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	if linkID != nil {
		if found && id != *linkID {
			return 0, errGoogleInUse
		}
		if found {
			return id, nil
		}
		tag, err := s.db.Exec(ctx, `UPDATE accounts SET google_sub=$2 WHERE id=$1 AND google_sub IS NULL`, *linkID, c.Sub)
		if err != nil {
			return 0, uniqueAsInUse(err)
		}
		if tag.RowsAffected() == 0 {
			return 0, errGoogleLinked
		}
		return *linkID, nil
	}
	if found {
		return id, nil
	}
	base := googleUsername(c.Email)
	for i := 0; i < 8; i++ {
		name := base
		if i > 0 {
			suffix, _ := randomDigits(4)
			name = base[:min(len(base), 15)] + "_" + suffix
		}
		err = s.db.QueryRow(ctx, `INSERT INTO accounts(username, email, google_sub, created_ip) VALUES ($1,$2,$3,$4)
			ON CONFLICT (username) DO NOTHING RETURNING id`, name, c.Email, c.Sub, clientIP(r, s.cfg.TrustProxy)).Scan(&id)
		if err == nil {
			s.logLogin(ctx, id, true, "register", r)
			return id, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return 0, uniqueAsInUse(err)
		}
	}
	return 0, errors.New("không tạo được tên tài khoản")
}

func uniqueAsInUse(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return errGoogleInUse
	}
	return err
}

var nonUsername = regexp.MustCompile(`[^a-z0-9_]+`)

// googleUsername: phần trước @ của email, chỉ giữ a-z 0-9 _, 3–20 ký tự.
func googleUsername(email string) string {
	local, _, _ := strings.Cut(strings.ToLower(email), "@")
	u := strings.Trim(nonUsername.ReplaceAllString(local, "_"), "_")
	if len(u) > 20 {
		u = u[:20]
	}
	for len(u) < 3 {
		u += "x"
	}
	return u
}

// googleKeySet: khóa công khai của Google (JWKS), lưu tạm 1 giờ, nạp lại khi gặp kid lạ (Google xoay khóa định kỳ).
type googleKeySet struct {
	url    string
	client *http.Client
	mu     sync.Mutex
	keys   map[string]*rsa.PublicKey
	at     time.Time
}

func (g *googleKeySet) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if k, ok := g.keys[kid]; ok && time.Since(g.at) < time.Hour {
		return k, nil
	}
	if time.Since(g.at) > 10*time.Second || g.keys == nil {
		if err := g.refresh(ctx); err != nil {
			return nil, err
		}
	}
	if k, ok := g.keys[kid]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("không có khóa Google kid=%s", kid)
}

func (g *googleKeySet) refresh(ctx context.Context) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, g.url, nil)
	res, err := g.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var set struct {
		Keys []struct {
			Kid, Kty, N, E string
		} `json:"keys"`
	}
	if err := json.NewDecoder(res.Body).Decode(&set); err != nil {
		return err
	}
	keys := map[string]*rsa.PublicKey{}
	for _, k := range set.Keys {
		if k.Kty != "RSA" {
			continue
		}
		n, err1 := base64.RawURLEncoding.DecodeString(k.N)
		e, err2 := base64.RawURLEncoding.DecodeString(k.E)
		if err1 != nil || err2 != nil {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	g.keys, g.at = keys, time.Now()
	return nil
}

func googlePage(w http.ResponseWriter, status int, ok bool, msg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	w.WriteHeader(status)
	icon, color := "✕", "#c82828"
	if ok {
		icon, color = "✓", "#16874c"
	}
	fmt.Fprintf(w, `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kiếm Hiệp</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f5f3;color:#1c1917;
font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px;box-sizing:border-box}
@media (prefers-color-scheme:dark){body{background:#11100f;color:#eeebe6}.c{background:#1a1817!important;border-color:#302d2a!important}}
.c{max-width:380px;width:100%%;background:#fff;border:1px solid #e4e1dc;border-radius:14px;padding:32px 24px;text-align:center}
.i{width:52px;height:52px;border-radius:50%%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;
font-size:26px;color:#fff;background:%s}h1{font-size:18px;margin:0 0 8px}p{margin:0;line-height:1.5;opacity:.8}
</style></head><body><div class="c"><div class="i">%s</div><h1>Kiếm Hiệp</h1><p>%s</p></div></body></html>`, color, icon, html.EscapeString(msg))
}

// dọn bản ghi đăng nhập Google hết hạn.
func (s *server) cleanupOAuth(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Minute):
			s.db.Exec(ctx, `DELETE FROM oauth_logins WHERE expires_at < now() - interval '10 minutes'`)
		}
	}
}
