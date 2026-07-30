---
work_id: issue-31-operator-work-queue
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: Wulan
spec: docs/specs/done/2026-07-30-operator-work-queue.md
---

# Operator work queue plan

## Steps

- [x] Add an append-only portable queue schema migration with indexes and completion idempotency storage.
- [x] Implement bounded shared-core handlers with membership/policy checks and conditional claim/fencing writes.
- [x] Register routes and add SDK methods/types without adding an orchestrator abstraction.
- [x] Update API, data-model, architecture, and route inventory documentation.
- [x] Add shared contract cases for lifecycle, claim concurrency, lease expiry/reassignment, stale rejection, completion idempotency, requeue, event redaction, and cross-scope denial.
- [x] Run workflow checks, shared runtime tests when available, SDK tests, build, and Worker dry-run; record exact limitations.
- [x] Review diff and rollback, move this pair to done, commit with `Closes #31`, and push the branch.

## Evidence mapping

- **AC-Q-001:** Shared create/list contract and `work_item.created` event assertions.
- **AC-Q-002:** Shared concurrent claim regression asserting one winner and increasing lease version after expiry/requeue.
- **AC-Q-003:** Shared heartbeat renewal contract and event assertion.
- **AC-Q-004:** Shared stale token/version regressions after reassignment.
- **AC-Q-005:** Shared duplicate completion and conflicting idempotency payload tests.
- **AC-Q-006:** Shared retry/requeue lifecycle and reclaim tests.
- **AC-Q-007:** Shared missing-scope, workspace-membership, and cross-organization denial tests.
- **AC-Q-008:** Event payload assertions proving tokens and work/completion payloads are absent.
- **AC-Q-009:** Route inventory check, SDK tests, API docs, Worker dry-run, and both runtime contract entrypoints.

## Security, migration, deployment, smoke, rollback

- Security: opaque token is accepted only with claimant identity and exact lease version; audit payloads exclude sensitive queue data.
- Migration: append one forward-only migration using SQLite/D1-compatible statements; existing rows are untouched.
- Deployment: not applicable; this work does not deploy or change CI/CD.
- Smoke: Worker dry-run plus shared contract/runtime checks where local runtimes exist.
- Rollback: revert application routes first; the additive tables may remain inert because destructive down migrations are prohibited.

## Acceptance evidence

- AC-Q-001/007/008: create/list handlers, workspace membership checks, route scopes, and redacted `work_item.created` contract/event assertion.
- AC-Q-002/003/004: conditional claim update plus shared concurrent claim, heartbeat, identity/token/version and stale-after-requeue regressions.
- AC-Q-005/006: claimant-scoped completion idempotency and requeue/reclaim contracts.
- AC-Q-009: SDK methods/types, API/data-model/collaboration docs, six-route inventory, Worker dry-run PASS, shared Bun/D1 contract definitions updated.
- Local gates: build PASS; Worker dry-run PASS; workflow and self-test PASS; route inventory PASS; diff check PASS. Bun unavailable, so runtime contract and SDK test execution is explicitly deferred to a Bun-capable reviewer environment.

## Verification

`pnpm build`, `pnpm build:worker`, `pnpm check:workflow`, route inventory, and `git diff --check` passed. Bun unavailable, so Bun-dependent runtime suites were not locally executable.
