---
work_id: channel-compile-ranking
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-08
updated: 2026-11-08
owner: maintainers
spec: docs/specs/done/2026-11-08-channel-compile-ranking.md
---
# Channel compile ranking plan

Goal: the channel compile serves the releases that answer the task.

- [x] Add a failing contract case for ranking, the 250-release channel, the no-term fallback, omissions, and gated releases.
- [x] Add a migration test for releases that are active before the migration.
- [x] Add migration 30 with `channel_release_fts`, a backfill, and triggers.
- [x] Rank eligible releases in the compile query and apply the bound after ranking.
- [x] Return `omitted_items` and `budget_exhausted`.
- [x] Update the API reference and CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-REL-001 | Contract case "channel context compile ranks releases by task": the matching release, activated last, leads at a 160-token budget |
| AC-REL-002 | Same case: in a 250-release channel the newest release is first for a matching task |
| AC-REL-003 | Same case: a task with no terms returns 13 releases newest first |
| AC-REL-004 | Same case: a small budget reports omitted items; the 250-release channel reports 50 omitted |
| AC-REL-005 | Same case: revoked, expired, and below-trust releases never appear for a matching or a no-term task |
| Migration | Integration test "migration 30 indexes releases that were already active" |

## Rollback

Revert the commit. Schema 30 stays applied and the index is unused, so no data
change is needed.

## Verification

`bun test tests/contract/bun-sqlite.test.ts`, `pnpm test:d1`, the migration
test, `pnpm typecheck:maintained`, and the docs checks. A real Cloudflare D1
database was not exercised.
