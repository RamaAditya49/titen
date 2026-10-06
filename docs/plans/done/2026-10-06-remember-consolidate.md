---
work_id: remember-consolidate-317
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-10-06
updated: 2026-10-06
owner: maintainers
spec: docs/specs/done/2026-10-06-remember-consolidate.md
---
# Optional claim on remember

- [x] Add `consolidate` on observation append and MCP `titen_remember`.
- [x] Copy trust, visibility, and a supporting source into one claim in the same batch.
- [x] Refuse missing `claims:write`, recalled evidence, and overlong content before insert.
- [x] State the rule in MCP `initialize` instructions.
- [x] Cover the flag with a dual-runtime MCP contract and the protocol schema test.
- [x] Document the flag in the API reference and the changelog.

## Acceptance evidence

| Acceptance | Verified evidence |
| --- | --- |
| AC-REM-001 | Contract `remember consolidate true is recallable when the model is disabled` |
| AC-REM-002 | Same contract leaves the omitted flag unconsolidated |
| AC-REM-003 | Same contract expects HTTP 403 and zero stored rows |
| AC-REM-004 | Same contract rejects a recalled source and a 4001-character body, and checks that the overlong body stored zero rows |
| AC-REM-005 | `tests/integration/mcp-protocol.test.ts` matches the instructions sentence |

## Verification

Dual-runtime contract case and the Bun MCP protocol test. No migration, deploy smoke, or rollback schema. Existing remember calls omit the flag and keep the previous response shape.

## Rollback

Revert the commit. Stored claims created with the flag remain ordinary claims. No column was added.
