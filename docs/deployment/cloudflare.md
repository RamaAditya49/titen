# Cloudflare deployment

Status: **implemented, verified locally, and verified live** in the retained
prefix-isolated Rama Digital `titen-test-*` stack. The live proof covers Worker,
D1, Vectorize, Workers AI BGE-M3 embeddings, Cron repair, authorization,
persistence, rollback, and dashboard-adapter behavior. It is not a customer
traffic cutover or activation of model-assisted derivation/reflection.

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

When Vectorize is enabled, create its authorization metadata indexes before the
first upsert. Existing vectors must be requeued after adding an index because
metadata-index creation is asynchronous:

```bash
wrangler vectorize create-metadata-index <index> --propertyName org_id --type string
wrangler vectorize create-metadata-index <index> --propertyName project_id --type string
wrangler vectorize create-metadata-index <index> --propertyName subject_id --type string
wrangler vectorize list-metadata-index <index>
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

## Reference live stack

The account-specific [`wrangler.titen-test.jsonc`](../../wrangler.titen-test.jsonc)
keeps the generic OSS config reusable and contains no credential:

| Resource | Retained live value |
| --- | --- |
| Account | Rama Digital |
| Worker | `titen-test-api` |
| D1 | `titen-test-db` in APAC |
| Vectorize | `titen-test-claims-v1`, 1024 dimensions, cosine |
| Workers AI | native `AI` binding, `@cf/baai/bge-m3` |
| Cron | every minute, bounded maintenance |
| URL | `https://titen-test-api.konektor.workers.dev` |

The 2026-08-01 live gate observed a 600.17 KiB / 124.29 KiB gzip Worker,
schema 20, one-read schema verification, enabled semantic readiness, 1024-value
BGE-M3 output, scoped metadata filtering, and a keyword-free target recalled
about two seconds after an explicit drain. A real Cron invocation indexed
pending work; unauthenticated and foreign-organization probes returned `401`
and non-disclosing `404`. Forced password replacement, fifteen dashboard destinations,
Add User, logout, D1 persistence, and Worker rollback/redeploy also belong to
the release gate; the exact terminal revision is recorded in the paired done
spec.

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
  "ratelimits": [
    {
      "name": "LOGIN_RATE_LIMITER",
      "namespace_id": "52054",
      "simple": { "limit": 10, "period": 60 }
    }
  ],
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
maintenance handler. The generic `wrangler.jsonc` configures only D1; the
separate `wrangler.titen-test.jsonc` activates native AI, Vectorize, and Cron for
the retained live reference stack. Extraction remains disabled.

- **Vectorize** — rebuildable semantic index for vector retrieval.
- **Workers AI** — embedding adapter support.
- **OpenAI-compatible extraction** — bounded derivation/reflection adapter via
  `TITEN_EXTRACT_BASE_URL`, model, immutable fingerprint, and optional secret.
- **Cron Trigger** — handler support for bounded indexing, enrichment, and
  delivery maintenance; trigger provisioning is operator work.
- **Channel serving** — CRM/chatbot gateway via scoped service credential.
- **Memory Atlas** — read-only browser client against authenticated REST.

The dashboard's Models area reads the same immutable Worker startup snapshot
through `GET /v1/models/config`. `POST /v1/models/probe` performs one bounded,
rate-limited validation using the configured binding/provider, returns no raw
provider payload, writes no canonical memory, and cannot mutate bindings or
environment variables.

With no AI/Vectorize binding or embedding variables, the Worker remains ready
in intentional FTS-only mode. Semantic opt-in requires both native bindings and
a valid local contract. Configure `TITEN_EMBED_MODEL`, `TITEN_EMBED_DIMS`,
`TITEN_EMBED_REVISION`, `TITEN_EMBED_PROFILE`, and
`TITEN_EMBED_MIN_COSINE`; the bound Vectorize index must use the same dimensions
and cosine metric. A partial binding/variable set, invalid dimension/policy,
or binding object without the required methods returns `configured_error` and
fails `/readyz`.

