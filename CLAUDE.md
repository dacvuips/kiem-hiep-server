## Repo này là backend của game Kiếm Hiệp

Server tài khoản (Go, `account/`), web Admin (`admin-web/`), web người chơi (`portal-web/`), `docker-compose.yml` máy dev,
deploy Docker Swarm (`deploy/`) và GitHub Actions. **Mọi sửa backend làm ở đây.**

Game server (Godot headless) KHÔNG ở đây — nằm ở repo game `../kiem-hiep` (`net/`, image từ `server/game/`),
vì dùng chung code combat / quái / map với game. Sửa giao thức / API giữa game và backend (`/internal/*`, `/v1/*`)
thì sửa CẢ 2 repo cho khớp.

- Khóa bí mật chỉ ở `.env` (máy dev) hoặc `/opt/kiemhiep/secrets/` (VPS) — không commit, không đưa vào client.
- Server đọc khóa qua `env()` trong `account/config.go`: biến thường hoặc `<TÊN>_FILE` (Docker secrets).
- Script `.sh` chạy trên VPS Linux: giữ xuống dòng LF (`.gitattributes` đã ép).
- Triển khai: xem `deploy/README.md`.
