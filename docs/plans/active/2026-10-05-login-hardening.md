---
work_id: login-hardening-310-311
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-10-05
updated: 2026-10-05
review_after: 2026-10-19
owner: maintainers
spec: docs/specs/active/2026-10-05-login-hardening.md
---
# Dashboard sign-in implementation plan

Use executing-plans and test-driven-development. Work in the isolated login-hardening checkout.

- [x] Add failing client-isolation, capacity, concurrency, path, and CLI recovery tests.
- [x] Implement shared guards, transactional session authority checks, and persistent account/client buckets.
- [x] Bind Bun socket identity and loopback proxy configuration.
- [x] Add restricted recovery sessions through existing proof validation.
- [x] Add account CLI commands, forced rotation, and session revocation.
- [x] Add shared Bun/D1 sign-in and recovery contracts.
- [x] Add dashboard recovery controls, attempt notices, and adapter/browser tests.
- [x] Update API, VPS, and changelog text. Check route and workflow documents.
- [x] Review PR #307 and run frozen install, build, browser, and type checks.
- [x] Run all manual gates and review the security diff.
- [ ] Merge verified changes into main.
- [ ] Back up the live store and unit paths. Deploy the exact main revision.
- [ ] Verify readiness, dashboard, unauthenticated denial, MCP inventory, and authenticated project resolution.
- [ ] Record evidence, close issues, and move both artifacts to done.

## Acceptance evidence map

| Acceptance | Planned verification |
| --- | --- |
| AC-LOGIN-001 | Shared client A block and client B success contract |
| AC-LOGIN-002 | Shared seeded account ceiling contract |
| AC-LOGIN-003 | Shared capacity admission preserves active rows |
| AC-LOGIN-004 | Full-capacity rejection contract |
| AC-LOGIN-005 | Real Bun listener client-limit test |
| AC-LOGIN-006 | Concurrent sign-in test with configured limit one |
| AC-LOGIN-007 | Raw-path core and Bun HTTP tests |
| AC-LOGIN-008 | Shared passkey/recovery tests during password blocks |
| AC-LOGIN-009 | Invalid, cross-account, disabled, replay, and expiry tests |
| AC-LOGIN-010 | Block audit count and metadata assertions |
| AC-LOGIN-011 | API count, adapter projection, and browser notice |
| AC-LOGIN-012 | CLI unlock test with another account |
| AC-LOGIN-013 | CLI reset, session revocation, and forced rotation |
| AC-LOGIN-014 | CLI list and missing-store denial |
| AC-LOGIN-015 | Bun and real workerd/D1 contract suites |

## Rollout

Run every pnpm test:all gate and pnpm check:routes. Do not enable GitHub Actions.
Prepare a source directory with built dashboard assets and runtime dependencies.
Save a verified SQLite backup and prior unit configuration before restarting services.
If smoke fails, restore prior service paths and verify the restored revision.

## Pre-deployment evidence

- Type checks pass, including four frozen historical files and six expected diagnostics.
- Integration: 263 pass. Bun contracts, vectors, and SDK: 158 pass.
- D1 harness: 9 pass. Real workerd/D1 contracts: 131 pass.
- Browser: 19 pass. Five optional screenshot tests remain skipped by design.
- The live adapter verifies fifteen destinations, forced password changes, atomic user creation, and federation.
- Dashboard, Worker, and SDK builds pass. Route, workflow, public-artifact, and debt-ledger checks pass.
- Review found and fixed three reset/session races, concurrent audit duplication, and Worker guard lifetime.
- Regression tests fail with the previous behavior and pass with these guards.
- PR #307 merged Astro 7.2.8 after frozen installation, type checks, build, and browser checks.
- Verified backup: `/var/backups/titen/login-hardening-20261005T020053Z`.
