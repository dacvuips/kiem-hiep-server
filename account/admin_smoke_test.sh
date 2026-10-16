#!/usr/bin/env bash
# Kiểm tra API web Admin (cần curl, jq, oathtool). Admin thử được tạo bằng lệnh CLI, KHÔNG dùng admin thật:
#   ADMIN_PASS=$(docker compose exec -T account /account admin smoke_super super | grep -o 'tạm: .*' | cut -d' ' -f2)
#   docker run --rm --network server_default -e ADMIN_USER=smoke_super -e ADMIN_PASS=$ADMIN_PASS ... bash admin_smoke_test.sh
# Xong thì vô hiệu hóa admin thử:
#   docker compose exec -T postgres psql -U kiemhiep -c "UPDATE admins SET disabled=true, session_epoch=session_epoch+1 WHERE username='smoke_super'"
set -u
API=${API:-http://localhost:8080}
AU=${ADMIN_USER:?}
AP=${ADMIN_PASS:?}
JAR=$(mktemp)
pass=0; fail=0
apost() { curl -s -b "$JAR" -c "$JAR" -X POST "$API$1" -H 'Content-Type: application/json' -H 'X-Admin-Request: 1' -d "$2"; }
aget()  { curl -s -b "$JAR" -c "$JAR" "$API$1"; }
check() { if [ "$2" == "$3" ]; then echo "  OK   $1"; pass=$((pass+1)); else echo "  FAIL $1 (được '$2', cần '$3')"; fail=$((fail+1)); fi; }

check "thiếu header chống CSRF" "$(curl -s -X POST "$API/admin/api/login" -d '{}' | jq -r .code)" "csrf"
check "sai mật khẩu" "$(apost /admin/api/login "{\"username\":\"$AU\",\"password\":\"sai\"}" | jq -r .code)" "wrong_login"
r=$(apost /admin/api/login "{\"username\":\"$AU\",\"password\":\"$AP\"}")
check "đăng nhập lần đầu = phải bật 2FA" "$(jq -r .scope <<<"$r")" "enroll"
check "cookie HttpOnly" "$(grep -c '#HttpOnly_' "$JAR")" "1"
check "chưa 2FA thì không xem được" "$(aget /admin/api/stats | jq -r .code)" "enroll_2fa"
SECRET=$(apost /admin/api/2fa/setup '{}' | jq -r .secret)
check "nhận khóa 2FA" "${#SECRET}" "32"
check "mã 2FA sai" "$(apost /admin/api/2fa/enable '{"code":"000000"}' | jq -r .code)" "totp_wrong"
CODE=$(oathtool --totp -b "$SECRET")
check "bật 2FA" "$(apost /admin/api/2fa/enable "{\"code\":\"$CODE\"}" | jq -r .scope)" "full"
check "phải đổi mật khẩu tạm" "$(aget /admin/api/stats | jq -r .code)" "must_change_password"
check "mật khẩu admin ngắn" "$(apost /admin/api/me/password "{\"old_password\":\"$AP\",\"new_password\":\"ngan\"}" | jq -r .code)" "bad_password"
NEWPW="Mat-khau-admin-$RANDOM-dai"
check "đổi mật khẩu" "$(apost /admin/api/me/password "{\"old_password\":\"$AP\",\"new_password\":\"$NEWPW\"}" | jq -r .admin.must_change_password)" "false"
check "xem thống kê" "$(aget /admin/api/stats | jq -r '.registrations | length')" "30"

# đăng nhập lại với 2FA; mã vừa dùng không dùng lại được
apost /admin/api/logout '{}' >/dev/null
check "đã đăng xuất" "$(aget /admin/api/me | jq -r .code)" "unauthorized"
check "thiếu mã 2FA" "$(apost /admin/api/login "{\"username\":\"$AU\",\"password\":\"$NEWPW\"}" | jq -r .code)" "totp_required"
check "dùng lại mã 2FA cũ" "$(apost /admin/api/login "{\"username\":\"$AU\",\"password\":\"$NEWPW\",\"code\":\"$CODE\"}" | jq -r .code)" "totp_wrong"
sleep $(( 31 - $(date +%s) % 30 ))
CODE=$(oathtool --totp -b "$SECRET")
check "đăng nhập đủ 2FA" "$(apost /admin/api/login "{\"username\":\"$AU\",\"password\":\"$NEWPW\",\"code\":\"$CODE\"}" | jq -r .scope)" "full"

# người chơi thử
U="adm_$RANDOM$RANDOM"
curl -s -X POST "$API/v1/auth/register" -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"email\":\"$U@example.com\",\"password\":\"matkhau1\"}" >/dev/null
ID=$(aget "/admin/api/accounts?q=$U" | jq -r '.items[0].id')
check "tìm tài khoản" "$(aget "/admin/api/accounts?q=$U" | jq -r '.items[0].username')" "$U"
check "khóa thiếu lý do" "$(apost /admin/api/accounts/$ID/ban '{"hours":1,"reason":""}' | jq -r .code)" "reason_required"
check "khóa 1 giờ" "$(apost /admin/api/accounts/$ID/ban '{"hours":1,"reason":"Spam kênh thế giới"}' | jq -r .ok)" "true"
check "người chơi bị chặn đăng nhập" "$(curl -s -X POST "$API/v1/auth/login" -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"matkhau1\"}" | jq -r .code)" "banned"
check "lọc tài khoản bị khóa" "$(aget "/admin/api/accounts?status=banned&q=$U" | jq -r .total)" "1"
check "mở khóa" "$(apost /admin/api/accounts/$ID/unban '{"reason":"Đã xác minh nhầm"}' | jq -r .ok)" "true"
check "cấm chat" "$(apost /admin/api/accounts/$ID/mute '{"hours":24,"reason":"Chửi bới người chơi"}' | jq -r .ok)" "true"
TEMP=$(apost /admin/api/accounts/$ID/reset-password '{"reason":"Người chơi gọi hỗ trợ"}' | jq -r .temp_password)
check "mật khẩu tạm dùng được" "$(curl -s -X POST "$API/v1/auth/login" -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"$TEMP\"}" | jq -r .account.username)" "$U"
check "đổi email" "$(apost /admin/api/accounts/$ID/email '{"email":"moi@example.com","reason":"Người chơi xác minh CMND"}' | jq -r .ok)" "true"
D=$(aget /admin/api/accounts/$ID)
check "chi tiết tài khoản" "$(jq -r .account.email <<<"$D")" "moi@example.com"
check "nhật ký trên tài khoản" "$(jq -r '.audit | length' <<<"$D")" "5"
check "nhật ký có lý do" "$(jq -r '.audit[-1].reason' <<<"$D")" "Spam kênh thế giới"
check "nhật ký không lưu mật khẩu tạm" "$(aget "/admin/api/audit?target_id=$ID" | grep -c "$TEMP")" "0"
S1=$(aget /admin/api/servers | jq -c '.items[0] | {name, region, status, is_new, host, port, ws_url, sort_order, reason: "Kiểm tra tự động (không đổi gì)"}')
check "sửa máy chủ (giữ nguyên giá trị)" "$(curl -s -b "$JAR" -X PUT "$API/admin/api/servers/1" -H 'Content-Type: application/json' -H 'X-Admin-Request: 1' -d "$S1" | jq -r .ok)" "true"
check "danh sách admin" "$(aget /admin/api/admins | jq -r "[.items[] | select(.username==\"$AU\")] | length")" "1"
check "không tự hạ quyền" "$(apost /admin/api/admins/$(aget /admin/api/me | jq -r .admin.id)/update '{"role":"viewer","reason":"thử hạ quyền"}' | jq -r .code)" "self_change"
# nạp thẻ: đơn chờ -> Admin duyệt tay -> ví; cộng / trừ Xu tay; cài đặt
UT=$(curl -s -X POST "$API/v1/auth/login" -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"$TEMP\"}" | jq -r .access_token)
OC=$(curl -s -X POST "$API/v1/shop/orders" -H 'Content-Type: application/json' -H "Authorization: Bearer $UT" -d '{"amount_vnd":20000}' | jq -r .order.code)
check "danh sách đơn nạp" "$(aget "/admin/api/shop/orders?q=$OC" | jq -r '.orders[0].status')" "pending"
check "duyệt đơn thiếu lý do" "$(apost /admin/api/shop/orders/$OC/approve '{"reason":""}' | jq -r .code)" "reason_required"
check "duyệt đơn tay" "$(apost /admin/api/shop/orders/$OC/approve '{"reason":"Đối soát ngân hàng"}' | jq -r .order.status)" "paid"
check "duyệt lại không cộng 2 lần" "$(apost /admin/api/shop/orders/$OC/approve '{"reason":"Đối soát ngân hàng"}' | jq -r .code)" "order_done"
XU=$(aget /admin/api/accounts/$ID/wallet | jq -r .xu)
check "trừ Xu quá số dư bị chặn" "$(apost /admin/api/accounts/$ID/wallet "{\"delta\":-$((XU+1)),\"reason\":\"Thu hồi thử\"}" | jq -r .code)" "not_enough_xu"
check "cộng Xu tay" "$(apost /admin/api/accounts/$ID/wallet '{"delta":5,"reason":"Đền bù bảo trì"}' | jq -r .xu)" "$((XU+5))"
check "sổ cái có dòng admin" "$(aget /admin/api/accounts/$ID/wallet | jq -r '.ledger[0].kind')" "admin"
check "đọc cài đặt quy đổi" "$(aget /admin/api/shop/settings | jq -r '.xu_per_10k > 0')" "true"
rm -f "$JAR"
echo "Kết quả: $pass đạt, $fail lỗi"
[ "$fail" -eq 0 ]
