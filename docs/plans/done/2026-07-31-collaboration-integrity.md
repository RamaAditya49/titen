---
work_id: collaboration-integrity
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
spec: docs/specs/done/2026-07-31-collaboration-integrity.md
---
# Plan

- [x] Reproduce the reported assumptions against current source and trace every
  collaboration, idempotency, event, federation, and migration caller.
- [x] Add the smallest forward migration for checkpoint uniqueness, safe
  handoff references and resolution fencing, principal idempotency, and
  database-assigned event order.
- [x] Replace checkpoint and handoff select-then-write races with native
  single-statement upsert or uniqueness-fenced batches.
- [x] Preflight references and add bounded delegated reads, lease inspection,
  and role-gated force-release without expanding the role model.
- [x] Move idempotency lookup/write scope from credential to principal while
  preserving the original key ID as audit data.
- [x] Move event and federation paging to a monotonic internal sequence with
  legacy event-ID resolution.
- [x] Add shared concurrency, cross-scope, key-rotation, same-millisecond, and
  populated-schema migration regressions on Bun/SQLite and D1.
- [x] Update only the implemented API, data model, collaboration notes, and
  Unreleased changelog entries affected by observable behavior.
- [x] Run focused tests, the dual-runtime API suite, integration tests, route
  and workflow checks, and `git diff --check`; record evidence and move this
  pair to `done`.

## Acceptance evidence

- AC-CIN-001: twelve concurrent D1 and Bun resolution attempts produced one
  `handoff_resolutions` row and one accepted/rejected event; the latency wrapper
  repeated the race with 15 ms reads.
- AC-CIN-002: twelve concurrent saves returned one create and eleven updates,
  one stable checkpoint ID, and one persisted head on both runtimes.
- AC-CIN-003: missing, cross-organization, wrong-subject, expired, private, and
  invalid-workspace references returned `404`; schema-v11 migration tests
  retired dangling/cross-scope pointers.
- AC-CIN-004: the exact recipient read a pending and accepted checkpoint/context,
  a sibling received `404`, and membership revocation closed context access
  while the explicitly delegated checkpoint remained readable.
- AC-CIN-005: lease pages were capped at 200 and traversed by cursor; another
  organization saw zero rows, a member was denied, and an organization admin
  force-released the target.
- AC-CIN-006: a revoked-key retry through a rotated credential replayed the
  original observation, retained the first `key_id`, and another principal
  committed an independent result.
- AC-CIN-007: page-size-one event reads and 200-plus-8 federation pages returned
  all 208 equal-timestamp events in database sequence while the public cursor
  remained an event ID.
- AC-CIN-008: the shared populated-v11 helper passed on Miniflare D1 and
  Bun/SQLite, including checkpoint deduplication, handoff repair, principal
  idempotency convergence, foreign keys, trigger creation, and rollback.

## Verification

- `pnpm test:api` passed: 81 D1 migration/contract cases and 98 Bun, vector,
  and SDK cases.
- `pnpm test:integration` passed: 74 cases across 13 files, including the
  documented small-team golden path and the latency race.
- `pnpm check:routes` passed with 55 implemented routes.
- `node scripts/check-workflow-docs.mjs` and its `--self-test` passed before
  terminal close; both are rerun after this move.
- `git diff --check` passed and is rerun on the terminal diff.

Issue #103's sent-handoff listing, handoff expiry, lease expiry sweeper, and
broader team onboarding remain consciously deferred. Issue #119's deep-JSON
guard/canonicalization work also remains outside this FK/preflight-only batch.
No production deployment or npm publication was performed from this isolated
implementation branch.
