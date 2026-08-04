---
work_id: webhook-registration-boundary-20260804
status: done
stage: done
outcome: completed
complexity: simple
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
---

# Webhook registration boundary, federation assertion, calibration precision

## Outcome

Completed. The webhook queue no longer admits an event that shares its
registration millisecond, the federation contract case asserts on the remote
wrapper ids it names instead of a queue total, and the embedding calibration
harness reports precision@k and F1@k alongside recall. Closes issues #239,
#240, and #246.

## Problem

Three defects reported from the `v0.5.7` release-bound benchmark on `rama-tuf`,
all landing on the same event queue or on the harness that measures retrieval.

**#239 — inclusive registration boundary.** `src/core/webhooks.ts` and
`src/core/maintenance.ts` compared a webhook's `created_at` to an event's
`created_at` with `<=`. Both are millisecond-precision ISO-8601 strings, so a
webhook registered inside the same millisecond as an already-recorded event
matched that event and queued it. An instrumented probe drained one unexpected
row in 10 of 40 iterations with a 1:1 correlation to a string-equal
`created_at`; a 3 ms sleep before registration made it 0 of 40. The delivered
row was always the subscriber's own pre-existing event, so the impact is one
spurious at-least-once delivery, not a leak — but a webhook must never receive
an event that predates its own registration.

**#240 — over-broad contract assertion.** The case
`federation push stores remote identity as an owner-visible untrusted wrapper`
asserted `events_drained === 0` with the message
"the victim webhook must not queue remote wrappers". `events_drained` is the
total for that drain, including the subscriber's own legitimate events, so #239
made the assertion fail 8 of 16 bun:sqlite runs with a message that reads as a
cross-tenant leak. Instrumentation over 48 iterations showed zero remote
wrappers were ever queued: the product behaviour was correct and the assertion
was measuring the wrong quantity.

**#246 — no precision in the calibration harness.**
`scripts/benchmark-embedding-calibration.ts` computed recall@1, recall@5,
MRR@10 and nDCG@10 but no precision and no F1. `no_result_false_positive` is a
partial proxy that only covers queries whose ground truth is "nothing", so the
harness could not answer whether recall was bought with precision.

## Scope

- The three sites that compare a webhook registration time to an event time.
- The one federation contract case named in #240.
- The `quality()` function, report, stdout summary, and self-test of the
  calibration harness.

Out of scope: the federation authorization boundary itself (verified intact by
#239's own analysis and by `eventAccessSql`), delivery retry semantics, and any
change to the benchmark fixture, split, or threshold selection.

## Acceptance criteria

**AC-1 — Ubiquitous:** The system shall queue a webhook delivery only for
events whose `created_at` is strictly later than the webhook's own
`created_at`.

**AC-2 — Event-driven:** When a webhook is registered with a `created_at`
string-equal to an existing event's `created_at`, the system shall record no
delivery for that event.

**AC-3 — Ubiquitous:** The federation contract case shall assert that no
delivery queued for the victim webhook carries a remote wrapper id, and that
every remote wrapper id is queued for the owner webhook.

**AC-4 — Ubiquitous:** The calibration harness shall report `precision_at_1`,
`precision_at_5`, `f1_at_1`, and `f1_at_5` for every group it summarises.

**AC-5 — Event-driven:** When a run returns results for a query whose ground
truth is "nothing", the harness shall count those results in the precision
denominator.

## Verification

- AC-1, AC-2: contract case
  `a webhook never receives an event recorded in its own registration
  millisecond`, run on bun:sqlite and Cloudflare D1 through the same `CASES`
  array. It pins the webhook's `created_at` to the latest event's `created_at`
  through `fx.query`, so the collision is deterministic rather than
  timing-dependent.
- AC-3: the narrowed assertions in the existing federation case, with the owner
  side as a live positive control.
- AC-4, AC-5: `bun scripts/benchmark-embedding-calibration.ts --self-test`.

## Non-goals

No new dependency, no schema change, no metric renamed or removed. Precision is
additive to `summary.json`; the raw trial schema version is unchanged because
raw trials are untouched.
