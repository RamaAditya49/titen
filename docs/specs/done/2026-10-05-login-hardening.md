---
work_id: login-hardening-310-311
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-10-05
updated: 2026-10-05
owner: maintainers
---
# Dashboard sign-in protection and recovery

Issues: #310 and #311. Rama authorized issue fixes, PR merges, deployment, and runtime verification.

## Design and scope

Use existing SQL and Web APIs. Add no dependency or schema migration.
Keep the legacy account hash. Add client bucket keys with an account-hash prefix.
Keep five failures per client and a higher account limit of 50 within 15 minutes.
Preserve active blocks. Reserve capacity before password work. Bound storage to 4096 live buckets.
Limit Bun clients to 20 attempts per minute. Permit four concurrent sign-in password checks without a queue.
Use socket addresses. Trust configured client headers only through a loopback proxy.
Reject ambiguous raw paths with Bun native route parameters before URL normalization. Keep the shared pre-parse guard for other transports.
Issue password-independent recovery sessions with no data scopes. Require passkey or recovery-code proof before access.
Return the same recovery envelope for unknown accounts. Preserve mandatory password changes after recovery.
Add host account list, unlock, and reset-password commands. Do not enable disabled accounts or revoke agent keys.
Write metadata-only block audits. Show failed-attempt counts in a separate notice after authentication.
Update API, VPS, dashboard, and changelog documentation. Review PR #307 separately.
The NAEOS comment proposes interoperability outside these fixes. npm publication remains a separate deliberate release.

## Acceptance criteria

- **AC-LOGIN-001 — Event-driven:** When client A reaches five failures, Titen shall permit client B to verify the same password.
- **AC-LOGIN-002 — State-driven:** While account failures reach 50 across clients, Titen shall block password sign-in across clients.
- **AC-LOGIN-003 — State-driven:** While throttle storage contains active blocks, Titen shall preserve those blocks during admission.
- **AC-LOGIN-004 — Unwanted behavior:** If storage contains 4096 live buckets, then Titen shall return HTTP 429 before password verification.
- **AC-LOGIN-005 — Event-driven:** When a Bun client exceeds 20 attempts per minute, Titen shall return HTTP 429.
- **AC-LOGIN-006 — State-driven:** While four sign-in password checks run, Titen shall reject additional checks with HTTP 429.
- **AC-LOGIN-007 — Unwanted behavior:** If a raw path contains dot segments or encoded separators, then Titen shall return HTTP 400.
- **AC-LOGIN-008 — State-driven:** While password sign-in is blocked, Titen shall permit valid passkey or recovery-code authentication.
- **AC-LOGIN-009 — Unwanted behavior:** If recovery proof is invalid, disabled, replayed, expired, or cross-account, then Titen shall deny access.
- **AC-LOGIN-010 — Event-driven:** When a password bucket becomes blocked, Titen shall write one metadata-only audit event per transition.
- **AC-LOGIN-011 — Event-driven:** When authentication succeeds, Titen shall show the preceding account failed-attempt count.
- **AC-LOGIN-012 — Event-driven:** When a host operator unlocks an account, Titen shall clear only that account's throttle rows.
- **AC-LOGIN-013 — Event-driven:** When a host operator resets a password, Titen shall issue a temporary password and require replacement.
- **AC-LOGIN-014 — Event-driven:** When a host operator lists accounts, Titen shall show username, disabled state, and passkey count.
- **AC-LOGIN-015 — Ubiquitous:** Titen shall enforce shared sign-in behavior on Bun and D1 without widening account authority.

## Risks and done conditions

Test forged client headers, recovery-stage scope, concurrent audits, reset scope, and mandatory password changes.
Check account state and staged-session authority inside session issuance transactions. Keep Worker password guards for the isolate lifetime.
Back up the live database and unit paths before deployment. Restore prior service paths for rollback.
Done requires passing manual gates, reviewed merges, production readiness, dashboard checks, and authenticated MCP smoke.
Move both artifacts to done only after evidence exists.

## Delivery

PR #307 updates Astro to 7.2.8. PR #312 delivers these sign-in changes.
All acceptance criteria pass their contract, integration, browser, or real-host checks.
The paired plan records test counts, backup evidence, and production verification.
