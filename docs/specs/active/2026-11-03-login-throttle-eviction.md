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
buckets. A row is evictable only when all of these hold:

- it is not actively blocked;
- it holds fewer than five failures, the client block threshold;
- it has been idle for at least two minutes;
- it is not one of the request's own buckets.

Among evictable rows, the fewest failures go first, then the oldest last touch.

Eviction must not let an attacker cycle a bucket's failure count. Ranking alone
does not prevent that: when storage is full of rows that outrank the target, the
target is the only candidate, and one guess plus one made-up-username request
resets it, repeatedly. (The Cursor security review found this on the first
revision of the change.) The two bounds cap any forced reset at four failures per
bucket per two minutes, at most 120 per hour. The 50-failure account ceiling with
its delay ladder already permits about 145 guesses per hour, so a flood gains no
guesses beyond what the ceiling allows.

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

- **Residual lockout.** An attacker can still fill storage with rows that are not
  evictable. The cheapest ways are rows with five or more failures (about 10,000
  requests per 15 minutes) or a sustained flood of about 2048 requests every two
  minutes. The old cost was about 2048 requests per 15 minutes. Edge rate limits
  remain the recommended first layer.
- **Lost counts.** Eviction drops the count of a row with at most four failures
  that has been idle for two minutes. That is bounded as described in Design.
- **Recovery delay.** After a flood stops, legitimate sign-in can still see 429
  until flood rows have been idle for two minutes.

## EARS acceptance criteria

- **AC-THROTTLE-001 — State-driven:** While throttle storage holds 4096 unblocked one-failure rows from other buckets idle for at least two minutes, Titen shall verify a sign-in password and return HTTP 201 for correct credentials.
- **AC-THROTTLE-002 — Event-driven:** When admission needs storage, Titen shall remove evictable rows with the fewest recorded failures first and the oldest last-touch time among equal counts.
- **AC-THROTTLE-003 — State-driven:** While a throttle row is actively blocked, Titen shall keep that row during admission.
- **AC-THROTTLE-004 — Unwanted behavior:** If throttle storage holds 4096 rows and fewer evictable rows than the request needs, then Titen shall return HTTP 429 before password verification.
- **AC-THROTTLE-005 — State-driven:** While a throttle row holds five or more failures, Titen shall keep that row during admission.
- **AC-THROTTLE-006 — Ubiquitous:** Titen shall keep throttle storage at or below 4096 rows.
- **AC-THROTTLE-007 — Ubiquitous:** Titen shall apply the same admission behavior on Bun/SQLite and Cloudflare D1.
- **AC-THROTTLE-008 — State-driven:** While a throttle row was touched within the last two minutes, Titen shall keep that row during admission.

## Done conditions

- Every criterion has passing Bun/SQLite and Cloudflare D1 contract evidence.
- The reproduction fails before the change and passes after it.
- Integration, contract, and type checks pass.
- API, VPS, and changelog text describe the new behavior.
- A maintainer reviews and merges the change and deploys it. Real Bun and
  Cloudflare runtime smoke pass after deployment.
- Both artifacts move to `done/` only after that evidence exists.
