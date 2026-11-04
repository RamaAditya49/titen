---
work_id: key-list-pagination
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-03
updated: 2026-11-03
owner: maintainers
---
# Key list pagination and status filter

Issue #340. `GET /v1/keys` returned the 500 oldest keys with no cursor, no
filter, and no truncation signal. `api_keys` only grows, and every dashboard
sign-in adds rows, so newer keys silently fell out of the list. The fence query
also read every fence in the organization.

Scope: `src/core/keys.ts`, `src/sdk.ts`, docs and tests. Compatibility first:
ascending order and a default page of 500 stay, so a caller that sends no
parameter gets the same first page. New: `limit`, opaque `cursor`, `status`,
`principal_id`, and `data.next_cursor`. Out of scope: an `(org_id, created_at,
id)` index (a migration requires a package version bump) and retention of
expired dashboard-session keys (a separate retention decision, see #340).

## Acceptance criteria

- **AC-KEY-001 — Event-driven:** When an organization holds more keys than one page, Titen shall return `data.next_cursor` on `GET /v1/keys`, and following cursors shall return every key exactly once.
- **AC-KEY-002 — Event-driven:** When a key is created after the organization already holds 500 or more keys, Titen shall return that key on some page of `GET /v1/keys`.
- **AC-KEY-003 — Event-driven:** When `GET /v1/keys?status=active` is called, Titen shall return only keys whose lifecycle status is `active` at request time, with the filter applied before the page limit.
- **AC-KEY-004 — Event-driven:** When `GET /v1/keys` returns a page, Titen shall read fence rows only for the keys on that page.
- **AC-KEY-005 — Event-driven:** When a caller omits all new parameters, Titen shall return the same first 500 keys in the same order with an unchanged `data.keys` element shape.
- **AC-KEY-006 — Unwanted behavior:** If `limit`, `status`, `principal_id`, or `cursor` is malformed, then Titen shall return `400 VALIDATION_ERROR` without reading keys.

## Done conditions

Contract cases pass on bun-sqlite and the D1 harness. The SDK test covers the
passthrough. Docs and CHANGELOG describe the parameters.

## Completion evidence

All six acceptance criteria passed; the paired plan maps each to its check.
