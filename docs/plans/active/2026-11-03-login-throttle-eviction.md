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

Use test-driven development. Work on branch `fix/login-throttle-eviction`.
Run every test on `rama-tuf` in a separate worktree. Push the branch to `rama-tuf` over SSH only.

- [ ] Add contract cases to `tests/contract/login-security.ts` for AC-THR-001 to AC-THR-005.
- [ ] Add the flood test and the limiter unit test to `tests/integration/login-rate-limit.test.ts`.
- [ ] Run the new tests on the old code. Record the failures.
- [ ] Add tiered eviction to `admitPasswordAttempt` in `src/core/login-security.ts`.
- [ ] Evict the oldest client in `src/runtime/bun/login-rate-limit.ts`.
- [ ] Run `tsc --noEmit`, `pnpm test:api`, and `pnpm test:integration` on `rama-tuf`.
- [ ] Update `docs/reference/api.md`, `docs/deployment/vps.md`, `docs/security/threat-model.md`, and `CHANGELOG.md`.
- [ ] Run `pnpm check:workflow`. Move both artifacts to `done/`.

## Acceptance evidence map

| Acceptance | Planned evidence |
| --- | --- |
| AC-THR-001 | Contract: 4096 unblocked rows, then a correct sign-in from a new client returns 201 |
| AC-THR-002 | Contract: the oldest row with 49 failures survives eviction |
| AC-THR-003 | Contract: 4094 active blocks stay after a successful sign-in |
| AC-THR-004 | Contract: 4096 active blocks return 429 and keep 4096 rows |
| AC-THR-005 | Contract: the row count stays at or below 4096 after each case |
| AC-THR-006 | Integration: 2,100-attempt flood from 210 addresses, then a correct sign-in returns 201 |
| AC-THR-007 | Integration: limiter with 4096 live clients admits a new client and keeps the per-client limit |
| AC-THR-008 | `pnpm test:api` runs the contract on Bun/SQLite and D1 (Miniflare) |

## Rollback

The change has no migration. Revert the commit to restore the old admission rule.
