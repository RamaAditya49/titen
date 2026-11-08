---
work_id: org-scoped-event-scans
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-08
updated: 2026-11-08
owner: maintainers
spec: docs/specs/done/2026-11-08-org-scoped-event-scans.md
---
# Organization-scoped event scans plan

Goal: the cost of an event scan follows the new events of one organization.

- [x] Add failing tests: plan guards for the three scans, a v27 migration fixture, and contract cases for interleaved paging and repeated delivery passes.
- [x] Add migration 28 with `event_order.org_id`, its backfill, the `(org_id, seq)` index, the replaced trigger, and `webhooks.scanned_seq`.
- [x] Filter `listEvents` and the federation pull by `eo.org_id` with an always-present `eo.seq` lower bound.
- [x] Scan each webhook from `scanned_seq` in `processWebhooks` and move the mark in the same batch as the delivery inserts.
- [x] Select organizations in `deliverPending` from `scanned_seq` through the `(org_id, seq)` index.
- [x] Registration sets `scanned_seq` to the current head.
- [x] API reference note and CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-EVT-001 | `tests/integration/query-plan.test.ts`: the maintenance selection and the webhook scan plan as an `event_order_org_seq` range on `org_id` and `seq` |
| AC-EVT-002 | Contract case "a webhook queues each matching event once across several delivery passes": five owed events, passes of two, one delivery each, mark at head, a later pass drains zero |
| AC-EVT-003 | Plan guard for `listEvents`, and the contract case "event paging returns exactly the caller's events in sequence order when other organizations interleave", including a caught-up poll |
| AC-EVT-004 | Not adopted. The `/v1/events` response shape is unchanged |
| AC-EVT-005 | `assertPopulatedV27EventOrderMigration` on SQLite and the D1 harness: every row backfilled, every `seq` equal, new events fill `org_id` |

The registration-millisecond case also asserts that `scanned_seq` starts at the
registration sequence.

## Rollback

Revert the commit. Migration 28 is forward-only. The old binary refuses a store
at a newer schema, so roll back with a database backup taken before the upgrade.

## Verification

`bun test tests/contract/bun-sqlite.test.ts`, `pnpm test:d1`,
`bun test tests/integration`, `pnpm typecheck:maintained`,
`node scripts/check-workflow-docs.mjs`, and `node scripts/check-ponytail-debt.mjs`.
`node scripts/check-schema-version.mjs` fails until the release bump. No
measured timing was taken in this change.
