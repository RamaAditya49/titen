---
work_id: validation-erasure-hardening-20260731
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
spec: docs/specs/done/2026-07-31-validation-erasure-hardening.md
---
# Plan

- [x] Add path-aware required validation, safe-string checks, sortable timestamp
  validation, and one iterative JSON-depth guard at the shared HTTP boundary.
- [x] Reject inverted temporal intervals in consolidation and portability
  preflight.
- [x] Add the scoped observation tombstone and atomically redact dependent
  claims, search/vector projections, history, events, and audit evidence.
- [x] Mark each compiled/evidence item as untrusted and document the operator,
  temporal, and advisory-injection contracts.
- [x] Include `SECURITY.md` in the npm package and document the SDK token range.
- [x] Add focused shared-runtime tests for depth, paths, controls, timestamps,
  purge authorization, redaction, derived-index cleanup, and idempotency.
- [x] Run affected contract/integration/package gates, route/workflow checks,
  and `git diff --check`; then move this pair to `done/` with exact evidence.

## Acceptance evidence mapping

- AC-VEH-001: deep checkpoint and idempotent-observation contract cases.
- AC-VEH-002: nested claim/source and missing-versus-wrong-type assertions.
- AC-VEH-003: control, bidi, surrogate, tab, and line-feed assertions.
- AC-VEH-004: extended-year and inverted consolidation/import assertions.
- AC-VEH-005: same-org, repeat-purge, canonical, FTS, outbox, history,
  event, and audit assertions.
- AC-VEH-006: missing-scope and cross-organization non-disclosure assertions.
- AC-VEH-007: compile and evidence response assertions.
- AC-VEH-008: SDK documentation and packed-file inspection.

## Security, migration, rollback, and smoke

No schema change is required: an observation tombstone binds its retained SHA-256
to the replacement marker, while audit and append-only history prove the action.
Before merge, rollback is branch deletion. After a purge executes, original
readable text can only be recovered from an older protected backup; the public
runbook must say so. This worktree does not deploy or publish.

## Verification evidence

- Bun shared contract: 77 passed, including four new hardening cases.
- Cloudflare D1 shared contract: 80 passed, including the same cases.
- Integration suite: 74 passed; vector contract: 11 passed; SDK suite: 14 passed.
- Worker dry-run, 52-route documentation check, workflow check and self-test,
  strict README `seng-jelas`, and `git diff --check`: passed.
- Package verifier: clean install, `SECURITY.md`, README security configuration,
  SDK imports, CLI bootstrap/serve, readiness, nine-tool MCP negotiation, and
  custom-prefix binary smoke passed.
- Independent review found and then cleared purge/consolidation races and both
  explicit/background vector-deletion paths, including repeat-purge behavior.
