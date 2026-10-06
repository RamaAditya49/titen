---
work_id: key-target-fences-318
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-10-06
updated: 2026-10-06
owner: maintainers
---
# API key target fences

Issue #318. Keys are scoped by capability but not by subject or project. Any agent key can write another agent's profile subject.

## Design and scope

Migration 26 adds `api_key_fences`. No rows means the key is unrestricted, so existing keys stay unchanged. `data_target_type` stays a separate single-target gate and still misses as 404. A fence is optional on `POST /v1/keys` and on `titen key create`. `--subjects` and `--projects` are write fences. Explicit `--read-*` and `--write-*` flags set each dimension. A project pattern is an exact project id. A subject pattern is exact or one trailing asterisk. When both dimensions are set, both must match. Write misses return 403 and do not insert a row. Read fences filter canonical reads and do not apply to a key that only has write fences, so organization and team visibility still compile. MCP tool failures already return `isError` with the API error code. Key list, principal introspection, and `key.create` audit detail show the four lists. Null means unrestricted. JSONL export does not carry fence rows. There is no in-place edit of an existing key hash; operators revoke and create a replacement.

## Acceptance criteria

- **AC-FEN-001 — Optional feature:** Where a key write fence lists `x:profile:alice` and `x:shared`, Titen shall reject remember and consolidate on `x:profile:bob` with HTTP 403 and code FORBIDDEN, and the MCP tools/call result shall set isError with code FORBIDDEN.
- **AC-FEN-002 — Optional feature:** Where that same key has no read fence, Titen shall still compile an organization-visible claim and a team-visible claim on `x:profile:bob`.
- **AC-FEN-003 — Event-driven:** When an operator creates a key with fences, Titen shall show those patterns from key list, from GET /v1/principal, and in the key.create audit detail.
- **AC-FEN-004 — Ubiquitous:** Titen shall leave a key with no fence rows able to write a subject its grants already allow.
- **AC-FEN-005 — Event-driven:** When migration 26 runs on a database whose latest migration is 25 and that already contains an API key, Titen shall keep that key and shall add no fence rows.
- **AC-FEN-006 — Unwanted behavior:** If a key has a read subject fence, then Titen shall omit subjects outside that fence from compile and shall still allow a write that has no write fence.
- **AC-FEN-007 — Optional feature:** Where a write subject pattern ends with one asterisk, Titen shall allow a subject that starts with that prefix and shall reject a subject that does not.
- **AC-FEN-008 — Optional feature:** Where a key sets both write project ids and write subjects, Titen shall allow a write only when both match.
- **AC-FEN-009 — Unwanted behavior:** If a fence field is empty, duplicated, a project wildcard, or a subject pattern whose asterisk is not a single trailing asterisk, then Titen shall reject key creation.

## Done conditions

Dual-runtime contract covering MCP, CLI create and list, a schema-25 migration test, and a placeholder-count unit test. API, data model, CLI usage, and changelog describe the fences and the upgrade command.
