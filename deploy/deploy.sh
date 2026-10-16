#!/usr/bin/env bash
# ĐƯA LÊN VPS BẰNG TAY — chạy trên máy dev (Git Bash). Bình thường GitHub Actions làm việc này (xem deploy/README.md);
# script dùng khi cài lần đầu, khi Actions hỏng, hoặc để đẩy bản game cho launcher.
# Đọc deploy/deploy.env (chép từ deploy.env.example).
#
#   bash deploy/deploy.sh setup              lần đầu: chép script lên VPS, thêm luật tường lửa, lịch sao lưu database
#   bash deploy/deploy.sh env                lần đầu: tạo stack.env + secrets/ NGAY TRÊN VPS (khóa mới, không qua máy dev)
#   bash deploy/deploy.sh account            build + đẩy image account lên Docker Hub, bật lại trên VPS
#   bash deploy/deploy.sh game               (cần repo game ở GAME_REPO) build gói + image game server, bật lại
#   bash deploy/deploy.sh redeploy account=<TAG> game=<TAG>   quay về bản image cũ (ghi 1 hoặc cả 2)
#   bash deploy/deploy.sh client             đẩy bản game cho launcher (repo game: python tools/build_client_update.py)
#   bash deploy/deploy.sh status | logs [service]
#
# Khóa bí mật chỉ nằm TRÊN VPS (stack.env, secrets/) — script này không đọc, không chép .env của máy dev.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "$here")"
die() { echo "Lỗi: $*" >&2; exit 1; }

[ -f "$here/deploy.env" ] || die "chưa có deploy/deploy.env — chép deploy.env.example rồi điền"
cfg() { grep -E "^$1=" "$here/deploy.env" | tail -n 1 | cut -d= -f2- | tr -d '\r'; }
VPS="$(cfg VPS)"; SSH_PORT="$(cfg SSH_PORT)"; R="$(cfg REMOTE_DIR)"; DOMAIN="$(cfg DOMAIN)"; GAME_HOST="$(cfg GAME_HOST)"
HUB="$(cfg HUB)"; GAME_REPO="$(cfg GAME_REPO)"
SSH_PORT="${SSH_PORT:-22}"; R="${R:-/opt/kiemhiep}"; GAME_REPO="${GAME_REPO:-$repo/../kiem-hiep}"
[ -n "$VPS" ] && [ -n "$DOMAIN" ] && [ -n "$GAME_HOST" ] && [ -n "$HUB" ] || die "deploy.env thiếu VPS / DOMAIN / GAME_HOST / HUB"
case "$VPS" in *1.2.3.4*) die "deploy.env vẫn là giá trị mẫu";; esac

ssh_() { ssh -p "$SSH_PORT" -o ServerAliveInterval=30 "$VPS" "$@"; }
scp_() { scp -P "$SSH_PORT" "$@"; }

platform() {
	case "$(ssh_ uname -m | tr -d '\r')" in
		aarch64|arm64) echo linux/arm64 ;;
		*) echo linux/amd64 ;;
	esac
}
new_tag() { echo "$(date +%Y%m%d-%H%M)-$(cd "$1" && git rev-parse --short HEAD 2>/dev/null || echo nogit)"; }

## Chỉ đẩy thư mục deploy/ (stack.yml, Caddyfile, script) — code đã nằm trong image.
push_deploy_files() {
	ssh_ "mkdir -p '$R/deploy'"
	(cd "$repo" && tar -czf - --exclude='./deploy/deploy.env' ./deploy) | ssh_ "tar -xzf - -C '$R'"
}

swarm_up() {
	push_deploy_files
	ssh_ "cd '$R' && bash deploy/swarm_up.sh '$HUB' $*"
	echo "== Kiểm tra https://$DOMAIN/healthz"
	curl -fsS -m 15 "https://$DOMAIN/healthz" && echo " <- ok" \
		|| echo "!! Chưa gọi được https://$DOMAIN — DNS đã trỏ về VPS chưa? Caddy cần vài chục giây lấy chứng chỉ lần đầu."
}

## Image nên để PRIVATE trên Docker Hub (image game chứa toàn bộ code server).
build_push() { # <tên image> <context> [dockerfile]
	local name="$1" ctx="$2" df="${3:-$2/Dockerfile}" tag="$4"
	docker buildx version >/dev/null 2>&1 || die "cần Docker Desktop (buildx)"
	echo "== Build $(platform) -> $HUB/$name:$tag"
	docker buildx build --platform "$(platform)" -f "$df" -t "$HUB/$name:$tag" -t "$HUB/$name:latest" --push "$ctx" \
		|| die "build/đẩy $name lỗi — đã 'docker login' chưa? Repo $HUB/$name đã tạo chưa?"
}

