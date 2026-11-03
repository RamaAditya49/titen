---
work_id: bounded-unconsolidated-probe
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-03
updated: 2026-11-03
owner: maintainers
spec: docs/specs/done/2026-11-03-bounded-unconsolidated-probe.md
---
# Bounded unconsolidated-observation probe plan

Goal: make compile cost independent of the subject's observation history while
keeping the #325 signal authorization-correct.

- [x] Add a failing contract case for the window, the capped flag, `at`, and authorization exclusion.
- [x] Replace the two anti-join statements with one windowed statement, bounded by `as_of`.
- [x] Remove the id tie-break from the window so SQLite walks `observations_scope` without a temp sort.
- [x] Apply the access predicate inside the window, so unreadable rows cannot fill it or displace readable ones (review finding on PR #344).
- [x] Add a query-plan guard that fails on a scan or a sort inside the window.
- [x] Measure compile latency on Bun with 200,000 unconsolidated observations, before and after.
- [x] Update the API reference and CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-CTX-001 | Throwaway benchmark (serve + provisionWith, 5 consolidated notes per subject, 200,000 bulk observations in one subject, ANALYZE, median of 5): busy 2.9 ms vs quiet 2.4 ms after (access predicate inside the window); busy 381.8 ms on main |
| AC-CTX-002 | `tests/integration/query-plan.test.ts`: exactly one captured statement, `observations_scope` range, no `SCAN o`, no temp sort in the window; the guard fails when the `o.id DESC` tie-break is restored |
| AC-CTX-003 | Contract case "compile bounds the unconsolidated probe…": 500 inserted rows give count 500, 20 ids, capped true |
| AC-CTX-004 | Same case: `at` one second before the seed gives 0 and no ids, while red on main (1) |
| AC-CTX-005 | Same case: another principal's private note is never counted; existing "compile reports only authorized unconsolidated observations" passes |
| AC-CTX-007 | Same case: another same-org principal's 500 newer private notes leave count 1, the seed id, and no capped flag; fails on the first PR revision (`0 !== 1`) |
| AC-CTX-006 | Existing exact-budget deepEqual case and agent-ergonomics hint assertions pass unchanged |

Caveat: a caller who can read only a few of a subject's observations walks the index further before finding 500 readable rows. That is the price of not leaking hidden rows, and it is bounded by the subject's history as before this change, never worse.

## Rollback

Revert the commit. No schema or stored data changes.

## Verification

Bun/SQLite and the D1 contract harness, after `pnpm build:worker`. No real
Cloudflare or VPS deployment was exercised.
