---
work_id: agent-ergonomics-322
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-10-07
updated: 2026-10-07
owner: maintainers
spec: docs/specs/done/2026-10-07-agent-ergonomics.md
---
# Agent ergonomics for issues 322-329

- [x] Return fence and trust denial detail, and collect compile and remember field errors.
- [x] Fill a single write-fence project and hint when several remain.
- [x] Add whoami, subject resolve, and close project suggestions.
- [x] Add compile hints, degraded reason, and a SQL/FTS read timestamp.
- [x] Add principal reassign, enrichment job commands, and migration 27.
- [x] Report version and schema version, local timestamps, dashboard unit, and docs.

## Acceptance evidence

| Acceptance | Verified evidence |
| --- | --- |
| AC-ERG-001 | Contract `agent ergonomics explain fences, fill one project, and reassign private principals` |
| AC-ERG-002 | Same contract expects trust_ceiling and allowed_trust |
| AC-ERG-003 | Same contract expects subject_id, task, and max_tokens together |
| AC-ERG-004 | Same contract accepts subject and query aliases |
| AC-ERG-005 | Same contract expects project_id_source key_fence |
| AC-ERG-006 | Same contract expects an unscoped hint naming both projects |
| AC-ERG-007 | Same contract checks GET /v1/principal and titen_whoami omit the raw key |
| AC-ERG-008 | Same contract checks subject lookup and a close suggestion |
| AC-ERG-009 | Same contract checks unconsolidated ids, hint, degraded.reason, and consistent_as_of |
| AC-ERG-010 | Same contract dry-run then reassign, plus the CLI principal reassign test |
| AC-ERG-011 | CLI jobs ack test and the contract readiness version fields |
| AC-ERG-012 | Timezone unit test and the contract local timestamp fields |
| AC-ERG-013 | MCP protocol test for initialize text and the dashboard unit test |

## Verification

Dual-runtime contract case, Bun CLI, MCP protocol, timezone, and unit-file tests. Migration 27 is a nullable column. Rollback is reverting the commit; acked_at can stay null on an older binary only before that binary refuses a newer schema.

## Rollback

Revert the commit and stay on schema 26 if migration 27 has not been applied. After it has been applied, the older binary refuses the newer schema until the column is left in place or the database is restored from backup.
