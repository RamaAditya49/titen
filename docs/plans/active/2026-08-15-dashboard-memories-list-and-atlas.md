---
work_id: dashboard-memories-list-and-atlas
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-08-15
updated: 2026-08-15
review_after: 2026-08-29
owner: titen-maintainers
spec: docs/specs/active/2026-08-15-dashboard-memories-list-and-atlas.md
---

# Plan

1. Add the shared `GET /v1/memories` read path using existing validation, FTS,
   authorization, retention, and claim lifecycle helpers; keep pagination
   keyset-based and bounded.
2. Add the authenticated same-origin adapter proxy and dashboard API client
   types; reject unknown query parameters and preserve upstream errors.
3. Split the dashboard navigation and panels: Memories is a real list/search
   surface; Atlas retains graph/inspector/compile controls and is entered from
   a selected memory. Add truthful loading, empty, error, and disabled states.
4. Add shared Bun/D1 contract coverage, adapter forwarding/validation tests,
   and browser assertions for navigation, list/search/pagination, and Atlas
   handoff.
5. Update API, dashboard, architecture, PRD/release notes, and changelog;
   run route/workflow/build/package gates and close this pair only with evidence.
6. Publish npm, sync the web release, update the configured server using a
   recoverable package backup, restart only the affected service, and smoke
   health/readiness/session/dashboard/list/Atlas routes. Roll back to the
   previous package if the candidate fails before finalizing.

## Acceptance evidence mapping

| Acceptance | Planned evidence |
| --- | --- |
| AC-MA-001 | shared SQL contract on Bun and D1 with private/team/org, retention, and foreign-scope rows |
| AC-MA-002 | FTS search contract with compile/vector disabled and quoted operator input |
| AC-MA-003 | page-size and cursor traversal contract plus browser next/previous checks |
| AC-MA-004 | API validation cases for malformed cursor, limit, and filter |
| AC-MA-005 | dashboard browser list, search, empty, error, and no-compile assertions |
| AC-MA-006 | dashboard browser Atlas handoff and exactly-one active navigation assertion |
| AC-MA-007 | existing readiness/disconnect fixtures extended to list surface |
| AC-MA-008 | D1/Bun contract, worker dry build, adapter test, Astro build, and package smoke |
| AC-MA-009 | registry/version manifest, deployed web/server HTTP smoke, and changelog evidence |

## Security and rollback

No migration or dependency is planned. Query scope is derived from the
principal and all SQL predicates are applied before ranking or pagination. The
release is additive and rolls back by restoring the prior npm package/dashboard
bundle and service revision; canonical memory rows are never rewritten.

