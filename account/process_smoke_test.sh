#!/usr/bin/env bash
# Kiểm tra VẬN HÀNH GAME SERVER trên web Admin (cần curl, jq, oathtool): danh sách tiến trình, khởi động lại êm, thông số game,
# phân quyền (gm không được), kiểm tra dữ liệu, nhật ký. Admin thử tạo bằng CLI — KHÔNG dùng admin thật:
#   SUPER_PASS=$(docker compose exec -T account /account admin smoke_ops super | grep -o 'tạm: .*' | cut -d' ' -f2)
#   GM_PASS=$(docker compose exec -T account /account admin smoke_ops_gm gm | grep -o 'tạm: .*' | cut -d' ' -f2)
#   docker run --rm --network server_default -e API=http://account:8080 -e SUPER_PASS=$SUPER_PASS -e GM_PASS=$GM_PASS \
#     -e TARGET_PORT=7917 -v "$PWD/account:/t" alpine sh -c "apk add -q bash curl jq oath-toolkit-oathtool && bash /t/process_smoke_test.sh"
# Cần 1 game server (thế giới) đang chạy ở cổng TARGET_PORT — bài này SẼ KHỞI ĐỘNG LẠI nó (dùng server thử, không dùng server thật).
# Xong thì vô hiệu hóa 2 admin thử (lệnh ở cuối kết quả).
set -u
API=${API:-http://localhost:8080}
TARGET_PORT=${TARGET_PORT:?cổng game server thử}
pass=0; fail=0
check() { if [ "$2" == "$3" ]; then echo "  OK   $1"; pass=$((pass+1)); else echo "  FAIL $1 (được '$2', cần '$3')"; fail=$((fail+1)); fi; }

## login <user> <mật khẩu tạm> -> đặt JAR (cookie) cho admin đó: bật 2FA + đổi mật khẩu tạm như admin mới thật.
login() {
	JAR=$(mktemp)
	apost /admin/api/login "{\"username\":\"$1\",\"password\":\"$2\"}" >/dev/null
	local secret code newpw
	secret=$(apost /admin/api/2fa/setup '{}' | jq -r .secret)
	code=$(oathtool --totp -b "$secret")
	apost /admin/api/2fa/enable "{\"code\":\"$code\"}" >/dev/null
	newpw="Mat-khau-ops-$RANDOM-$RANDOM-dai"
	apost /admin/api/me/password "{\"old_password\":\"$2\",\"new_password\":\"$newpw\"}" >/dev/null
}
apost() { curl -s -b "$JAR" -c "$JAR" -X POST "$API$1" -H 'Content-Type: application/json' -H 'X-Admin-Request: 1' -d "$2"; }
aput()  { curl -s -b "$JAR" -c "$JAR" -X PUT "$API$1" -H 'Content-Type: application/json' -H 'X-Admin-Request: 1' -d "$2"; }
aget()  { curl -s -b "$JAR" -c "$JAR" "$API$1"; }

echo "== gm (không đủ quyền điều khiển)"
login smoke_ops_gm "${GM_PASS:?}"
GM_JAR=$JAR
KEY=$(aget /admin/api/processes | jq -r ".items[] | select(.port == $TARGET_PORT and .alive) | .key" | head -n 1)
check "gm xem được danh sách tiến trình (thấy server thử)" "$([ -n "$KEY" ] && echo co)" "co"
check "gm KHÔNG khởi động lại được" "$(apost "/admin/api/processes/$KEY/restart" '{"seconds":30,"reason":"thử quyền gm"}' | jq -r .code)" "forbidden"
check "gm KHÔNG đổi được thông số" "$(aput /admin/api/game-settings '{"values":{"exp_mult":2},"reason":"thử quyền gm"}' | jq -r .code)" "forbidden"
check "không có cookie thì không xem được" "$(curl -s "$API/admin/api/processes" | jq -r .code)" "unauthorized"
check "thiếu header chống CSRF" "$(curl -s -b "$JAR" -X PUT "$API/admin/api/game-settings" -d '{}' | jq -r .code)" "csrf"

echo "== super"
login smoke_ops "${SUPER_PASS:?}"
check "thông số: khoá lạ bị từ chối" "$(aput /admin/api/game-settings '{"values":{"gold_free":1000},"reason":"thử khoá lạ"}' | jq -r .code)" "bad_setting"
check "thông số: vượt khoảng bị từ chối" "$(aput /admin/api/game-settings '{"values":{"exp_mult":99},"reason":"thử vượt khoảng"}' | jq -r .code)" "bad_setting"
check "thông số: thiếu lý do" "$(aput /admin/api/game-settings '{"values":{"exp_mult":2}}' | jq -r .code)" "reason_required"
check "thông số: lưu kinh nghiệm x2" "$(aput /admin/api/game-settings '{"values":{"exp_mult":2},"reason":"thử thông số game"}' | jq -r .values.exp_mult)" "2"
check "khởi động lại: thiếu lý do" "$(apost "/admin/api/processes/$KEY/restart" '{"seconds":30}' | jq -r .code)" "reason_required"
check "khởi động lại: đếm ngược quá ngắn" "$(apost "/admin/api/processes/$KEY/restart" '{"seconds":3,"reason":"thử đếm ngược"}' | jq -r .code)" "bad_seconds"
check "khởi động lại: tiến trình không tồn tại" "$(apost "/admin/api/processes/1-world-7/restart" '{"seconds":30,"reason":"thử không tồn tại"}' | jq -r .code)" "process_offline"
check "khởi động lại: gửi lệnh 12 giây" "$(apost "/admin/api/processes/$KEY/restart" '{"seconds":12,"message":"thử nghiệm","reason":"thử khởi động lại êm"}' | jq -r .ok)" "true"
drain=""
for _ in $(seq 1 20); do
	drain=$(aget /admin/api/processes | jq -r ".items[] | select(.key == \"$KEY\") | .draining")
	[ "$drain" == "true" ] && break
	sleep 1
done
check "game server nhận lệnh -> đang đếm ngược" "$drain" "true"
gone=""
for _ in $(seq 1 50); do
	gone=$(aget /admin/api/processes | jq -r ".items[] | select(.key == \"$KEY\") | .alive")
	[ "$gone" == "false" ] && break
	sleep 1
done
check "hết đếm ngược -> tiến trình thoát (mất tín hiệu)" "$gone" "false"
check "nhật ký có lệnh khởi động lại" "$(aget '/admin/api/audit?action=process.restart' | jq -r "[.items[] | select(.target_id == \"$KEY\")] | length > 0")" "true"
check "nhật ký có đổi thông số (cũ -> mới)" "$(aget '/admin/api/audit?action=game.settings' | jq -r '.items[0].detail.after.exp_mult')" "2"
aput /admin/api/game-settings '{"values":{"exp_mult":1},"reason":"trả thông số về gốc sau khi thử"}' >/dev/null

echo
echo "Kết quả: $pass OK, $fail FAIL"
echo "Vô hiệu hóa admin thử: docker compose exec -T postgres psql -U kiemhiep -c \"UPDATE admins SET disabled=true, session_epoch=session_epoch+1 WHERE username IN ('smoke_ops','smoke_ops_gm')\""
[ "$fail" == 0 ]
