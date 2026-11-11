---
work_id: retry-clears-output-hash
status: active
stage: implement
outcome: pending
review_after: 2026-11-18
complexity: complex
created: 2026-11-11
updated: 2026-11-11
owner: maintainers
spec: docs/specs/active/2026-11-11-retry-clears-output-hash.md
---
# Retry clears output hash plan

Goal: a retried enrichment job reaches a terminal state when the model returns a different output.

- [x] Add a failing contract case: a job fails with `unsafe_output`, the operator retries it, and the next run returns a different valid output.
- [x] Add migration 32: clear `output_hash` on `pending` and `leased` jobs, then replace the trigger `enrichment_jobs_output_immutable`.
- [x] Set `output_hash = NULL` in `retryEnrichmentJobs`.
- [x] Add contract cases for the rejected second output, the trigger rejection, and the migration cleanup.
- [x] Update `docs/reference/` and CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-RTY-001 | bun-sqlite and cloudflare-d1 contract case `bun:sqlite replays bounded model enrichment` / `D1 replays bounded model enrichment` (assertEnrichmentContract in tests/contract/enrichment.ts): retried job has `output_hash` NULL, `state` pending, `attempts` 0 |
| AC-RTY-002 | bun-sqlite and cloudflare-d1 contract case `bun:sqlite replays bounded model enrichment` / `D1 replays bounded model enrichment` (assertEnrichmentContract in tests/contract/enrichment.ts): retried `RETRY_VALID_OUTPUT` job reaches `done` with a new hash |
| AC-RTY-003 | bun-sqlite and cloudflare-d1 contract case `bun:sqlite replays bounded model enrichment` / `D1 replays bounded model enrichment` (assertEnrichmentContract in tests/contract/enrichment.ts): retried `RETRY_REJECT_OUTPUT` job is `failed` with a new hash, and the next job in the pass is `done` |
| AC-RTY-004 | bun-sqlite and cloudflare-d1 contract case `bun:sqlite replays bounded model enrichment` / `D1 replays bounded model enrichment` (assertEnrichmentContract in tests/contract/enrichment.ts): direct hash updates and a reset without the retry shape reject with `ENRICHMENT_OUTPUT_IMMUTABLE` |
| AC-RTY-005 | `tests/integration/retry-output-hash-migration.test.ts` (Bun only): `migration 32 clears the output hash of pending and leased jobs` |
| AC-RTY-006 | same `assertEnrichmentContract` runs in `tests/contract/bun-sqlite.test.ts` and `tests/contract/cloudflare-d1.test.ts` |
