# Cloudflare deployment

Status: target design; P0 must verify every binding and runtime assumption.

## Components

- one Cloudflare Worker;
- D1 as canonical SQL and FTS store;
- optional Vectorize as a rebuildable semantic index;
- optional Workers AI for embeddings and structured extraction;
- Cron Trigger for bounded outbox and consolidation work.

No KV, R2, Queue, Durable Object, or `nodejs_compat` is required for P0.

## Planned bindings

```jsonc
{
  "main": "src/cloudflare.ts",
  "compatibility_date": "<pin during P0>",
  "d1_databases": [{ "binding": "DB", "database_name": "titen" }],
  "vectorize": [{ "binding": "VECTORIZE", "index_name": "titen-memory" }],
  "ai": { "binding": "AI" },
  "triggers": { "crons": ["*/5 * * * *"] }
}
```

Vectorize and AI are optional capabilities. Readiness and responses must report
when semantic retrieval or consolidation is unavailable.

## Provisioning order

1. Create D1 and apply migrations.
2. Create the vector index with the tested dimensions/metric if enabled.
3. Create required vector metadata indexes before inserting vectors.
4. Deploy the Worker.
5. Bootstrap the first organization/admin credential through a local CLI.
6. Run protected remember/context/delete and cross-scope smoke tests.
7. Verify scheduled repair and outbox age.

## Runtime rules

- Authority is derived from the authenticated credential.
- D1 commits canonical records, history, FTS, and outbox atomically.
- Vector mutations may be asynchronous; canonical hydration rejects stale
  versions and tombstones.
- Recent pending writes use a bounded overlay only if P0 CPU measurements allow
  it.
- Long consolidation work remains bounded; add Queue/Workflow only after a
  measured need.

## Secrets

- Store bootstrap/model secrets with Worker secrets, never `wrangler.jsonc`.
- Never place API keys in Vectorize metadata or logs.
- Use a distinct, revocable key per agent/service integration.

## Verification gate

- unauthenticated protected request returns JSON `401`;
- cross-tenant access returns non-disclosing not-found;
- observation and context compile work without Vectorize;
- embedding dimension mismatch fails readiness;
- cache-busted production response reports the deployed revision;
- rollback artifact and migration compatibility are known before release.

Current Cloudflare limits and pricing remain research evidence in the root
[blueprint](../../blueprint.md) and must be refreshed before production.
