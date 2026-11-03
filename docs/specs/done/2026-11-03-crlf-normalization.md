---
work_id: crlf-normalization
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-03
updated: 2026-11-03
owner: maintainers
---
# Normalize CRLF to LF at ingest

Issue #354. The #108 guard rejects every C0 control except tab and line feed,
so a Windows `\r\n` line ending made every validated write fail with "unsafe
control character" on REST and MCP alike. A lone CR can overwrite a terminal
line and stays rejected; the CRLF pair carries no such power.

Scope: `requireString` and `optionalString` in `src/core/validate.ts` replace
each `\r\n` with `\n` before the length, emptiness, and unsafe-character checks,
and return the normalized value. Every caller already uses the returned value,
so stored text and `content_hash` derive from it. The raw request body is still
hashed byte-exact for idempotency identity. The Bun source importer
(`src/runtime/bun/source-import.ts`) canonicalizes each file the same way before
its control check and secret scan, and imports the shared `UNSAFE_TEXT` class
instead of a duplicate, so the API and the importer cannot drift apart.

## Acceptance criteria

- **AC-VAL-001 — Event-driven:** When a write request carries a validated string containing `\r\n`, Titen shall accept it and store the value with each `\r\n` replaced by `\n`.
- **AC-VAL-002 — Unwanted behavior:** If a validated string contains a `\r` not immediately followed by `\n`, then Titen shall reject it with `VALIDATION_ERROR` and a message naming U+000D.
- **AC-VAL-003 — Event-driven:** When the same observation is written once with CRLF and once with LF line endings and the same `source.id`, Titen shall return the first record and shall not append a second observation.
- **AC-VAL-004 — Event-driven:** When CRLF content arrives through `titen_remember`, `add_observations`, or `create_entities`, Titen shall return a non-error tool result with the content stored as LF.
- **AC-VAL-005 — Unwanted behavior:** If a validated string contains NUL, ESC, DEL, or a bidirectional override, then Titen shall keep rejecting it with `VALIDATION_ERROR`.

- **AC-VAL-006 — Event-driven:** When `titen import` reads a markdown source whose only difference from an accepted file is CRLF line endings, Titen shall produce the same entries and `content_hash` values as for the LF file, and shall still reject a lone `\r`.

## Done conditions

Unit, contract (bun-sqlite and D1), and MCP compatibility tests pass and the
contract case fails on main. The API reference documents the rule.

## Completion evidence

All six acceptance criteria passed; the paired plan maps each to its check.
