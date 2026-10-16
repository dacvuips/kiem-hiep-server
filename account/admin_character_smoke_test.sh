#!/usr/bin/env bash
# Kiểm tra API sửa nhân vật của web Admin (cần curl, jq, oathtool). Tạo admin thử bằng CLI như admin_smoke_test.sh:
#   AP=$(docker compose exec -T account /account admin smoke_char super | grep -o 'tạm: .*' | cut -d' ' -f2)
#   SK=$(grep ^GAME_SERVICE_KEY= .env | cut -d= -f2-)
#   docker run --rm --network server_default -e AU=smoke_char -e AP=$AP -e SK=$SK -v "$PWD/account:/t" alpine:3.20 \
#     sh -c "apk add -q bash curl jq oath-toolkit-oathtool && bash /t/admin_character_smoke_test.sh"
# Xong thì vô hiệu hóa admin thử (UPDATE admins SET disabled=true ... WHERE username='smoke_char').
set -u
API=http://account:8080
JAR=$(mktemp)
pass=0; fail=0
apost() { curl -s -b "$JAR" -c "$JAR" -X POST "$API$1" -H 'Content-Type: application/json' -H 'X-Admin-Request: 1' -d "$2"; }
aput()  { curl -s -b "$JAR" -c "$JAR" -X PUT "$API$1" -H 'Content-Type: application/json' -H 'X-Admin-Request: 1' -d "$2"; }
aget()  { curl -s -b "$JAR" -c "$JAR" "$API$1"; }
check() { if [ "$2" == "$3" ]; then echo "  OK   $1"; pass=$((pass+1)); else echo "  FAIL $1 (được '$2', cần '$3')"; fail=$((fail+1)); fi; }

apost /admin/api/login "{\"username\":\"$AU\",\"password\":\"$AP\"}" >/dev/null
SECRET=$(apost /admin/api/2fa/setup '{}' | jq -r .secret)
apost /admin/api/2fa/enable "{\"code\":\"$(oathtool --totp -b "$SECRET")\"}" >/dev/null
NEWPW="Mat-khau-admin-$RANDOM-dai"
apost /admin/api/me/password "{\"old_password\":\"$AP\",\"new_password\":\"$NEWPW\"}" >/dev/null
check "admin vào được" "$(aget /admin/api/me | jq -r '.permissions | index("characters.write") != null')" "true"

U="smk$RANDOM$RANDOM"
TOK=$(curl -s -X POST $API/v1/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"email\":\"$U@example.com\",\"password\":\"Mat-khau-choi-12345\"}" | jq -r .access_token)
CNAME="Thu$RANDOM"
CID=$(curl -s -X POST $API/v1/characters -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d "{\"server_id\":1,\"slot\":0,\"name\":\"$CNAME\",\"data\":{\"level\":5,\"gold\":10,\"server_seen\":1,\"admin_grants\":[{\"kind\":\"gold\",\"gold\":0}]}}" | jq -r .id)
check "tạo nhân vật thử" "$([ "$CID" != "null" ] && echo y)" "y"
C=$(aget /admin/api/characters/$CID)
check "admin xem nhân vật" "$(jq -r .name <<<"$C")" "$CNAME"
check "người chơi không tự chèn đồ Admin lúc tạo" "$(jq -r '.data.admin_grants // "none"' <<<"$C")" "none"
V=$(jq -r .version <<<"$C")
DATA=$(jq -c '.data | .gold=999999 | .level=90 | .admin_grants=[{"kind":"equip","detail":0,"particular":0,"level":10,"series":3,"magic":[10,10,10,10,10,10],"seed":5}]' <<<"$C")
check "thiếu lý do" "$(aput /admin/api/characters/$CID "{\"version\":$V,\"name\":\"$CNAME\",\"data\":$DATA,\"reason\":\"\"}" | jq -r .code)" "reason_required"
R=$(aput /admin/api/characters/$CID "{\"version\":$V,\"name\":\"${CNAME}X\",\"data\":$DATA,\"reason\":\"smoke test sua nhan vat\"}")
check "lưu thành công, version tăng" "$(jq -r .version <<<"$R")" "$((V+1))"
C=$(aget /admin/api/characters/$CID)
check "đổi tên" "$(jq -r .name <<<"$C")" "${CNAME}X"
check "tên trong data theo tên mới" "$(jq -r .data.name <<<"$C")" "${CNAME}X"
check "cấp cột level cập nhật" "$(jq -r .level <<<"$C")" "90"
check "tiền" "$(jq -r .data.gold <<<"$C")" "999999"
check "đồ chờ giao" "$(jq -r '.data.admin_grants | length' <<<"$C")" "1"
check "cờ đá khỏi game" "$(jq -r .reload_pending <<<"$C")" "true"
check "bản cũ bị từ chối" "$(aput /admin/api/characters/$CID "{\"version\":$V,\"name\":\"${CNAME}X\",\"data\":$DATA,\"reason\":\"smoke test sua nhan vat\"}" | jq -r .code)" "stale_save"
V2=$(jq -r .version <<<"$C")
# người chơi lưu từ Hub: không xoá / thêm được đồ Admin
SAVE=$(jq -c '.data | .admin_grants=[]' <<<"$C")
curl -s -X PUT $API/v1/characters/$CID -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d "{\"version\":$V2,\"data\":$SAVE}" >/dev/null
check "game không xoá được đồ chờ giao" "$(aget /admin/api/characters/$CID | jq -r '.data.admin_grants | length')" "1"
# game server hỏi trạng thái -> nhận lệnh đá + bỏ cờ
ST=$(curl -s -X POST $API/internal/game/status -H "X-Service-Key: $SK" -H 'Content-Type: application/json' -d "{\"account_ids\":[],\"character_ids\":[$CID]}")
check "game server nhận lệnh đá" "$(jq -r ".reload | index($CID) != null" <<<"$ST")" "true"
ST=$(curl -s -X POST $API/internal/game/status -H "X-Service-Key: $SK" -H 'Content-Type: application/json' -d "{\"account_ids\":[],\"character_ids\":[$CID]}")
check "chỉ đá 1 lần" "$(jq -r '.reload | length' <<<"$ST")" "0"
check "đang online" "$(aget /admin/api/characters/$CID | jq -r .online)" "true"
check "đá khỏi game" "$(apost /admin/api/characters/$CID/kick '{"reason":"smoke test da nhan vat"}' | jq -r .ok)" "true"
check "nhật ký có thao tác sửa" "$(aget "/admin/api/audit?action=character.edit" | jq -r '.items[0].detail.changes | map(select(startswith("gold"))) | length')" "1"
echo "== $pass OK, $fail FAIL"
