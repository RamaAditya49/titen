---
work_id: golden-path-live-dashboard
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: Wulan
spec: docs/specs/done/2026-07-30-golden-path-live-dashboard.md
---
# Plan

- [x] Extend the public SDK only for merged coordination and Atlas operations.
- [x] Add the real-service golden path and prerequisite/run documentation.
- [x] Replace browser-visible credential configuration with a strict same-origin Bun adapter and explicit dashboard modes.
- [x] Add SDK/unit and browser mock coverage, preserving non-interactive unavailable areas.
- [x] Run the real golden path, adapter boundary, live dashboard, dual-runtime, browser, build, workflow, and package gates.
- [x] Record independent evidence and move this pair to done.

## Acceptance evidence mapping
- AC-GP-001: golden path source, SDK tests, real local smoke.
- AC-GP-002: missing-config execution test.
- AC-GP-003: example/docs inspection.
- AC-DASH-001: adapter tests, bundle secret scan.
- AC-DASH-002: default browser suite.
- AC-DASH-003: adapter and browser error mocks.
- AC-DASH-004: existing and updated browser assertions.
- AC-DASH-005: Playwright mocked same-origin tests.

## Security, deployment, rollback
Validate exact lens and bounded subject/limit; use fixed upstream route; never forward client auth; suppress upstream bodies. No migration or deployment change. Rollback removes the optional adapter/example and returns dashboard to explicit fixture-only mode without canonical-data impact.

## Verification evidence

- `PLAYWRIGHT_PORT=4499 pnpm test:all`: PASS.
- Worker dry-run plus Bun/SQLite and workerd/D1 API/SDK contracts: 135 pass, 0 fail.
- Integration suite: 41 pass, 0 fail, including the public golden-path process with four scoped principals and adapter traversal/symlink/Host/Origin denial cases.
- `pnpm verify:dashboard-live`: PASS against a real Bun/SQLite upstream through the loopback adapter; the requested subject was returned and the other subject was excluded.
- Astro/browser gate: 10 Chromium tests pass; the fixture disclosure remains visible at 320, 390, and 768 px; bundle is 10.4 KiB gzip under the 80 KiB budget.
- Workflow checker and self-test: PASS for 18 artifacts.
- `pnpm pack --dry-run`: PASS for `titen-memory@0.1.1`; package builds the Node SDK tarball without exposing runtime keys.
- `git diff --check origin/main...HEAD`: PASS.
- No CI/CD, migration, queue, external deployment, or shared reverse-proxy authentication layer was added.
