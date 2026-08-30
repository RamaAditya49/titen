---
work_id: dashboard-workspace-picker-fidelity-20260816
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-16
updated: 2026-08-17
owner: CADIS
spec: docs/specs/done/2026-08-16-dashboard-workspace-picker-fidelity.md
---

# Plan — dashboard workspace picker fidelity

- [x] Compare the reported dashboard, current Astro source, live workspace
  contract, and exact approved mockup component.
- [x] Replace only the native sidebar presentation with the mockup-aligned
  accessible trigger/menu while retaining the existing select as request state.
- [x] Add one focused browser regression covering live options, selection,
  request scoping, dismissal, and 320 px usability.
- [x] Run focused tests, build, screenshots, package/workflow checks, and review
  the generated desktop/mobile captures.
- [x] Record the patch in the changelog, commit and push with required
  attribution, publish the verified npm artifact, and update the production
  runtime.
- [x] Synchronize and deploy `titen-web`, smoke both public hostnames and the
  live dashboard, then move this pair to `done/` with release/rollback evidence.

## Acceptance evidence mapping

| Acceptance | Evidence |
| --- | --- |
| AC-TITEN-WS-001 | Desktop screenshot and browser assertions for the icon, two-line label, bordered trigger, and chevron presentation. |
| AC-TITEN-WS-002 | Focused Playwright case for authorized live options, explicit unscoped memory, current checkmark, explanation, selection, outside dismissal, and Escape dismissal. |
| AC-TITEN-WS-003 | Browser request assertions prove Memories and Workspace Graph retain the chosen live `workspace_id` and clear stale results. |
| AC-TITEN-WS-004 | Keyboard/focus assertions, reviewed 320 px screenshot and overflow smoke, no-storage assertion, and source review showing no synthetic workspace data. |
| AC-TITEN-WS-005 | Full suite, exact package smoke, npm/tag/release integrity, deployment-host smoke/backup, and `titen-web` build/deploy/public browser smoke. |

## Verification

- `pnpm test:all`: D1 128/128, Bun/vector/SDK 156/156, integration 230/230,
  browser 10/10 active with three update-only screenshot cases skipped, live
  adapter smoke, workflow self-test, and Ponytail debt checks passed.
- `pnpm screenshots`: desktop, mobile, and Atlas references regenerated and
  reviewed; the selector remains usable without horizontal overflow at 320 px.
- `bash scripts/verify-pack.sh`: all nine clean-install/package checks passed
  for the exact 0.8.7 tarball; npm reports the matching SHA-1 and `gitHead`.
- deployment-host: package/revision `0.8.7`/`npm-0.8.7`, health/readiness/dashboard
  `200`, schema `23/23`, protected route `401`, backup
  `/opt/titen/backups/npm-0.8.7-20260817-080321`.
- `titen-web`: release sync/check, 96-route and 9-tool cross-checks, 63-page
  CSP/navigation build, Cloudflare deployment
  `0838c332-9c8a-4a70-aeec-96f5679f473d`, both public hostnames,
  `/version.json`, `/releases/0.8.7`, release OG, and live desktop/320 px
  browser smoke passed. Previous rollback deployment:
  `e3ac2760-59fb-4a01-94bd-8e2ede08b4b5`.

## Rollback

Before npm publication, revert the focused source commit. After publication,
publish a corrective patch rather than overwriting the immutable artifact. For
the website and runtime, restore their recorded previous versions and repeat
health, readiness, dashboard, protected-route, and public-host smoke checks.
