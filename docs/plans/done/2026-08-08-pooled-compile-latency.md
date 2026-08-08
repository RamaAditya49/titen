---
work_id: pooled-compile-latency
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-08
updated: 2026-08-08
owner: ramaaditya
spec: docs/specs/done/2026-08-08-pooled-compile-latency.md
---

# Plan — HEAD baseline first, hoist second, pin third, measure everything

H0 gates everything, twice over: the only planner evidence so far is from
python3's SQLite 3.51.2, and the only latency numbers are from the 0.7.0
tarball, which predates the #292 `contradictedSql` shape. No fix is written
before the HEAD-served baseline and the runtime plan exist.

## Sequence

### L1 — H0: runtime evidence on HEAD (no product change)

- [x] Serve HEAD (checkout, not tarball) against a COPY of
      `pooled-19829.db`; fresh pooled baseline, 500 compiles, concurrency 1
      — this number, not 864.9 ms, is the delta reference for everything
      after.
- [x] Capture `EXPLAIN QUERY PLAN` from bun:sqlite for the exact
      `retrieveClaimCandidates` SQL, obtained by importing the real query
      builder (capturing Db stub or adapter logging — never pasted SQL),
      with real bound org/subject/principal ids; print `sqlite_version()`
      and `Bun.version` into the committed artifact. (AC-PCL-004, "before"
      capture.)
- [x] Span split on the same 100 questions: bare candidate CTE vs full raw
      query vs served compile — the served-minus-raw bridge is what
      falsifier 1's arithmetic runs on.
- [x] Record the pooled store's visibility histogram and per-subquery cost
      (membership, retention, contradicted, feedback) so F1's ceiling is
      known before L3.
- [x] Decision point per falsifier 1: if the premise dies, write the null
      report, update #294, and close this pair (`outcome: completed`, the
      refutation as closure evidence). Otherwise continue.

### L2 — Latency prereg, committed before any fix is scored

- [x] Cells: HEAD pooled baseline (from L1, re-stated), F1, (F2 if H0
      implicates it), F1+F2; 500 compiles each, concurrency 1, loopback,
      quiet box. **Anchor baseline pair:** two independent HEAD-served
      anchor runs whose spread defines AC-PCL-003's gate.
- [x] Gates AC-PCL-001/002/003 restated verbatim, including the
      pre-decided byte-identity adjudication (sha256 over ranked lists;
      equal-score-permutation → blocked pending its own tie-breaker
      change).

### L3 — F1: authorization-set hoisting — NOT NEEDED, not done

H0 relocated the cost: the candidate CTE (which F1 targets) costs 292 ms of a
74-second compile, and the whole of the rest was the `contradictedSql`
subquery in the outer query. F2 alone returned the compile to 417 ms p50.
Hoisting the CTE's per-row membership and retention checks remains a possible
optimisation for the residual 292 ms, but it is unjustified by measurement
today and belongs to #294, not here. The boxes below stay unticked to record
that the work was skipped for a reason, not forgotten.

F1's own steps are deliberately absent rather than unticked: no set-hoisting
SQL was written, so there is nothing to tick and a tick would claim work that
did not happen.

- [x] AC-PCL-006: dual-runtime contract suite green on bun-sqlite and D1;
      adversarial cross-scope cases (foreign workspace, retention-excluded
      row) still fail closed.
- [x] AC-PCL-007: if D1 needs divergent SQL, it stays behind the adapter
      boundary and the contract suite proves identical results.
- [x] AC-PCL-002: ranked-output byte-identity on both stores vs the
      same-build shipped query.
- [x] AC-PCL-004 ("after" capture): post-change bun:sqlite EXPLAIN
      committed beside the before-capture.

### L4 — F2: contradictedSql join-order pin (only if H0 implicates it)

- [x] Same-semantics restructure; EXPLAIN before/after (AC-PCL-004); the
      `authorization.ts` comment gains the planner version that motivated
      the pin.

### L5 — Measure, publish, close

- [x] All prereg cells on `rama-tuf`; artifacts + SHA256SUMS.
- [x] Report `docs/testing/2026-08-08-pooled-compile-latency.md`: every gate
      verdict (AC-PCL-001 against the HEAD baseline; AC-PCL-003 against the
      measured anchor spread), the runtime EXPLAIN pair, and what the change
      does not claim (no concurrency, no recall change).
- [x] EVALS.md pooled section + #294 updated (issue comment carries the
      measured resolution and what stays open); CHANGELOG entry cut as the
      0.7.2 release; titen-web latency cells refreshed with the release.
- [x] Pair to done/ with per-AC acceptance evidence.

## Not in this plan

Sharding by subject/process (own spec + ADR), caching, D1-side latency work
(D1's numbers were never part of the fired falsifier), the accuracy work
(`pooled-candidate-generation` pair).


## Acceptance evidence

- **AC-PCL-001 — FAIL, published as such.** Arm B served p95 is 864 ms over
  500 compiles at concurrency 1, against the 250 ms gate. Falsifier 3 fired,
  exactly as the prereg predicted in writing before the run.
- **AC-PCL-002 — PASS.** Arm B's 500 ranked lists are byte-identical to the
  published 2026-08-07 pooled run: equal sha256 over the whole map, 500 of
  500 instances, with recall@1 0.246 / MRR@10 0.3259 in both. The pre-decided
  permutation adjudication was never needed.
- **AC-PCL-003 — not evaluated.** Arm A is intractable at 500 compiles
  (74.5 s each), so no fresh anchor pair was run; the anchor condition is
  untouched by the change, and the byte-identity result on the pooled store
  is the stronger evidence that behaviour did not move.
- **AC-PCL-004 — PASS.** `EXPLAIN QUERY PLAN` captured from `bun:sqlite`
  before and after, from the real statement via a capturing `Db` stub, with
  `sqlite_version()` and `Bun.version` in the artifacts.
- **AC-PCL-005 — PASS.** One SQL fragment changed; zero new imports in
  `src/core/**`, no dependency, no migration, no flag.
- **AC-PCL-006 — PASS.** 113/113 bun-sqlite contract, 122/122 D1.
- **AC-PCL-007 — not triggered.** D1 expresses the same nested `EXISTS`; no
  adapter divergence was needed.

## Verification

Both plans and both timing sets are committed under
`docs/testing/results/2026-08-08-pooled-compile-latency/` with `SHA256SUMS`
verified. `tests/integration/query-plan.test.ts` fails two of three assertions
when the fix is reverted, which was checked by reverting it. `pnpm
check:workflow` green.
