# Production deployment

## Prerequisites

- Bun 1.3+
- SQLite 3.45+ (for FTS5)
- A reverse proxy (Caddy recommended for automatic TLS)
- A non-root user `titen`

Keep Titen on loopback. Reach it through an SSH tunnel, a private network, or a
TLS reverse proxy; opening a public firewall port is a separate operator choice.

## Install

```bash
# Create user and directories
sudo useradd -r -s /bin/false titen
sudo mkdir -p /opt/titen /var/lib/titen
sudo chown titen:titen /var/lib/titen
sudo chmod 700 /var/lib/titen
sudo install -d -m 700 /etc/titen
sudo install -m 600 /dev/null /etc/titen/titen.env

# Deploy code
sudo cp -r . /opt/titen/
cd /opt/titen && pnpm install --prod

# Bootstrap
sudo -u titen bun /opt/titen/src/runtime/bun/cli.ts bootstrap --db /var/lib/titen/titen.db --org 'My Org'
# SAVE THE PRINTED KEY

# Install services
sudo cp deploy/titen.service /etc/systemd/system/
sudo cp deploy/backup.service deploy/backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now titen
sudo systemctl enable --now backup.timer

# TLS (with Caddy)
sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile
# Edit: replace titen.example.com with your domain
# Set TITEN_MCP_ORIGIN=https://titen.example.com in /etc/titen/titen.env
sudo systemctl reload caddy
```

## Verify

```bash
curl http://127.0.0.1:8787/healthz
curl https://titen.yourdomain.com/healthz
```

## Backup

Automatic daily backup at 03:00 via systemd timer. Manual:

```bash
sudo -u titen /opt/titen/deploy/backup.sh
```

## Rootless Podman/Quadlet

```bash
mkdir -p ~/.config/containers/systemd ~/.config/titen ~/.local/share/titen
chmod 700 ~/.config/titen ~/.local/share/titen
install -m 600 /dev/null ~/.config/titen/titen.env
cp deploy/titen.container ~/.config/containers/systemd/
systemctl --user daemon-reload
systemctl --user enable --now titen.service
curl http://127.0.0.1:8787/readyz
```

The checked-in Quadlet publishes only `127.0.0.1:8787`. Use the native
`/healthz` and `/readyz` endpoints from your monitoring system; the old guessed
shell monitor has been removed.

For remote administration without changing the bind:

```bash
ssh -N -L 8787:127.0.0.1:8787 titen-host
```

## Signing secrets and webhooks

Store the external AES-256-GCM keyring in the mode-0600 environment file:

```text
TITEN_SECRET_KEYS={"active":"v1","keys":{"v1":"<32-byte-base64url-key>"}}
TITEN_WEBHOOK_ALLOWED_HOSTNAMES=hooks.example.com
TITEN_MCP_ORIGIN=https://titen.example.com
```

`TITEN_MCP_ORIGIN` is required only when TLS terminates at the reverse proxy.
Use the exact public origin without a trailing slash; Titen does not trust
`X-Forwarded-Proto` to choose it.

The Bun runtime pins outbound TLS to a public DNS answer and refuses redirects,
private/link-local addresses, non-HTTPS URLs, and hosts outside this allowlist.
Cloudflare webhook delivery stays disabled because generic Worker `fetch` cannot
prove address pinning; registration fails closed there.

## Vector retrieval (optional)

Set environment variables in the systemd unit or an env file:

```
TITEN_EMBED_BASE_URL=http://127.0.0.1:11434/v1
TITEN_EMBED_MODEL=bge-m3
TITEN_EMBED_DIMS=1024
```

Requires an OpenAI-compatible embedding endpoint (e.g., Ollama, vLLM).
