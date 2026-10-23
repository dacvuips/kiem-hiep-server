package main

// Kiểm thử tích hợp đăng nhập Google với 1 "Google giả" (httptest) và database thật.
// Chạy trong mạng docker compose (cần DATABASE_URL + các khóa trong .env):
//
//	docker run --rm --network server_default --env-file .env -e DATABASE_URL=postgres://kiemhiep:$DB_PASSWORD@postgres:5432/kiemhiep?sslmode=disable \
//	  -v "$PWD/account:/src" -w /src golang:1.23-alpine go test -run Google -v ./...

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type fakeGoogle struct {
	srv       *httptest.Server
	key       *rsa.PrivateKey
	sub       string
	email     string
	challenge map[string]string // code -> code_challenge
	nonce     map[string]string // code -> nonce
	badNonce  bool
}

func newFakeGoogle(t *testing.T) *fakeGoogle {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	g := &fakeGoogle{key: key, challenge: map[string]string{}, nonce: map[string]string{}}
	mux := http.NewServeMux()
	// Trang đăng nhập: "người chơi" đồng ý ngay -> chuyển về redirect_uri kèm code.
	mux.HandleFunc("/auth", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		code := "code-" + q.Get("state")[:8]
		g.challenge[code] = q.Get("code_challenge")
		g.nonce[code] = q.Get("nonce")
		http.Redirect(w, r, q.Get("redirect_uri")+"?"+url.Values{"code": {code}, "state": {q.Get("state")}}.Encode(), http.StatusFound)
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		code := r.Form.Get("code")
		sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
		if g.challenge[code] == "" || base64.RawURLEncoding.EncodeToString(sum[:]) != g.challenge[code] || r.Form.Get("client_secret") != "test-secret" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
			return
		}
		nonce := g.nonce[code]
		if g.badNonce {
			nonce = "khac"
		}
		now := time.Now()
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss": "https://fake-google.test", "aud": "test-client", "sub": g.sub, "email": g.email, "email_verified": true,
			"nonce": nonce, "iat": now.Unix(), "exp": now.Add(time.Hour).Unix(),
		})
		tok.Header["kid"] = "k1"
		signed, _ := tok.SignedString(g.key)
		json.NewEncoder(w).Encode(map[string]string{"id_token": signed})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, r *http.Request) {
		pub := g.key.PublicKey
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kid": "k1", "kty": "RSA", "alg": "RS256",
			"n": base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
		}}})
	})
	g.srv = httptest.NewServer(mux)
	t.Cleanup(g.srv.Close)
	return g
}

func testServer(t *testing.T, g *fakeGoogle) (*server, *httptest.Server) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("cần DATABASE_URL (chạy trong mạng docker compose)")
	}
	cfg := loadConfig()
	cfg.GoogleClientID, cfg.GoogleClientSecret = "test-client", "test-secret"
	cfg.GoogleAuthURL, cfg.GoogleTokenURL, cfg.GoogleJWKSURL = g.srv.URL+"/auth", g.srv.URL+"/token", g.srv.URL+"/jwks"
	cfg.GoogleIssuer = "https://fake-google.test"
	ctx := context.Background()
	db, err := openDB(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if err := migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	s := &server{cfg: cfg, keys: loadKeyring(), db: db, mail: newMailer(cfg), ipRL: newRateLimiter(1000, 1000), userRL: newRateLimiter(1000, 1000)}
	s.http = &http.Client{Timeout: 5 * time.Second}
	s.googleKeys = &googleKeySet{url: cfg.GoogleJWKSURL, client: s.http}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/auth/google/start", wrap(s.handleGoogleStart))
	mux.HandleFunc("GET /v1/auth/google/callback", s.handleGoogleCallback)
	mux.HandleFunc("POST /v1/auth/google/poll", wrap(s.handleGooglePoll))
	api := httptest.NewServer(mux)
	t.Cleanup(api.Close)
	s.cfg.PublicBaseURL = api.URL
	t.Cleanup(db.Close)
	return s, api
}

