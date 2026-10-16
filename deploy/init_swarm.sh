#!/usr/bin/env bash
# TẠO CẤU HÌNH SWARM LẦN ĐẦU (chạy trên VPS manager, 1 lần) — khóa MỚI sinh ngay trên VPS:
#   <dir>/stack.env     cấu hình KHÔNG bí mật (tên miền, cờ, SMTP host...) — service đọc qua env_file
#   <dir>/secrets/*     mỗi khóa 1 file (quyền 600) — thành Docker secret, service đọc qua *_FILE
#   bash deploy/init_swarm.sh <DOMAIN> <GAME_HOST>
# Không bao giờ ghi đè cái đã có (mất password_pepper = mọi mật khẩu người chơi sai).
# Đổi 1 khóa sau này (VD mật khẩu SMTP): sửa file trong secrets/ rồi deploy lại — Swarm tạo secret mới.
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)"
domain="${1:?thiếu DOMAIN}"
game_host="${2:?thiếu GAME_HOST}"
[ -e "$dir/stack.env" ] || [ -e "$dir/secrets" ] && { echo "Đã có $dir/stack.env hoặc $dir/secrets — không ghi đè." >&2; exit 1; }
command -v openssl >/dev/null || { echo "Thiếu openssl" >&2; exit 1; }
umask 077

rnd() { openssl rand -base64 "$1" | tr -d '\n'; }
alnum() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
db_pass="$(alnum 32)"
admin_pass="$(alnum 20)"

mkdir -p "$dir/secrets"
put() { printf '%s\n' "$2" > "$dir/secrets/$1"; }
put db_password "$db_pass"
put database_url "postgres://kiemhiep:$db_pass@postgres:5432/kiemhiep?sslmode=disable"
put jwt_private_key "$(rnd 32)"        # hạt giống Ed25519 32 byte (giống lệnh genkeys)
put password_pepper "$(rnd 32)"
put token_hmac_key "$(rnd 32)"
put game_service_key "$(alnum 48)"
put bootstrap_admin_pass "$admin_pass"
put smtp_pass ""                       # điền sau (mật khẩu SMTP)
put google_client_secret ""            # điền sau nếu bật đăng nhập Google
chmod 600 "$dir/secrets/"*

cat > "$dir/stack.env" <<EOF
# Cấu hình KHÔNG bí mật cho service account (khóa nằm trong secrets/). Sửa xong: deploy lại (deploy.sh server).
DOMAIN=$domain
GAME_PUBLIC_HOST=$game_host
PUBLIC_BASE_URL=https://$domain
CORS_ORIGINS=https://$domain
TRUST_PROXY=true
ADMIN_COOKIE_SECURE=true
SHOP_SANDBOX=false
DEV_TRUST_CLIENT_SAVES=false
JWT_KID=k$(openssl rand -hex 4)
JWT_PUBLIC_KEYS=
JWT_ISSUER=kiemhiep-account
JWT_AUDIENCE=kiemhiep-game
ACCESS_TTL=15m
REFRESH_TTL=720h
RESET_TTL=10m
BOOTSTRAP_ADMIN_USER=admin
RATE_LIMIT_IP_PER_MIN=120
MAIL_FROM=Kiếm Hiệp <no-reply@${domain#*.}>
# Gửi mail quên mật khẩu (Brevo / Amazon SES / Gmail SMTP...). Mật khẩu SMTP: secrets/smtp_pass
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
# Đăng nhập Google (bỏ trống = tắt). Client secret: secrets/google_client_secret
GOOGLE_CLIENT_ID=
EOF
chmod 600 "$dir/stack.env"
echo "Đã tạo $dir/stack.env và $dir/secrets/ (quyền 600)."
echo "Đăng nhập web Admin lần đầu: https://$domain/admin/  —  tài khoản: admin  /  mật khẩu tạm: $admin_pass"
echo "(Chỉ in 1 lần. Đăng nhập xong hệ thống bắt bật 2FA + đổi mật khẩu.)"
echo "SAO LƯU thư mục $dir/secrets ra nơi an toàn — mất password_pepper là mất toàn bộ mật khẩu người chơi."
