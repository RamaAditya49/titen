---
work_id: org-scoped-event-scans
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-08
updated: 2026-11-08
owner: maintainers
---
# Organization-scoped event scans

Issue #361. `event_order` is one sequence for the whole deployment and has no
organization column. Every event consumer walked it from a fixed point and
joined `events` to filter by organization. The fixed point never moved past
rows that the consumer skipped. The cost of each scan therefore grew with every
event ever written, including events of other organizations.

Three consumers were affected: webhook maintenance (every pass, for every
active webhook), `GET /v1/events` polls from a caught-up client, and federation
pull. The issue measured a 151.7 ms maintenance pass and a 93.5 ms caught-up
poll with 200,000 events in another organization.

Scope: `src/core/migrations.ts`, `src/core/events.ts`, `src/core/webhooks.ts`,
`src/core/maintenance.ts`, `src/core/federation.ts`. Global `seq` stays the
single ordering. The `data.cursor` rule from #196 and the `/v1/events` response
shape do not change.

## Design

Migration 28 adds `event_order.org_id`, backfills it from `events`, adds the
index `event_order_org_seq (org_id, seq)`, and replaces the `events_assign_order`
trigger so that it fills `org_id`. Migration 28 also adds `webhooks.scanned_seq`,
set to `created_seq` for existing webhooks.

Event listing and federation pull filter `eo.org_id = ? AND eo.seq > ?`. The
lower bound is always present, so SQLite seeks the organization range.

A delivery pass reads the head sequence, then scans each active webhook from its
own `scanned_seq` up to that head. A short page means the whole range was
examined, so the mark moves to the head. A full page moves the mark to its last
row. The mark moves in the same batch that inserts the delivery rows, and only
while the webhook is active. The `webhook_deliveries_event` uniqueness keeps
delivery at least once and queues each event once.

An event that the webhook owner cannot read, or that does not match the
subscribed kinds, when it is first examined is not delivered later. Before this
change a later pass could still queue it.

Part 3 of the issue, `meta.scan_cursor`, is not adopted. The maintainers have
not chosen between that shape and a per-request scan cap. The org-scoped seek
already bounds a caught-up poll by the new events of the caller's organization.

## Acceptance criteria

- **AC-EVT-001 — Event-driven:** When an organization has one active webhook and all of its events are delivered, Titen shall complete a maintenance pass without examining events of other organizations.
- **AC-EVT-002 — Event-driven:** When a webhook pass examines events up to sequence S, Titen shall not re-examine events with `seq` at or below S for that webhook, and shall queue each matching event exactly once.
- **AC-EVT-003 — Event-driven:** When a caught-up client polls `GET /v1/events` with its last cursor and no new visible event exists, Titen shall examine only events of the caller's organization written after that cursor.
- **AC-EVT-004 — Event-driven:** When `meta.scan_cursor` is adopted and passed back, Titen shall not re-examine events at or before it. Not adopted.
- **AC-EVT-005 — Event-driven:** When the migration runs on an existing store, Titen shall backfill `event_order.org_id` for every row and preserve every existing `seq`.

## Done conditions

The plan-shape guard, the migration fixture, and the three contract cases pass.
The Bun contract suite, the D1 contract suite, and the integration folder pass.

## Completion evidence

AC-EVT-001, 002, 003, and 005 passed. AC-EVT-004 is not adopted. The paired
plan maps each criterion to its check.
