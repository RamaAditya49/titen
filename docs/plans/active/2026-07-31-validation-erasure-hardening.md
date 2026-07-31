---
work_id: validation-erasure-hardening-20260731
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-07-31
updated: 2026-07-31
review_after: 2026-08-14
owner: CADIS
spec: docs/specs/active/2026-07-31-validation-erasure-hardening.md
---
# Plan

- [ ] Add path-aware required validation, safe-string checks, sortable timestamp
  validation, and one iterative JSON-depth guard at the shared HTTP boundary.
- [ ] Reject inverted temporal intervals in consolidation and portability
  preflight.
- [ ] Add the scoped observation tombstone and atomically redact dependent
  claims, search/vector projections, history, events, and audit evidence.
- [ ] Mark each compiled/evidence item as untrusted and document the operator,
  temporal, and advisory-injection contracts.
- [ ] Include `SECURITY.md` in the npm package and document the SDK token range.
- [ ] Add focused shared-runtime tests for depth, paths, controls, timestamps,
  purge authorization, redaction, derived-index cleanup, and idempotency.
- [ ] Run affected contract/integration/package gates, route/workflow checks,
  and `git diff --check`; then move this pair to `done/` with exact evidence.

## Acceptance evidence mapping

- AC-VEH-001: deep checkpoint and idempotent-observation contract cases.
- AC-VEH-002: nested claim/source and missing-versus-wrong-type assertions.
- AC-VEH-003: control, bidi, surrogate, tab, and line-feed assertions.
- AC-VEH-004: extended-year and inverted consolidation/import assertions.
- AC-VEH-005/006: same-org, missing-scope, cross-org, repeat-purge, canonical,
  FTS, outbox, history, event, and audit assertions.
- AC-VEH-007: compile and evidence response assertions.
- AC-VEH-008: SDK documentation and packed-file inspection.

## Security, migration, rollback, and smoke

No schema change is required: an observation tombstone binds its retained SHA-256
to the replacement marker, while audit and append-only history prove the action.
Before merge, rollback is branch deletion. After a purge executes, original
readable text can only be recovered from an older protected backup; the public
runbook must say so. This worktree does not deploy or publish.
