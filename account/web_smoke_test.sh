#!/usr/bin/env bash
# Kiểm tra phiên đăng nhập TRANG WEB người chơi (cookie HttpOnly) + nạp thẻ giả lập.
#   API=http://localhost:8080 bash server/account/web_smoke_test.sh
set -uo pipefail
API="${API:-http://localhost:8080}"
JAR="$(mktemp)"
pass=0; fail=0
check() { if [ "$2" = "1" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 :: $3"; fail=$((fail+1)); fi; }

u="web$(date +%s)$RANDOM"
H=(-H "Content-Type: application/json" -H "X-Web-Request: 1")

# Thiếu header chống CSRF -> 403
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/web/register" -H "Content-Type: application/json" \
  -d "{\"username\":\"$u\",\"email\":\"$u@x.vn\",\"password\":\"matkhau1\"}")
check "thiếu X-Web-Request bị chặn" "$([ "$code" = 403 ] && echo 1)" "$code"

# Đăng ký: refresh token KHÔNG nằm trong body, nằm trong cookie HttpOnly
hdr=$(mktemp)
body=$(curl -s -D "$hdr" -c "$JAR" -X POST "$API/v1/web/register" "${H[@]}" -d "{\"username\":\"$u\",\"email\":\"$u@x.vn\",\"password\":\"matkhau1\"}")
check "đăng ký trả access token" "$(echo "$body" | grep -q '"access_token":"ey' && echo 1)" "$body"
check "không trả refresh token trong body" "$(echo "$body" | grep -q '"refresh_token":""' && echo 1)" "$body"
check "cookie HttpOnly + SameSite=Strict" "$(grep -i 'set-cookie: kh_web=' "$hdr" | grep -qi 'httponly' && grep -i 'set-cookie: kh_web=' "$hdr" | grep -qi 'samesite=strict' && echo 1)" "$(grep -i set-cookie "$hdr")"
old_cookie=$(grep kh_web "$JAR" | awk '{print $7}')

# Refresh bằng cookie (xoay vòng)
body=$(curl -s -b "$JAR" -c "$JAR" -X POST "$API/v1/web/refresh" "${H[@]}" -d '{}')
tok=$(echo "$body" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
check "refresh bằng cookie" "$([ -n "$tok" ] && echo 1)" "$body"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/web/refresh" "${H[@]}" -H "Cookie: kh_web=$old_cookie" -d '{}')
check "cookie cũ (đã xoay) bị từ chối" "$([ "$code" = 401 ] && echo 1)" "$code"
# Dùng lại token cũ = dấu hiệu bị trộm -> mọi phiên bị thu hồi: đăng nhập lại
body=$(curl -s -c "$JAR" -X POST "$API/v1/web/login" "${H[@]}" -d "{\"username\":\"$u\",\"password\":\"matkhau1\"}")
tok=$(echo "$body" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
check "đăng nhập web" "$([ -n "$tok" ] && echo 1)" "$body"

# Nạp thẻ giả lập
A=(-H "Content-Type: application/json" -H "Authorization: Bearer $tok")
body=$(curl -s -X POST "$API/v1/shop/orders" "${A[@]}" -d '{"amount_vnd":50000}')
ordercode=$(echo "$body" | sed -n 's/.*"code":"\(NAP[A-Z0-9]*\)".*/\1/p')
check "tạo đơn nạp" "$([ -n "$ordercode" ] && echo 1)" "$body"
body=$(curl -s -X POST "$API/v1/shop/sandbox/$ordercode/pay" "${A[@]}" -d '{}')
check "thanh toán giả lập" "$(echo "$body" | grep -q '"status":"paid"' && echo 1)" "$body"
body=$(curl -s "$API/v1/shop/wallet" "${A[@]}")
check "ví có Xu + sổ cái" "$(echo "$body" | grep -q '"kind":"topup"' && echo 1)" "$body"
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/shop/wallet")
check "ví cần đăng nhập" "$([ "$code" = 401 ] && echo 1)" "$code"

# Đổi mật khẩu qua web: cấp phiên mới bằng cookie
body=$(curl -s -b "$JAR" -c "$JAR" -X POST "$API/v1/web/password" "${H[@]}" -H "Authorization: Bearer $tok" \
  -d '{"old_password":"matkhau1","new_password":"matkhau2"}')
check "đổi mật khẩu web" "$(echo "$body" | grep -q '"access_token":"ey' && echo 1)" "$body"

# Đăng xuất: xoá cookie, refresh sau đó thất bại
curl -s -b "$JAR" -c "$JAR" -X POST "$API/v1/web/logout" "${H[@]}" -d '{}' >/dev/null
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$API/v1/web/refresh" "${H[@]}" -d '{}')
check "đăng xuất xong không refresh được" "$([ "$code" = 401 ] && echo 1)" "$code"

# Trang web người chơi được phục vụ tại / với CSP
hdrs=$(curl -s -D - -o /dev/null "$API/nap-the")
check "trang web người chơi tại / (SPA + CSP)" "$(echo "$hdrs" | grep -qi 'content-security-policy' && echo "$hdrs" | grep -q ' 200' && echo 1)" "$hdrs"

rm -f "$JAR" "$hdr"
echo "RESULT $pass/$((pass+fail))"
[ "$fail" = 0 ]
