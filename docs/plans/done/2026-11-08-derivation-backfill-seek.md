---
work_id: derivation-backfill-seek
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-08
updated: 2026-11-08
owner: maintainers
spec: docs/specs/done/2026-11-08-derivation-backfill-seek.md
---
# Derivation backfill seek plan

Goal: the backfill checks for an existing derivation job with an index seek.

- [x] Add contract tests: one recovery, no second schedule, and no duplicate after the migration statement runs.
- [x] Add a query-plan guard for the backfill anti-join and the export job filter.
- [x] Add migration 28: plain column, backfill `UPDATE`, and index.
- [x] Write the column in `jobInsert` and in the logical import insert.
- [x] Rewrite the backfill anti-join and the export join to use the column.
- [x] Add the 20,000-observation timing test.
- [x] CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-ENR-001 | `tests/integration/query-plan.test.ts`: the anti-join plan shows `SEARCH existing USING INDEX enrichment_jobs_source_observation (org_id=? AND lane=? AND source_observation_id=?)`. The export join plan shows an id seek on `input_observation` and no `json_extract` in the join. |
| AC-ENR-002 | `tests/integration/derivation-backfill-perf.test.ts`: 20,000 observations with done jobs, measured 11.8 ms on `rama-tuf`; the test bound is 500 ms. |
| AC-ENR-003 | `tests/contract/enrichment.ts`: an observation written without extraction gets exactly one job from the backfill. |
| AC-ENR-004 | `tests/contract/enrichment.ts`: clear the column, run the migration `UPDATE`, then the backfill schedules nothing and the job count stays 1. |

## Rollback

Revert the commit. Migration 28 is forward-only, so the column and index stay
on stores that already migrated. Older code ignores both.

## Verification

On `rama-tuf`: `bun test tests/contract/bun-sqlite.test.ts` (131 pass),
`pnpm test:d1` (9 and 141 pass), `bun test` on the query-plan and timing files
(6 pass), ten enrichment, portability, and migration integration files
(57 pass), `pnpm typecheck:maintained`, `check-workflow-docs`, and
`check-ponytail-debt`. A real Cloudflare scheduled handler was not exercised.
