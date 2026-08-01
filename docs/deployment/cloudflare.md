# Cloudflare deployment

Status: **implemented and verified locally** through workerd/D1. A provisioned
live Worker/D1 deployment and live Vectorize/Workers AI bindings are not current
repository evidence.

Cloudflare Tunnel is ingress for a self-hosted Bun/VPS origin, not a way to
deploy this Worker runtime. See the [secure ingress guide](./secure-ingress.md)
for Tailscale Serve and Cloudflare Tunnel with Access.

## Local preview

Prerequisites: Node 22+, pnpm 10+, Cloudflare account with D1.

```bash
pnpm install

# Apply schema and bootstrap to Wrangler's local D1 state
(
  set -eu
  umask 077
  titen_sql=$(mktemp)
  trap 'rm -f "$titen_sql"' EXIT HUP INT TERM
  pnpm titen schema >"$titen_sql"
  pnpm exec wrangler d1 execute titen --local --file="$titen_sql"
  pnpm titen bootstrap --org 'My Org' --print-sql >"$titen_sql"
  pnpm exec wrangler d1 execute titen --local --file="$titen_sql"
)

# Start a local Worker preview
pnpm exec wrangler dev
```

Local D1 state is separate from the production database. Use the `--remote`
commands below for every production schema or credential write.

## Production deployment

```bash
# 1. Create the production D1 database
pnpm exec wrangler d1 create titen
# Copy the database_id from output into wrangler.jsonc

# 2. Apply schema and bootstrap the first production org credential
(
  set -eu
  umask 077
  titen_sql=$(mktemp)
  trap 'rm -f "$titen_sql"' EXIT HUP INT TERM
  pnpm titen schema >"$titen_sql"
  pnpm exec wrangler d1 execute titen --remote --file="$titen_sql"
  pnpm titen bootstrap --org 'My Org' --print-sql >"$titen_sql"
  pnpm exec wrangler d1 execute titen --remote --file="$titen_sql"
)
# Save the bootstrap key printed to stderr; only its hash enters D1.

# 3. Deploy
pnpm deploy:worker

# 4. (Optional) Enable auto-migrate on deploy
# Set TITEN_AUTO_MIGRATE to "1" in wrangler.jsonc vars
# or: wrangler secret put TITEN_AUTO_MIGRATE

# 5. Verify
curl https://titen.<your-subdomain>.workers.dev/healthz
```

