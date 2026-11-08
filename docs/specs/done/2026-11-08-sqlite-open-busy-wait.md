---
work_id: sqlite-open-busy-wait
status: done
stage: done
outcome: completed
complexity: simple
created: 2026-11-08
updated: 2026-11-08
owner: maintainers
---
# Wait for the lock when the Bun store opens

`openDatabase` in `src/runtime/bun/sqlite.ts` ran `PRAGMA journal_mode = WAL`
before `PRAGMA busy_timeout = 5000`. The WAL switch and WAL recovery take a
lock. When another process held that lock, the open failed at once with
`SQLITE_BUSY` instead of waiting. The `pnpm test:all` gate for 0.10.10 hit this
in `tests/integration/durability.test.ts`, where six writer processes open one
file at the same time.

Scope: the pragma order in `openDatabase`. The pragma values do not change.

## Acceptance criteria

- **AC-OPEN-001 — Event-driven:** When another process holds an exclusive lock on the database file, `openDatabase` shall wait up to the busy timeout and then open the store in WAL mode.
- **AC-OPEN-002 — Ubiquitous:** `openDatabase` shall keep the journal mode, synchronous level, checkpoint size, foreign-key rule, and busy timeout values.

## Done conditions

The new regression test fails before the change and passes after it. The
durability and runtime-hardening tests pass.

## Completion evidence

Both acceptance criteria passed. The paired plan maps each to its check.
