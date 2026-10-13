# deploy

Builds the site locally and syncs it to an Ubuntu 24.04 server running Caddy.

| File        | Purpose                                                       |
| ----------- | ------------------------------------------------------------- |
| `setup.sh`  | One-time server setup. Runs on the server as root.            |
| `deploy.sh` | Builds `site/` and syncs it to the server. Runs locally.      |
| `Caddyfile` | Caddy config. `deploy.sh` uploads it when it changes.         |

## Server layout

- `/var/www/site`: the built site, owned by the `deploy` user.
- `/etc/caddy/Caddyfile`: owned by `deploy`, so `deploy.sh` can replace it.
- `deploy` can run `sudo systemctl reload caddy` without a password, and no other sudo commands.
- `/swapfile`: 1GB swap.

## First-time setup

Run `setup.sh` on the server as root, from the repo root:

```bash
ssh root@<host> 'bash -s' < deploy/setup.sh
```

With a specific key or port:

```bash
ssh -i <key> -p <port> root@<host> 'bash -s' < deploy/setup.sh
```

`<host>` is the server's IP address or an alias from `~/.ssh/config`.

The script installs Caddy from the official Caddy apt repository, creates the swap file, creates the `deploy` user, and copies root's `~/.ssh/authorized_keys` to it, so the key you use for root also works for `deploy`. It skips anything already in place, so it is safe to run again.

## Deploying

From the repo root:

```bash
deploy/deploy.sh <host>
```

| Option                | Meaning                                         |
| --------------------- | ----------------------------------------------- |
| `-u`, `--user <user>` | SSH user. Default: `deploy`                     |
| `-i`, `--key <key>`   | SSH private key file                            |
| `-p`, `--port <port>` | SSH port                                        |
| `-n`, `--dry-run`     | Dry run: build and list changes, upload nothing |
| `-h`, `--help`        | Help                                            |

Examples:

```bash
deploy/deploy.sh 203.0.113.10
deploy/deploy.sh --key ~/.ssh/server_ed25519 203.0.113.10
deploy/deploy.sh --dry-run my-server
```

The key path must not contain spaces.

Each run:

1. Builds the site with `npm run build` in `site/`. Dependencies must already be installed (`npm install` in `site/`).
2. Syncs `site/dist/` to `/var/www/site` with rsync. The server ends up as an exact copy of the build: files removed locally are deleted on the server. Files are compared by checksum, so only changed files are uploaded.
3. Compares `deploy/Caddyfile` with the server's copy. If they differ, uploads it, validates it with `caddy validate`, and reloads Caddy. An invalid Caddyfile is left as `/etc/caddy/Caddyfile.new` and the running config is untouched.

A dry run (`--dry-run`) prints the files rsync would add, change or delete, and whether the Caddyfile would be updated. Lines starting with `*deleting` are files that would be removed from the server.

## Caddy config

The site is served over HTTP on port 80 for any hostname. Responses are compressed with zstd or gzip. Files under `/_astro/` have content hashes in their names and are cached by browsers for a year; everything else is revalidated on each request.

### Switching to a domain

Point the domain's DNS A record at the server, then replace `:80` on the first line of `Caddyfile` with the domain:

```
example.com {
```

Deploy as usual. Caddy obtains and renews an HTTPS certificate for the domain and redirects HTTP to HTTPS. Ports 80 and 443 must be reachable from the internet for the certificate to be issued.
