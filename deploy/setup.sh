#!/usr/bin/env bash
# One-time server setup for Ubuntu 24.04. Safe to re-run.
# Runs on the server as root; see deploy/README.md for how to invoke it.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
	echo "setup.sh must run as root" >&2
	exit 1
fi

DEPLOY_USER=deploy
WEB_ROOT=/var/www/site

echo "==> Swap"
if [[ ! -f /swapfile ]]; then
	fallocate -l 1G /swapfile
	chmod 600 /swapfile
	mkswap /swapfile
fi
swapon --show=NAME --noheadings | grep -qx /swapfile || swapon /swapfile
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

echo "==> Caddy"
if ! command -v caddy > /dev/null; then
	apt-get update
	apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
	chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
	apt-get update
	apt-get install -y caddy
fi

echo "==> Deploy user"
id "$DEPLOY_USER" > /dev/null 2>&1 || useradd --create-home --shell /bin/bash "$DEPLOY_USER"

# The deploy user accepts the same SSH keys as the account that ran this script.
key_source_home=$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)
deploy_home=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$deploy_home/.ssh"
install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$key_source_home/.ssh/authorized_keys" "$deploy_home/.ssh/authorized_keys"

echo "==> Web root and Caddy config ownership"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$WEB_ROOT"
chown "$DEPLOY_USER:$DEPLOY_USER" /etc/caddy /etc/caddy/Caddyfile

echo "==> Allow the deploy user to reload Caddy"
sudoers_file=/etc/sudoers.d/deploy-caddy
echo "$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl reload caddy" > "$sudoers_file.tmp"
chmod 440 "$sudoers_file.tmp"
visudo -cf "$sudoers_file.tmp" > /dev/null
mv "$sudoers_file.tmp" "$sudoers_file"

echo "==> Done"
