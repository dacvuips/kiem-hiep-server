# Kiếm Hiệp — backend

Server tài khoản (Go), web Admin, trang web người chơi và cấu hình triển khai Docker Swarm.
**Game server** (Godot headless) nằm ở repo game `kiem-hiep` (thư mục `net/`, image build từ `server/game/`) vì dùng chung
code combat / quái / map với game. Triển khai máy thật + GitHub Actions: xem [deploy/README.md](deploy/README.md).
Máy dev: clone repo này **cạnh** repo game (`../kiem-hiep`) — `server/dev.sh` của repo game tìm repo này ở `../kiem-hiep-server`.

| Thư mục | Nội dung |
|---|---|
| `account/` | Server tài khoản (Go): đăng ký, đăng nhập, quên/đổi mật khẩu, máy chủ, nhân vật, API web Admin |
| `admin-web/` | Web Admin (React + Vite), được build vào image `account` và phục vụ tại `/admin/` |

## Bắt đầu nhanh — 1 lệnh cho cả hệ thống

```bash
cp server/.env.example server/.env                         # lần đầu: điền khoá (genkeys bên dưới) + GODOT_PATH
bash server/dev.sh up        # build lại gói game server NẾU code đổi, bật account + 4 game server
bash server/dev.sh status    # service / cổng / bản code đang chạy (cảnh báo nếu gói server cũ hơn code)
bash server/dev.sh logs field
bash server/dev.sh restart game
bash server/dev.sh down      # tắt hết, GIỮ dữ liệu PostgreSQL
bash server/dev.sh local field   # chạy 1 game server bằng Godot từ mã nguồn (sửa code nhanh, không Docker)
bash server/dev.sh test [--battle]   # toàn bộ bài test (bật server thử cổng 79xx riêng, xong tự tắt)
```

| Tiến trình | Cổng (UDP ENet / WebSocket) | Ghi chú |
|---|---|---|
| `account` | `127.0.0.1:8080` | API + web Admin `/admin/`. Mặc định chỉ máy này gọi được (`ACCOUNT_BIND`) |
| `game` | 7777 / 7778 | thế giới |
| `battle` | 7787 / 7788 | chiến trường Tống Kim |
| `arena` | 7797 / 7798 | đấu trường PK |
| `field` | 7807 / 7808 | phòng train chung Vượt Ải (thêm tiến trình: chép khối `field`, đổi `GAME_FIELD_INDEX` 1..8 + cổng) |

Gói game server mang **dấu phiên bản** (mã git + giờ build): in ra lúc khởi động, hiện ở web Admin › Máy chủ. Chạy thẳng mã nguồn
thì ghi "(chạy từ mã nguồn)". `dev.sh` tự dọn image Docker cũ sau mỗi lần build (không đụng volume dữ liệu).

## Chạy trên máy dev (chi tiết)

Cần Docker Desktop đang chạy.

```bash
cp .env.example .env                              # lần đầu
docker compose run --rm --no-deps account genkeys  # in bộ khóa mới -> dán vào .env
docker compose up -d --build
```

| Dịch vụ | Địa chỉ |
|---|---|
| API tài khoản | http://localhost:8080 (chỉ máy này — thử từ điện thoại trong LAN: `ACCOUNT_BIND=0.0.0.0` trong `.env`) |
| Web Admin | http://localhost:8080/admin/ |
| Hộp thư giả (xem mã OTP) | http://localhost:8025 |
| PostgreSQL | `127.0.0.1:5432`, user/db `kiemhiep`, mật khẩu = `DB_PASSWORD` trong `.env` |

Kiểm tra toàn bộ luồng tài khoản:

```bash
docker run --rm --network server_default -e API=http://account:8080 -e MAIL=http://mailpit:8025 \
  -v "$PWD/account:/t" alpine:3.20 sh -c "apk add -q bash curl jq && bash /t/smoke_test.sh"
```

## Trang web người chơi + nạp thẻ

`portal-web/` (React + Vite), được build vào image `account` và phục vụ tại **http://localhost:8080/**: trang chủ, đăng ký,
đăng nhập, quên mật khẩu, quản lý tài khoản (đổi mật khẩu, nhân vật, lịch sử nạp / đăng nhập), **nạp thẻ**.

- Đăng nhập web: `/v1/web/*` — refresh token nằm trong cookie HttpOnly + SameSite=Strict (JavaScript không đọc được),
  access token chỉ giữ trong bộ nhớ trang; mọi yêu cầu `/v1/web/*` phải có header `X-Web-Request: 1` (chống CSRF).
