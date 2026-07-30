# VPS deployment

Status: **verified** — P0 memory service operational on Bun 1.3+ with SQLite (WAL mode).

## Quick start

Prerequisites: Bun 1.3+.

```bash
# Bootstrap org — prints org_id and api_key
bunx titen-memory bootstrap --org 'My Org'

# Start the memory service (defaults to 127.0.0.1:8787)
bunx titen-memory serve

# Verify
curl http://127.0.0.1:8787/healthz
```

The `titen` CLI runs on Bun: it uses `bun:sqlite`. `npx titen-memory` fails
unless Bun is on `PATH`, because the published `bin` carries a
`#!/usr/bin/env bun` shebang. The SDK (`import { TitenClient } from
"titen-memory"`) is plain `fetch` and runs on Node 22+, Bun, Deno, and workers
alike.

## Quick start from a clone

Prerequisites: Bun 1.3+, git, pnpm.

```bash
git clone https://github.com/RamaAditya49/titen.git
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

## Container install (verified)

Optional. The service runs fine directly under Bun; this exists so a deployment
can be reproduced without provisioning a host. Built and run with podman on
Fedora 44; nothing in the `Dockerfile` is docker-specific.

```bash
podman build -t titen:latest .            # or: docker build
podman volume create titen-data

# Bootstrap once. Save the printed api_key; it cannot be shown again.
podman run --rm -v titen-data:/var/lib/titen titen:latest \
  bootstrap --db /var/lib/titen/titen.db --org 'My Org'

# Serve. The embedding variables are optional; without them retrieval is
# lexical-only and readiness reports the vector capability as disabled.
podman run -d --name titen --network host -v titen-data:/var/lib/titen \
  -e TITEN_EMBED_BASE_URL=http://127.0.0.1:11434/v1 \
  -e TITEN_EMBED_MODEL=embeddinggemma \
  -e TITEN_EMBED_DIMS=768 \
  -e TITEN_VEC_DB_PATH=/var/lib/titen/vectors.db \
  titen:latest serve --db /var/lib/titen/titen.db --host 127.0.0.1 --port 8787

curl http://127.0.0.1:8787/readyz
```

Two things that will bite otherwise:

- **The base image must use glibc.** `sqlite-vec` ships a glibc-linked prebuilt
  binary; on Alpine it fails to load with `__memcpy_chk: symbol not found`. An
  Alpine image still starts and serves, it just loses vector retrieval silently.
  That is why the image is Debian-based and 623 MB rather than ~100 MB.
- **Podman builds OCI images, which ignore `HEALTHCHECK`.** Use
  `podman build --format docker` if you want it honoured, or rely on an external
  probe against `/healthz`.

### Indexing runs itself

Embedding calls a model over the network, so it cannot happen inside a canonical
write. The service therefore runs a bounded maintenance pass on an interval that
drains the indexing outbox and delivers webhooks. Nothing needs scheduling for
vector retrieval to work.

```
TITEN_MAINTENANCE_INTERVAL_MS=15000   # default; 0 disables the timer
```

Set it to `0` only when an external scheduler owns the work, and then drive it
yourself:

```bash
curl -sX POST http://127.0.0.1:8787/v1/index/drain?limit=50 \
  -H "authorization: Bearer $TITEN_KEY"
curl -sX POST http://127.0.0.1:8787/v1/webhooks/deliver \
  -H "authorization: Bearer $TITEN_KEY"
```

On Cloudflare there is no in-process timer, so the Worker exposes a `scheduled`
handler instead. Add a Cron Trigger to `wrangler.jsonc`:

```jsonc
"triggers": { "crons": ["*/1 * * * *"] }
```

### Verified behavior

A containerized run against `embeddinggemma` (768 dimensions) served through
Ollama retrieved a claim that shared no keywords with the query, ranked it above
a lexically similar decoy in the same order as the model's own cosine similarity,
and preserved all memory across a container restart. Measured: index drain
134.9 ms, context compile p50 104.8 ms, embedding 106.4 ms. Graceful shutdown
completes in about 130 ms.

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
