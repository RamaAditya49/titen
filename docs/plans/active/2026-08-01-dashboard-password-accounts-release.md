---
work_id: dashboard-password-accounts-release
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-01
updated: 2026-08-01
review_after: 2026-08-15
owner: CADIS
spec: docs/specs/active/2026-08-01-dashboard-password-accounts-release.md
---
# Plan

- [x] Audit the API-key session, membership and role authority, shared database
  contract, dashboard adapter, and dual-runtime cryptographic capabilities.
- [x] Add schema 20 and the smallest shared password/account module using Web
  Crypto PBKDF2 without a dependency.
- [x] Add bootstrap owner creation, authenticated account administration,
  first-login password replacement, password login, current-session revocation,
  fixed adapter routes, and compatibility-preserving API inventory.
- [x] Replace dashboard API-key login and Add User output with labeled username,
  password, and role interaction while keeping the private shell hidden.
- [x] Update PRD, architecture, API, dashboard, deployment, and release notes.
- [ ] Run focused adversarial, shared D1/Bun, integration, browser, live adapter,
  build, package, route, dependency, and workflow checks.
- [ ] Build the exact container, take a verified production backup, run a
  disposable restore canary, activate it on `rama-tuf`, and prove rollback.
- [ ] Publish npm, annotated Git tag, GitHub Release, and titen.dev discovery
  manually; close repository and workflow hygiene; terminalize this pair.

## Acceptance evidence mapping

- AC-DPA-001, AC-DPA-003, AC-DPA-006: shared account contract tests and adapter
  integration tests for valid/invalid login, generic failure, bounded attempts,
  ephemeral credential expiry, logout revocation, cookie, and restart behavior.
- AC-DPA-002: deterministic hash-format tests, unique-salt tests, source/package
  secret scans, and D1/Bun verification timing smoke.
- AC-DPA-004, AC-DPA-005, AC-DPA-007: dual-runtime atomic account tests covering
  role/scope/trust authority, duplicate rollback, and cross-organization denial.
- AC-DPA-008: existing API, MCP, SDK, CLI, server-key adapter, and package suites.
- AC-DPA-009: Playwright login/Add User accessibility, storage, DOM, responsive,
  and private-shell assertions plus the existing bundle gate.
- AC-DPA-010: full D1 and Bun contract suites, migration verification, integration
  suite, and real live-dashboard verifier.
- AC-DPA-011: checksum-matched exact-image backup/restore canary and production
  readiness, auth, six-area, denial, restart, listener, image-label, and rollback
  evidence on `rama-tuf`.
- AC-DPA-012: npm metadata and clean install, tag/release/revision equality,
  deployed image label, manual titen-web sync/deploy, and dual-host HTTP smokes.
- AC-DPA-013: workflow checker plus GitHub issue, PR, branch, Actions, worktree,
  and clean-release-tree evidence.
- AC-DPA-014, AC-DPA-015: CLI/integration/browser tests proving one-time random
  bootstrap and Add User passwords, restricted first-login UI/API authority,
  password replacement, session revocation, and fresh-login scope restoration.

## Security, migration, deployment, and rollback

Schema 20 adds only the canonical operator-account table. It does not alter or
delete existing keys, memberships, or evidence. Password work uses Web Crypto
available on both runtimes and stores its algorithm/work factor in the verifier.
The adapter keeps one short-lived API key only in process memory. Before
production migration, create an owner account through the existing root key,
take an online SQLite backup, restore it into a disposable volume, and run the
exact image. Rollback restores the prior units/image; restore the snapshot only
if schema/data integrity requires it. Publication remains manual and irreversible;
GitHub Actions stays disabled.
