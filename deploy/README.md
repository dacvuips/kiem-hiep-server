# Đưa lên máy chủ thật (Docker Swarm)

```
repo kiem-hiep-server (repo này)            repo game kiem-hiep
  push account/ admin-web/ portal-web/        push net/ systems/ data/ ...
     │ Actions: go test, build image             │ Actions: Godot xuất game_server.pck, build image
     ▼                                           ▼
  Docker Hub  <HUB>/kiemhiep-account:<TAG>    <HUB>/kiemhiep-game:<TAG>
     │                                           │
     └────────── SSH -> VPS manager: bash deploy/swarm_up.sh <HUB> account=<TAG> | game=<TAG>
                 docker stack deploy kiemhiep (deploy/stack.yml) — image kia giữ nguyên bản đang chạy
```

Trên VPS (`/opt/kiemhiep`): `stack.env` (cấu hình thường), `secrets/` (khóa — thành Docker secrets), `client/`
(gói game cho launcher), `deploy/` (repo này đẩy lên), `backups/`.

## 1. Cài lần đầu (từ máy dev, Git Bash)

1. **DNS**: bản ghi A `api.<tên miền>` và `game.<tên miền>` -> IP node manager.
2. **SSH key** lên VPS: `ssh-keygen -t ed25519` rồi `ssh-copy-id root@<IP>`.
3. **Docker Hub**: tạo 2 repo **private** `kiemhiep-account`, `kiemhiep-game`. Tạo Access Token (Account settings ->
   Personal access tokens, quyền Read & Write). Trên VPS manager: `docker login -u <HUB>` (để kéo image private).
4. `cp deploy/deploy.env.example deploy/deploy.env`, điền `HUB`, `VPS`, `DOMAIN`, `GAME_HOST`.
5. `bash deploy/deploy.sh setup` — luật tường lửa (chỉ khi ufw/firewalld đang bật), lịch sao lưu 03:17.
6. `bash deploy/deploy.sh env` — tạo `stack.env` + `secrets/` **trên VPS** với khóa mới, in mật khẩu admin tạm (1 lần).
   **Sao lưu `/opt/kiemhiep/secrets/`** ra nơi an toàn (mất `password_pepper` = mất mọi mật khẩu người chơi).
   SMTP: sửa `SMTP_HOST/PORT/USER` trong `stack.env`, mật khẩu ghi vào `secrets/smtp_pass`.
7. Bản đầu tiên (chưa có Actions): `bash deploy/deploy.sh account` rồi `bash deploy/deploy.sh game`
   (hoặc push lên GitHub sau khi làm mục 2).
8. `https://<DOMAIN>/admin/` -> đăng nhập `admin` + mật khẩu tạm -> bật 2FA -> đổi mật khẩu.

## 2. GitHub Actions (làm cho CẢ 2 repo: kiem-hiep-server và kiem-hiep)

Settings -> Secrets and variables -> Actions:

| Loại | Tên | Giá trị |
|---|---|---|
| Variable | `DOCKERHUB_USERNAME` | tài khoản Docker Hub |
| Variable | `VPS_HOST` | IP / tên miền VPS manager |
| Variable | `VPS_USER` | user SSH (VD `root` hoặc `deploy` có quyền docker) |
| Variable | `VPS_PORT` | cổng SSH (bỏ trống = 22) |
| Variable | `DOMAIN` | `api.<tên miền>` (chỉ repo server — kiểm tra /healthz) |
| Variable | `VPS_PLATFORM` | bỏ trống = `linux/amd64`; VPS chip ARM: `linux/arm64` |
| Secret | `DOCKERHUB_TOKEN` | Access Token Docker Hub |
| Secret | `VPS_SSH_KEY` | khóa SSH **riêng cho Actions** (`ssh-keygen -t ed25519 -f gh_deploy -N ""`, chép `gh_deploy.pub` vào `~/.ssh/authorized_keys` trên VPS, dán nội dung `gh_deploy`) |
| Secret | `VPS_KNOWN_HOSTS` | kết quả `ssh-keyscan -p <cổng> <IP VPS>` (chạy trên máy tin cậy) — chống giả mạo máy chủ |

Settings -> Environments -> tạo `production`. Repo game: bật **Required reviewers** — bật lại game server ngắt mọi
người đang chơi, nên duyệt tay để chọn lúc vắng người. Repo server: tuỳ (account khởi động lại vài giây).

Sau đó: push lên `main` là tự build + deploy phần thay đổi. Chạy tay: tab Actions -> Run workflow.

## Các lần sau

| Việc | Cách |
|---|---|
| Sửa server tài khoản / web | push repo này |
| Sửa game server | push repo game (duyệt bước deploy) |
| Bản mới lỗi | `bash deploy/deploy.sh redeploy account=<TAG cũ>` (hoặc `game=<TAG cũ>`) — TAG xem trên Docker Hub |
| Đổi khóa / cấu hình | sửa `stack.env` / `secrets/*` trên VPS rồi `deploy.sh redeploy account=<TAG đang chạy>` |
| Bản game cho launcher | repo game: `python tools/build_client_update.py`, rồi repo này: `bash deploy/deploy.sh client` |
| Trạng thái / log | `deploy.sh status`, `deploy.sh logs game` (account, battle, arena, field, caddy, postgres) |

## Trên VPS

- Sao lưu tay: `bash /opt/kiemhiep/deploy/backup_db.sh` — giữ 14 bản. **Chép ra máy khác định kỳ.**
- Khôi phục: `gunzip -c backups/<file>.sql.gz | docker exec -i $(docker ps -q -f label=com.docker.swarm.service.name=kiemhiep_postgres) psql -U kiemhiep kiemhiep`
- Quên mật khẩu Super Admin: `docker exec -it $(docker ps -q -f label=com.docker.swarm.service.name=kiemhiep_account) /account admin <tên> super`
- Đã có Traefik/nginx chiếm 80/443: `swarm_up.sh` dừng và báo — bỏ service `caddy` trong `stack.yml`, trỏ proxy đó tới
  `account:8080` (gắn proxy vào mạng `kiemhiep_kiemhiep`).
