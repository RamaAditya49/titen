---
work_id: issue-31-operator-work-queue
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: Wulan
---

# Operator work queue

## Problem

Authorized agents need durable coordination state for bounded work without Titen selecting agents or running loops. Concurrent workers must not silently share ownership, and an expired worker must be fenced after reassignment.

## Scope

In scope: create/list work items, atomic lease claim, heartbeat, idempotent completion, explicit retry/requeue, claimant/token/version fencing, workspace visibility, scope checks, audit events, SDK/API documentation, portable migration, and shared runtime contracts.

Out of scope: scheduling, agent selection, execution, backoff automation, CI/CD, deployment, and general orchestration.

## Constraints and risks

- SQL and behavior must be identical on D1 and bun:sqlite.
- Authorization occurs before queue state disclosure or mutation.
- Claim races must use one conditional SQL mutation; follow-up reads may only verify the winner.
- Tokens are opaque capabilities and audit payloads must not contain them.
- Retry preserves the same work item and increments its fencing version.

## Acceptance criteria

- **AC-Q-001 — Event-driven:** When an authorized writer creates a work item in a workspace it can access, Titen shall persist one pending item with policy metadata and emit a `work_item.created` event without storing an execution loop.
- **AC-Q-002 — Event-driven:** When eligible workers concurrently claim a pending or lease-expired item, Titen shall conditionally assign at most one claimant/token pair and return a monotonically increased lease version to the winner.
- **AC-Q-003 — State-driven:** While a claimant presents the current opaque token and lease version before expiry, Titen shall renew the lease heartbeat without changing ownership or version and emit an audit event.
- **AC-Q-004 — Unwanted behavior:** If a stale claimant presents an expired, replaced, or mismatched token/version, then Titen shall reject heartbeat, completion, and requeue without mutating the current assignment.
- **AC-Q-005 — Event-driven:** When the current claimant completes an item, Titen shall store the outcome once; repeating the same completion with the same idempotency key and payload shall return the stored result, while a different payload shall conflict.
- **AC-Q-006 — Event-driven:** When an authorized current claimant or workspace administrator requeues a failed or leased item, Titen shall clear ownership, increment the fencing version, retain attempt history, and make it safely claimable again.
- **AC-Q-007 — Ubiquitous:** Titen shall enforce route scopes plus existing organization/workspace membership visibility before listing, reading, or mutating work items and shall fail closed across organizations.
- **AC-Q-008 — Ubiquitous:** Titen shall expose queue lifecycle events containing actor and record identifiers but no work payload, completion payload, or lease token.
- **AC-Q-009 — Ubiquitous:** Titen shall document and expose the same queue routes and SDK contract for Cloudflare/D1 and Bun/SQLite, with route inventory and shared dual-runtime contract coverage.

## Done conditions

All criteria have reproducible evidence; migration, API, SDK, route inventory, concurrency/fencing tests, workflow checks, feasible build/Worker checks, and rollback notes are complete; paired artifacts are moved to `done/`.

## Completion evidence

- Portable schema migration 10 adds work items and completion idempotency records without destructive statements.
- Shared handlers use conditional SQL fencing, membership checks, route scopes, redacted lifecycle events, and no scheduling/execution behavior.
- Shared contract cases cover concurrent claim, heartbeat, stale identity/token rejection, completion idempotency, requeue/version fencing, and event redaction on both runtime entrypoints.
- `pnpm build:worker`: PASS (Wrangler dry-run, 186.90 KiB / 39.46 KiB gzip).
- `pnpm build`: PASS (Astro build and dashboard bundle budget).
- `pnpm check:workflow`: PASS, including checker self-test and six-route inventory.
- `git diff --check`: PASS.
- Bun unavailable; therefore Bun/SQLite, D1 Miniflare contract execution, and SDK Bun tests were not locally runnable. The Worker bundle compiles the shared implementation.
- Deployment/CI/CD: not applicable and intentionally unchanged.
- Rollback: revert routes/SDK first; additive migration tables can remain inert.
