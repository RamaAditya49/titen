---
work_id: dashboard-mockup-fidelity-live
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-15
updated: 2026-08-15
review_after: 2026-08-29
owner: titen-maintainers
spec: docs/specs/active/2026-08-15-dashboard-mockup-fidelity.md
---

# Plan: live dashboard mockup fidelity

- [ ] Audit the approved mockup and current rendered dashboard in a private
  temporary directory; record no credentials or private assets in the repo.
- [ ] Replace the dashboard shell markup/styles with the smallest local SVG and
  CSS composition that matches the mockup while keeping existing data selectors.
- [ ] Add live Atlas topology rendering and accessible graph/list/inspector
  synchronization without adding dependencies or API routes.
- [ ] Verify desktop, mobile, disconnected, empty, error, lens, login, and all
  six area flows through the existing browser/adapter tests.
- [ ] Run build, bundle, type/workflow checks, and inspect local screenshots.
- [ ] Commit with the required CADIS trailer, push, publish the npm package,
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

## Rollback

Revert the single release commit and restore the previous npm/server revision;
no migration or canonical data mutation is included.
