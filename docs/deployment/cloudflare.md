# Cloudflare deployment

Status: **verified** — P0 memory service operational on Cloudflare Workers with D1.

## Quick start

Prerequisites: Node 22+, pnpm 10+, Cloudflare account with D1.

```bash
# 1. Install
pnpm install

# 2. Create D1 database
wrangler d1 create titen
# Copy the database_id from output into wrangler.jsonc

# 3. Apply schema
pnpm titen schema | wrangler d1 execute titen --file=-

# 4. Bootstrap first org credential (save the printed key)
pnpm titen bootstrap --org 'My Org' --print-sql | wrangler d1 execute titen --file=-

# 5. Deploy
pnpm deploy:worker

# 6. (Optional) Enable auto-migrate on deploy
# Set TITEN_AUTO_MIGRATE to "1" in wrangler.jsonc vars
# or: wrangler secret put TITEN_AUTO_MIGRATE

# 7. Verify
curl https://titen.<your-subdomain>.workers.dev/healthz
```

## Verified P0 behavior

- Worker bundle: 68.90 KiB / 16.67 KiB gzip.
- 32 contract tests pass through Miniflare with real D1.
- Loop latency p50: 45.6 ms (local D1, not production).
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

## Planned (not yet active)

These bindings will be added when their P0 work items begin:

- **Vectorize** — rebuildable semantic index for vector retrieval.
- **Workers AI** — embeddings and structured extraction.
- **Cron Trigger** — bounded consolidation, enrichment, event delivery.
- **Channel serving** — CRM/chatbot gateway via scoped service credential.
- **Memory Atlas** — read-only browser client against authenticated REST.

Readiness and `/healthz` will report when optional capabilities are unavailable.

## Secrets

- Store bootstrap/model secrets with `wrangler secret put`, never in `wrangler.jsonc`.
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
