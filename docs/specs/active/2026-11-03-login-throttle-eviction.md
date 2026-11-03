---
work_id: login-throttle-eviction
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-11-03
updated: 2026-11-03
review_after: 2026-11-17
owner: maintainers
---
# Login throttle eviction under full storage

Reported privately by the scheduled backend research run on 2026-11-03. Not filed
as a public issue, per SECURITY.md.

## Problem

`login_throttles` is bounded to 4096 rows. Admission inserts an account row and a
client row only while the table holds fewer than 4096 rows, then returns HTTP 429
when either row is missing. Rows stay for 15 minutes after their last failure.

Each attempt with a new well-formed username adds two rows, whether or not the
account exists. About 2048 unauthenticated attempts inside 15 minutes therefore
fill the table, and every later sign-in, including an operator with the correct
password, returns `429 LOGIN_RATE_LIMITED` until rows age out. Repeating the
flood keeps all operators locked out. Reproduced on Bun/SQLite at `23302a1`.

ADR 0006 already states "keep a bounded table and remove the oldest rows". The
code rejects new attempts instead of removing rows. AC-LOGIN-004 of
`docs/specs/done/2026-10-05-login-hardening.md` encoded the rejecting behavior;
this work narrows it.

## Design

Before inserting, admission removes just enough rows to fit the request's two
buckets. It removes only rows that are not actively blocked and are not the
request's own buckets. It removes the rows with the fewest recorded failures
first and, among equal counts, the oldest last-touch time.

Ranking by failure count keeps brute-force state. A flood of one-failure rows
evicts other one-failure rows. It cannot reset an account bucket that holds more
failures unless the attacker first gives thousands of rows at least as many
failures. In-flight rows have the newest touch time, so they are removed last
among equal counts.

## In scope

- Eviction inside the existing admission batch in `src/core/login-security.ts`.
- Shared Bun/SQLite and Cloudflare D1 contract coverage.
- API reference, VPS deployment guide, and changelog wording.

## Out of scope

- Schema changes, new indexes, or migrations.
- Changing the 5-failure client limit, 50-failure account limit, 15-minute
  window, 4096-row bound, delay ladder, or response codes.
- Reserving capacity for existing accounts. It would make 429 behavior differ by
  account existence and create an enumeration oracle.
- Edge rate limits, Cloudflare Rate Limiting configuration, and deployment.

## Constraints

- `src/core/**` keeps zero external imports; the change is SQL inside an existing batch.
- The statement runs in the same atomic batch on both runtimes.
- Active blocks are never removed.

## Risks

- **Residual lockout.** An attacker can still fill storage with actively blocked
  rows. That needs at least five failures per row and repeated escalation to keep
  blocks alive, which raises the cost from about 2048 requests to tens of
  thousands. Edge rate limits remain the recommended first layer.
- **Lost counts.** Eviction drops the failure count of an unblocked row. Removing
  a row with N failures requires storage full of rows with at least N failures.
- **Spurious 429 under heavy concurrency.** Another admission can evict a fresh
  row between the batch and the admission check. Fresh rows are removed last, so
  this needs storage full of in-flight rows.

## EARS acceptance criteria

- **AC-THROTTLE-001 — State-driven:** While throttle storage holds 4096 unblocked rows from other buckets, Titen shall verify a sign-in password and return HTTP 201 for correct credentials.
- **AC-THROTTLE-002 — Event-driven:** When admission needs storage, Titen shall remove unblocked rows with the fewest recorded failures first and the oldest last-touch time among equal counts.
- **AC-THROTTLE-003 — State-driven:** While a throttle row is actively blocked, Titen shall keep that row during admission.
- **AC-THROTTLE-004 — Unwanted behavior:** If throttle storage holds 4096 actively blocked rows, then Titen shall return HTTP 429 before password verification.
- **AC-THROTTLE-005 — State-driven:** While an account bucket holds more failures than every other unblocked row, Titen shall keep its failure count when admission evicts rows.
- **AC-THROTTLE-006 — Ubiquitous:** Titen shall keep throttle storage at or below 4096 rows.
- **AC-THROTTLE-007 — Ubiquitous:** Titen shall apply the same admission behavior on Bun/SQLite and Cloudflare D1.

## Done conditions

- Every criterion has passing Bun/SQLite and Cloudflare D1 contract evidence.
- The reproduction fails before the change and passes after it.
- Integration, contract, and type checks pass.
- API, VPS, and changelog text describe the new behavior.
- A maintainer reviews and merges the change and deploys it. Real Bun and
  Cloudflare runtime smoke pass after deployment.
- Both artifacts move to `done/` only after that evidence exists.
