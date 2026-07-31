---
work_id: collaboration-integrity
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
---
# Collaboration integrity

## Problem

The collaboration and orchestration surfaces rely on several ordering and
identity assumptions that synchronous SQLite happens to hide. Parallel
handoff resolutions can all report success, concurrent checkpoint saves can
create duplicate heads, credential rotation bypasses idempotency, and random
event IDs are not a durable paging order. Handoffs can also persist invalid or
unreadable references, while operators cannot inspect or recover an active
lease within the roles already represented by the data model.

## In scope

- Make one handoff resolution win atomically and make checkpoint head upserts
  conflict-safe on both D1 and Bun/SQLite.
- Migrate duplicate checkpoint heads deterministically without leaving a
  handoff pointing at a removed duplicate.
- Preflight workspace membership and handoff recipient/context/checkpoint
  references; enforce safe handoff foreign keys.
- Let a recipient read only the exact live checkpoint and currently authorized
  compiled context delegated by a pending or accepted handoff.
- Add a bounded organization-scoped lease listing and allow force-release only
  to an active organization-level `owner` or `admin` membership.
- Scope idempotency to the acting principal across key rotation while retaining
  the originating credential ID for audit and isolating different principals.
- Page events and federation pulls by a database-assigned monotonic sequence,
  while accepting previously issued event-ID cursors.
- Cover concurrency, migration, authorization, rotation, and same-millisecond
  pagination through the shared contract and both runtime adapters.

## Out of scope

- A ULID library, queue, dependency, role framework, ORM, or interactive
  transaction abstraction.
- Handoff expiry, sent-handoff listing, a lease expiry sweeper, or the broader
  team-sharing onboarding documentation from issue #103.
- Deep-JSON parsing/stringification work from issue #119.
- Shared checkpoint version history or the broader future COL-001 redesign.

## Acceptance criteria

- **AC-CIN-001 — Event-driven:** When concurrent authorized callers resolve one
  pending handoff, Titen shall commit exactly one terminal resolution and one
  matching event, while every other caller receives a non-success response.
- **AC-CIN-002 — Event-driven:** When concurrent callers save the same
  organization, subject, agent, and kind, Titen shall retain exactly one
  reachable checkpoint head containing one complete submitted state.
- **AC-CIN-003 — Unwanted behavior:** If a membership or handoff references a
  foreign, missing, cross-organization, inaccessible, expired, or mismatched
  workspace/context/checkpoint/recipient, then Titen shall reject it before the
  foreign-key write without exposing another scope.
- **AC-CIN-004 — State-driven:** While a pending or accepted handoff delegates a
  checkpoint or context to its intended recipient, Titen shall let that
  recipient read only the referenced resource and shall recheck current claim
  authorization before returning context items.
- **AC-CIN-005 — Ubiquitous:** Titen shall return at most 200 organization-bound
  lease records per introspection request and shall require an active
  organization-level `owner` or `admin` membership for force-release.
- **AC-CIN-006 — Event-driven:** When the same principal retries an identical
  mutation with the same idempotency key after credential rotation, Titen shall
  replay the original result, retain the original key ID for audit, and keep a
  different principal's key space separate.
- **AC-CIN-007 — Event-driven:** When multiple events share one timestamp and a
  caller or federation peer advances a cursor through bounded pages, Titen
  shall return every authorized event once in database commit order and shall
  continue accepting legacy event-ID cursors.
- **AC-CIN-008 — Unwanted behavior:** If the integrity migration encounters
  duplicate checkpoint heads or dangling/cross-scope handoff references, then
  Titen shall deterministically preserve the newest head, repair safe
  references, retire unsafe references, and complete identically on D1 and
  Bun/SQLite.

## Done conditions

The focused regressions, dual-runtime contract, integration/migration, route,
workflow, and diff checks pass; the implemented API/data-model/changelog text
matches behavior; deferred issue #103 and #119 work is explicit; and this spec
and its plan move together to `done` with terminal evidence.
