---
work_id: webhook-registration-boundary-20260804
status: done
stage: done
outcome: completed
complexity: simple
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
spec: docs/specs/done/2026-08-04-webhook-registration-boundary.md
---

# Webhook registration boundary plan

## Steps

- [x] Read issues #239, #240, #246 and trace the queue end to end:
  `processWebhooks` selects events, `queueEvent` selects hooks, and
  `deliverPending` selects organizations with due work. Confirm which of the
  three actually records a delivery row.
- [x] Grep every site that compares a webhook registration time to an event
  time. Three, not the two named in #239: `webhooks.ts:252` (`queueEvent`),
  `webhooks.ts:451` (`processWebhooks`), `maintenance.ts:398`
  (`deliverPending`).
- [x] Write the failing contract case first. Make the same-millisecond
  collision deterministic by pinning the webhook's `created_at` to the latest
  event's `created_at` through `fx.query`, instead of racing the clock. Watch it
  fail on bun:sqlite.
- [x] Change all three predicates from `<=` to `<`. Watch the case pass.
- [x] Narrow the #240 assertion: capture the victim webhook id, list its
  deliveries, and assert that none of the ids in `remoteIds` appears among them.
- [x] Add the owner side as a positive control so the victim assertion cannot
  pass by nothing being queued at all, pinning the owner webhook's `created_at`
  into the past so the fixed `<` boundary cannot make the control flaky in turn.
- [x] Prove the control is live: set the pinned time to 2099 and confirm the
  case fails with `the owner webhook must queue every remote wrapper`. Restore.
- [x] Run the previously flaky case 16 times and confirm 16 passes.
- [x] Add micro-averaged `precision_at_1`/`precision_at_5` and `f1_at_1`/`f1_at_5`
  to `quality()`. The denominator counts results returned across every trial,
  no-result queries included, so junk returned to lift recall is visible.
- [x] Extend the harness self-test with a case whose precision differs from its
  recall, plus the empty-input null case. Prove it is load-bearing by moving the
  no-result `continue` above the denominator and watching the self-test fail.
- [x] Surface precision and F1 in `report.md` and the stdout summary.
- [x] Run `pnpm test:api` (both runtimes), `pnpm test:integration`, and
  `node scripts/check-workflow-docs.mjs`.

## Verification

```
pnpm test:api            # bun:sqlite + Cloudflare D1 through the same CASES array
pnpm test:integration
bun scripts/benchmark-embedding-calibration.ts --self-test
node scripts/check-workflow-docs.mjs
```

## Acceptance evidence

### AC-1, AC-2 — strict registration boundary

Failing first, on the unmodified core:

```
AssertionError: a webhook must never receive an event that predates its own registration
+ actual - expected
+ [ 'evt_5abde8064b2f43188112ebbb43c20a87' ]
- []
(fail) bun-sqlite: a webhook never receives an event recorded in its own registration millisecond
```

Passing after the three-predicate change, on both runtimes through `CASES`:

```
✔ bun-sqlite: a webhook never receives an event recorded in its own registration millisecond
✔ cloudflare-d1: a webhook never receives an event recorded in its own registration millisecond
```

### AC-3 — federation assertion narrowed, control live

Control deliberately broken (owner webhook pinned to 2099):

```
AssertionError: the owner webhook must queue every remote wrapper
+ actual - expected
+ []
- [ 'evt_remote_actor_injection', 'evt_remote_claim_pointer', 'evt_remote_observation_pointer' ]
```

Restored, 16 consecutive runs of the previously 8-in-16 flaky case: 16 pass,
0 fail.

### AC-4, AC-5 — precision and F1

Self-test with the no-result denominator removed (the partial-coverage bug the
issue names):

```
Expected values to be strictly equal:
1 !== 0.5
```

Restored:

```
self-test ok fixture_sha256=463ec1f11086908ef55f86ea321456f6c824062d73ba69683a241268d820ddea
```

## Notes

`deliverPending` in `maintenance.ts` only selects which organizations have due
work; the delivery rows are written by `queueEvent`. Its predicate is fixed for
the same reason regardless: on the old comparison it woke an organization for an
event that can never be delivered.

Precision is micro-averaged rather than macro-averaged so that a query returning
nothing contributes nothing to either side of the ratio, instead of needing an
arbitrary convention for the precision of an empty result set.
