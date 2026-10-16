#!/usr/bin/env bash
# Kiểm tra cấu hình trước khi bật trên máy thật (deploy.sh / swarm_up.sh tự gọi). Lỗi nguy hiểm -> dừng; thiếu nhẹ -> cảnh báo.
#   bash deploy/check_env.sh <dir>/stack.env    (+ thư mục secrets/ cạnh nó)
set -uo pipefail
env="${1:-$(cd "$(dirname "$0")/.." && pwd)/stack.env}"
[ -f "$env" ] || { echo "Thiếu $env — chạy deploy.sh env" >&2; exit 1; }
get() { grep -E "^$1=" "$env" | tail -n 1 | cut -d= -f2- ; }
bad=0
fail() { echo "LỖI: $*" >&2; bad=1; }
warn() { echo "Cảnh báo: $*" >&2; }

grep -q "DOI_THANH_KHOA_THAT" "$env" && fail "còn giá trị mẫu DOI_THANH_KHOA_THAT"
[ "$(get DEV_TRUST_CLIENT_SAVES)" = "true" ] && fail "DEV_TRUST_CLIENT_SAVES=true (người chơi tự sửa được cấp/tiền/đồ)"
case "$(get GAME_DEV_TRUST_CLIENT)" in 1|true) fail "GAME_DEV_TRUST_CLIENT bật (chỉ dùng máy dev)";; esac
[ "$(get SHOP_SANDBOX)" = "true" ] && fail "SHOP_SANDBOX=true (nạp thẻ giả = Xu miễn phí)"
[ "$(get TRUST_PROXY)" = "true" ] || fail "TRUST_PROXY phải là true (đứng sau Caddy)"
[ "$(get ADMIN_COOKIE_SECURE)" = "false" ] && fail "ADMIN_COOKIE_SECURE=false"
case "$(get ACCOUNT_BIND)" in ""|127.0.0.1) ;; *) fail "ACCOUNT_BIND phải là 127.0.0.1 (đi qua HTTPS)";; esac
domain="$(get DOMAIN)"
[ -n "$domain" ] || fail "thiếu DOMAIN"
[ "$(get PUBLIC_BASE_URL)" = "https://$domain" ] || fail "PUBLIC_BASE_URL phải là https://$domain"
case "$(get GAME_PUBLIC_HOST)" in ""|127.0.0.1|localhost) fail "GAME_PUBLIC_HOST phải là tên miền / IP công khai";; esac
[ "$(get BOOTSTRAP_ADMIN_PASS)" = "DOI_THANH_KHOA_THAT" ] && fail "BOOTSTRAP_ADMIN_PASS còn giá trị mẫu"
if [ "$(basename "$env")" = stack.env ]; then
	sec="$(dirname "$env")/secrets"
	for k in db_password database_url jwt_private_key password_pepper token_hmac_key game_service_key bootstrap_admin_pass; do
		[ -s "$sec/$k" ] && [ -n "$(tr -d '[:space:]' < "$sec/$k")" ] || fail "thiếu secret $sec/$k"
	done
	[ -f "$sec/smtp_pass" ] && [ -f "$sec/google_client_secret" ] || fail "thiếu $sec/smtp_pass hoặc google_client_secret (để trống được)"
	grep -rq "DOI_THANH_KHOA_THAT" "$sec" 2>/dev/null && fail "secret còn giá trị mẫu"
fi
[ -n "$(get SMTP_HOST)" ] || warn "chưa có SMTP_HOST — người chơi không nhận được mã quên mật khẩu"
[ -z "$(get GOOGLE_CLIENT_ID)" ] && warn "chưa bật đăng nhập Google (không bắt buộc)"
perm="$(stat -c %a "$env" 2>/dev/null || echo 600)"
[ "$perm" = "600" ] || warn "$env đang quyền $perm — nên chmod 600"
[ $bad = 0 ] && echo "Cấu hình ổn cho máy thật."
exit $bad
