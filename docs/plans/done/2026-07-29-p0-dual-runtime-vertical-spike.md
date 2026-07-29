---
work_id: titen-p0-dual-runtime-vertical-spike
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-29
updated: 2026-07-29
owner: titen-maintainers
spec: docs/specs/done/2026-07-29-p0-dual-runtime-vertical-spike.md
---

# Plan — P0 dual-runtime vertical spike

Spec: [2026-07-29-p0-dual-runtime-vertical-spike.md](../../specs/done/2026-07-29-p0-dual-runtime-vertical-spike.md)

## Shape

```text
src/core/           shared, Web-Standards only
  db.ts             driver interface: query, run, transaction
  migrations.ts     ordered forward-only SQL, applied through the driver
  http.ts           method+path routing, envelopes, request IDs, errors
  auth.ts           bearer verification, principal/scope resolution
  idempotency.ts    key replay storage and lookup
  projects.ts       reference normalization and resolution
  observations.ts   atomic append: row, history, FTS, outbox
  claims.ts         deterministic direct claims and source links
  evidence.ts       authorized claim evidence read
  retrieval.ts      scoped FTS candidate query
  rank.ts           deterministic scoring, diversity, conflict coverage
  tokens.ts         deterministic conservative estimator
  context.ts        compile, persist run, feedback
  keys.ts           API key management (create, list, revoke)
  portability.ts    JSONL export and import
src/runtime/cloudflare/  worker entry + D1 driver + wrangler config
src/runtime/bun/         Bun.serve entry + bun:sqlite driver + bootstrap CLI
tests/contract/          runtime-agnostic cases + one driver per runtime
```

Verification toolchain: `bun test` for the Bun runtime, `wrangler` local D1 for
the Worker runtime, both executing the same exported case list. Wrangler is the
only new dependency and is already required to deploy the Worker.

Deliberate P0 ceilings, each marked in code: character-ratio token estimator,
standalone FTS5 table written in the same transaction instead of triggers with
an external content table, and an indexing outbox with no consumer.

## Steps

- [x] 1. Parity harness first. Add the driver interface, both drivers, the
      migration runner, `GET /healthz`, `GET /readyz`, and the two test drivers
      that run one shared trivial case. Nothing else proceeds until both
      runtimes are green.
- [x] 2. Schema and credentials. Add the P0 migration covering organizations,
      api_keys, projects, observations, observations_fts, record_history,
      index_outbox, claims, claim_sources, context_runs, context_run_items,
      context_feedback, and idempotency. Add hashed-key verification, the local
      bootstrap path, and the 401/403/404 disclosure rules.
- [x] 3. Evidence intake. Add `POST /v1/projects/resolve` and
      `POST /v1/observations` with normalization, validation, trust authority,
      atomic write, and idempotency replay. Add the forced-failure test that
      asserts no partial rows.
- [x] 4. Derived memory. Add `POST /v1/consolidations` for deterministic direct
      claims with source links and trust ceilings, plus
      `GET /v1/claims/:id/evidence` with hidden-source signaling.
- [x] 5. Context loop. Add scoped FTS retrieval, deterministic ranking, budget
      packing, `POST /v1/context/compile`, and
      `POST /v1/context/:id/feedback`.
- [x] 6. Adversarial pass. Add cross-organization, cross-subject, revoked-key,
      and foreign-source cases for every protected operation on both runtimes.
- [x] 7. Footprint. Measure Worker bundle size, loop latency, peak memory, and
      storage growth per observation on both runtimes; record the numbers here.
- [x] 8. Runtime smoke. Run the full loop against a local Worker with D1 and
      against `Bun.serve` with a file-backed database, including a restart and
      a fresh-instance read.
- [x] 9. Documentation. Update `docs/reference/api.md` status,
      `docs/deployment/*.md`, README status, and the roadmap P0 entry to
      describe only verified behavior.
- [x] 10. Close. Confirm the dashboard build, browser tests, and
      `pnpm check:workflow` still pass, then move both artifacts to `done/`.

## Footprint measurements (AC-P0-021)

| metric | bun-sqlite | cloudflare-d1 |
| --- | --- | --- |
| worker bundle (raw / gzip) | n/a | 68.90 KiB / 16.67 KiB |
| full loop p50 (100 iterations) | 12.0 ms | 45.6 ms |
| full loop p95 | 17.1 ms | 57.9 ms |
| storage per loop | 47.64 KiB | 42.33 KiB |
| peak process RSS | 155640.00 KiB | workerd manages its own isolate memory |

