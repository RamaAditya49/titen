---
work_id: pooled-compile-latency
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-08
updated: 2026-08-08
owner: ramaaditya
---

# Bring pooled compile p95 under 250 ms without changing what it returns

## Problem

Compile p95 on the 19,829-session / 342,129-claim single-subject pooled store
is **864.9 ms** against the pre-registered 250 ms line
([2026-08-07 report](../../testing/2026-08-07-pooled-store.md), falsifier 5).
The [2026-08-08 improvement cycle](../../testing/2026-08-08-pooled-improvements.md)
eliminated the cheap hypotheses:

- `max_candidates` caps to 200/100 are recall-neutral and recover only
  ~4.5% of p95 (best cell), so post-LIMIT hydration *volume* is not the
  driver;
- the scoped FTS candidate query alone (measured read-only, off the product
  path) costs a median 65.6 ms on the same corpus, so most of compile time
  lives elsewhere.

**Where the time goes is this spec's hypothesis, not yet a finding.** The
committed EXPLAIN artifact
([improve-20260808-elat.json](../../testing/results/2026-08-08-pooled-improvements/artifacts/improve-20260808-elat.json))
shows the candidate CTE evaluating the correlated membership and retention
access subqueries (its SUBQUERY 1/2 lines) once per FTS-matched row
**before** `LIMIT` — the one cost that scales with matches rather than with
the cap — while [#294](https://github.com/RamaAditya49/titen/issues/294) and
the report frame the suspect as post-CTE hydration (SUBQUERY 6,
`contradictedSql` join order under SQLite 3.51.2). These two readings are in
tension; H0 exists to adjudicate them, and everything after H0 is
conditional on its answer.

**System-under-test warning, load-bearing.** Every published pooled latency
number was measured on the `titen-memory@0.7.0` registry tarball. The #292
`contradictedSql` nested-EXISTS shape shipped in **0.7.1** and has **never
been served against the pooled store**: 0.7.0's `disputed` predicate was a
bare EXISTS over `claim_sources` with no `observations` join. HEAD's pooled
baseline is therefore unknown — it may be worse than 864.9 ms — and no delta
in this work may be computed against the 0.7.0 numbers.

## Approach, ordered by the simplicity budget

1. **H0 — runtime evidence on HEAD, before any fix.** Serve HEAD against
   the pooled store and re-measure the baseline (fresh cells; the 0.7.0
   numbers are context, not baseline). Capture `EXPLAIN QUERY PLAN` for the
   exact `retrieveClaimCandidates` SQL from inside bun:sqlite — obtained by
   importing the real query builder, not by pasting SQL — with real bound
   ids, printing `sqlite_version()` and `Bun.version` into the artifact.
   Split spans: bare CTE vs full raw query vs served compile on the same
   100 questions, so the served-minus-raw overhead is a measured number.
   Record the pooled store's visibility histogram and the per-subquery cost
   so F1's ceiling is known before it is built.
2. **F1 — hoist principal-constant authorization out of the per-row loop**
   (only if H0 implicates the CTE's per-matched-row checks). Inside
   `retrieveClaimCandidates`, `c.org_id = ?` already pins the org, so the
   membership predicate is principal-constant except for the row's
   `workspace_id`: materialize the principal's authorized-workspace set and
   the retention-exclusion set once per query and turn the per-row check
   into set membership. Generate the hoisted SQL from a sibling helper next
   to `recordAccessSql` in `authorization.ts` so the correlated and hoisted
   forms cannot drift apart. Same rows must qualify — the shipped predicate
   is the oracle. No schema change, no flag.
3. **F2 — pin the `contradictedSql` join order** (only if H0 shows
   bun:sqlite choosing the drive-from-observations shape). Same semantics;
   `authorization.ts` already documents why the order is load-bearing, and
   the comment gains the planner version that motivated the pin.

Refused: any result caching layer, any schema/index migration before H0
evidence demands one, any behavior flag, and any change to what the query
returns.

**Done when:** either every AC below is evidenced in the published report,
or a falsifier fires and the null report plus the #294 update ship — the
pair then closes with `outcome: completed`, the refutation being the
closure evidence.

## EARS acceptance criteria

- **AC-PCL-001 — Event-driven:** When an authorized compile runs against the
  full pooled store (342,129 claims, one subject) at concurrency 1 over
  loopback, Titen shall answer with p95 ≤ 250 ms across 500 compiles,
  measured on a HEAD build that includes the change.
- **AC-PCL-002 — Ubiquitous:** Titen shall return ranked output
  byte-identical to the same-build shipped query on the pooled and anchor
  stores (500/500 instances each, sha256 over ranked lists). Adjudication
  on divergence is pre-decided: if the per-instance (id, score) multisets
  are identical and only equal-score rows permuted, the change is blocked
  pending a deterministic tie-breaker shipped as its own change; any other
  divergence is falsifier 2.
- **AC-PCL-003 — Ubiquitous:** Titen shall keep the scoped anchor
  condition's compile p95 within the repeat spread established by this
  work's own fresh anchor baseline pair (two independent HEAD-served runs,
  an L2 prereg cell); the single published 138.1 ms figure is context, not
  the gate.
- **AC-PCL-004 — Event-driven:** When the change ships, Titen's evidence
  shall include `EXPLAIN QUERY PLAN` captured from the bun:sqlite runtime
  before and after, against a realistic-row-count store, per the standing
  #291 rule; a green contract suite is not latency evidence.
- **AC-PCL-005 — Ubiquitous:** Titen shall ship the change with zero new
  external imports in `src/core/**`, no new dependency, no migration, and
  no configuration flag.
- **AC-PCL-006 — Ubiquitous:** Titen shall pass the dual-runtime contract
  suite on bun-sqlite and D1 with the change applied.
- **AC-PCL-007 — Unwanted behavior:** If the D1 runtime cannot express the
  same query shape, then Titen shall keep the divergent SQL behind the
  existing adapter boundary and shall prove identical results through the
  dual-runtime contract suite.

## Falsification

Written before any run; a null on any of these is a publishable outcome.

1. **Premise kill, stated as arithmetic:** if H0's fresh HEAD cells show
   that served-compile minus raw-full-query overhead alone exceeds the
   headroom to 250 ms, or that the candidate CTE is not the dominant span
   and the runtime plan is already fast-shaped, the located-cost premise is
   dead; publish the corrected profile and update #294 with it.
2. If a fix reaches ≤ 250 ms but changes ranked output beyond the
   pre-decided equal-score-permutation case, it is blocked until the
   divergence is explained as a bug fix with its own evidence — never
   merged as an accepted side effect.
3. If F1+F2 combined land above 250 ms on HEAD, the falsifier stands a
   second time; publish the residual profile and stop — sharding by
   subject/process is a different spec with an ADR, not scope creep here.

## Non-goals

No caching, no ANN, no schema change, no concurrency work (the 2026-08-04
one-thread ceiling is separate), no change to ranking or recall.

## Evidence

Measurement reuses the preserved stores and E-LAT harness on `rama-tuf`
(`~/titen-bench-20260807/lanes/pooled-19829.db`, key in
`logs/pooled-19829.log.bootstrap`; anchor copy procedure in
[`run_day1.sh`](../../testing/results/2026-08-07-pooled-store/harness/run_day1.sh)),
with HEAD served from a checkout instead of the tarball. Results land in
`docs/testing/2026-08-XX-pooled-compile-latency.md` with artifacts +
SHA256SUMS; a latency prereg with these exact cells is committed before the
first scored run.
