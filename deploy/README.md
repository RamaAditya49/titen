# Production deployment

## Prerequisites

- Bun 1.3+
- SQLite 3.45+ (for FTS5)
- A reverse proxy (Caddy recommended for automatic TLS)
- A non-root user `titen`

## Install

```bash
# Create user and directories
sudo useradd -r -s /bin/false titen
sudo mkdir -p /opt/titen /var/lib/titen
sudo chown titen:titen /var/lib/titen
sudo chmod 700 /var/lib/titen

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

## Monitoring

```bash
/opt/titen/deploy/monitor.sh http://127.0.0.1:8787
```

Add to your monitoring system (Prometheus node_exporter script, Nagios check, etc.).

## Vector retrieval (optional)

Set environment variables in the systemd unit or an env file:

```
TITEN_EMBED_BASE_URL=http://127.0.0.1:11434/v1
TITEN_EMBED_MODEL=bge-m3
TITEN_EMBED_DIMS=1024
```

Requires an OpenAI-compatible embedding endpoint (e.g., Ollama, vLLM).
