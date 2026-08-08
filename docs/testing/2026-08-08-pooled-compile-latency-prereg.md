# Pre-registration — pooled compile latency, the `contradictedSql` join order

Date: 2026-08-08. Committed before the first scored A/B run, per
[the spec](../specs/done/2026-08-08-pooled-compile-latency.md) AC-PCL-001 and
the standing rule that a protocol written after a number is not a protocol.

## What H0 already established, before this prereg

H0 was diagnostic and changed no product code. Two of its findings are the
reason this prereg exists, and both are recorded here before the A/B runs:

1. **The runtime plan is the bad one.** `EXPLAIN QUERY PLAN` captured from
   `bun:sqlite` (Bun 1.3.14, **SQLite 3.53.0**) for the real
   `retrieveClaimCandidates` statement — obtained by calling the shipped query
   builder with a capturing `Db` stub, never by pasting SQL — shows the
   `contradictedSql` subquery planning as
   `SEARCH o USING INDEX observations_workspace_scope (org_id=?)`: it drives
   from `observations` and scans the organization once per candidate row. That
   is the exact shape `src/core/authorization.ts` documents as the historical
   79-second failure, in a release that believed the nested-`EXISTS` comment
   described its own code. The code shipped a **join inside** the `EXISTS`,
   which the planner is free to reorder, and 3.53.0 reorders it.
2. **The published pooled latency numbers describe different code.** Every
   published pooled figure (compile p50 424.7 ms, p95 864.9 ms) was measured on
   the `titen-memory@0.7.0` tarball. The `contradictedSql` observations join
   arrived with the #292 fix in **0.7.1**. The 0.7.0 predicate was a bare
   `EXISTS` over `claim_sources` with no join, so no published number bounds
   HEAD's behaviour and none may be used as this work's baseline.

Store used throughout: a read-only copy of the 2026-08-07 pooled store —
19,829 sessions, 342,129 claims, one org, one subject (`pooled-v1`), 19,829
observations, **zero** rows with `relation = 'contradicts'`, zero retention
exclusions, all claims `private`. Every candidate therefore takes the *false*
branch of the predicate: this measures the cost of proving a contradiction
absent, which is the common case, not a worst case.

## Arms

| Arm | Code | What it is |
| --- | --- | --- |
| A | HEAD at `33db2d7` (= published 0.7.1 shape) | the join spelling; the baseline |
| B | A + the nested-`EXISTS` rewrite of `contradictedSql` | the candidate fix |

B changes one SQL fragment. It adds no dependency, no migration, no flag, and
no new query surface; `recordAccessParams` binding order is unchanged, which is
itself an assertion the contract suite checks.

## Cells

1. **Raw statement timing**, both arms, the real `retrieveClaimCandidates`
   statement bound with real ids, 20 questions from the benchmark set (not
   synthesised text — a long claim statement yields sixteen corpus-common terms
   whose disjunction matches a large fraction of the store, a case the product
   never serves), median and full sample list published.
2. **Served compile**, both arms, 500 questions against the served pooled
   store, concurrency 1, loopback, quiet box, p50/p95/p99.
3. **Scoped anchor baseline pair**, arm B only if arm A is intractable:
   two independent HEAD-served runs on a copy of the per-instance store, whose
   spread defines the AC-PCL-003 no-regression gate. The single published
   138.1 ms figure is context, not the gate.
4. **`EXPLAIN QUERY PLAN` from `bun:sqlite`**, both arms, committed verbatim.

## Gates, restated verbatim from the spec

- **AC-PCL-001:** arm B's served pooled compile p95 ≤ **250 ms** over 500
  compiles at concurrency 1.
- **AC-PCL-002:** arm B's ranked output byte-identical to arm A's on the pooled
  and anchor stores, 500/500 instances, sha256 over ranked lists. Pre-decided
  adjudication: if the per-instance `(id, score)` multisets match and only
  equal-score rows are permuted, the change is **blocked** pending a
  deterministic tie-breaker shipped as its own change; any other divergence is
  falsifier 2.
- **AC-PCL-003:** arm B's anchor p95 within the spread of this work's own fresh
  anchor pair.

## Falsifiers

1. If arm A turns out to be *fast* — if the drive-from-observations plan does
   not cost measurable time on this store — then H0's plan reading is not a
   performance finding, the premise dies, and the correct output is a published
   note that a bad-looking plan on a zero-contradiction store is free.
2. If arm B changes any ranked output beyond the pre-decided permutation case,
   it does not ship, whatever it does to latency.
3. If arm B lands above 250 ms, the 2026-08-07 latency falsifier stands a
   second time and the residual profile is published; sharding by
   subject/process is then a separate spec with an ADR, not scope creep here.

## Prediction, written before the A/B

Arm A's raw statement is **tens of seconds** per query on this store (early H0
timing suggested ~35 s, which is why the full 50-question sweep was abandoned
for a 5-sample run). Arm B returns it to the sub-second range and the served
p95 to the neighbourhood of the 0.7.0 figure. **Whether that clears 250 ms is
genuinely unknown** — 0.7.0 itself measured 864.9 ms, so the fix alone is
expected to *restore* the old failure rather than pass the gate, and falsifier 3
firing is the most likely single outcome.

## Consequence if arm A is confirmed slow

That is a shipped regression in the current npm `latest`, invisible to the
contract suite (its stores hold tens of rows) and to every published benchmark
(all measured 0.7.0). It ships as a patch release with the measurement, and the
0.7.1 entry gains a correction pointing at it. The regression is disclosed
whether or not the fix clears the gate.
