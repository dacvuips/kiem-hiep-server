#!/usr/bin/env bash
# Kiểm tra nhanh toàn bộ luồng tài khoản trên môi trường docker compose (cần curl + jq).
#   bash server/account/smoke_test.sh
set -u
API=${API:-http://localhost:8080}
MAIL=${MAIL:-http://localhost:8025}
U="test_$RANDOM$RANDOM"
EMAIL="$U@example.com"
pass=0; fail=0

post() { curl -s -X POST "$API$1" -H 'Content-Type: application/json' ${3:+-H "Authorization: Bearer $3"} -d "$2"; }
get()  { curl -s "$API$1" -H "Authorization: Bearer $2"; }
check() { # tên, giá trị thực, giá trị mong đợi
	if [ "$2" == "$3" ]; then echo "  OK   $1"; pass=$((pass+1)); else echo "  FAIL $1 (được '$2', cần '$3')"; fail=$((fail+1)); fi
}

echo "Tài khoản thử: $U"
r=$(post /v1/auth/register "{\"username\":\"$U\",\"email\":\"$EMAIL\",\"password\":\"matkhau1\"}")
check "đăng ký" "$(jq -r .account.username <<<"$r")" "$U"
REFRESH1=$(jq -r .refresh_token <<<"$r")
check "đăng ký trùng tên" "$(post /v1/auth/register "{\"username\":\"$U\",\"email\":\"$EMAIL\",\"password\":\"matkhau1\"}" | jq -r .code)" "username_taken"
check "tên sai quy tắc" "$(post /v1/auth/register '{"username":"A b","email":"x@y.z","password":"matkhau1"}' | jq -r .code)" "bad_username"
check "mật khẩu ngắn" "$(post /v1/auth/register '{"username":"abc_def","email":"x@y.z","password":"123"}' | jq -r .code)" "bad_password"

check "mật khẩu chứa tên tài khoản" "$(post /v1/auth/register "{\"username\":\"abc_xyz\",\"email\":\"x@y.z\",\"password\":\"abc_xyz123\"}" | jq -r .code)" "password_is_username"
ACC0=$(post /v1/auth/login "{\"username\":\"$U\",\"password\":\"matkhau1\"}" | jq -r .access_token)
check "JWT ký Ed25519 có kid" "$(cut -d. -f1 <<<"$ACC0" | tr '_-' '/+' | base64 -d 2>/dev/null | jq -r '.alg + (if .kid then ":kid" else "" end)')" "EdDSA:kid"
check "JWT có iss/aud" "$(cut -d. -f2 <<<"$ACC0" | tr '_-' '/+' | { read p; while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done; echo "$p"; } | base64 -d | jq -r '.iss + "|" + .aud')" "kiemhiep-account|kiemhiep-game"
NONE="$(printf '{"alg":"none","typ":"JWT"}' | base64 | tr -d '=\n' | tr '/+' '_-').$(cut -d. -f2 <<<"$ACC0")."
check "token alg=none bị từ chối" "$(get /v1/account/me "$NONE" | jq -r .code)" "unauthorized"
check "token sửa nội dung bị từ chối" "$(get /v1/account/me "${ACC0%?????}AAAAA" | jq -r .code)" "unauthorized"
check "khóa công khai jwks" "$(curl -s "$API/.well-known/jwks.json" | jq -r '.keys[0].crv')" "Ed25519"
check "sai mật khẩu" "$(post /v1/auth/login "{\"username\":\"$U\",\"password\":\"sai\"}" | jq -r .code)" "wrong_login"
check "tên không tồn tại" "$(post /v1/auth/login '{"username":"khong_co_ai","password":"x"}' | jq -r .code)" "wrong_login"
r=$(post /v1/auth/login "{\"username\":\"${U^^}\",\"password\":\"matkhau1\"}")
ACCESS=$(jq -r .access_token <<<"$r"); REFRESH2=$(jq -r .refresh_token <<<"$r")
check "đăng nhập (không phân biệt hoa thường)" "$(jq -r .account.username <<<"$r")" "$U"
check "xem tài khoản" "$(get /v1/account/me "$ACCESS" | jq -r .email)" "$EMAIL"
check "danh sách máy chủ" "$(get /v1/servers "$ACCESS" | jq -r '.servers[0].name')" "Tống Kim 01"
check "không có token" "$(get /v1/servers "" | jq -r .code)" "unauthorized"

r=$(post /v1/auth/refresh "{\"refresh_token\":\"$REFRESH2\"}")
REFRESH3=$(jq -r .refresh_token <<<"$r")
check "làm mới phiên" "$([ -n "$REFRESH3" ] && [ "$REFRESH3" != null ] && echo yes)" "yes"
check "dùng lại refresh cũ bị từ chối" "$(post /v1/auth/refresh "{\"refresh_token\":\"$REFRESH2\"}" | jq -r .code)" "unauthorized"
check "…và mọi phiên bị thu hồi" "$(post /v1/auth/refresh "{\"refresh_token\":\"$REFRESH3\"}" | jq -r .code)" "unauthorized"

check "quên mật khẩu, email sai vẫn trả ok" "$(post /v1/auth/forgot "{\"username\":\"$U\",\"email\":\"sai@x.com\"}" | jq -r .ok)" "true"
check "quên mật khẩu" "$(post /v1/auth/forgot "{\"username\":\"$U\",\"email\":\"${EMAIL^^}\"}" | jq -r .ok)" "true"
sleep 1
CODE=$(curl -s "$MAIL/api/v1/search?query=to:$EMAIL" | jq -r '.messages[0].Snippet' | grep -oE 'là: [0-9]{6}' | grep -oE '[0-9]{6}')
check "nhận mã OTP qua mail" "${#CODE}" "6"
WRONG=$([ "$CODE" == "000000" ] && echo 111111 || echo 000000)
check "mã sai" "$(post /v1/auth/reset "{\"username\":\"$U\",\"code\":\"$WRONG\",\"new_password\":\"matkhau2\"}" | jq -r .code)" "bad_code"
check "đặt lại mật khẩu" "$(post /v1/auth/reset "{\"username\":\"$U\",\"code\":\"$CODE\",\"new_password\":\"matkhau2\"}" | jq -r .ok)" "true"
check "mã đã dùng không dùng lại được" "$(post /v1/auth/reset "{\"username\":\"$U\",\"code\":\"$CODE\",\"new_password\":\"matkhau3\"}" | jq -r .code)" "bad_code"
check "mật khẩu cũ hết tác dụng" "$(post /v1/auth/login "{\"username\":\"$U\",\"password\":\"matkhau1\"}" | jq -r .code)" "wrong_login"
r=$(post /v1/auth/login "{\"username\":\"$U\",\"password\":\"matkhau2\"}")
ACCESS=$(jq -r .access_token <<<"$r"); REFRESH4=$(jq -r .refresh_token <<<"$r")
check "đăng nhập mật khẩu mới" "$(jq -r .account.username <<<"$r")" "$U"

check "đổi mật khẩu sai mật khẩu cũ" "$(post /v1/account/password '{"old_password":"sai","new_password":"matkhau9"}' "$ACCESS" | jq -r .code)" "wrong_password"
OLDACCESS=$ACCESS
sleep 1
r=$(post /v1/account/password '{"old_password":"matkhau2","new_password":"matkhau9"}' "$ACCESS")
check "đổi mật khẩu" "$(jq -r .account.username <<<"$r")" "$U"
check "access token cũ bị từ chối ngay sau khi đổi" "$(get /v1/account/me "$OLDACCESS" | jq -r .code)" "unauthorized"
check "access token mới vẫn dùng được" "$(get /v1/account/me "$(jq -r .access_token <<<"$r")" | jq -r .username)" "$U"
check "phiên cũ bị đăng xuất sau khi đổi" "$(post /v1/auth/refresh "{\"refresh_token\":\"$REFRESH4\"}" | jq -r .code)" "unauthorized"
check "đăng xuất" "$(post /v1/auth/logout "{\"refresh_token\":\"$(jq -r .refresh_token <<<"$r")\"}" | jq -r .ok)" "true"

echo "Kết quả: $pass đạt, $fail lỗi"
[ "$fail" -eq 0 ]
