---
work_id: level6-dashboard-release-20260816
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-16
updated: 2026-08-16
review_after: 2026-08-30
owner: CADIS
spec: docs/specs/active/2026-08-16-level6-dashboard-release.md
---

# Plan — Level 6 dashboard release

- [x] Inspect repository authority, current runtime contracts, latest mockup,
  generated desktop references, current production metadata, and open issues.
- [x] Add the smallest forward migration and shared authorization predicates
  needed for scoped grants and delegated key targets.
- [x] Add principal/project/subject directories, grant administration and
  simulation, model config/probe, and Atlas workspace graph contracts.
- [x] Extend the loopback adapter with explicit allowlisted reads and mutations
  and adversarial coverage for every new protected operation.
- [x] Rebuild the Astro dashboard as the approved fifteen-area responsive shell
  with live states, no fixture fallback, and no browser-held credential.
- [x] Fix npm root packaging and add installed-tarball route smoke coverage.
- [x] Update architecture, API, deployment, dashboard, design, PRD, changelog,
  and release metadata together with the observable behavior.
- [x] Run targeted tests, full dual-runtime suite, migration checks,
  production-source typecheck, build, package smoke, Playwright
  visual/accessibility checks, and workflow/release checks. The repository-wide
  TypeScript command still reports 102 pre-existing errors confined to archived
  benchmark harnesses and historical test fixtures; no touched production file
  reports an error.
- [ ] Move this spec and plan to `done/` with evidence and no unchecked work.
- [ ] Commit with required attribution, push `main`, publish the verified npm
  tarball, synchronize and deploy `titen-web`, then smoke production or restore
  and verify rollback.

## Pre-release evidence

- `pnpm test:all`: D1 128/128, Bun/vector/SDK 156/156, integration
  230/230, browser 9/9 active with two update-only screenshot cases skipped,
  15-destination live-adapter smoke, and workflow/debt checks passed.
- `bash scripts/verify-pack.sh`: all nine clean-install checks passed for
  `titen-memory-0.8.6.tgz`, including `/`, `/dashboard/`, CLI, MCP, Node SDK,
  and the global Bun executable.
- `pnpm screenshots`: desktop and 320 px references regenerated from v0.8.6;
  the dashboard bundle is 22.9 KiB gzip against the 80 KiB budget.
- `pnpm typecheck`: 102 historical diagnostics remain only in archived
  benchmark harnesses and test fixtures; a filtered run reports zero errors in
  every production file changed by this release.

## Acceptance evidence mapping

- AC-TITEN-DASH-001 through AC-TITEN-DASH-006: Astro/Playwright desktop, mobile,
  keyboard, capability, disconnected, session, mutation, and stale-state tests;
  dashboard bundle check and reviewed screenshots.
- AC-TITEN-DASH-010 through AC-TITEN-DASH-013: browser interaction tests plus adapter
  allowlist/mutation tests against live response shapes.
- AC-TITEN-DASH-020 through AC-TITEN-DASH-022: Bun/SQLite and workerd/D1 contract
  cases for directory references, workspace graph bounds, and cross-grant
  omission.
- AC-TITEN-DASH-030 through AC-TITEN-DASH-032: dual-runtime model diagnostics test,
  masked configuration inspection, probe audit evidence, and canonical row
  count invariance.
- AC-TITEN-DASH-040 through AC-TITEN-DASH-044: migration checks and adversarial
  dual-runtime grant/write/key-clamp tests, including next-request revocation.
- AC-TITEN-DASH-050 through AC-TITEN-DASH-051: installed-tarball route smoke, npm
  integrity/source match, repository checks, `titen-web` revision, production
  health/readiness/dashboard smoke, and rollback proof.

## Rollback

Before publication, revert the isolated release commit. After npm publication,
never overwrite or unpublish the artifact: publish a corrective patch. For
`titen-web`, restore its previously recorded deployment and verify its public
revision/route smoke. Database migration 23 is additive; old binaries ignore
its tables and columns, so rollback does not delete canonical data.
