package main

import (
	"net/http"
	"strings"
)

// Phiên đăng nhập cho TRANG WEB người chơi (nạp thẻ, quản lý tài khoản) — cùng tài khoản với game nhưng KHÔNG đưa
// refresh token cho JavaScript: refresh token nằm trong cookie HttpOnly + SameSite=Strict, chỉ gửi tới /v1/web/*;
// access token (15 phút) trả trong body và chỉ giữ trong bộ nhớ trang. Các đường /v1/web/* dùng lại đúng handler của game
// (cùng kiểm tra mật khẩu, khoá tài khoản, xoay vòng refresh token), chỉ khác cách trả phiên.
// Chống CSRF: mọi yêu cầu /v1/web/* phải có header X-Web-Request: 1 (trang khác không tự gắn được header này).

const (
	webCookie     = "kh_web"
	webCookiePath = "/v1/web"
	webCSRFHeader = "X-Web-Request"
)

func isWeb(r *http.Request) bool { return strings.HasPrefix(r.URL.Path, webCookiePath+"/") }

// webOnly bọc handler cho đường /v1/web/*: bắt buộc header chống CSRF.
func (s *server) webOnly(h handlerFunc) handlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		if r.Header.Get(webCSRFHeader) != "1" {
			return errCSRF
		}
		return h(w, r)
	}
}

// writeSession trả phiên vừa cấp: game nhận cả 2 token trong body; web nhận refresh token qua cookie HttpOnly.
func (s *server) writeSession(w http.ResponseWriter, r *http.Request, status int, resp sessionResp) error {
	if isWeb(r) {
		s.setWebCookie(w, resp.RefreshToken, int(s.cfg.RefreshTTL.Seconds()))
		resp.RefreshToken = ""
	}
	return writeJSON(w, status, resp)
}

func (s *server) setWebCookie(w http.ResponseWriter, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name: webCookie, Value: token, Path: webCookiePath, MaxAge: maxAge,
		HttpOnly: true, Secure: s.cfg.AdminCookieSecure, SameSite: http.SameSiteStrictMode,
	})
}

// refreshTokenOf: game gửi refresh token trong body, web gửi qua cookie.
func refreshTokenOf(r *http.Request, body string) string {
	if isWeb(r) {
		if c, err := r.Cookie(webCookie); err == nil {
			return c.Value
		}
		return ""
	}
	return body
}
