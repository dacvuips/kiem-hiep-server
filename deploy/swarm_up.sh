#!/usr/bin/env bash
# TRIỂN KHAI STACK SWARM (chạy trên VPS manager; GitHub Actions và deploy.sh tự gọi):
#   bash deploy/swarm_up.sh <HUB> [account=<TAG>] [game=<TAG>]
# Không ghi tag của image nào -> giữ bản đang chạy (chưa chạy bao giờ -> latest). Vì 2 image build ở 2 repo khác nhau:
#   repo kiem-hiep-server -> account=<TAG>,  repo game kiem-hiep -> game=<TAG>.
# Image private trên Docker Hub: chạy `docker login` trên manager 1 lần (--with-registry-auth chuyển quyền cho các node).
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)"
HUB="${1:?thiếu HUB (tài khoản Docker Hub)}"
shift
STACK=kiemhiep
cd "$dir"

# Actions của 2 repo có thể deploy cùng lúc: phải lần lượt, nếu không lần sau đọc tag cũ của image kia rồi đưa nó về bản cũ.
exec 9>"$dir/.deploy.lock"
flock -w 900 9 || { echo "Đang có lần deploy khác chạy quá 15 phút" >&2; exit 1; }

## Tag image đang chạy của 1 service (rỗng nếu chưa có).
running_tag() {
	docker service inspect "${STACK}_$1" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null \
		| sed -E 's/@sha256:.*//; s/.*://' || true
}
ACCOUNT_TAG="$(running_tag account)"; ACCOUNT_TAG="${ACCOUNT_TAG:-latest}"
GAME_TAG="$(running_tag game)"; GAME_TAG="${GAME_TAG:-latest}"
for a in "$@"; do
	case "$a" in
		account=*) ACCOUNT_TAG="${a#account=}" ;;
		game=*) GAME_TAG="${a#game=}" ;;
		*) echo "Tham số không hợp lệ: $a (account=<TAG> | game=<TAG>)" >&2; exit 1 ;;
	esac
done
for t in "$ACCOUNT_TAG" "$GAME_TAG"; do
	[[ "$t" =~ ^[A-Za-z0-9_.-]{1,128}$ ]] || { echo "TAG không hợp lệ: $t" >&2; exit 1; }
done

[ "$(docker info -f '{{.Swarm.LocalNodeState}}')" = active ] || { echo "Máy này chưa ở trong Swarm (docker swarm init)" >&2; exit 1; }
[ "$(docker info -f '{{.Swarm.ControlAvailable}}')" = true ] || { echo "Phải chạy trên node manager" >&2; exit 1; }
bash deploy/check_env.sh "$dir/stack.env"

# Node chứa dữ liệu (Postgres volume, client/): chưa node nào có nhãn -> gắn cho node này.
if [ -z "$(docker node ls -q --filter node.label=kiemhiep.main=true)" ]; then
	echo "Gắn nhãn kiemhiep.main=true cho node này (Postgres, account, Caddy, game server chạy ở đây)"
	docker node update --label-add kiemhiep.main=true "$(docker info -f '{{.Swarm.NodeID}}')" >/dev/null
fi
mkdir -p client/files

# Chế độ cổng vào: public = Caddy mở 80/443 và tự lấy chứng chỉ; proxy = đã có reverse proxy (Nginx Proxy Manager, Traefik...)
# giữ 80/443, Caddy chỉ chia đường trong mạng Swarm (caddy:80) và proxy đó lo TLS. Ép tay: EDGE=public|proxy trong stack.env.
EDGE="$(grep -E '^EDGE=' stack.env | cut -d= -f2- || true)"
if [ -z "$EDGE" ]; then
	busy=0
	for port in 80 443; do
		other="$(docker service ls --format '{{.Name}} {{.Ports}}' | grep -E "(:|\*:)$port->" | grep -v "^${STACK}_caddy " || true)"
		if [ -n "$other" ] || { ss -ltnH "sport = :$port" 2>/dev/null | grep -q . && ! docker service ps "${STACK}_caddy" >/dev/null 2>&1; }; then
			busy=1
		fi
	done
	EDGE=public
	[ "$busy" = 1 ] && EDGE=proxy
fi
case "$EDGE" in public|proxy) ;; *) echo "EDGE không hợp lệ: $EDGE (public | proxy)" >&2; exit 1 ;; esac
stack_files=(-c deploy/stack.yml)
if [ "$EDGE" = public ]; then
	stack_files+=(-c deploy/stack.public.yml); export SITE_ADDR="$(grep -E '^DOMAIN=' stack.env | cut -d= -f2-)"
else
	export SITE_ADDR=":80"
fi
echo "== Cổng vào: $EDGE"

h() { sha256sum "$1" | cut -c1-12; }
export KH_DIR="$dir" HUB ACCOUNT_TAG GAME_TAG
export DOMAIN="$(grep -E '^DOMAIN=' stack.env | cut -d= -f2-)"
export GAME_PUBLIC_HOST="$(grep -E '^GAME_PUBLIC_HOST=' stack.env | cut -d= -f2-)"
export H_CADDYFILE="$(h deploy/Caddyfile)"
for f in secrets/*; do
	n="$(basename "$f" | tr '[:lower:]' '[:upper:]')"
	export "H_$n=$(h "$f")"
done

echo "== docker stack deploy $STACK (account:$ACCOUNT_TAG, game:$GAME_TAG)"
wait_flag=()
docker stack deploy --help 2>/dev/null | grep -q -- '--detach' && wait_flag=(--detach=false)   # Docker 26+: chờ service chạy xong
docker stack deploy "${stack_files[@]}" --with-registry-auth --prune "${wait_flag[@]}" "$STACK"

# Secret/config cũ (nội dung đã đổi -> tên cũ) không service nào dùng nữa: xoá. Cái đang dùng thì Docker từ chối xoá.
for s in $(docker secret ls --format '{{.Name}}' | grep '^kh_' || true); do docker secret rm "$s" >/dev/null 2>&1 || true; done
for c in $(docker config ls --format '{{.Name}}' | grep '^kh_' || true); do docker config rm "$c" >/dev/null 2>&1 || true; done

# Máy chủ 1 vẫn là địa chỉ máy dev (seed) -> trỏ về wss://DOMAIN/ws/world (client dùng ws_url). Admin sửa tay trên web Admin rồi thì không đụng.
pg="$(docker ps -q -f "label=com.docker.swarm.service.name=${STACK}_postgres" | head -n 1)"
if [ -n "$pg" ]; then
	for _ in $(seq 1 30); do
		docker exec "$pg" psql -U kiemhiep -tAc "SELECT 1 FROM game_servers LIMIT 1" >/dev/null 2>&1 && break
		sleep 2   # đợi account chạy migrate tạo bảng
	done
	docker exec "$pg" psql -U kiemhiep -q -c \
		"UPDATE game_servers SET host='$GAME_PUBLIC_HOST', ws_url='wss://$DOMAIN/ws/world' WHERE id=1 AND host='127.0.0.1'" || true
fi
docker image prune -f >/dev/null 2>&1 || true
docker stack services "$STACK" --format 'table {{.Name}}\t{{.Replicas}}\t{{.Image}}'
