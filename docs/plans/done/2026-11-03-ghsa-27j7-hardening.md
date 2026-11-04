---
work_id: ghsa-27j7-hardening
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-03
updated: 2026-11-03
owner: maintainers
spec: docs/specs/done/2026-11-03-ghsa-27j7-hardening.md
---
# GHSA-27j7 hardening plan

Use test-driven development. Work on branch `fix/ghsa-27j7`.
Run every test on `rama-tuf` in a separate worktree. Push the branch to `rama-tuf` over SSH only.
Keep the branch off public GitHub until the advisory's temporary private fork exists.

- [x] Add contract cases to `tests/contract/cases.ts` for AC-SEC-001 to AC-SEC-004 and AC-SEC-010.
- [x] Add the chunked body test and the webhook header assertions to `tests/integration/`.
- [x] Run the new tests on the old code. Record the failures.
- [x] Add role and principal checks to `importRecords` in `src/core/portability.ts`.
- [x] Replace `request.text()` with a bounded stream read in `src/core/app.ts`.
- [x] Set `maxRequestBodySize` in `src/runtime/bun/server.ts` and `scripts/dashboard-adapter.ts`.
- [x] Add the timestamped signature in `src/core/webhooks.ts`.
- [x] Add the organization filter in `src/core/audit.ts`.
- [x] Write `docs/decisions/0007-mcp-call-tool-bundle-scope.md`.
- [x] Update `docs/reference/api.md`, `docs/security/threat-model.md`, and `CHANGELOG.md`.
- [x] Run `pnpm typecheck`, `pnpm test:api`, `pnpm test:integration`, and `pnpm check:workflow` on `rama-tuf`.
- [x] Move both artifacts to `done/`.

## Log

- 2026-11-03: the first admin case failed on the old code with 409, because the admin already had an organization membership.
  The case now maps a second principal, and the old code returns 200 for an imported `owner` role.
- 2026-11-03: `scripts/dashboard-adapter.ts` read bodies with the same pattern. The spec scope and AC-SEC-006 now include it.
- 2026-11-03: three added lines in `src/runtime/bun/server.ts` moved a ponytail marker. `PONYTAIL-DEBT.md` now names line 324.

## Failing runs on the old code

| Revision | Command on `rama-tuf` | Result |
| --- | --- | --- |
| `2f7d978` (tests only) | `bun test tests/contract/bun-sqlite.test.ts tests/integration/request-body-limit.test.ts tests/integration/webhooks.test.ts` | 131 pass, 7 fail: member self-grant (200, expected 404), admin owner import (409), principal reuse (200, expected 403), foreign audit cursor (1 entry), chunked body (16,777,216 bytes read), Bun runtime limit (401 from the app), webhook V2 headers missing |
| `0374d34` (reworked admin case) | `bun test tests/contract/bun-sqlite.test.ts -t "admin cannot import"` | 1 fail: expected 403, got 200 |

## Verification

All commands ran on `rama-tuf` at `b30b777`.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm test:api` | exit 0; Bun/SQLite and vectors 168 pass; D1 (Miniflare) 141 pass; SDK 9 pass |
| `pnpm test:integration` | exit 0; 277 pass, 0 fail |
| `pnpm check:workflow` | exit 0 |
| `pnpm verify:dashboard-live`, `pnpm build`, `playwright test --workers=4` | exit 0; 19 pass, 5 skipped |
| `bash scripts/verify-pack.sh` | exit 0 |

## Acceptance evidence map

| Acceptance | Verified evidence |
| --- | --- |
| AC-SEC-001 | Contract "membership import cannot grant an organization role without authority" passes on Bun/SQLite and D1 |
| AC-SEC-002 | Contract "an admin cannot import an owner membership" passes on Bun/SQLite and D1 |
| AC-SEC-003 | Contract "credential import cannot reuse another principal identity" passes on Bun/SQLite and D1 |
| AC-SEC-004 | Contract "a managed credential may import a key for its own principal" passes on Bun/SQLite and D1 |
| AC-SEC-005 | Integration "a chunked body above the limit is refused without reading it all" |
| AC-SEC-006 | Integration "the Bun server refuses a body far above the limit before the app reads it". indirect: the adapter sets `maxRequestBodySize: 2 * BODY_LIMIT`, and `tests/integration/dashboard-adapter.test.ts` passes |
| AC-SEC-007 | Integration "a delivered event arrives signed, and the signature verifies independently" verifies V2 and the timestamp |
| AC-SEC-008 | The same test verifies `X-Titen-Signature` over the body |
| AC-SEC-009 | The same test checks `signing.v2` in the registration response |
| AC-SEC-010 | Contract "an audit cursor from another organization returns nothing" passes on Bun/SQLite and D1 |
| AC-SEC-011 | `pnpm test:api` runs the contract cases on Bun/SQLite and D1 |
| AC-SEC-012 | `docs/decisions/0007-mcp-call-tool-bundle-scope.md` |

## Rollback

The change has no migration. Revert the commits to restore the old behavior.
Webhook receivers that verify `X-Titen-Signature-V2` must fall back to `X-Titen-Signature` after a revert.