One loop = observation append + claim materialization + context compile + feedback (4 requests).

## Runtime smoke evidence

### Bun/SQLite

```
[1] healthz: 200 ok
[2] observation: 201 id=obs_127976d872da49b7b181722379c04837
[3] claim: 201 id=claim_3f1089cf5cb344aea1c92c095b7f7409
[4] server stopped
[5] server restarted on http://127.0.0.1:9878
[6] readyz: 200 ready=true
[7] compile: 200 items=1
[8] claim found after restart: true
[9] evidence: 200 supporting=1
✓ Bun runtime smoke PASSED
```

### Cloudflare Worker/D1

```
[1] healthz: 200 ok runtime=cloudflare-d1
[2] observation: 201 id=obs_981ce3c1c751458f834ec4d7aaa76f6e
[3] claim: 201 id=claim_102d9cf8ba29427da0334e0febc5b012
[4] worker disposed
[5] worker restarted (fresh isolate)
[6] readyz: 200 ready=true
[7] compile: 200 items=1
[8] claim found after restart: true
[9] evidence: 200 supporting=1
✓ Cloudflare Worker D1 runtime smoke PASSED
```

## Contract test summary

```
bun-sqlite:     32 pass, 0 fail (572 ms)
cloudflare-d1:  32 pass, 0 fail (2.02 s)
```

## Dashboard and workflow check

```
dashboard CSS + JS: 9.8 KiB gzip / 80 KiB budget
  2 page(s) built
  8 browser tests passed (3.7 s)
workflow docs OK (12 artifacts)
```

## Acceptance evidence mapping

| Acceptance | Evidence |
| ---------- | -------- |
| AC-P0-001  | `src/core/` imports no runtime module; adapters are 3 files totaling <4 KiB |
| AC-P0-002  | 32 identical cases pass on both runtimes with normalized responses |
| AC-P0-003  | Case "an observation commits its canonical row, history, FTS row, and outbox entry together" |
| AC-P0-004  | Case "an idempotent retry returns the original result and writes nothing new" |
| AC-P0-005  | `assertBatchAtomicity` test on both runtimes |
| AC-P0-006  | Case "project references normalize to a stable lowercase owner/repo" |
| AC-P0-007  | Case "credential-bearing, query-string, and local-path references are rejected" |
| AC-P0-008  | Case "a deterministic claim links evidence without calling a model" |
| AC-P0-009  | Case "a foreign evidence reference is not found and writes no claim" |
| AC-P0-010  | Case "claim trust and visibility may not exceed their evidence" |
| AC-P0-011  | Case "a compiled pack stays under budget and explains every item" |
| AC-P0-012  | Case "compilation excludes other organizations, subjects, and private memory" |
| AC-P0-013  | Case "no eligible memory returns a successful empty pack" |
| AC-P0-014  | Case "readiness reports applied migrations and disabled optional capabilities" |
| AC-P0-015  | Case "feedback is recorded, idempotent, and changes no evidence" |
| AC-P0-016  | Case "a deterministic claim links evidence without calling a model" (hidden_source_count) |
| AC-P0-017  | Case "missing, malformed, unknown, and revoked credentials all return 401" |
| AC-P0-018  | Case "raw key material never reaches storage" |
| AC-P0-019  | Readiness reports schema state; healthz never leaks paths |
| AC-P0-020  | Runtime smoke: "committed memory survives a restart without a rebuild step" |
| AC-P0-021  | Footprint table above |
| AC-P0-022  | package.json has no model/vector/queue/ORM dep; wrangler.jsonc has no nodejs_compat |

## Verification

- `bun test tests/contract/bun-sqlite.test.ts` — 32 pass;
- `bun test tests/contract/cloudflare-d1.test.ts` — 32 pass;
- `pnpm test` (Astro build + Playwright browser suite) — 8 pass;
- `pnpm check:workflow` — 12 artifacts OK;
- recorded runtime smoke output for both targets.

## Rollback

The service is additive and unreleased. Rollback removes `src/core`,
`src/runtime`, `tests/contract`, and the new dependency; the dashboard and
documentation remain independently buildable. No data migration is deployed, so
no destructive rollback path exists.
