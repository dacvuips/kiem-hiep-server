package main

import (
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config đọc hết từ biến môi trường (xem server/.env.example).
type Config struct {
	HTTPAddr    string
	DatabaseURL string
	JWTIssuer   string
	JWTAudience string
	// Tên miền web được gọi API từ trình duyệt (client web, web Admin), cách nhau dấu phẩy. Rỗng = không cho trình duyệt nào.
	CORSOrigins []string

	AccessTTL  time.Duration
	RefreshTTL time.Duration
	ResetTTL   time.Duration

	SMTPHost string
	SMTPPort int
	SMTPUser string
	SMTPPass string
	MailFrom string

	// Tạo Super Admin đầu tiên khi bảng admins còn trống.
	BootstrapAdminUser string
	BootstrapAdminPass string

	// Đứng sau reverse proxy thì lấy IP thật từ X-Forwarded-For.
	TrustProxy bool

	// CHỈ DÙNG KHI PHÁT TRIỂN: lưu nguyên dữ liệu nhân vật game gửi (bỏ guardClientSave) để nút TEST lên cấp / thêm đồ
	// ở Hub được lưu thật. TUYỆT ĐỐI không bật trên máy chủ thật — người chơi tự sửa được cấp / tiền / đồ.
	DevTrustClientSaves bool

	// Danh sách tài khoản GM được chỉ định qua GM_ACCOUNTS (cách nhau bằng dấu phẩy)
	GMAccounts []string

	// Cookie phiên admin chỉ gửi qua HTTPS. Chỉ tắt khi chạy dev bằng http://.
	AdminCookieSecure bool
	// Thư mục web Admin đã build (server phục vụ tại /admin/). Rỗng = không phục vụ.
	AdminWebDir string
	// Thư mục trang web người chơi đã build (phục vụ tại /). Rỗng = không phục vụ.
	PortalWebDir string
	// Cổng thanh toán GIẢ LẬP cho nạp thẻ (chỉ dùng khi phát triển). Production phải tắt.
	ShopSandbox bool

	// Đăng nhập Google. Thiếu client id/secret hoặc PUBLIC_BASE_URL = tắt (nút Google báo chưa bật).
	PublicBaseURL      string // địa chỉ công khai của server này, VD https://api.kiemhiep.vn (dùng làm redirect_uri)
	GoogleClientID     string
	GoogleClientSecret string
	GoogleAuthURL      string
	GoogleTokenURL     string
	GoogleJWKSURL      string
	GoogleIssuer       string // thêm 1 iss được chấp nhận (chỉ dùng khi kiểm thử với Google giả)

	// Thư mục bản cài game cho APK launcher (manifest.json + files/*.pck, xem client_update.go). Rỗng = tắt.
	ClientDir string

	// Khóa dịch vụ cho game server gọi /internal/* (bí mật dùng chung giữa account server và game server).
	GameServiceKey string
}

func loadConfig() Config {
	c := Config{
		HTTPAddr:           env("HTTP_ADDR", ":8080"),
		DatabaseURL:        env("DATABASE_URL", ""),
		JWTIssuer:          env("JWT_ISSUER", "kiemhiep-account"),
		JWTAudience:        env("JWT_AUDIENCE", "kiemhiep-game"),
		CORSOrigins:        splitList(env("CORS_ORIGINS", "")),
		AccessTTL:          envDur("ACCESS_TTL", 15*time.Minute),
		RefreshTTL:         envDur("REFRESH_TTL", 30*24*time.Hour),
		ResetTTL:           envDur("RESET_TTL", 10*time.Minute),
		SMTPHost:           env("SMTP_HOST", "localhost"),
		SMTPPort:           envInt("SMTP_PORT", 1025),
		SMTPUser:           env("SMTP_USER", ""),
		SMTPPass:           env("SMTP_PASS", ""),
		MailFrom:           env("MAIL_FROM", "Kiếm Hiệp <no-reply@kiemhiep.local>"),
		BootstrapAdminUser: env("BOOTSTRAP_ADMIN_USER", ""),
		BootstrapAdminPass: env("BOOTSTRAP_ADMIN_PASS", ""),
		TrustProxy:         env("TRUST_PROXY", "false") == "true",
		DevTrustClientSaves: env("DEV_TRUST_CLIENT_SAVES", "true") == "true",
		GMAccounts:          splitList(env("GM_ACCOUNTS", "")),
		AdminCookieSecure:  env("ADMIN_COOKIE_SECURE", "true") != "false",
		AdminWebDir:        env("ADMIN_WEB_DIR", ""),
		PortalWebDir:       env("PORTAL_WEB_DIR", ""),
		ShopSandbox:        env("SHOP_SANDBOX", "false") == "true",
		PublicBaseURL:      env("PUBLIC_BASE_URL", ""),
		GoogleClientID:     env("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: env("GOOGLE_CLIENT_SECRET", ""),
		GoogleAuthURL:      env("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
		GoogleTokenURL:     env("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
		GoogleJWKSURL:      env("GOOGLE_JWKS_URL", "https://www.googleapis.com/oauth2/v3/certs"),
		GoogleIssuer:       env("GOOGLE_TEST_ISSUER", ""),
		GameServiceKey:     env("GAME_SERVICE_KEY", ""),
		ClientDir:          env("CLIENT_DIR", ""),
	}
	if c.DatabaseURL == "" {
		log.Fatal("thiếu DATABASE_URL")
	}
	return c
}

// env đọc biến môi trường k; không có thì đọc file ở k_FILE (Docker Swarm secrets gắn tại /run/secrets/...),
// để khóa bí mật không nằm trong cấu hình service (docker service inspect thấy được).
func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	if p := os.Getenv(k + "_FILE"); p != "" {
		b, err := os.ReadFile(p)
		if err != nil {
			log.Fatalf("đọc %s_FILE: %v", k, err)
		}
		if v := strings.TrimSpace(string(b)); v != "" {
			return v
		}
	}
	return def
}

func splitList(v string) []string {
	var out []string
	for _, s := range strings.Split(v, ",") {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func envInt(k string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(k)); err == nil {
		return v
	}
	return def
}

func envDur(k string, def time.Duration) time.Duration {
	if v, err := time.ParseDuration(os.Getenv(k)); err == nil {
		return v
	}
	return def
}
