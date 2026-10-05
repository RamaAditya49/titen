---
work_id: login-hardening-310-311
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-10-05
updated: 2026-10-05
owner: maintainers
spec: docs/specs/done/2026-10-05-login-hardening.md
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
- [x] Merge verified changes into main.
- [x] Back up the live store and unit paths. Deploy the exact main revision.
- [x] Verify readiness, dashboard, unauthenticated denial, MCP inventory, and authenticated project resolution.
- [x] Record evidence, close issues, and move both artifacts to done.

## Acceptance evidence map

| Acceptance | Verified evidence |
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

## Verification

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

## Production evidence

PR #312 merged as `a11461e22e134e1dcf38409b6cf51e9cf34eddff`.
The VPS deploy runs revision `git-a11461e22e13` from a source release directory.
The package remains 0.10.3. No npm publication or schema migration occurred.

- Both systemd services are active with zero restarts.
- API and public dashboard readiness verify schema 24/24 and the deployed revision.
- The public dashboard renders the recovery button in Chromium.
- Unauthenticated MCP and dashboard session requests return 401.
- Authenticated MCP advertises nine canonical tools and nine compatibility tools.
- Authenticated project resolution returns the existing Titen project identity.
- Actual Bun requests reject raw dot segments and encoded slashes with HTTP 400.
- A temporary host database verifies client isolation, one block audit, and restricted recovery scope.
- Bun 1.3.14 verifies host unlock, host reset, forced rotation, and agent-key preservation.
- The temporary host database is removed after verification. Production operator accounts remain unchanged.
- Trusted ingress forwarding uses CF-Connecting-IP and a loopback-only x-titen-client-ip header.
- The prior source package and verified configuration/database snapshot remain available for rollback.

Existing readiness reports an enrichment job in terminal_error. This state preceded these sign-in changes.
Enrichment activation and npm publication remain outside this delivery.
