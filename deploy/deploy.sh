#!/usr/bin/env bash
# Builds the site and syncs it to the server. Reloads Caddy when deploy/Caddyfile has changed.
set -euo pipefail

usage() {
	cat <<EOF
Usage: deploy/deploy.sh [options] <host>

  <host>         Server IP address or SSH config alias

Options:
  -u, --user <user>   SSH user (default: deploy)
  -i, --key <key>     SSH private key file
  -p, --port <port>   SSH port
  -n, --dry-run       Build and list changes without uploading
  -h, --help          Show this help
EOF
}

require_value() {
	if [[ $# -lt 2 || -z $2 ]]; then
		echo "$1 requires a value" >&2
		exit 1
	fi
}

user=deploy
key=
port=
dry_run=false
host=

while [[ $# -gt 0 ]]; do
	case $1 in
		-u | --user) require_value "$@"; user=$2; shift 2 ;;
		-i | --key) require_value "$@"; key=$2; shift 2 ;;
		-p | --port) require_value "$@"; port=$2; shift 2 ;;
		-n | --dry-run) dry_run=true; shift ;;
		-h | --help) usage; exit 0 ;;
		-*) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
		*)
			if [[ -n $host ]]; then
				usage >&2
				exit 1
			fi
			host=$1
			shift
			;;
	esac
done

if [[ -z $host ]]; then
	usage >&2
	exit 1
fi

target="$user@$host"
ssh_cmd=(ssh)
[[ -n $key ]] && ssh_cmd+=(-i "$key")
[[ -n $port ]] && ssh_cmd+=(-p "$port")

repo=$(cd "$(dirname "$0")/.." && pwd)
web_root=/var/www/site
remote_caddyfile=/etc/caddy/Caddyfile

echo "==> Building site"
npm --prefix "$repo/site" run build

rsync_flags=(-azc --delete --itemize-changes)
$dry_run && rsync_flags+=(-n)

echo "==> Syncing site to $target:$web_root"
rsync "${rsync_flags[@]}" -e "${ssh_cmd[*]}" "$repo/site/dist/" "$target:$web_root/"

echo "==> Checking Caddyfile"
local_hash=$(shasum -a 256 "$repo/deploy/Caddyfile" | cut -d' ' -f1)
remote_hash=$("${ssh_cmd[@]}" "$target" "sha256sum $remote_caddyfile | cut -d' ' -f1")

if [[ $local_hash == "$remote_hash" ]]; then
	echo "Caddyfile unchanged"
elif $dry_run; then
	echo "Caddyfile differs from the server copy and would be uploaded"
else
	rsync -az -e "${ssh_cmd[*]}" "$repo/deploy/Caddyfile" "$target:$remote_caddyfile.new"
	"${ssh_cmd[@]}" "$target" "caddy validate --adapter caddyfile --config $remote_caddyfile.new \
		&& mv $remote_caddyfile.new $remote_caddyfile \
		&& sudo systemctl reload caddy"
	echo "Caddyfile updated and Caddy reloaded"
fi

echo "==> Done"
