package main

import (
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Lỗi trả về client: code cố định (client dịch ra câu hiển thị), message tiếng Việt để debug / hiển thị tạm.
type apiError struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *apiError) Error() string { return e.Code }

func newErr(status int, code, msg string) *apiError {
	return &apiError{Status: status, Code: code, Message: msg}
}

var (
	errBadRequest   = newErr(http.StatusBadRequest, "bad_request", "Dữ liệu gửi lên không hợp lệ")
	errUnauthorized = newErr(http.StatusUnauthorized, "unauthorized", "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")
	errRateLimited  = newErr(http.StatusTooManyRequests, "rate_limited", "Thao tác quá nhanh, vui lòng thử lại sau ít phút")
	errInternal     = newErr(http.StatusInternalServerError, "internal", "Máy chủ gặp sự cố, vui lòng thử lại sau")
)

type handlerFunc func(w http.ResponseWriter, r *http.Request) error

// wrap chuyển lỗi trả về từ handler thành JSON; lỗi không phải apiError được log và ẩn chi tiết với client.
func wrap(h handlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := h(w, r)
		if err == nil {
			return
		}
		ae, ok := err.(*apiError)
		if !ok {
			log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
			ae = errInternal
		}
		writeJSON(w, ae.Status, ae)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return errBadRequest
	}
	return nil
}

func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			return strings.TrimSpace(strings.Split(xff, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func userAgent(r *http.Request) string {
	ua := r.UserAgent()
	if len(ua) > 200 {
		ua = ua[:200]
	}
	return ua
}

// rateLimiter: token bucket theo khóa (IP, tên tài khoản...). Chạy trong bộ nhớ 1 tiến trình —
// khi chạy nhiều bản account server sẽ chuyển sang Redis.
type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // token mỗi giây
	burst   float64
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newRateLimiter(perMinute, burst int) *rateLimiter {
	rl := &rateLimiter{buckets: map[string]*bucket{}, rate: float64(perMinute) / 60, burst: float64(burst)}
	go func() {
		for range time.Tick(5 * time.Minute) {
			rl.mu.Lock()
			for k, b := range rl.buckets {
				if time.Since(b.last) > 10*time.Minute {
					delete(rl.buckets, k)
				}
			}
			rl.mu.Unlock()
		}
	}()
	return rl
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	b, ok := rl.buckets[key]
	if !ok {
		b = &bucket{tokens: rl.burst, last: now}
		rl.buckets[key] = b
	}
	b.tokens = min(rl.burst, b.tokens+now.Sub(b.last).Seconds()*rl.rate)
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// cors chỉ cho các tên miền khai báo trong CORS_ORIGINS gọi API từ trình duyệt. Client native (PC/mobile) không gửi
// Origin nên không bị ảnh hưởng.
func cors(origins []string, next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, o := range origins {
		allowed[o] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && allowed[origin] {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Vary", "Origin")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// securityHeaders: không cho cache dữ liệu tài khoản, không đoán kiểu nội dung, bắt buộc HTTPS khi chạy thật (HSTS chỉ có tác dụng qua HTTPS).
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		if h.Get("Cache-Control") == "" {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}
