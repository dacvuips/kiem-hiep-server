#!/usr/bin/env bash
# Sao lưu PostgreSQL (cron hằng ngày do setup_vps.sh cài). Giữ 14 bản gần nhất trong <dir>/backups.
#   bash deploy/backup_db.sh [/opt/kiemhiep]
# Khôi phục:
#   gunzip -c backups/<file>.sql.gz | docker exec -i $(docker ps -q -f label=com.docker.swarm.service.name=kiemhiep_postgres) psql -U kiemhiep kiemhiep
# NÊN chép thư mục backups ra máy khác (rclone / scp) — VPS hỏng thì bản sao lưu trên chính nó cũng mất.
set -euo pipefail
dir="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$dir"
mkdir -p backups
pg="$(docker ps -q -f label=com.docker.swarm.service.name=kiemhiep_postgres | head -n 1)"
[ -n "$pg" ] || { echo "$(date '+%F %T') không thấy container kiemhiep_postgres trên node này" >&2; exit 1; }
out="backups/kiemhiep-$(date +%Y%m%d-%H%M%S).sql.gz"
docker exec "$pg" pg_dump -U kiemhiep --clean --if-exists kiemhiep | gzip -9 > "$out.tmp"
mv "$out.tmp" "$out"
ls -1t backups/kiemhiep-*.sql.gz | tail -n +15 | xargs -r rm -f
echo "$(date '+%F %T') sao lưu $out ($(du -h "$out" | cut -f1))"
