---
work_id: webhook-attempt-clock
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-08
updated: 2026-11-08
owner: maintainers
spec: docs/specs/done/2026-11-08-webhook-attempt-clock.md
---
# Webhook attempt clock plan

Goal: every delivery attempt is signed and leased with its own time.

- [x] Add a failing integration test: six deliveries, a receiver that advances an injected clock by 4 s per request, and a second drain started during the fifth request.
- [x] Accept `Date | (() => Date)` as `now` in `drainWebhookQueue` and `processWebhooks`.
- [x] Read the clock before each claim for the lease, `last_attempt_at`, claim comparisons, and `X-Titen-Timestamp`, and after each attempt for the retry time, `last_delivery_at`, and sibling terminalization.
- [x] Pass `() => ctx.app.now()` from `POST /v1/webhooks/deliver` and the maintenance clock source from background delivery.
- [x] CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-WHK-001 | Integration test "each webhook attempt signs its own start time…": every `X-Titen-Timestamp` is within 1 s of the injected clock at dispatch |
| AC-WHK-002 | Same test: `lease_expires_at` read during each dispatch is at least start + 10 000 ms |
| AC-WHK-003 | Same test: a second drain started 16 s into the pass leaves exactly 6 dispatches for 6 distinct deliveries |
| AC-WHK-004 | Same test: with the clock read once per pass instead, the timestamp assertion fails for the second delivery |

## Rollback

Revert the commit. No schema or data change; leases and retries resume using
the pass start time.

## Verification

`bun test` on the touched file, `pnpm test:api` (Bun contract, D1 harness and
Miniflare D1 contract), `pnpm test:integration`, and `pnpm check:workflow`. A
real Cloudflare scheduled handler was not exercised.