- Nạp thẻ: tiền vào **Ví Xu** của tài khoản (`wallets`, sổ cái `wallet_ledger`), người chơi đổi Xu thành **Nguyên bảo** cho 1 nhân vật
  (`character_grants`). Game server cộng Nguyên bảo khi nhân vật vào map hoặc trong lần hỏi định kỳ nếu đang online, và chỉ đánh dấu
  "đã nhận" trong cùng lần lưu nhân vật (không mất, không cộng 2 lần). Tỉ lệ mặc định 10.000đ = 100 Xu, 1 Xu = 1 Nguyên bảo
  (web Admin → Nạp thẻ → Cài đặt quy đổi).
- Cổng thanh toán: hiện chỉ có **cổng giả lập** (`SHOP_SANDBOX=true`, chỉ máy dev). Cổng thật cắm vào `paymentProvider` trong
  `account/shop.go` (tạo đơn -> trang của cổng -> webhook có chữ ký -> `markPaid`). Production: `SHOP_SANDBOX=false`.
- Web Admin: trang **Nạp thẻ** (doanh thu, duyệt / huỷ đơn tay, cài đặt quy đổi) và mục **Ví Xu** trong chi tiết tài khoản (cộng / trừ Xu
  có lý do, ghi nhật ký).

```bash
cd portal-web && npm install && npm run dev        # phát triển giao diện ở :5174 (chuyển /v1 sang :8080)
API=http://localhost:8080 bash account/web_smoke_test.sh   # kiểm tra phiên web + nạp thẻ giả lập
```

## API người chơi

Lỗi luôn có dạng `{"code": "...", "message": "..."}`. Client dựa vào `code`.

| Method | Đường dẫn | Body | Ghi chú |
|---|---|---|---|
| POST | `/v1/auth/register` | `username, email, password` | Không cần OTP. Trả về phiên đăng nhập |
| POST | `/v1/auth/login` | `username, password` | Không phân biệt hoa thường ở tên |
| POST | `/v1/auth/refresh` | `refresh_token` | Xoay vòng token. Dùng lại token cũ sẽ thu hồi mọi phiên |
| POST | `/v1/auth/logout` | `refresh_token` | |
| POST | `/v1/auth/forgot` | `username, email` | Luôn trả `ok`. Gửi mã 6 số nếu tên và email khớp |
| POST | `/v1/auth/reset` | `username, code, new_password` | Sai 5 lần thì mã bị hủy. Đăng xuất mọi máy |
| POST | `/v1/account/password` | `old_password, new_password` | Cần `Authorization: Bearer`. Trả phiên mới |
| GET | `/v1/account/me` | | Cần Bearer |
| POST | `/v1/auth/google/start` | | Trả `auth_url, state, poll_secret`. Có Bearer = liên kết Google vào tài khoản đang đăng nhập |
| GET | `/v1/auth/google/callback` | | Google chuyển trình duyệt về đây (trang HTML báo quay lại game) |
| POST | `/v1/auth/google/poll` | `state, poll_secret` | `202` = đang chờ; `200` = phiên đăng nhập (lấy được 1 lần) |
| GET | `/v1/servers` | | Cần Bearer. Kèm `characters` = số nhân vật của tài khoản trên từng máy chủ |
| GET | `/v1/characters?server_id=N` | | Nhân vật của tài khoản trên máy chủ N (tối đa 4 ô) |
| POST | `/v1/characters` | `server_id, slot, name, data` | Tên 2–16 ký tự (chữ có dấu, số, cách), không trùng trong máy chủ |
| PUT | `/v1/characters/{id}` | `version, data` | Lưu tiến trình. Sai `version` (máy khác vừa lưu) thì trả `stale_save`. Không đổi được tên qua `data` |
| DELETE | `/v1/characters/{id}` | `password` | Xóa mềm, phải nhập lại mật khẩu |

Phiên đăng nhập: `{access_token (15 phút), refresh_token (30 ngày), expires_in, account}`.

Các mã lỗi: `bad_request`, `bad_username`, `bad_email`, `bad_password`, `password_is_username`, `username_taken`, `wrong_login`,
`wrong_password`, `bad_code`, `bad_name`, `name_taken`, `slot_taken`, `too_many_characters`,
`character_not_found`, `google_disabled`, `google_expired`, `google_in_use`, `google_already_linked`, `google_failed`, `google_canceled`, `bad_server`, `maintenance`, `stale_save`, `data_too_large`, `banned`, `unauthorized`, `rate_limited`, `internal`.

