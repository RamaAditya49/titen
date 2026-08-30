---
work_id: dashboard-memories-list-and-atlas
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-15
updated: 2026-08-15
owner: titen-maintainers
spec: docs/specs/done/2026-08-15-dashboard-memories-list-and-atlas.md
---

# Plan

- [x] Add the shared `GET /v1/memories` read path using existing validation, FTS,
   authorization, retention, and claim lifecycle helpers; keep pagination
   keyset-based and bounded.
- [x] Add the authenticated same-origin adapter proxy and dashboard API client
   types; reject unknown query parameters and preserve upstream errors.
- [x] Split the dashboard navigation and panels: Memories is a real list/search
   surface; Atlas retains graph/inspector/compile controls and is entered from
   a selected memory. Add truthful loading, empty, error, and disabled states.
- [x] Add shared Bun/D1 contract coverage, adapter forwarding/validation tests,
   and browser assertions for navigation, list/search/pagination, and Atlas
   handoff.
- [x] Update API, dashboard, architecture, PRD/release notes, and changelog;
   run route/workflow/build/package gates and close this pair only with evidence.
- [x] Publish npm, sync the web release, update the configured server using a
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

## Acceptance evidence

| Acceptance | Result |
| --- | --- |
| AC-MA-001 | Bun/D1 contract passes private, team, organization, retention, and foreign-scope cases. |
| AC-MA-002 | Bounded quoted FTS search passes with compile/vector disabled. |
| AC-MA-003 | Limit and opaque `(created_at,id)` cursor traversal passes without offset drift. |
| AC-MA-004 | Malformed cursor, limit, filters, and scope return bounded validation errors. |
| AC-MA-005 | Browser suite covers real list, search, empty/error/loading, pagination, and no-compile entry. |
| AC-MA-006 | Browser suite verifies Open in Atlas activates only Atlas and preserves the inspector handoff. |
| AC-MA-007 | Readiness/disconnect and adapter tests keep unavailable states truthful; no synthetic rows/counts. |
| AC-MA-008 | Shared core, Bun, D1, adapter, Astro build, and package smoke pass. |
| AC-MA-009 | npm, GitHub release, web manifest/deploy, server revision, and changelog all report 0.8.4. |

## Verification

- `pnpm test:all`: D1 126, Bun/vector/SDK 154, integration 229, dashboard live verification, and browser 9 passed (2 screenshot tests skipped).
- Adapter suite: 16 passed; `node scripts/check-route-docs.mjs`: 85 routes; `node scripts/check-workflow-docs.mjs` and self-test passed.
- `pnpm check`, `pnpm build`, and `pnpm release:sync 0.8.4 --check` passed in titen-web (two existing prose warnings only).
- npm registry latest is `0.8.4`; `titen.dev` and `www.titen.dev` serve version manifest `0.8.4` from Worker version `a6ecb042-94b9-4e49-82ed-142ae79334f3`.
- deployment-host package is `0.8.4`, services are active, `/healthz` is 200 with revision `npm-0.8.4`, `/readyz` is ready with schema 22/22, dashboard is 200, and unauthenticated Memories is 401.