Schema migrations are forward-only. Before changing production schema, record
the current [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
bookmark with `wrangler d1 time-travel info titen` and retain the previous
Worker artifact. Logical cross-runtime migration uses the five versioned NDJSON
streams documented in the
[API reference](../reference/api.md#portability-and-backup-restore); it is not a
replacement for point-in-time rollback because it excludes credentials,
operational coordination, feedback, audit/history, and derived state. After
deployment or restore, gate traffic on `/readyz`, not `/healthz`.

## Locally verified behavior

- 2026-07-31 dry-build upload: 446.21 KiB / 95.07 KiB gzip.
- The shared contract suite passes through workerd/Miniflare with real D1.
- Data survives isolate disposal and fresh cold start.
- No Vectorize, Workers AI, Cron, KV, R2, Queue, DO, or `nodejs_compat` required.

## Bindings

Actual `wrangler.jsonc`:

```jsonc
{
  "name": "titen",
  "main": "src/runtime/cloudflare/worker.ts",
  "compatibility_date": "2026-07-01",
  "workers_dev": true,
  "observability": { "enabled": true },
  "vars": {
    "TITEN_REVISION": "dev",
    "TITEN_AUTO_MIGRATE": "0"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "titen",
      "database_id": "replace-with-your-d1-database-id"
    }
  ]
}
```

`TITEN_REVISION` is stamped at build/deploy; `TITEN_AUTO_MIGRATE` controls
whether the Worker applies pending migrations on cold start.

## Optional capability truth

The Worker contains vector and extraction adapters plus a `scheduled()`
maintenance handler, but checked-in `wrangler.jsonc` configures only D1. It has
no AI, Vectorize, extraction secret, or Cron binding, so those capabilities are
not active by default or live-verified.

- **Vectorize** — rebuildable semantic index for vector retrieval.
- **Workers AI** — embedding adapter support.
- **OpenAI-compatible extraction** — bounded derivation/reflection adapter via
  `TITEN_EXTRACT_BASE_URL`, model, immutable fingerprint, and optional secret.
- **Cron Trigger** — handler support for bounded indexing, enrichment, and
  delivery maintenance; trigger provisioning is operator work.
- **Channel serving** — CRM/chatbot gateway via scoped service credential.
- **Memory Atlas** — read-only browser client against authenticated REST.

With no AI/Vectorize binding or embedding variables, the Worker remains ready
in intentional FTS-only mode. Semantic opt-in requires both native bindings and
a valid local contract. Configure `TITEN_EMBED_MODEL`, `TITEN_EMBED_DIMS`,
`TITEN_EMBED_REVISION`, `TITEN_EMBED_PROFILE`, and
`TITEN_EMBED_MIN_COSINE`; the bound Vectorize index must use the same dimensions
and cosine metric. Revision must identify immutable provider weights. The floor
must come from a locked evaluation of that exact model/profile; Titen bundles no
universal threshold. A partial binding/variable set, invalid dimension/policy,
or binding object without the required methods returns `configured_error` and
fails `/readyz`.

Migration 13 persists provider `workers-ai`, model, revision, dimensions,
cosine metric, the named role/normalization profile plus calibrated floor, and
index schema `claims-scope-v1` in D1. `embeddinggemma-retrieval-v1` applies
EmbeddingGemma's asymmetric prompts; `raw-unit-v1` remains explicit for raw-text
models. Readiness compares those local facts without calling Workers AI or
Vectorize. Migration 14 retains only safe embedder/vector-store failure
timestamps in semantic metadata, so `/readyz` fails without a provider probe
until a later complete embed/upsert proves recovery. A real drain/query smoke
supplies the initial reachability evidence and proves recovery.

Migration 16 adds nullable ownership and expiry fields to the rebuildable index
outbox. Manual and scheduled drains use D1's SQLite clock for conditional
claims, and every Vectorize upsert or removal keeps canonical reconciliation
until ownership-confirmed completion. The migration never infers recovery or
clears an existing dependency-failure marker.

Changing any fingerprint field requires an explicit reindex. Provision a fresh
compatible Vectorize index (or clear the rebuildable old projection), stop
index maintenance, then reset only the D1 projection metadata/work:

```bash
wrangler d1 execute titen --remote --command \
  "DELETE FROM semantic_index_metadata WHERE id = 'claims'; UPDATE index_outbox SET state = 'pending', attempts = 0, lease_token = NULL, lease_expires_at = NULL WHERE record_type = 'claim'; INSERT INTO index_outbox (id, org_id, record_type, record_id, operation, state, attempts, created_at) SELECT 'obx_' || lower(hex(randomblob(16))), c.org_id, 'claim', c.id, 'upsert', 'pending', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM claims c WHERE c.status IN ('active', 'disputed') AND NOT EXISTS (SELECT 1 FROM index_outbox o WHERE o.record_type = 'claim' AND o.record_id = c.id AND o.operation = 'upsert');"
```

Bind the intended index, deploy, require `/readyz`, and drain the pending claim
work before declaring semantic retrieval operational. Never reset canonical
claims or observations for a reindex.

Model-assisted memory uses a separate leased D1 enrichment job. A provisioned
Cron Trigger drains one job per bounded pass and is the background durability
guarantee; `POST /v1/enrichment/drain?limit=1` is the authorized manual path.
Set `TITEN_EXTRACT_BASE_URL`, `TITEN_EXTRACT_MODEL`, and a 64-hex
`TITEN_EXTRACT_MODEL_FINGERPRINT`; store `TITEN_EXTRACT_API_KEY` as a Worker
secret. Strict `TITEN_EXTRACT_RESPONSE_MODE=json_schema` is the default; select
`json_object` explicitly only when the provider cannot enforce strict schemas.
That compatibility mode sends the exact schema and bounds but keeps local
validation unchanged. The configured mode is visible in readiness without the
endpoint or secret. `TITEN_D1_PLAN=paid` is required, and background execution additionally
requires `TITEN_ENRICHMENT_BACKGROUND=1` plus an actual Cron Trigger. Local
schema and ID validation remains mandatory for every provider response.

Cloudflare Queue is not required. Add it only as an opaque job-ID wake-up path
after measured backlog age or semantic-ready latency exceeds the accepted
objective; D1 remains authoritative and Cron remains the reconciler.

The model-assisted scheduled profile is unsupported on Workers Free. Paid
activation is still blocked until a real max-bound D1 smoke proves the declared
900-query/100-parameter wrapper on the target account; local Miniflare and the
30-statement maximum fixture are necessary but not production evidence.

## Secrets

- Store external model secrets with `wrangler secret put`, never in
  `wrangler.jsonc`; native Workers AI bindings need no account API token inside
  the Worker.
- Use a distinct, revocable key per agent/service integration.
- Never place API keys in Vectorize metadata or logs.

## Rate limiting, telemetry, and rollback

Keep rate limiting at Cloudflare's authenticated ingress. Use [WAF Rate
Limiting Rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) to
match protected write routes, choose a plan-supported counting characteristic,
and reject excess requests before Worker execution. Do not copy raw
`Authorization` values into rule metadata, logs, or audits, and do not make
Titen trust forwarded-address headers. An isolate-local token bucket would be
inconsistent across isolates and is not an authorization boundary.

The checked-in `observability.enabled` setting uses [Workers
Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
and native [Workers metrics and
analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/).
Use those surfaces for request errors, CPU time, invocation volume, and tailing;
no logger framework or Prometheus endpoint is required. Keep memory content,
credentials, request bodies, and raw embeddings out of logs.

Before a release, retain the previous Worker version and a verified pre-upgrade
D1 backup/export. Roll back to that Worker version only when its code is known
to accept the current schema. A Worker rollback does not reverse a forward D1
migration; if the schema is incompatible, restore the verified database copy
according to the deployment runbook, redeploy the compatible Worker, then smoke
`/readyz` and one authenticated read.

## Verification gate

- Unauthenticated protected request → JSON `401`.
- Cross-tenant access → non-disclosing not-found.
- Observation and context compile work without Vectorize.
- Cache-busted production response reports the deployed revision.
- Rollback artifact and migration compatibility known before release.
- Extraction remains disabled unless the full opt-in tuple, Paid plan marker,
  locked evaluation, and real D1/VPS/local smokes are present.
- Run these gates manually from a controlled local checkout. GitHub Actions is
  intentionally not enabled so the repository incurs no hosted automation cost.

Current Cloudflare limits and pricing remain research evidence in the root
[blueprint](../../blueprint.md) and must be refreshed before production.
