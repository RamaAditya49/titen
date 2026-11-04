---
work_id: memories-validity-facets
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-03
updated: 2026-11-03
owner: maintainers
spec: docs/specs/done/2026-11-03-memories-validity-facets.md
---
# Memories validity and facets plan

Goal: one predicate decides what the memories list can show, and facets count
exactly that.

- [x] Add a failing contract case with a current, an ended, and a future active claim.
- [x] Build a shared scope predicate (org, subject, project, workspace, visibility, per-row validity, FTS, access).
- [x] Derive items from scope plus status, kind, and cursor; derive facets from scope alone.
- [x] Document the validity rule and `facets` in the API reference; update CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-MEM-001 | Contract case "memories apply each claim's validity window per row…": default and `status=active` list one item and `facets.status.active` is 1; on main facets reported 3 |
| AC-MEM-002 | Same case: `status=active,superseded` lists only the current claim, excluding the ended and future claims |
| AC-MEM-003 | `src/core/memories.ts`: items use `[...scope, status, kind, cursor]`, facets use `scope` |
| AC-MEM-004 | Facets never read `after`; the case asserts the `limit=1` page reports the same facets as the full list |
| AC-MEM-005 | Existing "memories lists authorized claims with lexical search and keyset pagination" passes unchanged on both runtimes |

## Rollback

Revert the commit. No schema or stored data changes.

## Verification

Bun/SQLite and the D1 contract harness after `pnpm build:worker`. No real
Cloudflare or VPS deployment was exercised.
