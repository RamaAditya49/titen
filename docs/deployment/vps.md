# VPS deployment

Status: **verified** — P0 memory service operational on Bun 1.3+ with SQLite (WAL mode).

## Quick start

Prerequisites: Bun 1.3+.

```bash
# Bootstrap org — prints org_id, api_key, owner username, and temporary password
bunx titen-memory bootstrap --org 'My Org'

# Start the memory service (defaults to 127.0.0.1:8787)
bunx titen-memory serve

# Verify
curl http://127.0.0.1:8787/healthz
```

The published `titen` executable runs directly on Bun because it uses
`bun:sqlite`; npm and pnpm installation paths still require Bun on `PATH`. The
SDK (`import { TitenClient } from "titen-memory"`) is plain `fetch` and runs on
Node 22+, Bun, Deno, and workers alike.

## Quick start from a clone

Prerequisites: Bun 1.3+, git, pnpm.

```bash
git clone https://github.com/RamaAditya49/titen.git
cd titen
pnpm install

# Bootstrap org — prints org_id, api_key, owner username, and temporary password
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
- The shared contract suite passes independently on Bun/SQLite and
  workerd/D1.
- Data survives restart without rebuild.
- FTS5 lexical retrieval works without a model.
- Loop latency p50: 12 ms.
- Peak RSS: ~152 MiB.
- Storage: ~45 KiB per loop iteration.

## Components

- One Bun process using `Bun.serve`.
- One SQLite database using `bun:sqlite`.
- FTS5 in the canonical database.
- Optional `sqlite-vec` extension for semantic retrieval.
- Optional OpenAI-compatible embedding endpoint (implemented).
- Optional OpenAI-compatible extraction/reflection with durable enrichment
  jobs, bounded leases, and the same shared validator used by D1 (implemented,
  disabled by default, not production-activated).
- In-process startup/timer drain for current index and delivery repair.
- REST under `/v1`; Streamable HTTP MCP at `/mcp`.
- An external CRM/chatbot gateway may call protected channel-context operations;
  the Titen process itself does not expose anonymous memory search.
- Optional Memory Atlas static client behind the same reverse proxy or a
  separate static host; calls authenticated REST only (planned).

Docker is not required.

## Defaults

- CLI defaults: database `./titen.db`, bind `127.0.0.1:8787`, and revision
  `dev`.
- The checked-in systemd, container, and Quadlet profiles pass an explicit
  `--db /var/lib/titen/titen.db`; their bind address and port are also explicit
  CLI flags.
- WAL mode, foreign keys enabled, bounded busy timeout, and an explicit
  1,000-page auto-checkpoint. [`PRAGMA synchronous = FULL`](https://www.sqlite.org/pragma.html#pragma_synchronous)
  is explicit: an acknowledged write uses SQLite's FULL WAL durability mode
  rather than a deployment-dependent default. With 4 KiB pages, the tested steady-state WAL
  stays below 5 MiB; the audited live WAL was about 4.0 MiB.
- Service user: non-root `titen`.
- Canonical, WAL, shared-memory, and optional vector database files are created
  and reopened as owner-only (`0600`), independent of the service umask.
- Configuration/credential files: mode `0600`.
- TLS/public ingress: Caddy, Nginx, Cloudflare Tunnel, or private network. Keep
  the listeners private by following the [secure ingress guide](./secure-ingress.md).

## Configuration

Process location and identity are CLI flags, not environment variables:

```bash
bunx titen-memory serve \
  --db /var/lib/titen/titen.db \
  --host 127.0.0.1 \
  --port 8787 \
  --revision <deployed-revision> \
  --quiet
