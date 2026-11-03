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
spec: docs/specs/active/2026-11-03-login-throttle-eviction.md
---
# Login throttle eviction plan

Goal: a full throttle table no longer locks out every sign-in, and brute-force
state survives eviction.

- [x] Reproduce the lockout on Bun/SQLite against `23302a1` (real operator gets 429).
- [x] Confirm the eviction SQL (computed `LIMIT`, `DELETE … IN (subquery)`) on SQLite.
- [x] Add failing shared contract assertions for AC-THROTTLE-001, 002, 005, and 006.
- [x] Add the eviction statement to the admission batch in `src/core/login-security.ts`.
- [x] Keep the existing full-of-blocked-rows 429 contract for AC-THROTTLE-003 and 004.
- [x] Run Bun/SQLite and Cloudflare D1 contract suites, integration tests, and type checks.
- [x] Update API reference, VPS guide, and the Unreleased changelog.
- [x] Address the Cursor security review on PR #341: bound eviction to rows under five failures
      that have been idle for two minutes, and add the block-dominated and fresh-flood contracts.
- [ ] Maintainer review and merge.
- [ ] Deploy, then run real Bun and Cloudflare sign-in smoke.
- [ ] Record deployment evidence and move both artifacts to done.

## Acceptance evidence

| Acceptance | Verification |
| --- | --- |
| AC-THROTTLE-001 | Contract: 4096 idle one-failure rows, correct password returns 201 (Bun and D1) |
| AC-THROTTLE-002 | Contract: oldest one-failure rows removed, newer and higher-count rows kept |
| AC-THROTTLE-003 | Contract: seeded active blocks survive admission at capacity |
| AC-THROTTLE-004 | Contract: 4096 active blocks return 429; block-dominated storage returns 429 |
| AC-THROTTLE-005 | Contract: a 49-failure account row survives a full table and block-dominated storage |
| AC-THROTTLE-006 | Contract: row count stays at or below 4096 after every admission |
| AC-THROTTLE-007 | Same `assertLoginSecurity` contract on bun-sqlite and real workerd/D1 |
| AC-THROTTLE-008 | Contract: 4096 rows touched one minute ago return 429 and stay stored |

## Security review

- Active blocks are excluded from eviction, so an attacker cannot clear a block by flooding.
- The request's own buckets are excluded, so admission cannot evict what it needs.
- Rows with five or more failures and rows touched within two minutes are never evicted.
  Ranking alone was not enough: in storage full of higher-ranked rows the target becomes the only candidate.
  The Cursor security review on PR #341 found this, and the block-dominated contract reproduces it on the first revision.
  The bounds cap any forced reset at four failures per two minutes, below the account ceiling's own rate.

## Verification

- Reproduction before the change: storage full of one-failure rows, correct operator password returns 429.
  After the change the same reproduction returns 201.
- The new contract assertions fail on the previous code (429 where 201 is expected) and pass after the change.
- `pnpm test:api`: real workerd/D1 contracts 136 pass, D1 harness 9 pass, Bun contracts, vectors, and SDK 163 pass.
- `pnpm typecheck`: pass, with four unchanged historical files and six frozen diagnostics.
- `pnpm test:integration`: 272 pass, 1 timeout. The timed-out test,
  "the Bun listener limits a client before password work", fails the same way without this change.
  It passes in 6.3 s with `--timeout 60000`; its 21 real password checks exceed the 5 s default on the test container.
- Workflow, schema, ponytail-debt, public-artifact, and route checks pass for this work. `check-workflow-docs`
  still reports the unrelated, already overdue `2026-10-06-release-0.10.5` pair.
- Review revision: the block-dominated contract fails on the first revision (`47c26f4`), where a made-up
  username was admitted (401) by evicting the 49-failure account row. It passes after the bound (429, row kept).
  The same suites were rerun after the revision with the same counts and the same single pre-existing timeout.
- Deployment and real-runtime smoke are not done yet; they stay open above.

## Rollback

The change is one SQL statement in an existing batch with no schema change.
Revert the commit to restore the previous admission behavior.
