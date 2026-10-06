---
work_id: key-target-fences-318
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-10-06
updated: 2026-10-06
owner: maintainers
spec: docs/specs/done/2026-10-06-key-target-fences.md
---
# API key target fences

- [x] Add `api_key_fences` in migration 26 without backfilling existing keys.
- [x] Reject out-of-fence writes with 403 after the existing grant check, including MCP tool errors.
- [x] Filter reads only when a read fence is present, and keep organization and team reads for write-only fences.
- [x] Accept fences on key create in the API and the CLI, and show them in key list, principal, and audit detail.
- [x] Cover the acceptance cases, pattern matching, and a live key migrating from schema 25.

## Acceptance evidence

| Acceptance | Verified evidence |
| --- | --- |
| AC-FEN-001 | Contract `key target fences deny foreign writes and keep shared reads`, including MCP remember and consolidate |
| AC-FEN-002 | Same contract compiles the organization claim and the team claim on the fenced key |
| AC-FEN-003 | Same contract checks list, principal, and audit detail; CLI test checks `titen key list` and the audit row |
| AC-FEN-004 | Same contract creates an unfenced key and writes the foreign subject |
| AC-FEN-005 | `tests/integration/key-fence-migration.test.ts` |
| AC-FEN-006 | Same contract hides Bob from a read-fenced compile and still lets that key write Bob |
| AC-FEN-007 | Same contract allows `x:profile:carol` and rejects `x:shared` for pattern `x:profile:*`; `tests/integration/key-fences.test.ts` |
| AC-FEN-008 | Same contract allows Alice in the listed project and rejects the other three combinations |
| AC-FEN-009 | Same contract expects HTTP 400 for an empty list, a duplicate, a middle asterisk, and a project wildcard |

## Verification

Dual-runtime contract, Bun CLI test, schema-25 migration test, and the bind-count unit test. Rollback is restore of the pre-migrate database snapshot. Existing keys have no fence rows, so a process that has not migrated yet is the snapshot, and a process on this build treats missing rows as unrestricted.

## Rollback

Restore the database snapshot taken before migration 26. Dropping `api_key_fences` on a forward database is safe only when no restricted key must keep its fence. Prefer restoring the snapshot.
