# VPS deployment

Status: **verified** — P0 memory service operational on Bun 1.3+ with SQLite (WAL mode).

## Quick start

Prerequisites: Bun 1.3+, git, pnpm.

```bash
git clone https://github.com/anthropic-labs/titen.git
cd titen
pnpm install

# Bootstrap org — prints org_id and api_key
pnpm titen bootstrap --org 'My Org'

# Start the memory service (defaults to 127.0.0.1:8787)
pnpm titen serve

# Verify
curl http://127.0.0.1:8787/healthz

# Create an agent key
pnpm titen key create --org-id <org_id> --label 'my agent'
```

## Verified P0 behavior

- All P0 endpoints operational: `healthz`, `readyz`, `observations`,
  `consolidations`, `context/compile`, `feedback`, `claims/:id/evidence`,
  `keys`, `export`, `import`.
- 32 contract tests pass.
- Data survives restart without rebuild.
- FTS5 lexical retrieval works without a model.
- Loop latency p50: 12 ms.
- Peak RSS: ~152 MiB.
- Storage: ~45 KiB per loop iteration.

## Components

- One Bun process using `Bun.serve`.
- One SQLite database using `bun:sqlite`.
- FTS5 in the canonical database.
- Optional `sqlite-vec` extension (planned).
- Optional OpenAI-compatible embedding/extraction endpoint.
- systemd timer or in-process bounded timer for repair/consolidation.
- REST under `/v1`; Streamable HTTP MCP at `/mcp` (planned).
- An external CRM/chatbot gateway may call protected channel-context operations;
  the Titen process itself does not expose anonymous memory search.
- Optional Memory Atlas static client behind the same reverse proxy or a
  separate static host; calls authenticated REST only (planned).

Docker is not required.

## Defaults

- Bind: `127.0.0.1`.
- Database: `/var/lib/titen/titen.db`.
- WAL mode, foreign keys enabled, bounded busy timeout.
- Service user: non-root `titen`.
- Configuration/credential files: mode `0600`.
- TLS/public ingress: Caddy, Nginx, Cloudflare Tunnel, or private network.

## Configuration

```text
TITEN_HOST=127.0.0.1
TITEN_PORT=8787
TITEN_DB_PATH=/var/lib/titen/titen.db
TITEN_EMBED_BASE_URL=http://127.0.0.1:11434/v1
TITEN_EMBED_MODEL=bge-m3
TITEN_EMBED_DIMS=1024
```

Model variables are optional. Observations and lexical context work without them.

Local agents connect to `http://127.0.0.1:8787`. Remote agents use a TLS
reverse proxy or private network with distinct revocable credentials.

For customer-facing use, route public traffic to the CRM/chatbot application,
not directly to Titen. The application holds a gateway credential pinned to its
channel/audience and derives an authenticated customer subject server-side.
Reverse-proxy rules must not expose arbitrary `/v1` or `/mcp` paths through that
public route.

`sqlite-vec` stores and searches vectors; it does not generate them. Pin and
probe the version because its public API remains pre-v1.

## Service hardening

The production unit should use:

- Dedicated non-root user.
- `StateDirectory=titen`.
- `UMask=0077`.
- `NoNewPrivileges=true`.
- `PrivateTmp=true`.
- `ProtectSystem=strict`.
- Write access only to the Titen state directory.
- Restart on failure with bounded backoff.
- Graceful HTTP and SQLite shutdown.
- Bounded shutdown flush for canonical/outbox state; remote model/vector or
  webhook completion is not required before process exit.

## Backup and restore

- Use SQLite backup API or `VACUUM INTO`; do not copy a live database file.
- Write timestamped backups with mode `0600` and checksum.
- Restore into a new file, run SQLite integrity checks, then point the service
  at the verified file.
- Vector indexes are rebuildable and do not block canonical restore.

## Planned

- `sqlite-vec` semantic vector retrieval.
- Streamable HTTP MCP at `/mcp`.
- Memory Atlas visual projection.
- Signed webhook delivery with retry/replay.
- Channel-release activation/revocation for CRM/public gateways.
- Postgres + `pgvector` scale adapter (when measured corpus size or concurrency
  justifies another database service).
