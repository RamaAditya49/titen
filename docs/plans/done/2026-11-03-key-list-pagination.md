---
work_id: key-list-pagination
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-03
updated: 2026-11-03
owner: maintainers
spec: docs/specs/done/2026-11-03-key-list-pagination.md
---
# Key list pagination plan

Goal: make every key reachable through `GET /v1/keys` without changing what an
existing caller sees.

- [x] Add a failing contract case: 505 old revoked keys, then one new key, then follow cursors.
- [x] Keyset-paginate on `(created_at, id)` with `limit + 1` to detect more rows; encode the cursor as base64url JSON.
- [x] Express `keyLifecycleStatus` in SQL for the `status` filter, and add `principal_id`.
- [x] Load fences with `key_id IN (page ids)`, chunked for the D1 bind cap.
- [x] Pass `limit`, `cursor`, `status`, `principal_id` through the SDK and return `next_cursor`.
- [x] Update the API reference and CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-KEY-001 | Contract case "key listing pages…": `limit=200` pages return every org key exactly once, last cursor null |
| AC-KEY-002 | Same case: the key created after 505 others is absent from the default page and present via cursors; red on main |
| AC-KEY-003 | Same case: `status=active&limit=5` contains the newest key and only active keys; `status=revoked&limit=1` returns a revoked key and a cursor |
| AC-KEY-004 | `src/core/keys.ts` fence query binds only page ids; existing fence contract cases pass |
| AC-KEY-005 | Same case: default call returns 500 keys oldest first; element key set equals a filtered page's; existing key cases pass |
| AC-KEY-006 | Same case: `status=expiredish`, `limit=501`, malformed `cursor` return 400 |

## Rollback

Revert the commit. No schema or stored data changes; `next_cursor` is additive.

## Verification

Bun/SQLite and the D1 contract harness after `pnpm build:worker`, plus the SDK
suite. No real Cloudflare or VPS deployment was exercised.
