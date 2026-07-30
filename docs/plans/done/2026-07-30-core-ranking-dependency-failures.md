---
work_id: titen-core-ranking-dependency-failures
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: wulan
spec: docs/specs/done/2026-07-30-core-ranking-dependency-failures.md
---

# Plan: core ranking and dependency-failure semantics

## Ordered steps

- [x] Inspect ranking, context compilation, index drain, error envelope, and shared test fixtures.
- [x] Normalize vector similarity per candidate set and replace the confidence multiplier with one explicit weighted component.
- [x] Document the formula and public audit components in the relevant reference contract.
- [x] Translate embedder and vector-store drain failures into safe retryable unavailable errors without advancing outbox state.
- [x] Extend shared vector fixtures and regression tests for narrow-band similarity, confidence, both dependency outages, and recovery.
- [x] Run required workflow, build/type, Worker dry-run, feasible targeted tests, and whitespace checks.
- [x] Record exact evidence and move this pair to `done/` together.

## Acceptance evidence

| Criterion | Planned evidence |
| --- | --- |
| AC-CORE-001 | unit/contract assertions for min-max vector normalization and zero-span behavior |
| AC-CORE-002 | narrow-band vector ranking regression where the strongest semantic hit reaches relevance 1 |
| AC-CORE-003 | exported constants, score components, formula docs, and sum assertion |
| AC-CORE-004 | regression with otherwise identical candidates and differing confidence |
| AC-CORE-005 | shared-core embedder outage response and pending-row assertions |
| AC-CORE-006 | shared-core store outage response and pending-row assertions |
| AC-CORE-007 | recovery retry assertion indexing and completing the preserved rows |
| AC-CORE-008 | package diff, dual-runtime build gates, and no migration/runtime-specific changes |

## Verification and safety

- Targeted ranking and vector/index tests exercise normal, degraded, failure, and recovery paths.
- Authorization remains on the existing `index:write` route and candidate hydration remains scope-enforced; no auth model changes.
- No migration or deployment is required. Existing outbox state is compatible.
- Rollback is a source revert; pending rows are intentionally preserved and need no repair.

```bash
node scripts/check-workflow-docs.mjs
node scripts/check-workflow-docs.mjs --self-test
pnpm exec tsc --noEmit
pnpm build
pnpm build:worker
bun test tests/contract/vectors.test.ts # only when Bun is available

git diff --check
```

## Recorded evidence

| Check | Result |
| --- | --- |
| Workflow validation | `workflow docs OK`; checker self-test passed |
| Ranking regressions | Narrow-band, zero-span, zero-similarity, explicit-confidence, and weight-sum tests passed |
| Dependency failures | Embedder/store 503 metadata, pending preservation, and recovery tests passed |
| Shared contract/SDK | 133 tests passed across Cloudflare D1, Bun SQLite, vector, and SDK suites |
| Integration | 28 tests passed across sqlite-vec, maintenance, MCP, federation, and webhooks |
| Build/browser | Worker dry-run bundled 175.44 KiB / gzip 37.42 KiB; Astro build and bundle budget passed; 8 browser tests passed on an alternate local port because 4399 was occupied by an unrelated checkout |
| Whitespace | `git diff --check` passed |
| Migration/deployment | Not applicable; no schema or deployed state changed |
