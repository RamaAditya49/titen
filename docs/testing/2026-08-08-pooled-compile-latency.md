# The published 0.7.1 cannot serve a large single-subject store

Date: 2026-08-08. Protocol
[pre-registered](./2026-08-08-pooled-compile-latency-prereg.md) before the
scored A/B; spec and plan are
[`2026-08-08-pooled-compile-latency`](../specs/active/2026-08-08-pooled-compile-latency.md).

Verdict up front. **`titen-memory@0.7.1`, the current npm `latest`, takes a
median 74.5 seconds to compile one context** on a 342,129-claim single-subject
store. 0.7.0 did the same work in under half a second. The cause is a query
the release believed it had fixed. The fix here restores the old behaviour
**byte-for-byte** — equal sha256 over all 500 ranked outputs — and does **not**
clear the pre-registered 250 ms gate, so **falsifier 3 fired exactly as
predicted** and the 2026-08-07 latency falsifier still stands.

## What happened

[#291](https://github.com/RamaAditya49/titen/issues/291) made the `disputed`
flag resolve through the caller's own authorization. That fix shipped in 0.7.1
and introduced a join:

```sql
EXISTS (SELECT 1 FROM claim_sources s
        JOIN observations o ON o.id = s.observation_id
        WHERE s.claim_id = c.id AND s.relation = 'contradicts' AND …)
```

`src/core/authorization.ts` carries a long comment explaining that this
predicate **must** seek `claim_sources` first, because driving from
`observations` scans the organization once per candidate — measured at 79
seconds on a 424,168-claim store during the 2026-08-07 work. The comment
describes a nested `EXISTS`. The code shipped a join, and **a join inside
`EXISTS` is still a join the planner may reorder.**

SQLite 3.53.0 — the version Bun 1.3.14 links — reorders it. Captured from
`bun:sqlite` against the real statement, obtained by calling the shipped query
builder with a capturing `Db` stub rather than pasting SQL:

```text
0.7.1 as published                        this release
  CORRELATED SCALAR SUBQUERY 6              CORRELATED SCALAR SUBQUERY 7
  SEARCH o USING INDEX                      SEARCH s USING COVERING INDEX
    observations_workspace_scope (org_id=?)   sqlite_autoindex_claim_sources_1 (claim_id=?)
  …                                         SEARCH o EXISTS USING INDEX
  SEARCH s USING COVERING INDEX               sqlite_autoindex_observations_1 (id=?)
    sqlite_autoindex_claim_sources_1 (…)
```

The left column is the 79-second shape, back in the release that believed it
had prevented it.

## Measured

Store: read-only copies of the 2026-08-07 pooled store — 19,829 sessions,
342,129 claims, 19,829 observations, one org, one subject, **zero** rows with
`relation = 'contradicts'`, zero retention exclusions. Every candidate takes
the *false* branch, so this is the cost of proving a contradiction absent — the
common case, not a worst case. Host `rama-tuf`, loopback, concurrency 1.

| | candidate query, real statement | served compile |
| --- | ---: | ---: |
| **0.7.1 as published** (npm tarball) | 73,439 ms (median of 3) | **74,474 ms** (median of 5: 75,894 / 73,822 / 73,566 / 75,636 / 74,474) |
| **This release** (nested `EXISTS`) | 232 ms (median of 20) | **417 ms p50, 864 ms p95, 1,072 ms p99** (500 questions) |

The candidate CTE alone costs 292 ms, so under 0.7.1 more than 99.6% of the
compile is the `disputed` subquery; after the fix the full query costs
essentially what its CTE costs.

**Output identity, the load-bearing check.** The fixed build's 500 ranked
lists are byte-identical to the published 2026-08-07 pooled run: equal sha256
over the whole map, 500 of 500 instances, recall@1 0.246 / recall@5 0.444 /
recall@10 0.508 / MRR@10 0.3259 in both. This restores the shipped answer
rather than changing it, which is AC-PCL-002 satisfied against the strongest
available reference.

## Gate verdicts

| Gate | Verdict |
| --- | --- |
| AC-PCL-001, pooled p95 ≤ 250 ms | **FAIL — 864 ms.** Falsifier 3 fired. |
| AC-PCL-002, byte-identical output | **PASS**, equal sha256, 500/500. |
| AC-PCL-006, dual-runtime contract suite | **PASS** — 113/113 bun-sqlite, 122/122 D1. |

**The prereg predicted this exact outcome**, in these words: "the fix alone is
expected to *restore* the old failure rather than pass the gate, and falsifier
3 firing is the most likely single outcome." The published 864.9 ms figure was
never beaten; it was returned to.

## Who is affected, and why nothing caught it

The cost is the product of candidate rows and organization-wide observations.
A store with few observations, or one that compiles with a small
`max_candidates`, pays almost nothing — which is why:

- **the contract suite passed on both shapes.** Its stores hold tens of rows,
  so the bad plan still returns the right answer in microseconds;
- **no published benchmark saw it.** Every pooled and anchor figure in
  `docs/testing/` was measured on the **0.7.0** tarball. The join arrived in
  0.7.1, after those runs;
- **the 2026-08-07 #291 measurement did not see it either.** It ran on the
  per-instance store at `top_k=5`, where each subject holds ~850 claims.

A single-subject store of this size is exactly the shape the pooled-store work
exists to measure, and it is the shape a long-lived per-user deployment
approaches.

## The guard, and the thing that makes it cheap

`tests/integration/query-plan.test.ts` asserts the **plan shape** of the
candidate query, the by-id hydration, and authorized-source loading. Reverting
the fix fails two of the three.

The discovery that makes this worth having: **the bad plan reproduces on an
empty store.** SQLite chooses this join order from the schema, not from row
counts. Both regressions — 2026-08-07's and this one — were catchable in
milliseconds by any test that looked at the plan instead of the result. The
guards assert the plan and never a duration; a timing assertion on this
hardware would be flaky, and the plan is what regressed.

## Corrections made while running this

Recorded because the first version of each was wrong and would have been
published:

1. **The first workload was pathological.** The probe initially drew its
   "questions" from long claim statements, which yield sixteen corpus-common
   terms whose disjunction matches a large fraction of the store — a case the
   product never serves. Re-run against the real benchmark question set.
2. **The first "0.7.1 served" measurement was 0.7.0.** The benchmark directory
   held a tarball installed before 0.7.1 existed, and it produced a 1.3-second
   median that contradicted the raw-statement timing by 56x. The contradiction
   was the tell; installing the genuine 0.7.1 resolved it. No number from that
   run appears above.
3. **`crossProject` was briefly suspected** of explaining the gap and was
   ruled out by measurement (73.4 s with the served value), not by argument.

## What this does not show

- **No concurrency, no throughput.** Concurrency 1, one process, loopback.
- **No D1 measurement.** The regression is a SQLite planner choice; D1's
  planner was not profiled, and no D1 latency claim is made here. The contract
  suite passes on both.
- **No claim that the fix is fast.** It is not: 864 ms p95 still fails the
  pre-registered gate, and the remaining cost is the candidate CTE plus
  packing. Making *that* fast is unfinished work, tracked in
  [#294](https://github.com/RamaAditya49/titen/issues/294).
- **Stores with real contradicting evidence were not measured.** This store has
  none, so the `EXISTS` always fails. A store where it frequently succeeds may
  behave differently in either direction.

## Evidence

Artifacts on `rama-tuf` under `~/titen-bench-20260808/` (both plans, both
timing sets, the 500-question served run) and
`~/titen-bench-20260804/results/titen-fts-pooled-19829-20260808-headfix.json`.
Checksummed copies under
[`results/2026-08-08-pooled-compile-latency/`](./results/2026-08-08-pooled-compile-latency/).
