---
work_id: pooled-compile-latency
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-08-08
updated: 2026-08-08
owner: ramaaditya
spec: docs/specs/active/2026-08-08-pooled-compile-latency.md
review_after: 2026-08-21
---

# Plan — HEAD baseline first, hoist second, pin third, measure everything

H0 gates everything, twice over: the only planner evidence so far is from
python3's SQLite 3.51.2, and the only latency numbers are from the 0.7.0
tarball, which predates the #292 `contradictedSql` shape. No fix is written
before the HEAD-served baseline and the runtime plan exist.

## Sequence

### L1 — H0: runtime evidence on HEAD (no product change)

- [ ] Serve HEAD (checkout, not tarball) against a COPY of
      `pooled-19829.db`; fresh pooled baseline, 500 compiles, concurrency 1
      — this number, not 864.9 ms, is the delta reference for everything
      after.
- [ ] Capture `EXPLAIN QUERY PLAN` from bun:sqlite for the exact
      `retrieveClaimCandidates` SQL, obtained by importing the real query
      builder (capturing Db stub or adapter logging — never pasted SQL),
      with real bound org/subject/principal ids; print `sqlite_version()`
      and `Bun.version` into the committed artifact. (AC-PCL-004, "before"
      capture.)
- [ ] Span split on the same 100 questions: bare candidate CTE vs full raw
      query vs served compile — the served-minus-raw bridge is what
      falsifier 1's arithmetic runs on.
- [ ] Record the pooled store's visibility histogram and per-subquery cost
      (membership, retention, contradicted, feedback) so F1's ceiling is
      known before L3.
- [ ] Decision point per falsifier 1: if the premise dies, write the null
      report, update #294, and close this pair (`outcome: completed`, the
      refutation as closure evidence). Otherwise continue.

### L2 — Latency prereg, committed before any fix is scored

- [ ] Cells: HEAD pooled baseline (from L1, re-stated), F1, (F2 if H0
      implicates it), F1+F2; 500 compiles each, concurrency 1, loopback,
      quiet box. **Anchor baseline pair:** two independent HEAD-served
      anchor runs whose spread defines AC-PCL-003's gate.
- [ ] Gates AC-PCL-001/002/003 restated verbatim, including the
      pre-decided byte-identity adjudication (sha256 over ranked lists;
      equal-score-permutation → blocked pending its own tie-breaker
      change).

### L3 — F1: authorization-set hoisting

- [ ] Materialize per-request authorized-workspace and retention-exclusion
      sets in `retrieveClaimCandidates`; per-row predicates become set
      membership. Generate the hoisted SQL from a sibling helper next to
      `recordAccessSql` in `authorization.ts` so the two forms cannot
      drift. The shipped predicate is the oracle: same rows must qualify.
- [ ] AC-PCL-005: diff shows zero new imports in `src/core/**`, no
      dependency, no migration, no flag.
- [ ] AC-PCL-006: dual-runtime contract suite green on bun-sqlite and D1;
      adversarial cross-scope cases (foreign workspace, retention-excluded
      row) still fail closed.
- [ ] AC-PCL-007: if D1 needs divergent SQL, it stays behind the adapter
      boundary and the contract suite proves identical results.
- [ ] AC-PCL-002: ranked-output byte-identity on both stores vs the
      same-build shipped query.
- [ ] AC-PCL-004 ("after" capture): post-change bun:sqlite EXPLAIN
      committed beside the before-capture.

### L4 — F2: contradictedSql join-order pin (only if H0 implicates it)

- [ ] Same-semantics restructure; EXPLAIN before/after (AC-PCL-004); the
      `authorization.ts` comment gains the planner version that motivated
      the pin.

### L5 — Measure, publish, close

- [ ] All prereg cells on `rama-tuf`; artifacts + SHA256SUMS.
- [ ] Report `docs/testing/2026-08-XX-pooled-compile-latency.md`: every gate
      verdict (AC-PCL-001 against the HEAD baseline; AC-PCL-003 against the
      measured anchor spread), the runtime EXPLAIN pair, and what the change
      does not claim (no concurrency, no recall change).
- [ ] EVALS.md pooled section + #294 updated; CHANGELOG Unreleased entry
      (patch class); titen-web benchmark latency cells + redeploy after the
      release that ships it.
- [ ] Pair to done/ with per-AC acceptance evidence.

## Not in this plan

Sharding by subject/process (own spec + ADR), caching, D1-side latency work
(D1's numbers were never part of the fired falsifier), the accuracy work
(`pooled-candidate-generation` pair).
