# VPS deployment

Status: target design; P0 must verify Bun/SQLite/sqlite-vec behavior on the
actual supported platforms.

## Components

- one Bun process using `Bun.serve`;
- one SQLite database using `bun:sqlite`;
- FTS5 in the canonical database;
- optional `sqlite-vec` extension;
- optional OpenAI-compatible embedding/extraction endpoint;
- systemd timer or in-process bounded timer for repair/consolidation;
- the same process exposes REST under `/v1` and planned Streamable HTTP MCP at
  `/mcp`.
- an external CRM/chatbot gateway may call protected channel-context operations;
  the Titen process itself does not expose anonymous memory search.
- an optional Memory Atlas static client may be served behind the same reverse
  proxy or from a separate static host; it calls authenticated REST only.

Docker is not required for the base install.

## Defaults

- bind: `127.0.0.1`;
- database: `/var/lib/titen/titen.db`;
- WAL mode, foreign keys enabled, bounded busy timeout;
- service user: non-root `titen`;
- configuration/credential files: mode `0600`;
- TLS/public ingress: Caddy, Nginx, Cloudflare Tunnel, or private network.

## Planned configuration

```text
TITEN_HOST=127.0.0.1
TITEN_PORT=8787
TITEN_DB_PATH=/var/lib/titen/titen.db
TITEN_EMBED_BASE_URL=http://127.0.0.1:11434/v1
TITEN_EMBED_MODEL=bge-m3
TITEN_EMBED_DIMS=1024
```

Model variables are optional. Direct observations and lexical context must work
when they are absent.

Local agents connect to `http://127.0.0.1:8787`; a configured name such as
`http://titen.localhost:8787` is optional. Do not use `titen.127.0.0.1` as a
hostname. Remote agents use a TLS reverse proxy or private network and receive
distinct revocable credentials.

For customer-facing use, route public traffic to the CRM/chatbot application,
not directly to Titen. The application holds a gateway credential pinned to its
channel/audience and derives an authenticated customer subject server-side.
Reverse-proxy rules must not expose arbitrary `/v1` or `/mcp` paths through that
public route.

Memory Atlas may expose its authenticated
`POST /v1/memory-views/compile` route through the operator/private ingress. Its
static client receives no database-file or filesystem access, and a restrictive
CSP should limit asset/API origins. Omitting or disabling Atlas leaves the
headless REST/MCP service and readiness contract unchanged.

`sqlite-vec` stores and searches vectors; it does not generate them. The base
VPS obtains embeddings from the configured compatible endpoint and uses the
same fingerprint for indexed claim versions and queries. Pin and probe the
`sqlite-vec` version because its public API remains pre-v1.

Postgres plus `pgvector` is not part of the lightweight base install. It may be
added as a later scale adapter when measured corpus size, concurrency, or an
existing enterprise Postgres topology justifies another database service.

## Service hardening

The production unit should use:

- dedicated non-root user;
- `StateDirectory=titen`;
- `UMask=0077`;
- `NoNewPrivileges=true`;
- `PrivateTmp=true`;
- `ProtectSystem=strict`;
- write access only to the Titen state directory;
- restart on failure with bounded backoff;
- graceful HTTP and SQLite shutdown;
- bounded shutdown flush for canonical/outbox state; remote model/vector or
  webhook completion is not required before process exit.

Exact unit contents are added after the executable path and shutdown behavior
exist.

## Backup and restore

- Use SQLite backup API or `VACUUM INTO`; do not copy a live database file as the
  official backup process.
- Write timestamped backups with mode `0600` and checksum.
- Restore into a new file, run SQLite integrity checks, then point the service at
  the verified file.
- Vector indexes are rebuildable and do not block canonical restore.

## Verification gate

- fresh migration and bootstrap as non-root;
- observation/context flow before and after restart;
- FTS-only degraded behavior without model/vector;
- exact `sqlite-vec` version and dimension probe when enabled;
- release FTS and customer-assertion verifier readiness when channel serving is
  enabled;
- backup, restore to a new file, integrity check, and smoke;
- idle RSS and p95 query latency recorded separately from model runtime usage;
- `/mcp` tool discovery and REST/MCP parity when enabled;
- signed webhook retry/replay and destination-policy checks when enabled.
- channel release activation/revocation, verified-but-unreleased exclusion,
  anonymous subject denial, customer-assertion expiry/replay, and cross-customer
  isolation when v0.3 is enabled;
- gateway, publisher, and approver use separate mode-`0600` credentials.
- when Atlas is enabled, each lens passes authorized/private/foreign focus,
  stale-candidate, limit, and Cloudflare-parity probes; renderer failure leaves
  the headless smoke green.
