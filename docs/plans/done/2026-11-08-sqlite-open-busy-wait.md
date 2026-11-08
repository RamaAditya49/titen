---
work_id: sqlite-open-busy-wait
status: done
stage: done
outcome: completed
complexity: simple
created: 2026-11-08
updated: 2026-11-08
owner: maintainers
spec: docs/specs/done/2026-11-08-sqlite-open-busy-wait.md
---
# SQLite open busy wait plan

Goal: a concurrent open waits for the lock instead of failing.

- [x] Add `tests/integration/sqlite-open-busy.test.ts`. A child process holds `BEGIN EXCLUSIVE` for 400 ms while the test opens the file.
- [x] Move `PRAGMA busy_timeout = 5000` before `PRAGMA journal_mode = WAL`.
- [x] CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-OPEN-001 | `tests/integration/sqlite-open-busy.test.ts`: fails with `SQLITE_BUSY` before the change, passes after it |
| AC-OPEN-002 | Diff review: only the position of `busy_timeout` changes; `tests/integration/durability.test.ts` and `tests/integration/runtime-hardening.test.ts` pass |

## Rollback

Revert the commit. No data or schema changes.

## Verification

`bun test tests/integration` and `pnpm check:workflow` on `rama-tuf`.
