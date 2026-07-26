# VPS deployment

Status: target design; P0 must verify Bun/SQLite/sqlite-vec behavior on the
actual supported platforms.

## Components

- one Bun process using `Bun.serve`;
- one SQLite database using `bun:sqlite`;
- FTS5 in the canonical database;
- optional `sqlite-vec` extension;
- optional OpenAI-compatible embedding/extraction endpoint;
- systemd timer or in-process bounded timer for repair/consolidation.

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
- graceful HTTP and SQLite shutdown.

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
- backup, restore to a new file, integrity check, and smoke;
- idle RSS and p95 query latency recorded separately from model runtime usage.