## Bảo mật

| Thứ cần bảo vệ | Cách làm |
|---|---|
| Mật khẩu | argon2id (19 MiB, 2 vòng) trên `HMAC(PASSWORD_PEPPER, mật khẩu)`, salt riêng từng tài khoản. Lộ database mà không có pepper thì không dò được. Tự băm lại khi đổi tham số |
| Access token | JWT ký **Ed25519**, header có `kid`, kèm `iss`/`aud`/`exp`/`nbf`/`iat`/`jti`. Sống 15 phút. Chỉ chấp nhận `EdDSA` (chặn `alg=none`) |
| Kiểm tra token ở game server | Chỉ dùng **khóa công khai** từ `/.well-known/jwks.json`. Game server không ký được token |
| Refresh token, mã OTP | Database chỉ lưu `HMAC(TOKEN_HMAC_KEY, …)`. Refresh xoay vòng, dùng lại token cũ thì thu hồi mọi phiên |
| Khóa bí mật | Chỉ ở biến môi trường (`server/.env`, không commit). Server không khởi động nếu thiếu khóa hoặc còn giá trị mẫu. Không ghi khóa ra log |
| Client | **Không giữ khóa nào**, chỉ giữ token của chính người chơi |
| Dò tài khoản | Cùng thông báo lỗi và cùng thời gian trả lời dù tên có tồn tại hay không. Quên mật khẩu luôn trả `ok` |
| Dò mật khẩu | Giới hạn theo tài khoản (10/phút) và theo IP (120/phút). OTP sai 5 lần thì hủy |
| HTTP | CORS chỉ cho tên miền trong `CORS_ORIGINS`, header `nosniff`/`no-store`/HSTS/`X-Frame-Options`. Production bắt buộc chạy sau HTTPS (Caddy/Nginx) với `TRUST_PROXY=true` |
| Database, hộp thư | Chỉ mở cổng cho `127.0.0.1`, không mở ra mạng |

Đổi khóa ký JWT: chạy `genkeys`, thay `JWT_KID` + `JWT_PRIVATE_KEY`, đưa khóa công khai cũ vào `JWT_PUBLIC_KEYS`
để token đang dùng còn hợp lệ tới khi hết hạn (15 phút), sau đó xóa đi.
**Không được đổi `PASSWORD_PEPPER`** khi đã có người chơi. Phải sao lưu nó an toàn cùng database.

> Hiện client tự gửi dữ liệu nhân vật (`PUT /v1/characters/{id}`), nên sửa client vẫn có thể gian lận chỉ số/đồ.
> Khi có game server (bước B), chỉ game server được ghi dữ liệu nhân vật.

## Web Admin

- Đăng nhập lần đầu bằng `BOOTSTRAP_ADMIN_USER` / `BOOTSTRAP_ADMIN_PASS` trong `.env`. Hệ thống bắt **bật 2FA**
  (Google Authenticator...) rồi **đổi mật khẩu** (ít nhất 12 ký tự) trước khi vào các trang.
- Vai trò: **Super Admin** (toàn quyền), **Game Master** (khóa, cấm chat, khôi phục nhân vật), **Hỗ trợ** (đặt lại mật khẩu,
  đổi email, đăng xuất mọi thiết bị), **Chỉ xem**.
- Mọi thao tác thay đổi dữ liệu bắt nhập lý do và ghi vào nhật ký (bảng `admin_audit`, không sửa / xóa được).
- Phiên admin nằm trong cookie HttpOnly + SameSite=Strict, kèm header chống CSRF, hết hạn sau 8 giờ.
- Mất 2FA / quên mật khẩu Super Admin: chạy trên máy chủ
  `docker compose exec account /account admin <tên> super` để nhận mật khẩu tạm mới (2FA bị xóa, phải thiết lập lại).
- Sửa giao diện: `cd admin-web && npm install && npm run dev` rồi mở http://localhost:5173/admin/ (API tự chuyển sang :8080).
- **Sửa nhân vật** (Super Admin): Tài khoản → bấm tên nhân vật. Sửa tên, cấp, tiền, môn phái, điểm tiềm năng / kỹ năng, cấp skill,
  trang bị, hành trang, rương (sửa / xoá / chuyển món), tặng đồ (đồ thường chọn loại + cấp + ngũ hành + cấp dòng, hoặc hoàng kim),
  và tab JSON cho mọi trường còn lại. Đồ tặng nằm ở `admin_grants` — game server sinh thành món thật bằng bộ sinh đồ của game
  khi nhân vật vào map. Lưu xong, nhân vật đang online bị game server đá ra (≤ `GAME_STATUS_POLL` giây) để vào lại nhận bản mới.
