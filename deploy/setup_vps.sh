#!/usr/bin/env bash
# CÀI VPS LẦN ĐẦU (chạy trên VPS bằng root): Docker, tường lửa, thư mục, lịch sao lưu database hằng ngày.
#   bash setup_vps.sh [/opt/kiemhiep]
# Chạy lại nhiều lần không sao. Hỗ trợ Ubuntu / Debian (ufw) và CentOS / Rocky / Alma (firewalld).
set -euo pipefail
dir="${1:-/opt/kiemhiep}"
[ "$(id -u)" = 0 ] || { echo "Cần chạy bằng root (sudo bash setup_vps.sh)" >&2; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
	echo "== Cài Docker"
	curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker compose version >/dev/null || { echo "Thiếu docker compose plugin" >&2; exit 1; }

# SSH, HTTPS, cổng game: thế giới 7777/7778, Tống Kim 7787/7788, Đấu trường 7797/7798, Train chung 7807/7808.
# KHÔNG mở 5432 (Postgres) và 8080 (account chỉ nghe 127.0.0.1, đi qua Caddy).
ssh_port="$(ss -tlnp 2>/dev/null | awk '/sshd/ {sub(/.*:/, "", $4); print $4; exit}')"
ssh_port="${ssh_port:-22}"
tcp=("$ssh_port" 80 443 7778 7788 7798 7808)
udp=(443 7777 7787 7797 7807)
# KHÔNG tự bật tường lửa (VPS có thể đang chạy dịch vụ khác / Swarm nhiều node) — chỉ thêm luật nếu đã bật.
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
	echo "== Thêm luật ufw"
	for p in "${tcp[@]}"; do ufw allow "$p/tcp" >/dev/null; done
	for p in "${udp[@]}"; do ufw allow "$p/udp" >/dev/null; done
elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
	echo "== Thêm luật firewalld"
	for p in "${tcp[@]}"; do firewall-cmd --permanent --add-port="$p/tcp" >/dev/null; done
	for p in "${udp[@]}"; do firewall-cmd --permanent --add-port="$p/udp" >/dev/null; done
	firewall-cmd --reload >/dev/null
else
	echo "!! Tường lửa chưa bật — nếu nhà cung cấp VPS có tường lửa riêng (security group), mở: TCP ${tcp[*]}, UDP ${udp[*]}"
fi
# Lưu ý: Docker tự mở cổng của container qua iptables (kể cả khi ufw chặn) — vì vậy Postgres / account
# trong deploy/stack.yml không publish cổng ra ngoài.

mkdir -p "$dir/backups"
cron="/etc/cron.d/kiemhiep-backup"
echo "17 3 * * * root bash $dir/deploy/backup_db.sh $dir >> $dir/backups/backup.log 2>&1" > "$cron"
chmod 644 "$cron"
echo "== Xong. Thư mục: $dir — sao lưu database lúc 03:17 hằng ngày vào $dir/backups"
