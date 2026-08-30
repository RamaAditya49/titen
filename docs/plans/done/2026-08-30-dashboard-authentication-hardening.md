---
work_id: dashboard-authentication-hardening-20260830
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-30
updated: 2026-08-30
owner: CADIS
spec: docs/specs/done/2026-08-30-dashboard-authentication-hardening.md
---

# Plan — Dashboard authentication hardening

- [x] Record the dependency, staged-session, persistence, and rollback decisions
  in an ADR before production implementation.
- [x] Add failing shared contract tests for persistent throttling, generic
  failures, restart survival, cleanup, staged authority, and runtime edge guards.
- [x] Add failing shared contract tests for WebAuthn configuration, challenge
  expiry, one-time use, account binding, counter updates, and recovery codes.
- [x] Add failing migration tests for schema 24 on Cloudflare D1 and Bun/SQLite.
- [x] Add the additive SQL migration and shared repository operations with
  atomic state transitions and bounded cleanup.
- [x] Add the smallest WebAuthn dependency and a runtime-neutral verification
  boundary. Verify its Cloudflare Worker bundle and Bun execution.
- [x] Implement fixed REST routes, staged session authorization, metadata-only
  auditing, and generic authentication failures.
- [x] Extend the loopback adapter and Astro dashboard with passkey enrollment,
  second-factor completion, credential management, and once-only recovery UI.
- [x] Update the PRD, FRD, design, architecture, threat model, API, dashboard,
  deployment, changelog, and package metadata for observable behavior.
- [x] Run targeted tests, dual-runtime contracts, migration checks, typecheck,
  build, browser tests, package smoke, public-artifact checks, and workflow checks.
- [x] Complete a security-focused self-review because this task does not
  authorize delegated agents. Fix every confirmed critical or high finding.
- [x] Move this pair to `done/` with evidence and no unchecked work.
- [x] Commit and push with required attribution. Publish the exact npm tarball
  and verify registry metadata before any private runtime upgrade.
- [x] Create a private backup, upgrade the target runtime from the published
  package, and verify health, readiness, schema, protected routes, dashboard,
  login controls, data integrity, and rollback readiness.

## Verification mapping

- AC-AUTH-001 through AC-AUTH-006: dual-runtime throttle contract, restart test,
  timing-insensitive response assertions, repository inspection, and edge-guard
  tests.
- AC-AUTH-010 through AC-AUTH-016: configuration validation, real-library
  integration, dual-runtime challenge tests, concurrent replay test, staged-key
  authorization tests, readiness tests, and Cloudflare bundle verification.
- AC-AUTH-020 through AC-AUTH-024: dual-runtime recovery lifecycle tests,
  concurrent one-time-use test, last-credential guard test, and audit redaction
  assertions.
- AC-AUTH-030 through AC-AUTH-033: existing contract suite, MCP and SDK smoke,
  adapter route tests, packed-tarball install smoke, registry integrity check,
  deployed revision check, and runtime smoke or verified rollback.

## Acceptance evidence map

| Acceptance | Verified evidence |
| --- | --- |
| AC-AUTH-001 | Dual-runtime SQL throttle tests and schema inspection |
| AC-AUTH-002 | Progressive delay schedule contract tests |
| AC-AUTH-003 | Active-block tests before password verification |
| AC-AUTH-004 | Successful-login throttle-clear tests |
| AC-AUTH-005 | Generic-response tests and six-attempt runtime smoke |
| AC-AUTH-006 | Edge-guard denial and failure contract tests |
| AC-AUTH-010 | Configuration, readiness, integration, and deployed capability checks |
| AC-AUTH-011 | Bound registration challenge and stored-credential tests |
| AC-AUTH-012 | Dual-runtime staged-session contract tests |
| AC-AUTH-013 | Central staged-route authorization tests |
| AC-AUTH-014 | Assertion verification and atomic counter tests |
| AC-AUTH-015 | Expiry, replay, purpose, and cross-account challenge tests |
| AC-AUTH-016 | Partial and unsafe configuration readiness tests |
| AC-AUTH-020 | First-enrollment recovery generation and hash-only tests |
| AC-AUTH-021 | Concurrent one-time recovery consumption tests |
| AC-AUTH-022 | Recovery regeneration invalidation tests |
| AC-AUTH-023 | Last-passkey password confirmation tests |
| AC-AUTH-024 | Metadata-only security audit assertions |
| AC-AUTH-030 | Existing API, MCP, SDK, and disabled-feature contract suites |
| AC-AUTH-031 | Complete D1 and Bun/SQLite contract suites |
| AC-AUTH-032 | Fixed adapter route tests and live adapter smoke |
| AC-AUTH-033 | npm metadata, exact deployed revision, backup, and rollback checks |

## Rollback

Migration 24 is additive. An older binary ignores its tables and staged-session
column. Before deployment, preserve the database and service configuration.
After npm publication, publish a corrective patch instead of changing the
published artifact. If the runtime smoke fails, restore the prior package and
database snapshot, then verify health, readiness, protected routes, and data
counts.

## Candidate evidence

- `pnpm test:all` passed: 129 D1 tests, 157 Bun/vector/SDK tests, 241
  integration tests, dashboard live smoke, and 18 browser tests with 5
  intentional screenshot skips.
- The real browser WebAuthn ceremony passed with a Chromium virtual
  authenticator.
- `bash scripts/verify-pack.sh` passed all nine package checks for
  `titen-memory@0.10.0`.
- The Worker dry build is 1,388.39 KiB before gzip and 270.25 KiB after gzip.
- The dashboard bundle is 30.0 KiB after gzip against its 80 KiB budget.
- Global `pnpm typecheck` retains existing repository debt. Its output contains
  no error in a file changed by this work. SDK declaration checks pass in the
  package gate.

## Release evidence

- npm `latest` resolves to `titen-memory@0.10.0`. Its `gitHead` is
  `aa709647365d2304ce0a62f451850981dd31d2d5`, and its registry shasum is
  `3c07fe4ea669d1506e6e8031e549c0c4c9767529`.
- Annotated tag `v0.10.0` and the non-draft GitHub Release resolve to the same
  source commit.
- The public release site reports `0.10.0`. Its release page and homepage pass
  HTTP smoke checks on both product hostnames.
- A private Bun deployment installed the published package after a verified
  backup. It reports revision `npm-0.10.0`, schema 24, and enabled WebAuthn.
- The private deployment preserved throttle state across restart. Database
  integrity, protected routes, the dashboard adapter, public MCP auth, service
  logs, and rollback snapshot verification passed.
