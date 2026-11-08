---
work_id: webhook-attempt-clock
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-08
updated: 2026-11-08
owner: maintainers
---
# Per-attempt clock for webhook delivery

Issue #384. `drainWebhookQueue` sends due deliveries one after another, and
each dispatch can take up to the 10-second timeout. Every time-dependent value
in the loop came from the single instant captured when the pass started. The
signed `X-Titen-Timestamp` therefore aged by one round trip per delivery, and a
receiver following the documented 300-second rule could reject a fresh
delivery. A lease written late in a long pass could already be expired, letting
a concurrent drain send the same delivery again.

Scope: `src/core/webhooks.ts` (`drainWebhookQueue`, `processWebhooks`,
`drainWebhooks`) and the webhook call site in `src/core/maintenance.ts`. No
schema, API shape, or retry-count change.

## Design

`now` accepts a fixed `Date` (unchanged behaviour, used by existing tests) or a
clock function. With a clock, the drain reads it once to select due work,
again right before each claim (lease expiry, `last_attempt_at`, the claim's
due and lease comparisons, the signed timestamp), and again after each attempt
(retry time, `last_delivery_at`, sibling terminalization). The API route passes
`() => ctx.app.now()`, and background maintenance passes its existing clock
source.

## Acceptance criteria

- **AC-WHK-001 — Event-driven:** When a drain pass sends a delivery, Titen shall set `X-Titen-Timestamp` to within 1 second of the time that delivery's HTTP request starts.
- **AC-WHK-002 — State-driven:** While a delivery's HTTP request is in flight, Titen shall hold a lease whose expiry is at least the request's start time plus the dispatch timeout.
- **AC-WHK-003 — Event-driven:** When two drains run at the same time for the same organization, Titen shall send each pending delivery at most once per attempt.
- **AC-WHK-004 — Event-driven:** When a pass outlasts many slow round trips, Titen shall not sign a later delivery with the pass start time.

## Done conditions

An integration test with an injected clock and a 4-second receiver covers the
timestamp, lease, and concurrent-drain criteria; the existing webhook claim,
retry, and access tests still pass; the contract suite passes on Bun and the
D1 harness.

## Completion evidence

All four acceptance criteria passed; the paired plan maps each to its check.
