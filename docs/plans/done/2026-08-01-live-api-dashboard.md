---
work_id: live-api-dashboard
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-01
owner: CADIS
spec: docs/specs/done/2026-08-01-live-api-dashboard.md
---
# Plan

- [x] Replace the browser-safe dashboard API stub with bounded same-origin
  health, readiness, and Atlas calls.
- [x] Expand the existing server adapter to the current read-only Atlas lenses
  while keeping credentials server-only and failures non-disclosing.
- [x] Replace fixture markup with a compact live-state Astro interface and
  accessible responsive styling.
- [x] Update browser, adapter, and real Bun/SQLite smoke coverage for normal,
  empty, loading, denial, failure, isolation, and no-secret paths.
- [x] Update dashboard and VPS deployment documentation.
- [x] Run the focused and repository workflow gates, record evidence, and move
  both artifacts to `done/`.

## Acceptance evidence mapping

- AC-LIVE-001: adapter boundary tests, browser request/storage assertions, and
  production bundle secret scan.
- AC-LIVE-002: browser mocked-live tests plus real Bun/SQLite adapter smoke.
- AC-LIVE-003: browser disconnected/401/403/error assertions and adapter 503
  disconnected/status-preservation tests.
- AC-LIVE-004: browser loading and empty-state assertions.
- AC-LIVE-005: Playwright keyboard/mobile checks and CSS inspection.
- AC-LIVE-006: `pnpm verify:dashboard-live` and adapter integration tests.

## Security, deployment, migration, and rollback

No data migration is required. Deployment adds only the existing loopback
adapter process with server-side `TITEN_API_URL` and `TITEN_API_KEY`; it does
not add a public credential exchange. Rollback serves the headless REST/MCP
service without the optional dashboard, leaving canonical data unchanged.

## Verification evidence

- `pnpm test:browser tests/dashboard.spec.ts`: PASS, 4 Chromium tests covering
  disconnected/no-fixture, live data, loading, empty, 401, 403, keyboard, and
  320-pixel behavior.
- `pnpm test:adapter`: PASS, 14 tests covering static containment, hardened
  headers, disconnected checks, foreign Host/Origin denial, and one explicitly
  allowlisted reverse-proxy origin.
- `pnpm verify:dashboard-live`: PASS against a temporary real Bun/SQLite API;
  health, readiness, four Atlas lenses, and cross-subject exclusion passed.
- `pnpm build`: PASS; Astro emitted the static dashboard and CSS plus JS totaled
  8.3 KiB gzip under the 80 KiB budget.
- `pnpm check:workflow`, `pnpm check:routes`, and `git diff --check`: PASS.
- Desktop 1440 x 1000 and mobile 390 x 844 disconnected states were inspected
  from the built preview; no horizontal overflow or synthetic record appeared.
- No dependency, migration, core route, write control, credential persistence,
  public listener, CI/CD workflow, or production deployment was added.