- Danh mục tên đồ / skill cho trang này: `admin-web/public/catalog.json`, sinh bằng
  `godot --headless --path . --script tools/export_admin_catalog.gd` — chạy lại khi đổi dữ liệu đồ hoặc skill.

Kiểm tra web Admin bằng trình duyệt thật (cần Chrome):

```bash
PASS=$(docker compose exec -T account /account admin e2e_super super | grep -o 'tạm: .*' | cut -d' ' -f2)
cd admin-web/e2e && npm install && node admin_e2e.mjs e2e_super "$PASS" ./shots
# xong: vô hiệu hóa admin thử
docker compose exec -T postgres psql -U kiemhiep -c "UPDATE admins SET disabled=true WHERE username='e2e_super'"
```

## Game server (Godot headless)

Chế độ MAIN_MAP online: `res://net/server/game_server.tscn` (code trong `net/`). Nghe ENet `:7777` (PC/mobile) và WebSocket
`:7778` (web), mô phỏng 18 tick/giây, gửi vị trí 9 lần/giây theo lưới tầm nhìn 1024 px (mỗi người thấy 3x3 ô quanh mình).

```bash
bash server/dev.sh up            # Docker (giống production): tự xuất gói server (~90 MB, chỉ code + dữ liệu) khi code đổi
bash server/dev.sh local world   # hoặc chạy thẳng bằng Godot trên máy (sửa code nhanh, không cần build lại)
bash server/dev.sh test          # kiểm thử bằng bot thật (server thử riêng, không đụng server đang chạy)
```

`GAME_TEST_MODE=1` (chỉ server thử của `test.sh`) bật lệnh chat `/testgold`, `/testlevel`, `/testrestart` và `GAME_BATTLE_MARSHAL_LIFE`
— **không bao giờ đặt trên máy chủ thật** (người chơi tự cộng tiền / cấp được).

Gói server dùng preset export **"Game Server (Linux)"** (chế độ Dedicated Server của Godot: ảnh đã import thành ảnh rỗng,
loại thư mục ảnh / âm thanh thô). Mỗi lần gửi trạng thái, thực thể mới vào tầm / rời tầm được gộp vào 1 gói (`S_SPAWNS`, `S_DESPAWNS`).

- Vào map: game gửi access token + mã nhân vật; game server hỏi `POST /internal/game/join` (khóa `GAME_SERVICE_KEY`).
  Nhân vật đăng nhập nơi khác thì phiên cũ bị đá.
- Di chuyển: game gửi vị trí, server kiểm tra tốc độ (ngân sách quãng đường) + ô vật cản, sai thì kéo về (`S_CORRECT`).
- Quái (theo `map.json`) do game server điều khiển: AI gốc KNpcAI, hồi sinh theo `respawn`; máu / kinh nghiệm / chiêu theo
  SCRIPT CẤP GỐC (`MonsterData.apply_level_script` — dùng chung với bản offline nên 2 bên luôn khớp). Quái chỉ "thức" trong 3x3 ô
  AOI quanh người chơi (`GAME_AWAKE_RADIUS`) và mô phỏng 2 tick 1 lần với bước đôi (vị trí vốn gửi 2 tick 1 lần). Server báo quái ra chiêu (`S_MATTACK`); máy người bị nhắm tính đòn thật, máy khác chỉ vẽ.
- Sát thương người chơi gây cho quái: game tính rồi gửi `C_DAMAGE`; server kiểm tra khoảng cách, tốc độ gửi và cắt theo
  **trần sát thương của chính nhân vật** (`ProfileGuard.max_hit`: skill mạnh nhất đã học x chí mạng x dư 20%).
- Quái chết: **server tính kinh nghiệm / lên cấp** (`S_PROGRESS`, chia theo phần sát thương); rớt đồ cho người hạ đòn cuối (`S_KILL`).
- Dữ liệu nhân vật khi đang trong map: game gửi cho game server (`C_PROFILE`), server gộp theo `ProfileGuard` (giữ cấp /
  kinh nghiệm của server, điểm tiềm năng / kỹ năng không vượt số cấp cho phép) và lưu qua `PUT /internal/game/characters/{id}`
  mỗi 60 giây + khi thoát (lưu tuần tự; nhân vật đăng nhập nơi khác thì phiên mới nhận dữ liệu trong RAM của phiên cũ).
