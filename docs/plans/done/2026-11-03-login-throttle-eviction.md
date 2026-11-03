---
work_id: login-throttle-eviction
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-03
updated: 2026-11-03
owner: maintainers
spec: docs/specs/done/2026-11-03-login-throttle-eviction.md
---
# Login throttle eviction plan

Use test-driven development. Work on branch `fix/login-throttle-eviction`.
Run every test on `rama-tuf` in a separate worktree. Push the branch to `rama-tuf` over SSH only.

- [x] Add contract cases to `tests/contract/login-security.ts` for AC-THR-001 to AC-THR-005.
- [x] Add the flood test and the limiter unit test to `tests/integration/login-rate-limit.test.ts`.
- [x] Run the new tests on the old code. Record the failures.
- [x] Add tiered eviction to `admitPasswordAttempt` in `src/core/login-security.ts`.
- [x] Evict the oldest client in `src/runtime/bun/login-rate-limit.ts`.
- [x] Insert a missing row in `recordLoginFailure` before its update. Add a contract case for AC-THR-009.
- [x] Run `tsc --noEmit`, `pnpm test:api`, and `pnpm test:integration` on `rama-tuf`.
- [x] Update `docs/reference/api.md`, `docs/deployment/vps.md`, `docs/security/threat-model.md`, and `CHANGELOG.md`.
- [x] Run `pnpm check:workflow`. Move both artifacts to `done/`.

## Log

- 2026-11-03: an automated review found that eviction could remove a reservation during password work.
  The spec gained AC-THR-009 before the code changed. Keeping reservations out of eviction was rejected,
  because guard-rejected attempts leave reservations and the lockout would return.

## Failing runs on the old code

| Revision | Command on `rama-tuf` | Result |
| --- | --- | --- |
| `cd82845` (tests only) | `bun test tests/contract/bun-sqlite.test.ts tests/integration/login-rate-limit.test.ts` | 132 pass, 3 fail: contract "unblocked rows must not lock out a correct sign-in", flood test (429, expected 201), limiter "a full limiter admits a new client" |
| `df91564` tests with `d7a8418` `src/core/login-security.ts` | `bun test tests/contract/bun-sqlite.test.ts` | 125 pass, 1 fail: AC-THR-009 deep-equal |

## Verification

| Command on `rama-tuf` at `df91564` | Result |
| --- | --- |
| `tsc --noEmit` (local, one package) | exit 0 |
| `pnpm test:api` | exit 0; Bun/SQLite and vectors 163 pass; D1 (Miniflare) 136 pass; SDK 9 pass |
| `pnpm test:integration` | exit 0; 275 pass, 0 fail |
| `pnpm check:workflow` | This pair passes. The command exits 1 only for the unrelated `2026-10-06-release-0.10.5` pair, overdue on `main` since 2026-10-20 |
| `--self-test`, `check-schema-version`, `check-ponytail-debt`, `check:public` | exit 0 |

## Acceptance evidence map

| Acceptance | Verified evidence |
| --- | --- |
| AC-THR-001 | Contract "unblocked rows must not lock out a correct sign-in" passes on Bun/SQLite and D1 |
| AC-THR-002 | Contract "eviction keeps the row with more failures" passes on Bun/SQLite and D1 |
| AC-THR-003 | Contract mixed case keeps 4094 active blocks after a 201 sign-in |
| AC-THR-004 | Contract "full active storage rejects before password work" returns 429 and keeps 4096 rows |
| AC-THR-005 | Contract row-count assertions after each capacity case |
| AC-THR-006 | Integration "a distinct-username flood from many clients does not lock out a correct sign-in" |
| AC-THR-007 | Integration "the Bun client limiter evicts the oldest client when full" |
| AC-THR-008 | `pnpm test:api` runs `bun:sqlite protects login clients and storage` and `D1 protects login clients and storage` |
| AC-THR-009 | Contract recordLoginFailure case creates both rows with one failure on Bun/SQLite and D1 |
| AC-LOGIN-004 | Superseded by AC-THR-004. The 2026-10-05 login-hardening evidence stays as history |

## Rollback

The change has no migration. Revert the commits to restore the old admission rule.