```

The current `serve` command accepts exactly `--db`, `--host`, `--port`,
`--revision`, and `--quiet`. `--quiet` suppresses startup, request, and
maintenance lines; use it when the service manager or ingress already owns
operational logs. Startup failures still print one actionable error. Its
supported environment configuration is:

```text
TITEN_MCP_ORIGIN=https://titen.example.com
TITEN_VEC_DB_PATH=/var/lib/titen/titen.db.vec
TITEN_EMBED_BASE_URL=http://127.0.0.1:11434/v1
TITEN_EMBED_MODEL=bge-m3
TITEN_EMBED_DIMS=1024
TITEN_EMBED_REVISION=<immutable-provider-revision>
TITEN_EMBED_PROFILE=raw-unit-v1
TITEN_EMBED_MIN_COSINE=<calibrated-cosine-floor>
TITEN_EXTRACT_BASE_URL=http://127.0.0.1:11434/v1
TITEN_EXTRACT_MODEL=<model-id>
TITEN_EXTRACT_MODEL_FINGERPRINT=<64-lowercase-hex-revision>
TITEN_EXTRACT_API_KEY=<optional-bearer-key>
TITEN_EXTRACT_TIMEOUT_MS=30000
TITEN_EXTRACT_RESPONSE_MODE=json_schema
TITEN_MAINTENANCE_INTERVAL_MS=15000
TITEN_SECRET_KEYS={"active":"v1","keys":{"v1":"<32-byte-base64url-key>"}}
TITEN_WEBHOOK_ALLOWED_HOSTNAMES=hooks.example.com
```

Embedding variables are optional. Observations and lexical context work without
them. Put `TITEN_EMBED_API_KEY` only in the mode-`0600` service environment; it
is required only when the configured embedder requires bearer authentication.
Base URL, model, dimensions, immutable revision, named profile, and calibrated
cosine floor form one opt-in contract. Supplying only part of that contract, or
supplying an API key without it, returns `configured_error` and makes `/readyz`
fail. A provider without an immutable revision remains FTS-only; Titen does not
pretend an `unspecified` model is safe to calibrate.

`raw-unit-v1` sends raw query/document text and fits models that explicitly use
that contract. `embeddinggemma-retrieval-v1` applies EmbeddingGemma's asymmetric
query/document prompts. Titen unit-normalizes both profiles. Select
`TITEN_EMBED_MIN_COSINE` from a locked exact-model evaluation; no universal or
pre-inspected threshold is bundled.

Extraction uses the separate `TITEN_EXTRACT_BASE_URL`, `TITEN_EXTRACT_MODEL`,
and immutable 64-hex `TITEN_EXTRACT_MODEL_FINGERPRINT` tuple. The API key and
timeout are optional. Strict `json_schema` output is the default. Set
`TITEN_EXTRACT_RESPONSE_MODE=json_object` only for a provider that cannot enforce
strict schemas; Titen then sends the exact schema with the bounded input and
still applies the same local validator. A partial or invalid tuple or response
mode reports `configured_error`; an absent tuple remains `disabled`. A positive maintenance interval drains one
shared bounded queue in the background, while `POST /v1/enrichment/drain`
provides an authorized manual path. The Bun server's 60-second idle bound stays
above the supported 45-second extraction timeout, leaving bounded response
headroom. Do not expose credentials through readiness.

Set `TITEN_MCP_ORIGIN` only when a TLS reverse proxy exposes `/mcp`. Its value
is the exact external origin (scheme, host, and optional port), with no trailing
slash. Titen deliberately ignores forwarded-protocol headers, so an untrusted
client cannot choose the accepted origin. Leave it unset for direct loopback or
private-network access; the request URL origin remains the default.

Local agents connect to `http://127.0.0.1:8787`. Remote agents use a TLS
reverse proxy or private network with distinct revocable credentials.

### Local-computer profile

A local computer is the same Bun/SQLite runtime, not a third implementation.
Keep Titen on loopback and point optional embedding/model URLs at a local engine
or an explicitly configured remote provider. For a rootless container, the
container's `127.0.0.1` is not the host: use host networking where supported,
`host.containers.internal`, or an explicit shared network. Keep all credentials
outside the image and source tree.

