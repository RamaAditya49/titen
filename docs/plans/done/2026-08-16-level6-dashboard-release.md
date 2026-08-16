---
work_id: level6-dashboard-release-20260816
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-16
updated: 2026-08-16
owner: CADIS
spec: docs/specs/done/2026-08-16-level6-dashboard-release.md
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
- [x] Move this spec and plan to `done/` with evidence and no unchecked work.
- [x] Commit with required attribution, push `main`, publish the verified npm
  tarball, synchronize and deploy `titen-web`, then smoke production or restore
  and verify rollback.

## Verification

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

- AC-TITEN-DASH-001, AC-TITEN-DASH-002, AC-TITEN-DASH-003,
  AC-TITEN-DASH-004, AC-TITEN-DASH-005, and AC-TITEN-DASH-006:
  Astro/Playwright desktop, mobile, keyboard, capability, disconnected,
  session, mutation, and stale-state tests; dashboard bundle check and reviewed
  screenshots.
- AC-TITEN-DASH-010, AC-TITEN-DASH-011, AC-TITEN-DASH-012, and
  AC-TITEN-DASH-013: browser interaction tests plus adapter allowlist/mutation
  tests against live response shapes.
- AC-TITEN-DASH-020, AC-TITEN-DASH-021, and AC-TITEN-DASH-022: Bun/SQLite and
  workerd/D1 contract cases for directory references, workspace graph bounds,
  and cross-grant omission.
- AC-TITEN-DASH-030, AC-TITEN-DASH-031, and AC-TITEN-DASH-032: dual-runtime
  model diagnostics test, masked configuration inspection, probe audit
  evidence, and canonical row count invariance.
- AC-TITEN-DASH-040, AC-TITEN-DASH-041, AC-TITEN-DASH-042,
  AC-TITEN-DASH-043, and AC-TITEN-DASH-044: migration checks and adversarial
  dual-runtime grant/write/key-clamp tests, including next-request revocation.
- AC-TITEN-DASH-050 and AC-TITEN-DASH-051: installed-tarball route smoke, npm
  integrity/source match, repository checks, `titen-web` revision, production
  health/readiness/dashboard smoke, and rollback proof.

## Rollback

Before publication, revert the isolated release commit. After npm publication,
never overwrite or unpublish the artifact: publish a corrective patch. For
`titen-web`, restore its previously recorded deployment and verify its public
revision/route smoke. Database migration 23 is additive; old binaries ignore
its tables and columns, so rollback does not delete canonical data.

## Release evidence

- npm `titen-memory@0.8.6`: published 2026-08-16 with SHA-1
  `ec64df80d4ab252f7ec16561a598ed7ee480fab3`, SHA-512 integrity recorded by
  the registry, and `gitHead` `261919af3129b011d1f771ab6e722ec3c48a861b`.
- GitHub release `v0.8.6`: stable, non-draft, non-prerelease, generated from
  the canonical changelog and attached to the same commit.
- Production Worker: version `cc41813e-0ce3-40fb-ae97-50ffcb959dae`, revision
  `261919af3129b011d1f771ab6e722ec3c48a861b`, health/readiness 200, schema
  23/23, migration lock off. D1 Time Travel bookmark before migration:
  `00000045-00000ee8-000050c9-e38b4033bc5a20100a08850d4988ff84`.
- Production website: commit `214c76cc49cf4a924a765840cb2540641c073537`,
  Cloudflare version `e3ac2760-59fb-4a01-94bd-8e2ede08b4b5`; previous website
  rollback version `d6dbbfba-21d4-4820-afde-1551462c7598` remains recorded.
  `titen.dev`, `www.titen.dev`, `/version.json`, `/releases/0.8.6`, and current
  API/access documentation all returned HTTP 200 with 0.8.6 content.
- GitHub issues #303 and #304 are closed and the open issue list is empty.