Only two of those have a Worker-side default: `TITEN_EMBED_MODEL` falls back to
`@cf/baai/bge-base-en-v1.5` and `TITEN_EMBED_DIMS` to `768`. **Revision,
profile, and floor have no default on this runtime either**, and the same
absence rules as the
[VPS embedding reference](./vps.md#embedding-configuration) apply — including
the model-forced profile rule and the empty-string rejection that makes an unset
`TITEN_EMBED_MIN_COSINE` fail closed. Revision should identify immutable
provider weights when the provider exposes them. The reference stack records
Cloudflare's observed catalog identity and date, not an independent weight
attestation. The floor must come from a locked evaluation of that exact
model/profile; Titen bundles no universal threshold.

The live evidence for this path comes from `titen-test-*`, an isolated stack on
the maintainer's own Cloudflare account. It is test production and not a
general-availability claim; a new account needs its own ready, drain, and query
smoke.

Migration 13 persists provider `workers-ai`, model, revision, dimensions,
cosine metric, the named role/normalization profile plus calibrated floor, and
index schema `claims-scope-v1` in D1. `embeddinggemma-retrieval-v1` applies
EmbeddingGemma's asymmetric prompts; `raw-unit-v1` remains explicit for raw-text
models; `raw-unit-v1-model-mismatch-acknowledged` is the deliberate opt-out that
sends raw text on a model whose id claims the prompt convention, documented in
[the VPS guide](./vps.md#embedding-configuration). All three are distinct in the
fingerprint, so switching between them forces a rebuild rather than mixing
conventions in one index. Readiness compares those local facts without calling Workers AI or
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
- Workers Web Crypto supports PBKDF2 but rejects one call above 100,000
  iterations. Titen's versioned verifier therefore runs six serial salted
  100,000-iteration stages; no crypto package or `nodejs_compat` flag is added.

## August 2026 platform check

Re-verified on 2026-08-01 from Cloudflare's official documentation:

- Wrangler JSONC remains the deployment source of truth, and native bindings
  avoid account tokens inside Workers: [configuration](https://developers.cloudflare.com/workers/wrangler/configuration/),
  [bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/).
- BGE-M3 is available as `@cf/baai/bge-m3`; Workers AI includes 10,000 free
  neurons per day, then usage is billed by neurons:
  [model](https://developers.cloudflare.com/workers-ai/models/bge-m3/),
  [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).
- Vectorize supports at most 1,536 dimensions and asynchronous mutations; its
  Free allocation includes 30 million queried dimensions and 5 million stored
  dimensions per month: [limits](https://developers.cloudflare.com/vectorize/platform/limits/),
  [pricing](https://developers.cloudflare.com/vectorize/platform/pricing/),
  [client API](https://developers.cloudflare.com/vectorize/reference/client-api/).
- D1 Time Travel is always on, with seven days of Free-plan and thirty days of
  Paid-plan retention: [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).
- Worker rollback changes code, not D1 migrations or bindings; schema
  compatibility must be proved before rollback:
  [rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
- Workers Web Crypto documents native PBKDF2 support; the live runtime probe
  additionally established the current 100,000-iteration per-call ceiling:
  [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).

## Rate limiting, telemetry, and rollback

The public password-login route uses Cloudflare's native [Rate Limiting
binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
after each failed verifier check, keyed by the normalized account bucket rather
than an IP address or password. The existing account throttle remains the
canonical defense because binding counters are intentionally permissive and
location-local. Keep `namespace_id` unique for this rule when copying the
template. WAF Rate Limiting Rules may additionally reject broad write abuse at
the ingress. Never copy raw `Authorization` values into rule metadata, logs, or
audits, and never trust forwarded-address headers for authorization.

The checked-in `observability.enabled` setting uses [Workers
Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
and native [Workers metrics and
analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/).
Use those surfaces for request errors, CPU time, invocation volume, and tailing;
no logger framework or Prometheus endpoint is required. Keep memory content,
credentials, request bodies, and raw embeddings out of logs.

The one-core throughput ceiling published in [VPS
deployment](./vps.md#capacity-rate-limiting-and-telemetry) is a property of the
single-process `bun:sqlite` runtime and does not apply here, because Workers
concurrency is the platform's per-request isolate model rather than one event
loop.

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

Refresh the linked limits and pricing before a different account, plan, or
customer cutover; the values above are a dated operational snapshot.
