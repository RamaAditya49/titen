---
work_id: retrieval-query-shape-20260731
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
---
# Retrieval query shape

## Problem

The shared lexical query evaluates dispute and feedback subqueries for every
FTS match before the 200-candidate cut. Evidence hydration can also let SQLite
start from every observation in an organization instead of the bounded
`claim_sources` rows for selected claims. Issues #114 and #121 show that both
shapes make broad context compilation scale with discarded or unrelated rows.

## Scope

Bound authorized lexical candidate IDs and BM25 scores before dispute/feedback
hydration, then hydrate visible evidence by bounded `claim_sources` rows and
canonical observation-ID lookups. Preserve ranking, authorization, token
packing, the fixed candidate ceiling, and identical Bun/SQLite and D1 SQL.
Refresh only the Ponytail triggers made stale by this fix.

Out of scope are `ANALYZE`, `PRAGMA optimize`, migrations, counters on claims,
new indexes, schedulers, runtime branches, dependencies, configurable candidate
limits, route changes, and public API changes.

## Acceptance criteria

- **AC-RQS-001 — Event-driven:** When more lexical rows match than the fixed
  candidate ceiling, Titen shall order and limit authorized candidate IDs by
  BM25 before evaluating dispute or feedback subqueries, and a best-ranked
  claim inserted after the ceiling shall remain eligible for a bounded pack.
- **AC-RQS-002 — Event-driven:** When selected claims need evidence hydration,
  Titen shall begin from only their bounded `claim_sources` rows and shall
  authorize each canonical observation by its identifier before returning an
  evidence ID.
- **AC-RQS-003 — Unwanted behavior:** If a source observation is foreign or no
  longer visible to the principal, then Titen shall omit its identifier without
  exposing a hidden count or scanning unrelated organization observations as
  the driving relation.
- **AC-RQS-004 — Ubiquitous:** Titen shall use one portable shared-core SQL path
  on Bun/SQLite and D1 without a migration, scheduler, dependency, new route,
  or changed candidate/budget contract.

## Risks and done conditions

The limiting subquery must retain all canonical organization, subject,
project, lifecycle, temporal, and visibility predicates; an early unauthorised
cut would be a correctness and privacy regression. Done requires focused SQL
shape and scale regressions, the affected contract on both runtimes, workflow
and route validation, a 51-route inventory, clean diff checks, and terminal
evidence in the paired done plan.

## Closure evidence

The shared query now limits fully authorized BM25 candidate IDs before its
dispute and feedback projections. Evidence hydration is driven by the selected
claims' `claim_sources` rows and validates each observation by primary ID.
Focused query-shape tests and a 201-claim late-best-match regression passed on
both Bun/SQLite and D1. The full integration suite, vector/SDK contracts,
51-route check, workflow checker and self-test, dependency and protected-file
diff checks, and `git diff --check` also passed. No migration, scheduler,
runtime-specific query, dependency, route, or public API was added.
