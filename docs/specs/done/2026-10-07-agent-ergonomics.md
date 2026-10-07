---
work_id: agent-ergonomics-322
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-10-07
updated: 2026-10-07
owner: maintainers
---
# Agent ergonomics for issues 322-329

Shared agents need fence denials, validation, project scope, discovery, compile hints, operator job and principal commands, local timestamps, and a short canonical MCP flow. Changes stay additive.

## Design and scope

In scope: structured write-fence and trust denials; one validation error for every missing compile or remember field; deprecated `subject` and `query` aliases; single-project write-fence fill with `project_id_source`; an unscoped compile hint when several projects are fenced; `titen_whoami` and richer principal data without the raw key; project-resolve subject lookup and close suggestions; compile ids, budget hint, `degraded.reason`, and `consistent_as_of`; `titen jobs` and `titen principal reassign` plus `POST /v1/principals/reassign`; migration 27 `acked_at`; `version` and `schema_version` on `/readyz` and `titen version`; optional `tz` and `TITEN_DISPLAY_TIMEZONE`; dashboard unit `PartOf` and `Wants`; docs for JSONL fences, principal change, canonical flow, and PATH-based MCP commands.

Out of scope: changing `titen --version` away from the bare package version; listing job ids on unauthenticated `/readyz`; guessing a project when a fence lists more than one; exporting fences inside JSONL.

## Acceptance criteria

- **AC-ERG-001 — Unwanted behavior:** If a write fence rejects a subject or a missing or foreign project, then Titen shall return HTTP 403 with the failed field, the allowed lists, and a message that names that check.
- **AC-ERG-002 — Unwanted behavior:** If a trust value is above the key ceiling, then Titen shall return HTTP 403 listing the trust levels that key may use.
- **AC-ERG-003 — Unwanted behavior:** If compile omits `subject_id`, `task`, and `max_tokens`, then Titen shall return one VALIDATION_ERROR that lists all three fields.
- **AC-ERG-004 — Optional feature:** Where a request uses `subject` or `query` and the canonical field is absent, Titen shall accept the alias and report it as deprecated.
- **AC-ERG-005 — Event-driven:** When `project_id` is omitted and the write fence lists exactly one project, Titen shall store and return that project with `project_id_source` `key_fence`.
- **AC-ERG-006 — State-driven:** While a compile omits `project_id` and the write fence lists more than one project, Titen shall keep the compile unscoped and return a hint naming those projects.
- **AC-ERG-007 — Event-driven:** When a caller asks who they are, Titen shall return principal, scopes, allowed trust, and fenced project references, and shall not return the raw key.
- **AC-ERG-008 — Event-driven:** When project resolve receives a subject id or an unknown reference, Titen shall return the fenced projects or close reference suggestions.
- **AC-ERG-009 — Event-driven:** When compile sees unconsolidated observations or a budget that fits no item, Titen shall return ids or a token hint, plus `degraded.reason` and `consistent_as_of`.
- **AC-ERG-010 — Event-driven:** When an owner or admin with `keys:manage` reassigns a principal, Titen shall move private observation and claim ownership, leave source fields in place, and write an audit event. A dry run shall write nothing.
- **AC-ERG-011 — Event-driven:** When an operator acks a failed enrichment job, Titen shall stop that job from marking readiness `terminal_error`, and `/readyz` shall report package version and schema version.
- **AC-ERG-012 — Optional feature:** Where `tz` or `TITEN_DISPLAY_TIMEZONE` is set, Titen shall add parallel local timestamps and leave UTC fields unchanged.
- **AC-ERG-013 — Ubiquitous:** Titen shall describe the canonical remember and compile flow in MCP initialize instructions, and the dashboard unit shall use PartOf and Wants rather than Requires.

## Done conditions

Dual-runtime contract coverage, CLI and unit tests, docs, changelog, and schema 27 on package 0.10.6. Public `/readyz` still omits job ids.
