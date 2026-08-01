---
work_id: dashboard-product-map-session-release
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-01
updated: 2026-08-01
review_after: 2026-08-15
owner: CADIS
spec: docs/specs/active/2026-08-01-dashboard-product-map-session-release.md
---
# Plan

- [x] Audit the implemented REST contracts, scope/role boundaries, current
  dashboard adapter, release policy, and official private-ingress guidance.
- [x] Add authenticated principal introspection and atomic human-user
  provisioning by reusing the existing key, membership, validation, audit, and
  transaction primitives.
- [x] Add bounded in-process dashboard sessions plus exact allowlisted proxies
  for Memories, Context, Work, Audit, Governance, and Federation.
- [x] Convert the six product-map labels into capability-gated live controls,
  add login/logout and add-user interaction, and preserve accessible failure and
  no-storage behavior.
- [x] Update PRD, DESIGN, API, dashboard, VPS, release discovery, and dedicated
  Tailscale Serve and Cloudflare Tunnel tutorials.
- [x] Run focused and full local security, contract, integration, browser,
  package, route, dependency, bundle, and workflow gates.
- [ ] Build and deploy the exact candidate container on `rama-tuf`, preserve a
  rollback target, and run authenticated six-area, add-user, denial, restart,
  persistence, and exposure smokes.
- [ ] Prepare and publish the stable npm package, annotated tag, generated
  GitHub Release, and deterministic titen.dev discovery update without GitHub
  Actions.
- [ ] Close completed issues/PRs, remove merged remote branches and disposable
  worktrees, record reproducible evidence, and move both workflow artifacts to
  `done/`.

## Acceptance evidence mapping

- AC-DPM-001, AC-DPM-002, AC-DPM-003: adapter and Playwright product-area
  tests plus real Bun/SQLite live-dashboard verification.
- AC-DPM-004, AC-DPM-005, AC-DPM-006: adapter session security tests covering
  cookie attributes, exact Origin/Host, clear-text remote denial, revocation,
  expiry, logout, restart, body bounds, and no credential reflection/storage.
- AC-DPM-007: shared D1 and Bun contract cases for `GET /v1/principal`, including
  invalid, expired, and revoked keys.
- AC-DPM-008, AC-DPM-009: shared D1 and Bun contract cases proving atomic user
  creation, one-time key use, active membership, role/scope non-escalation,
  duplicate rollback, and cross-organization isolation.
- AC-DPM-010: legacy server-key adapter regression and headless API suites.
- AC-DPM-011: browser keyboard/mobile/storage assertions, Astro build, bundle
  check, and dependency/package inspection.
- AC-DPM-012: copyable-command review against current official Tailscale and
  Cloudflare documentation plus local config validation and rollback probes.
- AC-DPM-013: exact-image `rama-tuf` readiness, session, area, user, denial,
  restart, persistence, loopback, resource, backup, and rollback evidence.
- AC-DPM-014: npm metadata and clean install, package shasum/integrity, Git/tag/
  release/revision equality, deployed image label, and dual-host website smokes.
- AC-DPM-015: workflow checker, GitHub issue/PR/branch queries, clean release
  worktrees, and final terminal artifacts.

## Security, migration, deployment, and rollback

No SQL migration or dependency is planned. New API operations use existing
tables and one transaction. Dashboard sessions are opt-in, process-local, and
invalidated by restart; canonical API keys remain hashed in SQL and raw keys
remain only in the operator and active adapter memory. Deploy one exact image
to the existing rootless `rama-tuf` units after a verified snapshot and retain
the prior image and data snapshot. Rollback restores the prior unit/image and,
only if canonical migration or data integrity requires it, the verified
snapshot. Tailscale and Cloudflare Tunnel mappings can be removed independently
without changing Titen data. Publication remains manual; no GitHub Actions file
or hosted release gate is permitted.

## Verification evidence

- `pnpm test:d1`: 107/107 Cloudflare D1/workerd contract tests pass. One combined
  run hit the existing 60-second semantic-readiness timing ceiling and caused a
  dependent `503`; the clean isolated rerun passed both tests and the full lane.
- `bun test tests/contract/bun-sqlite.test.ts tests/contract/vectors.test.ts tests/sdk`:
  131/131 pass, including principal introspection, atomic Add User, hard list
  caps, SDK lens parity, and SDK Add User fields.
- `pnpm test:integration`: 188/188 pass. Focused adapter/session execution is
  21/21 and also passes concurrently with the browser suite.
- `pnpm verify:dashboard-live`: real Bun/SQLite login, all six areas, Add User,
  new-user login, federation, and logout pass through the real adapter.
- `PLAYWRIGHT_PORT=44899 pnpm test`: 5 browser tests pass and 2 documentation
  capture tests are intentionally skipped; `pnpm screenshots` passes 2/2.
- `pnpm build`: dashboard JavaScript plus CSS is 11.9 KiB gzip against the 80
  KiB budget. `bash scripts/verify-pack.sh` passes 9/9 for
  `titen-memory-0.5.2.tgz`.
- `pnpm check:workflow`, `pnpm check:routes`, and `git diff --check` pass with 68
  workflow artifacts, 79 routes, and 20 tracked Ponytail markers.
- Official Tailscale Serve/Linux-operator/grants/container and Cloudflare
  Tunnel/Access/service-token sources are linked directly from
  `docs/deployment/secure-ingress.md`; no GitHub Actions workflow was added.

Deployment, publication, titen.dev, GitHub cleanup, and terminal workflow
evidence remain pending.
