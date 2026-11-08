---
work_id: derivation-backfill-seek
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-08
updated: 2026-11-08
owner: maintainers
---
# Indexed source lookup for the derivation backfill

Issue #376. `drainEnrichment` calls `scheduleDerivationBackfill` first on every
drain. The backfill asks, for each observation, whether a derivation job
exists. The job-to-observation link lived only inside the `input_ids` JSON
column, so no index could serve the lookup. Each probe scanned every derivation
job of the organization. A steady-state pass cost O(n squared) and grew with
the age of the store, not with new work.

Scope: `src/core/migrations.ts`, `src/core/enrichment.ts`
(`jobInsert`, `scheduleDerivationBackfill`), `src/core/portability.ts` (the
export job filter and the job import insert), and tests. No API shape change.

## Design

Migration 28 adds `enrichment_jobs.source_observation_id TEXT`, fills it for
existing derivation jobs with `json_extract(input_ids, '$[0].id')`, and adds
`enrichment_jobs_source_observation (org_id, lane, source_observation_id)`.
Every code path that inserts a job writes the column: `jobInsert` and the
logical import. Reflection jobs keep NULL.

The backfill anti-join and the export job filter now read the column.

### Column form

The column is plain, not generated. The integrity check reads
`PRAGMA table_info`, which hides generated columns, so a generated column
would look missing and fail the check. A plain column also works the same on
Bun SQLite and on D1, with no dependence on generated-column support there.
The cost is one extra bound value in two insert statements.

### Out of scope

The optional high-water mark is not added. AC-ENR-002 passes without it.

## Acceptance criteria

- **AC-ENR-001 — Event-driven:** When `scheduleDerivationBackfill` checks whether an observation already has a derivation job, Titen shall resolve it with an index seek on `(org_id, lane, source observation id)`.
- **AC-ENR-002 — State-driven:** While every observation already has a derivation job, Titen shall complete a backfill pass over 20,000 observations in under 100 ms on the Bun runtime.
- **AC-ENR-003 — Event-driven:** When an observation was accepted while extraction was unavailable, Titen shall still schedule exactly one derivation job for it on a later drain.
- **AC-ENR-004 — Event-driven:** When the migration runs on an existing store, Titen shall make the source observation id available for every existing derivation job, and the backfill shall schedule no duplicate jobs.

## Done conditions

The contract suite passes on Bun SQLite and on both D1 harnesses. The
query-plan guard and the 20,000-observation timing test pass.

## Completion evidence

All four acceptance criteria passed; the paired plan maps each to its check.