- **Đồ và tiền do server giữ:** mỗi món có `uid`. Game chỉ được sắp xếp / mặc / tháo / cất rương / khoá / đặt giá món server
  đã biết; món lạ, món nhân bản, sửa chỉ số, tăng tiền đều bị bỏ. Đồ rơi do server tung (`S_DROPS`), nhặt phải xin server
  (`C_PICKUP` -> `S_PICKED`, chủ được nhặt trước 30 giây), vứt đồ thì server đặt xuống đất (`C_DISCARD`). Quà chưa được game
  xác nhận (`grant_ack`) được server cộng bù khi gộp, không bị mất.
- **Giao dịch + bày bán giữa người thật** (`net/server/social_server.gd`): chạy đúng `TradeSession` / `StallService` gốc trên bản
  nhân vật của server; game chỉ gửi thao tác (`C_TRADE_*`, `C_STALL`), xong thì server gửi bản chuẩn (`S_PROFILE`) cho 2 bên.
  Bản game gửi lên trước khi nhận bản chuẩn (ack cũ) bị bỏ qua. Trong map có nút **Giao lưu** (người chơi ở gần).
- **Tổ đội thật** (`SocialServer`, `C_TEAM` / `S_TEAM_STATE`): lập đội, mời / xin vào, đuổi, đổi đội trưởng, mở / đóng,
  luật nhặt đồ (tự nhặt / tự do / đội trưởng / luân phiên) do server kiểm tra, chia kinh nghiệm cho đồng đội trong 768 px +
  kinh nghiệm lãnh đạo cho đội trưởng (luật KTeam gốc). `TeamService` khi online chỉ gửi lệnh, TeamWindow giữ nguyên.
- **Chat** (`net/server/chat_server.gd`, khung `ChatBox`): kênh Gần / Thế giới (chờ 10 giây) / Tổ đội / Bang hội / Riêng.
  Game server hỏi `POST /internal/game/status` mỗi `GAME_STATUS_POLL` giây (mặc định 30): **cấm chat / khoá từ web Admin
  có hiệu lực ngay với người đang online** (bị khoá thì bị đá ra). Đang gõ chữ thì phím không điều khiển nhân vật.
- **Bang hội thật** (`net/server/guild_server.gd`, bảng `guilds`): mỗi bang 1 bản dùng chung lưu PostgreSQL; thao tác chạy
  bằng `GuildService` gốc trên bản chung (bổ nhiệm, đuổi, nhường bang chủ, thông báo, tuyển người, quyên góp, phân quyền,
  đổi tên); lập bang / xin vào / mời / duyệt / rời / giải tán do server xử lý; quỹ bang + thử thách bang tính trên server.
- **Rương + khoá bảo vệ** (C5): mở thêm rương phải trừ đúng giá; mật mã / trạng thái khoá bảo vệ chỉ server giữ (`C_SECURITY`,
  gửi **mã băm** chứ không gửi mật mã); khoá món đồ chỉ được mở sau đủ 3 ngày chờ. Áp cho cả lưu HTTP ngoài map (Go).
- **Nhân vật mới:** lần đầu vào map, server khởi tạo lại phần kinh tế (cấp 1, không tiền / đồ) — chặn tạo nhân vật kèm đồ.
- **Lưu từ game ngoài map** (`PUT /v1/characters/{id}`): server tài khoản chặn tăng cấp / tiền / đồ / tổng điểm (`profile_guard.go`).
- `GAME_TEST_MODE=1` (chỉ khi chạy `tests/net_tests`): mỗi quái chết rớt thêm túi tiền + 1 món đồ dưới chân người hạ quái.
- **Production:** chặn đường dẫn `/internal/*` ở reverse proxy (chỉ cho mạng nội bộ của game server gọi).

### Đo tải (D)

```bash
# server/.env: tạm đặt RATE_LIMIT_IP_PER_MIN=5000 (tạo nhiều tài khoản bot từ 1 IP), restart account; xong trả về 120
GAME_TEST_MODE=1 GODOT=... bash server/run_game_server.sh
godot --headless --path . res://net/tools/load_test.tscn -- --bots=300 --seconds=60
```

Bot đi lang thang trong vùng 5000 x 5000 px quanh điểm xuất phát (rất đông — mỗi người thấy gần như mọi người khác), thỉnh
thoảng đánh quái / chat. Game server in mỗi 10 giây dòng `[đo]`: số người, thời gian tick (tách phần quái / gửi vị trí, ngân
sách 55.6 ms), KB/s gửi đi. Kết quả trên máy dev (1 luồng Godot, bot chạy cùng máy):

