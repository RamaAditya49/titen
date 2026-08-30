---
work_id: dashboard-authentication-hardening-20260830
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-08-30
updated: 2026-08-30
review_after: 2026-09-13
owner: CADIS
spec: docs/specs/active/2026-08-30-dashboard-authentication-hardening.md
---

# Plan — Dashboard authentication hardening

- [ ] Record the dependency, staged-session, persistence, and rollback decisions
  in an ADR before production implementation.
- [ ] Add failing shared contract tests for persistent throttling, generic
  failures, restart survival, cleanup, staged authority, and runtime edge guards.
- [ ] Add failing shared contract tests for WebAuthn configuration, challenge
  expiry, one-time use, account binding, counter updates, and recovery codes.
- [ ] Add failing migration tests for schema 24 on Cloudflare D1 and Bun/SQLite.
- [ ] Add the additive SQL migration and shared repository operations with
  atomic state transitions and bounded cleanup.
- [ ] Add the smallest WebAuthn dependency and a runtime-neutral verification
  boundary. Verify its Cloudflare Worker bundle and Bun execution.
- [ ] Implement fixed REST routes, staged session authorization, metadata-only
  auditing, and generic authentication failures.
- [ ] Extend the loopback adapter and Astro dashboard with passkey enrollment,
  second-factor completion, credential management, and once-only recovery UI.
- [ ] Update the PRD, FRD, design, architecture, threat model, API, dashboard,
  deployment, changelog, and package metadata for observable behavior.
- [ ] Run targeted tests, dual-runtime contracts, migration checks, typecheck,
  build, browser tests, package smoke, public-artifact checks, and workflow checks.
- [ ] Complete a security-focused self-review because this task does not
  authorize delegated agents. Fix every confirmed critical or high finding.
- [ ] Move this pair to `done/` with evidence and no unchecked work.
- [ ] Commit and push with required attribution. Publish the exact npm tarball
  and verify registry metadata before any private runtime upgrade.
- [ ] Create a private backup, upgrade the target runtime from the published
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

## Rollback

Migration 24 is additive. An older binary ignores its tables and staged-session
column. Before deployment, preserve the database and service configuration.
After npm publication, publish a corrective patch instead of changing the
published artifact. If the runtime smoke fails, restore the prior package and
database snapshot, then verify health, readiness, protected routes, and data
counts.
