# Cloudflare deployment

Status: target design; P0 must verify every binding and runtime assumption.

## Components

- one Cloudflare Worker;
- D1 as canonical SQL and FTS store;
- optional Vectorize as a rebuildable semantic index;
- optional Workers AI for embeddings and structured extraction;
- Cron Trigger for bounded enrichment, vector, event-delivery, and
  consolidation work.
- optional external CRM/chatbot gateway using a distinct scoped service
  credential; it is not a public Titen route.
- optional Memory Atlas static client, served by the same Worker/site or a
  separate static host, calling only authenticated REST.

No KV, R2, Queue, Durable Object, or `nodejs_compat` is required for P0.

## Planned bindings

```jsonc
{
  "main": "src/cloudflare.ts",
  "compatibility_date": "<pin during P0>",
  "d1_databases": [{ "binding": "DB", "database_name": "titen" }],
  "vectorize": [{ "binding": "VECTORIZE", "index_name": "titen-memory" }],
  "ai": { "binding": "AI" },
  "triggers": { "crons": ["*/5 * * * *"] },
}
```

Vectorize and AI are optional capabilities. Readiness and responses must report
when semantic retrieval or consolidation is unavailable.

Vectorize does not create embeddings. When semantic retrieval is enabled,
Workers AI or another compatible embedding provider must generate vectors for
both indexed claim versions and incoming context queries. The configured model,
dimensions, metric, normalization, and text-template version form one
fingerprint; a mismatch fails semantic readiness without disabling canonical
SQL/FTS operation.

## Provisioning order

1. Create D1 and apply migrations.
2. Create the vector index with the tested dimensions/metric if enabled.
3. Create required vector metadata indexes before inserting vectors.
4. Deploy the Worker.
5. Bootstrap the first organization/admin credential through a local CLI.
6. Run protected remember/context/delete and cross-scope smoke tests.
7. Verify scheduled repair and outbox age.
8. When MCP is enabled, verify `/mcp` initialization and the ordinary-agent
   tool allowlist.
9. When webhooks are enabled, verify signature, destination policy, retry, and
   failure isolation with a non-production receiver.
10. When v0.3 channel serving is enabled, provision publisher, approver, and
    gateway principals separately; activate/revoke a synthetic release and run
    anonymous plus cross-customer isolation probes.
11. When Memory Atlas is enabled, compile each enabled lens, probe foreign and
    private focus IDs, inject a stale candidate, and verify bounded truncation.

## Runtime rules

- Authority is derived from the authenticated credential.
- D1 commits canonical records, history, FTS, and outbox atomically.
- Vector mutations may be asynchronous; canonical hydration rejects stale
  versions and tombstones.
- Recent pending writes use a bounded overlay only if P0 CPU measurements allow
  it.
- Long consolidation work remains bounded; add Queue/Workflow only after a
  measured need.
- The same Worker may expose `/v1` and `/mcp`; neither route waits for model,
  vector visibility, or webhook delivery after canonical commit.
- Outbound webhook destinations are explicit, HTTPS, allowlisted, and checked
  against private/link-local metadata targets before every delivery.
- A public hostname may front the CRM/chatbot application, but `/v1` and `/mcp`
  remain authenticated. The gateway calls protected channel-context operations;
  it never forwards arbitrary Titen paths, keys, `subject_id`, or audience.
- Channel release FTS is committed with the canonical release. Optional release
  vectors are derived and every result is hydrated against channel, audience,
  version, validity, and status.
- Memory Atlas uses the same authenticated
  `POST /v1/memory-views/compile` contract as VPS. The optional browser client
  receives no D1, Vectorize, or Workers AI binding; same-origin hosting is
  preferred and its CSP permits only required static assets and API calls.
- Atlas layout and cache are derived. Disabling the client/compiler or losing a
  renderer cannot fail headless REST/MCP readiness.

## Secrets

- Store bootstrap/model secrets with Worker secrets, never `wrangler.jsonc`.
- Never place API keys in Vectorize metadata or logs.
- Use a distinct, revocable key per agent/service integration.
- Pin each gateway key to its allowed channel/audience and keep publisher and
  approver capabilities off that key.

## Verification gate

- unauthenticated protected request returns JSON `401`;
- cross-tenant access returns non-disclosing not-found;
- observation and context compile work without Vectorize;
- embedding dimension mismatch fails readiness;
- invalid/missing configured customer-assertion verifier fails channel-serving
  readiness without exposing issuer/key details;
- cache-busted production response reports the deployed revision;
- rollback artifact and migration compatibility are known before release.
- channel smoke confirms verified-but-unreleased content is absent, anonymous
  requests cannot select a customer subject, Customer A cannot retrieve
  Customer B memory, expired/replayed customer assertions fail, and revoke takes
  effect on the next context compile.
- when Atlas is enabled, all lenses return only authorized nodes/edges/counts,
  stale projections cannot revive ineligible records, limits truncate
  boundedly, and disabled mode leaves kernel/MCP smoke green.

Current Cloudflare limits and pricing remain research evidence in the root
[blueprint](../../blueprint.md) and must be refreshed before production.
