// Account server: tài khoản người chơi (đăng ký, đăng nhập, quên/đổi mật khẩu), danh sách máy chủ,
// và (sắp tới) API cho web Admin. Không giữ trạng thái trong RAM ngoài rate limit, nên chạy được nhiều bản.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "genkeys" {
		genKeys()
		return
	}
	cfg := loadConfig()
	keys := loadKeyring()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if len(os.Args) > 1 && os.Args[1] == "admin" {
		adminCLI(ctx, cfg, keys, os.Args[2:])
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "set-gm" {
		setGmCLI(ctx, cfg, os.Args[2:])
		return
	}

	db, err := openDB(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("kết nối database: %v", err)
	}
	defer db.Close()
	if err := migrate(ctx, db); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	if err := bootstrapAdmin(ctx, db, keys, cfg.BootstrapAdminUser, cfg.BootstrapAdminPass); err != nil {
		log.Fatalf("tạo admin đầu tiên: %v", err)
	}

	s := &server{
		cfg:  cfg,
		keys: keys,
		db:   db,
		mail: newMailer(cfg),
		// Theo IP nới rộng vì nhiều người chơi 4G/quán net chung 1 IP; chống dò mật khẩu nằm ở userRL.
		// RATE_LIMIT_IP_PER_MIN: chỉ tăng khi chạy load test trên máy dev (tạo hàng trăm tài khoản bot từ 1 IP).
		ipRL:   newRateLimiter(envInt("RATE_LIMIT_IP_PER_MIN", 120), max(60, envInt("RATE_LIMIT_IP_PER_MIN", 120)/2)),
		userRL: newRateLimiter(10, 5),
	}
	s.http = &http.Client{Timeout: 10 * time.Second}
	s.googleKeys = &googleKeySet{url: cfg.GoogleJWKSURL, client: s.http}
	go s.cleanupOAuth(ctx)
	if !s.googleEnabled() {
		log.Printf("đăng nhập Google: TẮT (thiếu GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / PUBLIC_BASE_URL)")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("GET /.well-known/jwks.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, keys.jwks())
	})
	mux.HandleFunc("POST /v1/auth/register", wrap(s.handleRegister))
	mux.HandleFunc("POST /v1/auth/login", wrap(s.handleLogin))
	mux.HandleFunc("POST /v1/auth/refresh", wrap(s.handleRefresh))
	mux.HandleFunc("POST /v1/auth/logout", wrap(s.handleLogout))
	mux.HandleFunc("POST /v1/auth/forgot", wrap(s.handleForgot))
	mux.HandleFunc("POST /v1/auth/reset", wrap(s.handleReset))
	mux.HandleFunc("POST /v1/account/password", wrap(s.handleChangePassword))
	mux.HandleFunc("GET /v1/account/me", wrap(s.handleMe))
	mux.HandleFunc("POST /v1/auth/google/start", wrap(s.handleGoogleStart))
	mux.HandleFunc("GET /v1/auth/google/callback", s.handleGoogleCallback)
	mux.HandleFunc("POST /v1/auth/google/poll", wrap(s.handleGooglePoll))
	// Trang web người chơi: cùng handler đăng nhập nhưng refresh token đi qua cookie HttpOnly (web_session.go).
	mux.HandleFunc("POST /v1/web/register", wrap(s.webOnly(s.handleRegister)))
	mux.HandleFunc("POST /v1/web/login", wrap(s.webOnly(s.handleLogin)))
	mux.HandleFunc("POST /v1/web/refresh", wrap(s.webOnly(s.handleRefresh)))
	mux.HandleFunc("POST /v1/web/logout", wrap(s.webOnly(s.handleLogout)))
	mux.HandleFunc("POST /v1/web/password", wrap(s.webOnly(s.handleChangePassword)))
	mux.HandleFunc("GET /v1/account/logins", wrap(s.handleAccountLogins))
	// Nạp thẻ (shop.go)
	mux.HandleFunc("GET /v1/shop/config", wrap(s.handleShopConfig))
	mux.HandleFunc("GET /v1/shop/wallet", wrap(s.handleShopWallet))
	mux.HandleFunc("POST /v1/shop/orders", wrap(s.handleShopCreateOrder))
	mux.HandleFunc("GET /v1/shop/orders/{code}", wrap(s.handleShopOrder))
	mux.HandleFunc("POST /v1/shop/orders/{code}/cancel", wrap(s.handleShopCancelOrder))
	mux.HandleFunc("POST /v1/shop/sandbox/{code}/pay", wrap(s.handleShopSandboxPay))
	mux.HandleFunc("POST /v1/shop/transfer", wrap(s.handleShopTransfer))
	mux.HandleFunc("GET /v1/servers", wrap(s.handleServers))
	mux.HandleFunc("GET /v1/characters", wrap(s.handleListCharacters))
	mux.HandleFunc("POST /v1/characters", wrap(s.handleCreateCharacter))
	mux.HandleFunc("PUT /v1/characters/{id}", wrap(s.handleSaveCharacter))
	mux.HandleFunc("DELETE /v1/characters/{id}", wrap(s.handleDeleteCharacter))
	mux.HandleFunc("GET /v1/rankings", wrap(s.handleRankings))
	mux.HandleFunc("GET /v1/battle", wrap(s.handleBattle))
	mux.HandleFunc("GET /v1/arena", wrap(s.handleArena))
	mux.HandleFunc("GET /v1/field", wrap(s.handleField))

	// Nội bộ: game server
	mux.HandleFunc("POST /internal/game/join", wrap(s.handleInternalJoin))
	mux.HandleFunc("PUT /internal/game/characters/{id}", wrap(s.handleInternalSave))
	mux.HandleFunc("POST /internal/game/status", wrap(s.handleInternalStatus))
	mux.HandleFunc("POST /internal/game/battle", wrap(s.handleInternalBattle))
	mux.HandleFunc("POST /internal/game/arena", wrap(s.handleInternalArena))
	mux.HandleFunc("POST /internal/game/field", wrap(s.handleInternalField))
	mux.HandleFunc("POST /internal/game/heartbeat", wrap(s.handleInternalHeartbeat))
	mux.HandleFunc("GET /internal/game/guilds", wrap(s.handleInternalGuilds))
	mux.HandleFunc("PUT /internal/game/guilds", wrap(s.handleInternalSaveGuild))
	mux.HandleFunc("DELETE /internal/game/guilds", wrap(s.handleInternalDeleteGuild))
	mux.HandleFunc("GET /internal/game/market", wrap(s.handleInternalMarket))
	mux.HandleFunc("PUT /internal/game/market", wrap(s.handleInternalSaveMarket))
	mux.HandleFunc("DELETE /internal/game/market", wrap(s.handleInternalDeleteMarket))

	// Web Admin
	mux.HandleFunc("POST /admin/api/login", wrap(s.handleAdminLogin))
	mux.HandleFunc("POST /admin/api/logout", wrap(s.handleAdminLogout))
	mux.HandleFunc("GET /admin/api/me", wrap(s.handleAdminMe))
	mux.HandleFunc("POST /admin/api/me/password", wrap(s.handleAdminChangePassword))
	mux.HandleFunc("POST /admin/api/2fa/setup", wrap(s.handleAdmin2FASetup))
	mux.HandleFunc("POST /admin/api/2fa/enable", wrap(s.handleAdmin2FAEnable))
	mux.HandleFunc("GET /admin/api/stats", wrap(s.handleAdminStats))
	mux.HandleFunc("GET /admin/api/accounts", wrap(s.handleAdminAccounts))
	mux.HandleFunc("GET /admin/api/accounts/{id}", wrap(s.handleAdminAccount))
	mux.HandleFunc("POST /admin/api/accounts/{id}/{action}", wrap(s.handleAdminAccountAction))
	mux.HandleFunc("POST /admin/api/characters/{id}/restore", wrap(s.handleAdminRestoreCharacter))
	mux.HandleFunc("GET /admin/api/characters/{id}", wrap(s.handleAdminCharacter))
	mux.HandleFunc("PUT /admin/api/characters/{id}", wrap(s.handleAdminSaveCharacter))
	mux.HandleFunc("POST /admin/api/characters/{id}/kick", wrap(s.handleAdminKickCharacter))
	mux.HandleFunc("GET /admin/api/servers", wrap(s.handleAdminServers))
	mux.HandleFunc("POST /admin/api/servers", wrap(s.handleAdminSaveServer))
	mux.HandleFunc("PUT /admin/api/servers/{id}", wrap(s.handleAdminSaveServer))
	mux.HandleFunc("GET /admin/api/processes", wrap(s.handleAdminProcesses))
	mux.HandleFunc("POST /admin/api/processes/{key}/restart", wrap(s.handleAdminProcessRestart))
	mux.HandleFunc("GET /admin/api/game-settings", wrap(s.handleAdminGameSettings))
	mux.HandleFunc("PUT /admin/api/game-settings", wrap(s.handleAdminGameSettings))
	mux.HandleFunc("GET /admin/api/audit", wrap(s.handleAdminAudit))
	mux.HandleFunc("GET /admin/api/shop/orders", wrap(s.handleAdminOrders))
	mux.HandleFunc("POST /admin/api/shop/orders/{code}/{action}", wrap(s.handleAdminOrderAction))
	mux.HandleFunc("GET /admin/api/shop/settings", wrap(s.handleAdminShopSettings))
	mux.HandleFunc("PUT /admin/api/shop/settings", wrap(s.handleAdminShopSettings))
	mux.HandleFunc("GET /admin/api/accounts/{id}/wallet", wrap(s.handleAdminWallet))
	mux.HandleFunc("POST /admin/api/accounts/{id}/wallet", wrap(s.handleAdminWalletAdjust))
	mux.HandleFunc("GET /admin/api/admins", wrap(s.handleAdminAdmins))
	mux.HandleFunc("POST /admin/api/admins", wrap(s.handleAdminCreateAdmin))
	mux.HandleFunc("POST /admin/api/admins/{id}/{action}", wrap(s.handleAdminAdminAction))
	if cfg.ClientDir != "" {
		mux.HandleFunc("GET /v1/client/manifest", wrap(s.handleClientManifest))
		mux.HandleFunc("GET /client/files/{file}", s.handleClientFile)
	}
	if cfg.AdminWebDir != "" {
		mux.Handle("GET /admin/", adminWeb(cfg.AdminWebDir))
		mux.HandleFunc("GET /admin", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/admin/", http.StatusFound) })
	}
	if cfg.PortalWebDir != "" {
		mux.Handle("GET /", portalWeb(cfg.PortalWebDir))
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           securityHeaders(cors(cfg.CORSOrigins, mux)),
		MaxHeaderBytes:    8 << 10,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()
	if cfg.DevTrustClientSaves {
		log.Printf("CẢNH BÁO: DEV_TRUST_CLIENT_SAVES=true — lưu nguyên dữ liệu game gửi (chỉ dùng khi phát triển, KHÔNG bật trên máy chủ thật)")
	}
	log.Printf("account server lắng nghe %s", cfg.HTTPAddr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