For customer-facing use, route public traffic to the CRM/chatbot application,
not directly to Titen. The application holds a gateway credential pinned to its
channel/audience and derives an authenticated customer subject server-side.
Reverse-proxy rules must not expose arbitrary `/v1` or `/mcp` paths through that
public route.

`sqlite-vec` stores and searches vectors; it does not generate them. Pin and
probe the version because its public API remains pre-v1. It is deliberately not
installed for SDK-only consumers; add it beside Titen only on a vector-enabled
VPS:

```bash
bun add titen-memory sqlite-vec@0.1.9
```

With no embedding tuple and no `sqlite-vec`, an SDK/default install remains a
ready FTS-only deployment. Once the tuple is present, `sqlite-vec@0.1.9`, a
writable vector database, and the expected `vec_claims` schema are required;
failure is `503 NOT_READY`, never a silent fallback.

### Explicit semantic reindex

Migration 13 binds the claim-vector projection to provider, model, immutable
revision, dimensions, cosine metric, the named role/normalization profile plus
its calibrated floor, and index schema `claims-scope-v1`. A missing legacy
fingerprint or any change fails readiness. Titen never rewrites this metadata or
deletes vectors automatically.

Migration 14 records only safe embedder/vector-store failure timestamps in
semantic metadata. That local evidence fails `/readyz` without probing either
dependency until a later complete embed/upsert proves recovery. After repairing
an outage, drain eligible upsert work, require `/readyz`, then perform a semantic
query smoke.

Migration 16 adds nullable ownership and expiry fields to the rebuildable index
outbox. Manual and background drains use the SQLite clock for conditional
claims, and every external upsert or removal keeps canonical reconciliation
until ownership-confirmed completion. The migration never infers recovery or
clears an existing dependency-failure marker.

To adopt a new fingerprint, stop Titen, take a verified canonical backup, then
reset only the rebuildable projection and requeue claim index work:

```bash
rm /var/lib/titen/titen.db.vec
sqlite3 /var/lib/titen/titen.db <<'SQL'
BEGIN IMMEDIATE;
DELETE FROM semantic_index_metadata WHERE id = 'claims';
UPDATE index_outbox
   SET state = 'pending', attempts = 0,
       lease_token = NULL, lease_expires_at = NULL
 WHERE record_type = 'claim';
INSERT INTO index_outbox
  (id, org_id, record_type, record_id, operation, state, attempts, created_at)
SELECT 'obx_' || lower(hex(randomblob(16))), c.org_id, 'claim', c.id,
       'upsert', 'pending', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM claims c
 WHERE c.status IN ('active', 'disputed')
   AND NOT EXISTS (
     SELECT 1 FROM index_outbox o
      WHERE o.record_type = 'claim' AND o.record_id = c.id
        AND o.operation = 'upsert'
   );
COMMIT;
SQL
```

Replace the vector path with the exact configured `TITEN_VEC_DB_PATH`; never
remove the canonical database. Start Titen with the intended tuple, require
`/readyz`, then let maintenance drain or call `POST /v1/index/drain`. Provider
reachability is proved by that real drain/query evidence, not by readiness.

## Container install (verified)

Optional. The service runs fine directly under Bun; this exists so a deployment
can be reproduced without provisioning a host. Built and run with podman on
Fedora 44; nothing in the `Dockerfile` is docker-specific.

```bash
podman build -t titen:latest .            # or: docker build
podman volume create titen-data

# Bootstrap once. Save the API key and dashboard temporary password; neither can
# be shown again. The dashboard requires the password to be changed at first login.
podman run --rm -v titen-data:/var/lib/titen titen:latest \
  bootstrap --db /var/lib/titen/titen.db --org 'My Org'

# Serve. The embedding variables are optional; without them retrieval is
# lexical-only and readiness reports the vector capability as disabled.
podman run -d --name titen --network host -v titen-data:/var/lib/titen \
  -e TITEN_EMBED_BASE_URL=http://127.0.0.1:11434/v1 \
  -e TITEN_EMBED_MODEL=embeddinggemma \
  -e TITEN_EMBED_DIMS=768 \
  -e TITEN_EMBED_REVISION=<immutable-provider-revision> \
  -e TITEN_EMBED_PROFILE=embeddinggemma-retrieval-v1 \
  -e TITEN_EMBED_MIN_COSINE="$CALIBRATED_COSINE_FLOOR" \
  -e TITEN_VEC_DB_PATH=/var/lib/titen/vectors.db \
  titen:latest serve --db /var/lib/titen/titen.db --host 127.0.0.1 --port 8787

curl http://127.0.0.1:8787/readyz
```