| Người online (cùng 1 vùng) | Tick trung bình | Gửi đi / người |
|---|---|---|
| 150 | ~5 ms | ~15 KB/s |
| 300 | ~9.5 ms | ~20-27 KB/s |
| 500 | ~14.5 ms | ~18 KB/s |

Tối ưu đã làm: mỗi ô AOI mã hoá 1 lần các thực thể đổi trạng thái rồi người xem ghép 9 khối (trước đó duyệt từng thực thể
cho từng người: 150 người tốn ~21 ms/tick); chỉ quét lại 3x3 ô khi người xem sang ô khác; bản ghi vị trí 17 -> 14 byte.
Băng thông mỗi người tăng theo **số người đứng gần**, không theo tổng số người trên map.

## Phòng train chung (Vượt Ải › Thường / Địa Ngục)

Tiến trình `field` (`GAME_FIELD=1`) chứa nhiều phòng, mỗi phòng 1 bản map + quái riêng, ID 6 số (chữ số đầu = `GAME_FIELD_INDEX` + 1,
không trùng giữa các tiến trình). Tối đa 8 người / phòng, chủ phòng rời = đóng phòng. Game tra phòng qua `GET /v1/field` (gộp mọi
tiến trình; phòng mới vào tiến trình vắng nhất). Tách phòng bằng vùng ô AOI riêng — **mọi kiểm tra "đứng gần" phía server phải dùng
`GameServer.near()`** (so cả phòng), thêm kiểm tra khoảng cách mới mà quên là lỗ hổng xuyên phòng.

## Vận hành từ web Admin (trang Máy chủ)

- **Tiến trình game server**: mỗi tiến trình gửi nhịp tim 5 giây / lần (`POST /internal/game/heartbeat`, khoá dịch vụ): bản code,
  số người, số phòng, thời gian tick, băng thông. Mất tín hiệu > 15 giây thì báo đỏ.
- **Khởi động lại êm** (vai trò super + 2FA + lý do, ghi nhật ký): game server báo đếm ngược cho người chơi, chặn người mới,
  LƯU mọi nhân vật rồi tự thoát; Docker (`restart: unless-stopped`) bật lại. Server tài khoản KHÔNG có quyền Docker.
  Bật tiến trình đã tắt hẳn vẫn làm bằng `dev.sh up` / trên máy chủ.
- **Thông số game** (super + 2FA + lý do, nhật ký ghi giá trị cũ -> mới): hệ số kinh nghiệm (1–10), rơi trang bị (1–20), tiền rơi (1–10).
  Chỉ khoá trong danh sách cho phép (`process.go: gameSettingDefs`); game server kẹp lại lần nữa.
- Kiểm tra: `account/process_smoke_test.sh` (hướng dẫn chạy ở đầu file — dùng admin thử tạo bằng CLI, không dùng admin thật).

## Lên máy chủ thật — kiểm tra bảo mật

- [ ] `.env` mới, khoá sinh bằng `genkeys`; **sao lưu `PASSWORD_PEPPER`** (đổi = mọi mật khẩu cũ sai). Không commit `.env`.
- [ ] `DEV_TRUST_CLIENT_SAVES=false`, `GAME_DEV_TRUST_CLIENT=0` (mặc định trong `.env.example`). Bật = người chơi tự sửa cấp / tiền / đồ.
- [ ] Không đặt `GAME_TEST_MODE`, `SHOP_SANDBOX=false`, `RATE_LIMIT_IP_PER_MIN` về 120.
- [ ] `ACCOUNT_BIND=127.0.0.1` + reverse proxy HTTPS (Caddy / Nginx) phía trước, `TRUST_PROXY=true`, `ADMIN_COOKIE_SECURE=true`,
      `CORS_ORIGINS` chỉ tên miền thật, `PUBLIC_BASE_URL` https.
- [ ] Đăng nhập Super Admin đầu tiên: đổi mật khẩu + bật 2FA; xoá `BOOTSTRAP_ADMIN_PASS` khỏi `.env`.
- [ ] Tường lửa chỉ mở 443 (proxy) + các cổng game UDP/WS; PostgreSQL chỉ `127.0.0.1`.
- [ ] `GAME_PUBLIC_HOST` = IP / tên miền công khai (người chơi kết nối tới game server).
- [ ] Chạy `bash server/dev.sh test` trên bản sắp phát hành — toàn bộ phải ĐẠT.
