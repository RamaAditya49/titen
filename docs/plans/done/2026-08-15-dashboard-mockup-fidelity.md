---
work_id: dashboard-mockup-fidelity-live
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-15
updated: 2026-08-15
owner: titen-maintainers
spec: docs/specs/done/2026-08-15-dashboard-mockup-fidelity.md
---

# Plan: live dashboard mockup fidelity

- [x] Audit the approved mockup and current rendered dashboard in a private
  temporary directory; record no credentials or private assets in the repo.
- [x] Replace the dashboard shell markup/styles with the smallest local SVG and
  CSS composition that matches the mockup while keeping existing data selectors.
- [x] Add live Atlas topology rendering and accessible graph/list/inspector
  synchronization without adding dependencies or API routes.
- [x] Wire every visible rail item to an existing live destination or
  authenticated status/policy view without adding API routes.
- [x] Add a private Profile/password-change destination and make alias
  selection exclusive.
- [x] Verify desktop, mobile, disconnected, empty, error, lens, login, and all
  six area flows through the existing browser/adapter tests.
- [x] Run build, bundle, workflow checks, and inspect local screenshots; record
  the unrelated repository-wide `pnpm typecheck` baseline failure.
- [x] Commit with the required CADIS trailer, push, publish the npm package,
  update server-wulan, and smoke/rollback-check the deployed dashboard.

## Acceptance evidence map

| Acceptance | Evidence |
| --- | --- |
| AC-DMF-001 | 1600px screenshot and browser shell assertions |
| AC-DMF-002 | Live Atlas browser test asserting SVG nodes, edges, list, inspector |
| AC-DMF-003 | Existing dashboard adapter/API/session suite and no-storage assertion |
| AC-DMF-004 | Existing mobile suite plus overflow/graph scroll assertions |
| AC-DMF-005 | Existing disconnected/error/empty tests and stale-state clearing |
| AC-DMF-006 | Build bundle gate, local asset inspection, no external request assertion |
| AC-DMF-007 | Existing lens/navigation/record interaction tests and focus assertions |
| AC-DMF-008 | Browser assertions for Memories, System, Access, and Releases destinations |
| AC-DMF-009 | Browser assertions for exclusive selection and profile/password flow |

## Rollback

Revert the single release commit and restore the previous npm/server revision;
no migration or canonical data mutation is included.

Implemented release commits: `138076b`, `1199e0d`, `718bb29`.
Server rollback artifacts include the latest dashboard bundle backup under
`/opt/titen/backups/dashboard-dist-20260815T015505Z.tgz`, package backup
`/opt/titen/backups/app-package-20260815T013743Z`, and service backup
`/opt/titen/backups/titen-service-20260815T013821Z.service`.

## Completion evidence

The paired spec contains the full acceptance evidence. The only unresolved
production signal is the upstream semantic readiness condition; the dashboard
now displays it instead of pretending the service is ready or hiding live data.

## Verification

`pnpm test:all`, `pnpm build`, the live dashboard smoke, npm package inspection,
web production smoke, and `node scripts/check-workflow-docs.mjs` passed. The
repository-wide `pnpm typecheck` remains a documented pre-existing baseline
failure outside this dashboard change.
