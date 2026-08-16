---
work_id: dashboard-workspace-picker-fidelity-20260816
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-16
updated: 2026-08-16
review_after: 2026-08-23
owner: CADIS
spec: docs/specs/active/2026-08-16-dashboard-workspace-picker-fidelity.md
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
- [ ] Record the patch in the changelog, commit and push with required
  attribution, publish the verified npm artifact, and update the production
  runtime.
- [ ] Synchronize and deploy `titen-web`, smoke both public hostnames and the
  live dashboard, then move this pair to `done/` with release/rollback evidence.

## Rollback

Before npm publication, revert the focused source commit. After publication,
publish a corrective patch rather than overwriting the immutable artifact. For
the website and runtime, restore their recorded previous versions and repeat
health, readiness, dashboard, protected-route, and public-host smoke checks.
