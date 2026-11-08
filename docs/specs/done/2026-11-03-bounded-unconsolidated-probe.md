---
work_id: bounded-unconsolidated-probe
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-03
updated: 2026-11-03
owner: maintainers
---
# Bounded unconsolidated-observation probe in context compile

Issue #339. Every compile counted unconsolidated observations with an unbounded
anti-join over the subject's whole observation history, twice: once as COUNT and
once as an id list. Observations are append-only, so compile cost grew with the
subject's history for a metadata field. The probe also ignored a historical `at`.

Scope: `src/core/context.ts` only, plus docs and tests. No migration; the
existing `observations_scope (org_id, subject_id, ingested_at)` index serves the
window. The window is the 500 newest observations the caller may read, so the
access predicate runs while the index is walked, before LIMIT. `budget.unconsolidated_observations` becomes
windowed, and `budget.unconsolidated_observations_capped: true` is added only
when the window is full, so existing responses keep their shape.

## Acceptance criteria

- **AC-CTX-001 — Event-driven:** When a client compiles context for a subject with 200,000 observations, Titen shall respond with p50 latency within 2× of the same compile on a subject with no extra observations, on the Bun runtime.
- **AC-CTX-002 — Event-driven:** When a compile computes unconsolidated observations, Titen shall issue exactly one statement for it, and that statement shall read the subject's observations through an index-ordered window of at most 500 rows.
- **AC-CTX-003 — Event-driven:** When 500 or more observations of the subject fall at or before `as_of`, Titen shall set `budget.unconsolidated_observations_capped` to `true`.
- **AC-CTX-004 — Event-driven:** When a compile specifies `at`, Titen shall exclude observations ingested after `at` from `unconsolidated_observations` and `unconsolidated_observation_ids`.
- **AC-CTX-005 — Unwanted behavior:** If a recent observation is not readable by the caller, then Titen shall exclude it from the count and the ids.
- **AC-CTX-007 — Unwanted behavior:** If observations the caller cannot read are newer than the caller's readable ones, then Titen shall leave `unconsolidated_observations`, `unconsolidated_observation_ids`, and `unconsolidated_observations_capped` exactly as they would be without those observations.
- **AC-CTX-006 — Ubiquitous:** Titen shall keep the existing budget shape when the window is not full: no `unconsolidated_observations_capped` field and an unchanged consolidation hint.

## Done conditions

Contract cases pass on bun-sqlite and the D1 harness. A query-plan guard fails
when the window regresses to a sort or a scan. The benchmark below is recorded.

## Completion evidence

All seven acceptance criteria passed; the paired plan maps each to its check.
