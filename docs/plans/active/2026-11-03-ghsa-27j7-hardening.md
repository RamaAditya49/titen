---
work_id: ghsa-27j7-hardening
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-11-03
updated: 2026-11-03
review_after: 2026-11-17
owner: maintainers
spec: docs/specs/active/2026-11-03-ghsa-27j7-hardening.md
---
# GHSA-27j7 hardening plan

Use test-driven development. Work on branch `fix/ghsa-27j7`.
Run every test on `rama-tuf` in a separate worktree. Push the branch to `rama-tuf` over SSH only.
Keep the branch off public GitHub until the advisory's temporary private fork exists.

- [ ] Add contract cases to `tests/contract/cases.ts` for AC-SEC-001 to AC-SEC-004 and AC-SEC-010.
- [ ] Add the chunked body test and the webhook header assertions to `tests/integration/`.
- [ ] Run the new tests on the old code. Record the failures.
- [ ] Add role and principal checks to `importRecords` in `src/core/portability.ts`.
- [ ] Replace `request.text()` with a bounded stream read in `src/core/app.ts`.
- [ ] Set `maxRequestBodySize` in `src/runtime/bun/server.ts`.
- [ ] Add the timestamped signature in `src/core/webhooks.ts`.
- [ ] Add the organization filter in `src/core/audit.ts`.
- [ ] Write `docs/decisions/0007-mcp-call-tool-bundle-scope.md`.
- [ ] Update `docs/reference/api.md`, `docs/security/threat-model.md`, and `CHANGELOG.md`.
- [ ] Run `pnpm typecheck`, `pnpm test:api`, `pnpm test:integration`, and `pnpm check:workflow` on `rama-tuf`.
- [ ] Move both artifacts to `done/`.

## Acceptance evidence map

| Acceptance | Planned verification |
| --- | --- |
| AC-SEC-001 | Contract "membership import cannot grant an organization role without authority" |
| AC-SEC-002 | Contract "an admin cannot import an owner membership" |
| AC-SEC-003 | Contract "credential import cannot reuse another principal identity" |
| AC-SEC-004 | Contract "a managed credential may import a key for its own principal" |
| AC-SEC-005 | Integration "a chunked body above the limit is refused without reading it all" |
| AC-SEC-006 | indirect: source assertion in the integration suite |
| AC-SEC-007 | Integration webhook delivery test verifies the V2 signature and timestamp |
| AC-SEC-008 | The same test verifies the legacy signature |
| AC-SEC-009 | The same test checks the registration `signing` block |
| AC-SEC-010 | Contract "an audit cursor from another organization returns nothing" |
| AC-SEC-011 | `pnpm test:api` runs the contract cases on Bun/SQLite and D1 |
| AC-SEC-012 | ADR 0007 |

## Rollback

The change has no migration. Revert the commits to restore the old behavior.
Webhook receivers that verify `X-Titen-Signature-V2` must fall back to `X-Titen-Signature` after a revert.
