---
work_id: crlf-normalization
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-03
updated: 2026-11-03
owner: maintainers
spec: docs/specs/done/2026-11-03-crlf-normalization.md
---
# CRLF normalization plan

Goal: accept Windows line endings without weakening the #108 control guard.

- [x] Add failing unit, contract, and MCP compatibility tests.
- [x] Add `normalizeLineEndings` and apply it in `requireString` and `optionalString` before every check.
- [x] Reject a remaining CR with a message naming U+000D and the fix.
- [x] Audit callers for raw `body[field]` reads after validation; none exist in `src/core`.
- [x] Document the rule in the API reference and update CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-VAL-001 | Contract case "writes store CRLF as LF…": 201 and the stored row holds LF; red on main (400 unsafe control character) |
| AC-VAL-002 | Same case: `progress 10%\rprogress 99%` returns 400 naming U+000D; unit test covers `x\r\r\ny` |
| AC-VAL-003 | Same case: an LF write with the same `source.id` returns the CRLF write's observation id and the subject holds one row |
| AC-VAL-004 | Same case: `titen_remember` returns no error and stores LF; `tests/contract/mcp-compat.test.ts` covers `create_entities` and `add_observations` |
| AC-VAL-005 | Contract case and unit test: NUL, ESC, DEL, and U+202E stay rejected |

## Rollback

Revert the commit. Stored LF rows remain valid; no schema change.

## Verification

Bun/SQLite and the D1 contract harness after `pnpm build:worker`. No real
Cloudflare or VPS deployment was exercised.
