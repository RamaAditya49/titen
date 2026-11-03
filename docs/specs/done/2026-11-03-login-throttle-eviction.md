---
work_id: login-throttle-eviction
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-03
updated: 2026-11-03
owner: maintainers
---
# Dashboard sign-in survives a full throttle table

Source: a private vulnerability report against `titen-memory@0.10.7`, revision `23302a1`.

## Problem

`admitPasswordAttempt` writes one account row and one client row before password verification.
The shared `login_throttles` table holds at most 4096 rows. When the table is full, admission returns HTTP 429.
Rows leave only 15 minutes after their last update. Nothing evicts rows under pressure.

An unauthenticated caller controls the username, so each attempt can add two new rows.
About 2,100 failed attempts with distinct usernames from about 210 addresses fill the table.
Most of these attempts stop at the password-check guard, so they cost no password hashing.
Then every operator gets HTTP 429 on sign-in, for all organizations on the deployment.
The lockout continues for about 15 minutes after the flood stops.

ADR 0006 says "Keep a bounded table and remove the oldest rows". The code does not remove rows at capacity.

The Bun edge limiter has the same failure mode. Its map refuses every new client at 4096 live clients.

## Scope

- At capacity, evict unblocked throttle rows before admission inserts its rows.
- Evict rows with the fewest recorded failures first. Evict the least recently touched row first in each tier.
  A pending reservation (`blocked_until_ms = -1`) counts as zero failures.
- Never evict an active block, or the caller's own account or client row.
- Keep the 4096-row bound and the HTTP 429 response when active blocks leave no room.
- Record each verified failure even when eviction removed the attempt's rows during password work.
- Evict the oldest client from the full Bun edge limiter map instead of refusing the new client.
- Add contract tests for Bun/SQLite and D1, an HTTP-level flood test, and a limiter unit test.
- Update the API reference, the VPS guide, the threat model, and the changelog.

## Out of scope

- A per-client or per-prefix row budget. Eviction by failure tier makes this unnecessary for this defect.
- Audit rows for attempts against unknown usernames.
- The password-check concurrency guard. It is a separate, documented capacity limit.
- Reverse-proxy deployments without `TITEN_LOGIN_CLIENT_IP_HEADER`. The VPS guide already requires the header.
- Schema changes. The fix uses the current columns and index.

## Constraints and risks

- Shared code stays in `src/core/**` with Web Standards only. The same SQL runs on SQLite and D1.
- Eviction must not reset the 50-failure account ceiling cheaply.
  Plain least-recently-touched eviction would let a flood evict a partly failed account row.
  Eviction by failure tier makes an attacker fill the table with rows of equal or higher failures first.
- Eviction can remove a pending reservation while its password check runs.
  Without a fix, the failure update then matches no row, and a client can skip its five-failure limit.
  Keeping reservations out of eviction is not safe: guard-rejected attempts leave reservations, so the lockout returns.
  `recordLoginFailure` therefore inserts a missing row before its update.
  The extra rows are bounded by concurrent password checks, and the next admission evicts back to the bound.
- `LIMIT` with a negative value means no limit in SQLite. The eviction count uses `max(0, ...)`.
- This change supersedes AC-LOGIN-004 in `docs/specs/done/2026-10-05-login-hardening.md`.
  Only a table without enough unblocked rows now returns HTTP 429.

## Acceptance criteria

- **AC-THR-001 — Unwanted behavior:** If the throttle table holds 4096 unblocked rows, then Titen shall return HTTP 201 for a correct sign-in from a new client.
- **AC-THR-002 — State-driven:** While the throttle table is full, Titen shall evict rows with the fewest recorded failures before rows with more failures.
- **AC-THR-003 — State-driven:** While throttle rows hold active blocks, Titen shall keep those rows during eviction.
- **AC-THR-004 — Unwanted behavior:** If active blocks leave fewer than two free rows, then Titen shall return HTTP 429 before password verification.
- **AC-THR-005 — Ubiquitous:** Titen shall keep the throttle table at no more than 4096 rows.
- **AC-THR-006 — Event-driven:** When callers send 2,100 failed sign-ins with distinct usernames from 210 addresses, Titen shall return HTTP 201 for a later correct sign-in.
- **AC-THR-007 — Unwanted behavior:** If the Bun client limiter holds 4096 live clients, then Titen shall evict the oldest client and admit the new client.
- **AC-THR-008 — Ubiquitous:** Titen shall apply AC-THR-001 to AC-THR-005 and AC-THR-009 on Bun/SQLite and Cloudflare D1.
- **AC-THR-009 — Unwanted behavior:** If eviction removes an attempt's rows before its failure is recorded, then Titen shall record that failure.

## Done conditions

- Each criterion has a passing test on `rama-tuf`. The new contract and flood tests fail on the old code.
- `pnpm test:api`, `pnpm test:integration`, `tsc --noEmit`, and `pnpm check:workflow` pass.
- The API reference, the VPS guide, the threat model, and the changelog describe the new behavior.
- Release and advisory publication stay a separate maintainer decision.

## Delivery

Branch `fix/login-throttle-eviction` delivers the change. All acceptance criteria pass on `rama-tuf`.
The paired plan records the failing runs on the old code and the passing suites.
