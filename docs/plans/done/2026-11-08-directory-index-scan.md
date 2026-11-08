---
work_id: directory-index-scan
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-08
updated: 2026-11-08
owner: maintainers
spec: docs/specs/done/2026-11-08-directory-index-scan.md
---
# Directory index scan plan

Goal: the project and subject directories cost one page of index lookups.

- [x] Add a contract case that pins per-caller counts for three principals over private, team, and organization records. It passes before and after the rewrite.
- [x] Add query-plan guards for both listings and for the reference probes. They fail before the rewrite.
- [x] Add migration 28 with the `observations_project` and `claims_project` indexes.
- [x] Rewrite `listProjects` and `listSubjects` to page first and count per returned entry.
- [x] Add a scale smoke test with 10,000 and 100,000 observations.
- [x] CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-DIR-001 | Plan guards in `tests/integration/query-plan.test.ts`: no `SCAN` of `claims` or `observations`, and a search on the project and subject indexes |
| AC-DIR-002 | `tests/integration/directory-scale.test.ts`: subject page time at 100,000 observations is within twice the 10,000 time |
| AC-DIR-003 | Contract case "directory counts stay per-caller…" on Bun and the D1 harness, unchanged before and after the rewrite |
| AC-DIR-004 | Plan guard "project reference probes use the project index" for `~` and for a project id |

## Rollback

Revert the commit. Migration 28 only adds two indexes, which are harmless if
left in place. The package version bump for schema 28 belongs to the release.

## Verification

`bun test` on the contract, plan, and scale files, `pnpm test:d1`,
`pnpm typecheck:maintained`, `pnpm check:workflow`, and `pnpm check:ponytail`.
The D1 impact (rows read) was not measured on a real Cloudflare database.
