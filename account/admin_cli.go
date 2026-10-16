package main

import (
	"context"
	"fmt"
	"log"
	"os"
)

// adminCLI: lệnh vận hành chạy trên máy chủ (không qua web), dùng khi chưa có admin hoặc admin bị khóa ngoài:
//
//	docker compose exec account /account admin <tên> <super|gm|support|viewer>
//
// Tạo admin mới hoặc ĐẶT LẠI admin đã có: mật khẩu tạm mới (in ra 1 lần), xóa 2FA, bắt đổi mật khẩu, thu hồi mọi phiên.
func adminCLI(ctx context.Context, cfg Config, keys *keyring, args []string) {
	if len(args) != 2 {
		fmt.Fprintln(os.Stderr, "cách dùng: account admin <tên> <super|gm|support|viewer>")
		os.Exit(2)
	}
	username, role := normUsername(args[0]), args[1]
	if !usernameRe.MatchString(username) {
		log.Fatal("tên admin 3–20 ký tự: chữ thường không dấu, số, _")
	}
	if _, ok := roleRank[role]; !ok {
		log.Fatal("vai trò phải là super, gm, support hoặc viewer")
	}
	db, err := openDB(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err := migrate(ctx, db); err != nil {
		log.Fatal(err)
	}
	temp, err := tempAdminPassword()
	if err != nil {
		log.Fatal(err)
	}
	hash, err := keys.hashPassword(temp)
	if err != nil {
		log.Fatal(err)
	}
	_, err = db.Exec(ctx, `INSERT INTO admins(username, display_name, password_hash, role) VALUES ($1,$1,$2,$3)
		ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role, disabled=false,
			totp_enabled=false, totp_secret='', totp_last_step=0, must_change_password=true, password_changed_at=now(),
			session_epoch=admins.session_epoch+1`, username, hash, role)
	if err != nil {
		log.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO admin_audit(action, target_type, target_id, reason, detail)
		SELECT 'admin.cli_reset', 'admin', id::text, 'Đặt lại bằng lệnh trên máy chủ', jsonb_build_object('role', $2::text) FROM admins WHERE username=$1`,
		username, role); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Admin %q (%s) — mật khẩu tạm: %s\nĐăng nhập web Admin, đổi mật khẩu và bật xác thực 2 lớp.\n", username, role, temp)
}