func post(t *testing.T, u string, body any, bearer string) (int, map[string]any) {
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, u, strings.NewReader(string(b)))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var m map[string]any
	json.NewDecoder(res.Body).Decode(&m)
	return res.StatusCode, m
}

// googleFlow: start -> "trình duyệt" đi theo auth_url (Google giả chuyển về callback) -> poll.
func googleFlow(t *testing.T, api string, bearer string, pollSecret func(string) string) (int, map[string]any) {
	code, start := post(t, api+"/v1/auth/google/start", map[string]any{}, bearer)
	if code != 200 {
		t.Fatalf("start %d %v", code, start)
	}
	st, ps := start["state"].(string), start["poll_secret"].(string)
	if c, _ := post(t, api+"/v1/auth/google/poll", map[string]string{"state": st, "poll_secret": ps}, ""); c != 202 {
		t.Fatalf("trước khi đăng nhập phải là 202, được %d", c)
	}
	res, err := http.Get(start["auth_url"].(string)) // client mặc định tự theo chuyển hướng về callback
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if pollSecret != nil {
		ps = pollSecret(ps)
	}
	return post(t, api+"/v1/auth/google/poll", map[string]string{"state": st, "poll_secret": ps}, "")
}

func TestGoogleLogin(t *testing.T) {
	g := newFakeGoogle(t)
	s, api := testServer(t, g)
	g.sub = "g-" + strings.ReplaceAll(time.Now().Format("150405.000000"), ".", "")
	g.email = "Nguoi.Choi+" + g.sub + "@gmail.com"

	if c, m := googleFlow(t, api.URL, "", func(string) string { return "sai" }); c != 401 {
		t.Fatalf("poll_secret sai phải bị từ chối, được %d %v", c, m)
	}

	c, m := googleFlow(t, api.URL, "", nil)
	if c != 200 || m["access_token"] == nil {
		t.Fatalf("đăng nhập Google: %d %v", c, m)
	}
	acc := m["account"].(map[string]any)
	if acc["google_linked"] != true || acc["has_password"] != false || !strings.HasPrefix(acc["username"].(string), "nguoi_choi") {
		t.Fatalf("tài khoản tạo từ Google sai: %v", acc)
	}
	firstID := acc["id"]

	// Đăng nhập lần 2 = cùng tài khoản.
	if _, m2 := googleFlow(t, api.URL, "", nil); m2["account"].(map[string]any)["id"] != firstID {
		t.Fatalf("lần 2 phải vào cùng tài khoản: %v", m2)
	}

	// Liên kết: tài khoản thường + Google khác.
	a, err := scanAccount(s.db.QueryRow(context.Background(), `INSERT INTO accounts(username, email, password_hash) VALUES ($1,'x@y.z','x') RETURNING `+accountCols,
		"lk"+g.sub[len(g.sub)-10:]))
	if err != nil {
		t.Fatal(err)
	}
	tok, _, _ := s.accessToken(a)
	if c, m := googleFlow(t, api.URL, tok, nil); c != 409 || m["code"] != "google_in_use" {
		t.Fatalf("Google đã dùng cho tài khoản khác phải báo google_in_use: %d %v", c, m)
	}
	g.sub += "-2"
	if c, m := googleFlow(t, api.URL, tok, nil); c != 200 || m["account"].(map[string]any)["id"] != float64(a.ID) {
		t.Fatalf("liên kết Google: %d %v", c, m)
	}
	if c, m := post(t, api.URL+"/v1/auth/google/start", map[string]any{}, tok); c != 409 || m["code"] != "google_already_linked" {
		t.Fatalf("đã liên kết rồi thì không liên kết thêm: %d %v", c, m)
	}

	// nonce sai (token bị chèn) -> thất bại.
	g.badNonce = true
	g.sub += "-3"
	if c, m := googleFlow(t, api.URL, "", nil); c != 502 || m["code"] != "google_failed" {
		t.Fatalf("nonce sai phải thất bại: %d %v", c, m)
	}
}
