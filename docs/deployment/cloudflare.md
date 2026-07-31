# Cloudflare deployment

Status: **implemented and verified locally** through workerd/D1. A provisioned
live Worker/D1 deployment and live Vectorize/Workers AI bindings are not current
repository evidence.

## Local preview

Prerequisites: Node 22+, pnpm 10+, Cloudflare account with D1.

```bash
pnpm install

# Apply schema and bootstrap to Wrangler's local D1 state
pnpm titen schema | wrangler d1 execute titen --local --file=-
pnpm titen bootstrap --org 'My Org' --print-sql | \
  wrangler d1 execute titen --local --file=-

# Start a local Worker preview
pnpm exec wrangler dev
```

Local D1 state is separate from the production database. Use the `--remote`
commands below for every production schema or credential write.

## Production deployment

```bash
# 1. Create the production D1 database
wrangler d1 create titen
# Copy the database_id from output into wrangler.jsonc

# 2. Apply schema to production
pnpm titen schema | wrangler d1 execute titen --remote --file=-

# 3. Bootstrap the first production org credential (save the printed key)
pnpm titen bootstrap --org 'My Org' --print-sql | \
  wrangler d1 execute titen --remote --file=-

# 4. Deploy
pnpm deploy:worker

# 5. (Optional) Enable auto-migrate on deploy
# Set TITEN_AUTO_MIGRATE to "1" in wrangler.jsonc vars
# or: wrangler secret put TITEN_AUTO_MIGRATE

# 6. Verify
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

- 2026-07-31 dry-build upload: 223.06 KiB / 49.49 KiB gzip.
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

The Worker contains vector adapters and a `scheduled()` maintenance handler,
but checked-in `wrangler.jsonc` configures only D1. It has no AI, Vectorize, or
Cron binding, so those capabilities are not active by default or live-verified.

- **Vectorize** — rebuildable semantic index for vector retrieval.
- **Workers AI** — embedding adapter support; automatic extraction is not
  implemented.
- **Cron Trigger** — handler support for bounded indexing/delivery maintenance;
  trigger provisioning is operator work.
- **Channel serving** — CRM/chatbot gateway via scoped service credential.
- **Memory Atlas** — read-only browser client against authenticated REST.

Readiness and `/healthz` will report when optional capabilities are unavailable.

ADR-0004's model-assisted target adds a separate leased D1 enrichment job. A
Cron Trigger drains it in bounded passes and is the durability guarantee.
Workers AI or an allowlisted authenticated HTTPS/VPC OpenAI-compatible endpoint
may implement the same proposal contract. Local schema and ID validation remains
mandatory for either provider.

Cloudflare Queue is not required. Add it only as an opaque job-ID wake-up path
after measured backlog age or semantic-ready latency exceeds the accepted
objective; D1 remains authoritative and Cron remains the reconciler.

Do not advertise the model-assisted scheduled profile on the Workers Free plan
without a real smoke. Current Free Cron CPU and D1 query limits are too narrow
to infer support from a local test; refresh official limits before provisioning.

## Secrets

- Store external model secrets with `wrangler secret put`, never in
  `wrangler.jsonc`; native Workers AI bindings need no account API token inside
  the Worker.
- Use a distinct, revocable key per agent/service integration.
- Never place API keys in Vectorize metadata or logs.

## Verification gate

- Unauthenticated protected request → JSON `401`.
- Cross-tenant access → non-disclosing not-found.
- Observation and context compile work without Vectorize.
- Cache-busted production response reports the deployed revision.
- Rollback artifact and migration compatibility known before release.

Current Cloudflare limits and pricing remain research evidence in the root
[blueprint](../../blueprint.md) and must be refreshed before production.