Two things that will bite otherwise:

- **The base image must use glibc.** `sqlite-vec` ships a glibc-linked prebuilt
  binary; on Alpine it fails to load with `__memcpy_chk: symbol not found`. An
  Alpine image may still answer `/healthz`, but a configured semantic deployment
  now fails `/readyz` with `vector_initialization_failed`. The current audited
  Debian image is about 239 MB. Treat this as measured evidence, not a fixed
  resource limit.
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
curl -sX POST http://127.0.0.1:8787/v1/enrichment/drain?limit=1 \
  -H "authorization: Bearer $TITEN_KEY"
curl -sX POST http://127.0.0.1:8787/v1/webhooks/deliver \
  -H "authorization: Bearer $TITEN_KEY"
```

The key used for the enrichment command requires `enrichment:write`. Keep the
extraction tuple absent when automatic enrichment is not intended.

On Cloudflare there is no in-process timer, so the Worker exposes a `scheduled`
handler instead. Add a Cron Trigger to `wrangler.jsonc`:

```jsonc
"triggers": { "crons": ["*/1 * * * *"] }
```

### Verified behavior

A historical containerized run against `embeddinggemma` (768 dimensions) served through
Ollama retrieved a claim that shared no keywords with the query, ranked it above
a lexically similar decoy in the same order as the model's own cosine similarity,
and preserved all memory across a container restart. Measured: index drain
134.9 ms, context compile p50 104.8 ms, embedding 106.4 ms. Graceful shutdown
completes in about 130 ms. That pre-profile smoke is deployment evidence, not a
safe current threshold; a current semantic deployment must pass the explicit
profile/floor contract and its own hard-negative query smoke.

## Rootless Quadlet

The checked-in [`deploy/titen.container`](../../deploy/titen.container) is the
rootless Podman path. It mounts the canonical state directory, reads a mode-0600
environment file, drops capabilities, and publishes only to loopback.

```bash
mkdir -p ~/.config/containers/systemd ~/.config/titen ~/.local/share/titen
chmod 700 ~/.config/titen ~/.local/share/titen
install -m 600 /dev/null ~/.config/titen/titen.env
cp deploy/titen.container ~/.config/containers/systemd/
systemctl --user daemon-reload
systemctl --user enable --now titen.service
curl http://127.0.0.1:8787/readyz
```

Use `ssh -N -L 8787:127.0.0.1:8787 <host>` for private remote access. A public
firewall rule and reverse proxy are explicit operator decisions, not defaults.

## Signing-key migration and rotation

Webhook and federation HMAC secrets are AES-256-GCM ciphertext in canonical SQL;
the keyring remains external. Generate a 32-byte key, place the JSON keyring in
the service's mode-0600 environment file, then restart. Startup wraps legacy
plaintext rows in bounded batches while readiness keeps authenticated traffic
blocked until rewrapping completes. Startup fail-closes an active legacy row
whose recoverable secret is `NULL` by disabling the webhook or suspending the
federation peer. Migration suspends an unattributed legacy peer and replaces its
stored endpoint with a deterministic tombstone, so the operator can register an
owned replacement at the original endpoint while the legacy log and filters
remain preserved. Readiness can then recover; the legacy peer stays suspended
and fail-closed. A missing or wrong keyring for any non-`NULL`
persisted secret keeps readiness failed until the correct key is restored.

Canonical federation remains operator-driven transport. The source peer needs
an explicit `claim` filter and a principal with `federation:write export:read`;
request `include_memory: true`, then relay only the returned `events` in a new
body containing the destination peer ID. Sign that exact destination JSON body
with the shared HMAC secret before `POST /v1/federation/push`. The destination
principal needs `federation:write import:write`, plus `projects:create` only when
an imported project reference does not exist. Do not log the response bundle or
place the secret in a command argument. Event-only pulls remain the default and
need none of these canonical-import scopes.

The first successful canonical import trust-on-first-use binds its
`source_org_id` to the destination peer. Confirm the expected value through
`GET /v1/federation/peers` before relaying further bundles; a mismatch requires
a separately registered peer rather than rebinding the existing one. Remote
`policy_approved` memory is intentionally rejected and must be imported below
that trust, reviewed, and approved locally.

To rotate, add `v2` while retaining `v1`, make `v2` active, restart and verify
readiness, then remove `v1` and restart again. Never put either key in SQL,
exports, logs, or command history.

The Bun runtime enables webhooks only when
`TITEN_WEBHOOK_ALLOWED_HOSTNAMES` is configured. It re-resolves each attempt,
rejects private/link-local and special-use IPv4/IPv6, pins TLS to one approved
address, disables redirects, and bounds each attempt to 10 seconds. Cloudflare
webhook registration/delivery remains deliberately unavailable: Worker `fetch`
does not expose a verifiable address-pinning primitive.

## Optional live dashboard

Build the static Astro client and run its adapter beside the loopback API. The
recommended session mode lets each operator sign in with a username/password.
The adapter seals the resulting bounded Titen key with AES-GCM inside an opaque
HttpOnly cookie. The raw credential enters neither browser-visible JSON, assets,
URLs, nor Web Storage:

```bash
pnpm build
TITEN_DASHBOARD_LIVE=true \
TITEN_DASHBOARD_AUTH=session \
TITEN_API_URL=http://127.0.0.1:8787 \
TITEN_DASHBOARD_ORIGIN=https://host.example.ts.net \
pnpm dashboard:adapter
```

Single-process deployments may omit `TITEN_DASHBOARD_SESSION_KEY` to invalidate
all sessions on restart. For multiple replicas or restart-stable sessions,
inject the same base64url-encoded 32-byte key into every adapter from the host's
secret manager. Rotating it invalidates every existing cookie.

The adapter remains bound to `127.0.0.1:4322`. Follow the
[secure ingress guide](./secure-ingress.md) to publish only that listener with
Tailscale Serve or Cloudflare Tunnel protected by Access. The exact HTTPS
hostname must match `TITEN_DASHBOARD_ORIGIN`; port `8787` remains private. Stop
the adapter and remove the ingress mapping to roll back without touching
canonical data.

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
  webhook completion is not required before process exit. An interrupted
  in-process semantic pass releases only its owned rebuildable leases before
  SQLite closes, so the next process can reconcile immediately.

## Capacity, rate limiting, and telemetry

The Bun runtime intentionally serves one process with one synchronous SQLite
handle. Its useful throughput is therefore bounded by one event loop/core;
adding client concurrency does not add database workers. Keep this shape until
an equivalent-quality, durability-preserving workload misses the accepted
small-team latency or throughput objective. Measure that workload before adding
a worker pool, read replicas, or sharding.

Rate-limit at the authenticated ingress, not inside the Titen process. For
example, Nginx provides the native [`limit_req`
module](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html). Apply a
stricter burst budget to authenticated writes and return `429` (with a bounded
`Retry-After` policy) before requests reach Titen. Do not use or log raw
`Authorization` values as rate-limit keys, and do not grant authority from
`X-Forwarded-For` or other forwarded headers. The existing trusted ingress may
derive its own privacy-safe key; Titen still authenticates every request.

Use the supervisor and host tools as the current telemetry surface; Titen does
not need a logger framework or a `/metrics` endpoint for this deployment:

```bash
journalctl -u titen.service --since '15 minutes ago'
systemctl show titen.service -p NRestarts -p MemoryCurrent -p CPUUsageNSec
stat -c '%s' /var/lib/titen/titen.db
curl --fail --silent http://127.0.0.1:8787/readyz
```

Run `serve --quiet` when the reverse proxy and supervisor already capture
requests and failures. [`journalctl`](https://www.freedesktop.org/software/systemd/man/255/journalctl.html)
provides time, unit, priority, and follow filters without changing application
code.

## Backup and restore

- Create an online, verified snapshot with
  `bunx titen-memory backup --db /var/lib/titen/titen.db --out /var/backups/titen/pre-upgrade.db`.
  The source must already exist. Titen writes an adjacent temporary file,
  verifies integrity, foreign keys, non-empty schema, and the exact schema
  version, sets mode `0600`, then atomically replaces a fixed output path. A
  failure leaves an existing output untouched and prints no internal stack.
- When a second rootless Podman container mounts the live named volume for an
  online backup, use the shared SELinux suffix `:z` on both containers. Never
  attach the same live volume with a second private `:Z` label: that relabels it
  away from the running service. A host-installed CLI avoids this sidecar
  boundary entirely.
- Do not copy a live WAL database file. Keep timestamped snapshots and an
  independently verified checksum outside the service state directory.
- Vector indexes are rebuildable and do not block canonical restore. The
  canonical snapshot does not contain `TITEN_VEC_DB_PATH`; after restoring it
  without the matching vector file, run the explicit semantic reindex above
  before returning semantic traffic. Readiness rejects a newly created empty
  projection paired with restored fingerprint metadata.
- Before an upgrade, run
  `bunx titen-memory migrate --db /var/lib/titen/titen.db --dry-run`; it prints
  pending forward-only SQL without creating or changing the database. Take the
  snapshot, apply the migration, restart, and require `/readyz` rather than
  `/healthz` to report success.
- Rollback is snapshot restore, not a down migration. Stop the service, preserve
  the failed database for diagnosis, restore the verified pre-upgrade snapshot
  into a new mode-`0600` file, start the previous binary against that file, and
  require `/readyz` before returning traffic.
- For logical migration between deployments, retain all five NDJSON streams
  from `GET /v1/export` (`workspaces`, `memberships`, `projects`,
  `observations`, `claims`) and their headers. Use an `export:all` key and
  `all=true` only for an audited whole-organization export. Restore with
  `POST /v1/import` and explicit actor mappings where source and destination
  principals differ.
- `UNRESOLVED_REFERENCE` means the logical export lacks a required workspace,
  actor mapping, project, observation, or replacement claim. It is not a write
  conflict. Re-import is idempotent.
- Format-v3 logical JSONL includes committed enrichment jobs, hashes, result
  mappings, and claim links inline with claims. Imported observations do not
  become implicit new model inputs. It still omits keys, integration secrets,
  checkpoints, live leases, context feedback, audit/history, and rebuildable
  indexes; only the verified SQLite snapshot is the full VPS recovery boundary.

## Implemented optional capabilities

- `sqlite-vec` semantic vector retrieval when configured.
- Streamable HTTP MCP at `/mcp`.
- Signed, allowlisted Bun webhook delivery with durable at-least-once retries.
- Automatic claim extraction/reflection with durable leases/backoff and
  separate readiness when the complete extraction tuple is configured.

The implementation remains opt-in and is not production-activated until the
locked multilingual evaluation and real VPS, Cloudflare Paid D1, and local
computer smokes are recorded. Repository verification is manual/local. GitHub
Actions remains disabled so the repository incurs no hosted automation cost.

The approved `rama-tuf` reboot validation is complete: the boot ID changed,
the rootless user service auto-started with `NRestarts=0`, canonical counts and
the recorded event survived, and the real-model live verifier passed. A later
service restart is not a substitute for repeating that host-level gate.