deploy_account() {
	local tag
	tag="$(new_tag "$repo")"
	build_push kiemhiep-account "$repo" "$repo/account/Dockerfile" "$tag"
	swarm_up "account=$tag"
	echo "account:$tag  (quay lại: deploy.sh redeploy account=<TAG cũ>)"
}

deploy_game() {
	[ -f "$GAME_REPO/project.godot" ] || die "không thấy repo game ở $GAME_REPO (GAME_REPO trong deploy.env)"
	local tag
	tag="$(new_tag "$GAME_REPO")"
	bash "$GAME_REPO/server/dev.sh" pck   # xuất server/game/game_server.pck bằng Godot (GODOT_PATH)
	build_push kiemhiep-game "$GAME_REPO/server/game" "$GAME_REPO/server/game/Dockerfile" "$tag"
	swarm_up "game=$tag"
	echo "game:$tag  (quay lại: deploy.sh redeploy game=<TAG cũ>)"
}

## Game và launcher phải gọi đúng https://DOMAIN — phát hành nhầm bản trỏ về 127.0.0.1 thì người chơi không vào được.
check_client_url() {
	local want="https://$DOMAIN" f got
	for f in "$GAME_REPO/project.godot" "$GAME_REPO/launcher/project.godot"; do
		got="$(grep -E '^network/account_url=' "$f" | cut -d'"' -f2 || true)"
		[ "$got" = "$want" ] || die "$f: account_url = '$got', cần '$want' (sửa [kiem_hiep] network/account_url)"
	done
}

push_client() {
	local dir="$GAME_REPO/server/client" f have keep
	[ -f "$dir/manifest.json" ] || die "chưa có $dir/manifest.json — repo game: python tools/build_client_update.py"
	check_client_url
	echo "== Đẩy bản game cho launcher"
	ssh_ "mkdir -p '$R/client/files'"
	have="$(ssh_ "ls '$R/client/files' 2>/dev/null" || true)"
	for f in "$dir"/files/*.pck; do
		[ -e "$f" ] || continue
		if ! grep -qxF "$(basename "$f")" <<<"$have"; then
			echo "   tải $(basename "$f") ($(du -h "$f" | cut -f1))..."
			scp_ "$f" "$VPS:$R/client/files/$(basename "$f").tmp"
			ssh_ "mv '$R/client/files/$(basename "$f").tmp' '$R/client/files/$(basename "$f")'"
		fi
	done
	# Manifest đi SAU CÙNG: người chơi chỉ thấy bản mới khi mọi gói đã nằm trên server.
	scp_ "$dir/manifest.json" "$VPS:$R/client/manifest.json.tmp"
	ssh_ "mv '$R/client/manifest.json.tmp' '$R/client/manifest.json'"
	keep="$(cd "$dir/files" && ls *.pck 2>/dev/null | tr '\n' ' ')"
	ssh_ "cd '$R/client/files' && for f in *.pck; do case \" $keep \" in *\" \$f \"*) ;; *) rm -f \"\$f\";; esac; done; rm -f *.tmp"
	echo "   đã lên — người chơi nhận ở lần mở app tiếp theo"
}

cmd="${1:-}"
case "$cmd" in
	setup)
		ssh_ "mkdir -p '$R/deploy'"
		scp_ "$here/setup_vps.sh" "$here/backup_db.sh" "$VPS:$R/deploy/"
		ssh_ "bash '$R/deploy/setup_vps.sh' '$R'"
		echo "Image private: đăng nhập Docker Hub trên VPS manager 1 lần:  ssh $VPS docker login -u $HUB"
		;;
	env) push_deploy_files; ssh_ "cd '$R' && bash deploy/init_swarm.sh '$DOMAIN' '$GAME_HOST'" ;;
	account) deploy_account ;;
	game) deploy_game ;;
	redeploy) shift; [ $# -ge 1 ] || die "cần account=<TAG> và/hoặc game=<TAG>"; swarm_up "$@" ;;
	client) push_client ;;
	status) ssh_ "docker stack services kiemhiep; docker stack ps kiemhiep --filter desired-state=running --format 'table {{.Name}}\t{{.Node}}\t{{.CurrentState}}\t{{.Error}}'" ;;
	logs) ssh_ "docker service logs --tail 200 -f kiemhiep_${2:-account}" ;;
	*) sed -n '2,15p' "$0"; exit 1 ;;
esac
