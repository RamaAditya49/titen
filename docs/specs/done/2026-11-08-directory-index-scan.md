---
work_id: directory-index-scan
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-08
updated: 2026-11-08
owner: maintainers
---
# Index-backed project and subject directories

Issue #338. `listProjects` and `listSubjects` built the count of every readable
claim and observation in the organization before they applied the `q` filter,
the `type` filter, and the page limit. A request for 10 entries cost as much as
a request for the whole organization: 565 ms at 300,000 observations. The
record tables also had no `project_id` index, so the reference checks in
`listProjectReferences` scanned both tables.

Scope: `src/core/directory.ts` and one new migration. No change to response
shape, count values, or authorization.

## Design

Both listings now choose the page first. The inner query reads `projects` or
`subjects`, applies the filters, keeps only entries with at least one readable
record (an `EXISTS` probe), orders, and applies `LIMIT`. The outer query then
computes `record_count`, `subject_count`, and `last_write` for those entries
only, with one correlated subquery per entry. Every probe keeps the full
`recordAccessSql` predicate, so no count comes from an unfiltered total.

Migration 31 adds `observations_project (org_id, project_id, ingested_at)` and
`claims_project (org_id, project_id, created_at)`. Subject probes use the
existing `observations_scope` and `claims_scope` indexes. The unscoped row
matches `project_id IS NULL` through the same indexes.

The counts for one entry are read as one JSON value. This keeps the number of
bound parameters in each statement under the D1 limit of 100.

A capped count is out of scope. The count of a very large project still costs
one index range read of that project.

## Acceptance criteria

- **AC-DIR-001 — Event-driven:** When a client calls `GET /v1/projects?limit=10`, Titen shall reach the record tables through index searches only, never through a table scan.
- **AC-DIR-002 — Event-driven:** When a client calls `GET /v1/subjects?limit=10` with a narrow `q`, Titen shall respond in about the same time in an organization of 100,000 observations as in one of 10,000.
- **AC-DIR-003 — Event-driven:** When an entry has records the caller cannot read, Titen shall return the same `record_count`, `subject_count`, and `last_write` as before for that caller, and shall omit entries with no readable record.
- **AC-DIR-004 — Event-driven:** When a client lists project references, Titen shall check for readable records through an index on `(org_id, project_id, ...)`.

## Done conditions

The contract case, the plan guards, and the scale smoke pass. The contract
suite passes on Bun and on the D1 harness.

## Completion evidence

All four acceptance criteria passed. The paired plan maps each to its check.
