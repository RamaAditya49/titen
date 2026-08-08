# Pooled-recall recovery, measured — nothing ships, and the window was never the problem

Date: 2026-08-08. Protocol
[pre-registered](./2026-08-08-pooled-recall-recovery-prereg.md) and committed
before any cell was scored; spec
[`2026-08-08-pooled-recall-recovery`](../specs/done/2026-08-08-pooled-recall-recovery.md).
Every cell is scored by the shared scorer (`common.score` / `common.sign_test`)
over all 500 LongMemEval-S instances with failures kept in the denominator.
Pooled baseline 0.246/0.3259 and anchor baseline 0.880/0.9147 were both
reproduced from the served stores before any comparison.

Verdict up front: **every gate in this cycle failed and nothing ships.** The
2026-08-08 improvement cycle explained six re-ranking losses by saying the
top-10 window was the limit; this cycle widened the window to 50 and the
explanation did not survive. The best deep re-ranker gains **+0.2 points**
against a **+46.2-point** oracle at that window, while costing 1,924 ms per
compile. Packing is a null by arithmetic and by measurement: it admits 23 more
gold sessions into the pack and moves recall@1 and recall@10 by exactly zero.
The combined cell — the one the spec says decides — captures **0.8 of the 53.0
points** its own oracle offers. The one thing this cycle did establish is
negative and useful: #294's premise is wrong in two ways, and its remaining
lever is worth **1.4%**.

## What the baselines say before anything is compared

Both stores were re-served from this repository's build and re-queried at the
published parameters (`max_tokens` 32,000, `max_candidates` 1,000, `top_k`
1,000, concurrency 1, loopback).

| Condition | recall@1 | recall@5 | recall@10 | MRR@10 | compile p50 | p95 | p99 | failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Pooled, 19,829 sessions / 342,129 claims | **0.246** | 0.444 | 0.508 | 0.3259 | 419.31 ms | 863.97 ms | 1,086.73 ms | 0 |
| Anchor, per-instance scoped, 424,168 claims | **0.880** | 0.960 | 0.982 | 0.9147 | 69.22 ms | 145.41 ms | 194.31 ms | 0 |

Every figure matches its published value exactly, and the pooled ranked lists
are **byte-identical to the 2026-08-07 artifact on all 500 instances**.

**The anchor's ranked lists were not, and finding out why is worth recording.**
43 of 500 differed. Every difference sat at the very end of the list — a ±1
session at the tail, never inside the first ten, never at position 1 — which is
why recall@1, recall@5, recall@10 and MRR@10 all reproduced exactly anyway. The
cause is that `rankCandidates` takes recency from the request's `as_of`, which
defaults to wall-clock time. A run a day later scores each claim's recency
differently, that changes how many digits `score` and `score_components`
serialize to, that changes each item's `estimateJsonTokens` cost by a byte or
two, and that changes which item is the last one to fit the budget. Re-running
the anchor with `at` pinned to the published run's timestamp
(`2026-08-07T11:40:15Z`) returns **500/500 byte-identical** lists. So this build
reproduces the 0.7.0 output exactly, and **a Titen pack's tail is not
reproducible across days unless `at` is pinned**, which is worth knowing before
anyone diffs two runs and reports a regression.

Latency is reported with its repeat spread rather than as a point estimate,
because the anchor's turned out to be wide. Three 32,000-token runs of each
store, recall identical in all of them:

| Condition | run 1 | run 2 | run 3 | spread |
| --- | ---: | ---: | ---: | --- |
| Pooled p50 / p95 | 419.31 / 863.97 | 420.44 / 880.32 | — | p95 within 1.9% |
| Anchor p50 / p95 | 69.22 / 145.41 | 56.37 / 75.94 | 21.89 / 34.92 | p95 varies **4.2x** |

The pooled store is far too large to cache and repeats tightly. The anchor store
is 2.2 GB and the first pass over a freshly copied file pays the page-cache
misses the later ones do not, which is the whole 4.2x. **An anchor latency
figure is meaningless without saying which pass it came from**, and the
published 138 ms is a first-pass number.

## R1 — oracle bounds, committed before any variant ran

Recall@1 an omniscient re-ranker could reach over the first `W` distinct
sessions of the shipped order:

| `W` | 1 (baseline) | 5 | 10 | 20 | 50 | 100 | whole pack |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Pooled | 0.246 | 0.444 | 0.508 | 0.614 | **0.708** | 0.730 | 0.730 |
| Anchor | 0.880 | 0.960 | 0.982 | 0.996 | 1.000 | 1.000 | 1.000 |

These reproduce the spec's arithmetic exactly. 0.708 is (254 + 100) / 500 and
0.730 is (254 + 111) / 500, so the C1 depth split and the stored ranked lists
agree about where the 111 in-pack misses are. Distinct sessions per pooled pack:
min 20, median 62, max 90.

## E-DEEP — the window opened and almost nothing came through

Gate: ≥ 5.0 points pooled recall@1 at p < 0.05, anchor loss under 0.5 points.
`W` is the first `W` distinct sessions of the shipped order; positions below it
are untouched; session score is the maximum over that session's scored units;
shipped order breaks ties.

**The replication first, because it is what licenses the rest.** D1 and D2 are
the 2026-08-08 cycle's V5 and V1 with only the window changed. At `W = 10` they
reproduce those results to the last instance:

| Cell | recall@1 | Δ | sign test | anchor | prior published |
| --- | ---: | ---: | --- | ---: | --- |
| D1 @ W=10 | 0.234 | −1.2 | W38/L44/T418, p=0.5811 | 0.852 (−2.8) | V5: 0.234, −1.2, W38/L44/T418, p=0.5811, 0.852 |
| D2 @ W=10 | 0.222 | −2.4 | W35/L47/T418, p=0.2242 | 0.808 (−7.2) | V1: 0.222, −2.4, W35/L47/T418, p=0.2242, 0.808 |

Identical. The window is therefore the only thing that moves below.

| V | Signal | `W` | Pooled r@1 | Δ (pts) | Sign test (two-sided) | Anchor r@1 | Anchor Δ | Model cost | Gate |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |
| D0 | identity control | any | 0.246 | +0.0 | W0/L0/T500, p=1.0 | 0.880 | +0.0 | 0 | control |
| D1 | cross-encoder | 10 | 0.234 | −1.2 | W38/L44/T418, p=0.5811 | 0.852 | −2.8 | 389 ms | **FAIL** |
| D1 | cross-encoder | 20 | 0.238 | −0.8 | W44/L48/T408, p=0.7547 | 0.854 | −2.6 | 774 ms | **FAIL** |
| D1 | cross-encoder | **50** | **0.248** | **+0.2** | W49/L48/T403, p=1.0 | 0.854 | −2.6 | **1,924 ms** | **FAIL** |
| D2 | term coverage | 20 | 0.206 | −4.0 | W31/L51/T418, p=0.0352 | 0.802 | −7.8 | 17 ms | **FAIL** |
| D2 | term coverage | 50 | 0.198 | −4.8 | W31/L55/T414, p=0.0127 | 0.802 | −7.8 | 17 ms | **FAIL** |
| D3 | RRF(shipped, D1) | 10 | 0.250 | +0.4 | W27/L25/T448, p=0.8899 | 0.872 | −0.8 | 389 ms | **FAIL** |
| D3 | RRF(shipped, D1) | 20 | 0.248 | +0.2 | W31/L30/T439, p=1.0 | 0.870 | −1.0 | 774 ms | **FAIL** |
| D3 | RRF(shipped, D1) | 50 | 0.244 | −0.2 | W31/L32/T437, p=1.0 | 0.868 | −1.2 | 1,924 ms | **FAIL** |

D0 returned the shipped order for every instance at every window, so the window
machinery adds nothing of its own.

**Winner: none.** Every clause fails for every variant. The recall clause needed
+5.0 and the best cell delivered +0.2; the anchor clause allowed a 0.5-point
loss and the cheapest violation is 1.2 points; the cost clause allowed 10% and
D1 adds 1,924 ms to a 419 ms compile.

**Falsifier 1 fires, and it takes the previous cycle's explanation with it.**
The 2026-08-08 report closed by saying the +26.2-point ceiling was unreached
because the window was the limit. At `W = 50` the ceiling is +46.2 points and the
window is demonstrably not the limit. D1's own trend says so: it improves
monotonically as the window widens, −1.2 → −0.8 → +0.2, and converges on the
baseline rather than on the oracle. A signal that could reach the golds would
diverge from the baseline as the window opened. This one asymptotes to it.

**What the churn looks like.** D1 at `W = 50` moves 97 of 500 instances and nets
one: 49 wins against 48 losses. It is not weakly right, it is uninformative, and
the per-type breakdown says why it cancels:

| Type | n | shipped | D1 @ W=50 | D2 @ W=50 | D3 @ W=50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| single-session-user | 70 | 0.114 | 0.043 | 0.143 | 0.057 |
| single-session-assistant | 56 | **0.714** | **0.571** | 0.286 | 0.661 |
| single-session-preference | 30 | 0.000 | 0.067 | 0.000 | 0.100 |
| multi-session | 133 | 0.120 | **0.210** | 0.150 | 0.188 |
| temporal-reasoning | 133 | 0.158 | **0.210** | 0.113 | 0.173 |
| knowledge-update | 78 | **0.487** | **0.397** | 0.487 | 0.385 |

This is the same shape the lexical losers had, with a different model in the
middle. The cross-encoder helps exactly where BM25 is weakest — multi-session
+9.0 and temporal-reasoning +5.2 — and pays for it where BM25 is strongest,
single-session-assistant −14.3 and knowledge-update −9.0. The two effects cancel
to +0.2. A gain would need a signal that adds to BM25 where BM25 already works,
and three cheap fusions plus rank fusion have now failed to be that.

One number moved that is not the gate: D1 at `W = 50` raises pooled **recall@10
from 0.508 to 0.534**. Correct answers do move up the list. They do not move to
position 1, which is the metric this corpus is reported on.

## E-PACK — 23 more golds in the pack, zero recall

Gate: the same one. The variants were simulated offline against a capture of the
ranked candidate order the packer actually sees, with each item's real
`estimateJsonTokens` cost. That simulation is licensed by the control: **P0, the
shipped rule, reproduced the served 32,000-token pack byte for byte on all 500
instances**, so the simulator is the packer.

Budget: 31,897 tokens of content after a 103-token envelope.

| V | Rule | Pooled r@1 | Δ | Pooled r@10 | Δ | Distinct sessions (median) | Items (median) | In-pool golds admitted |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| P0 | shipped | 0.246 | — | 0.508 | — | 62 | 92 | 0 of 98 |
| P1 | one claim per session | 0.246 | **+0.0** | 0.508 | **+0.0** | **92** | 92 | **23 of 98** |
| P2 | two claims per session | 0.246 | +0.0 | 0.508 | +0.0 | 73 | 92 | 8 of 98 |
| P3 | round-robin by session | 0.246 | +0.0 | 0.508 | +0.0 | **92** | 92 | **23 of 98** |

Anchor: recall@1 0.880 and recall@10 0.982 under every variant, with median
distinct sessions rising from 27 to 37. No regression, and no gain.

**Falsifier 2 fires.** Packing is not a lever on its own and may only be
re-tried combined with a re-ranker that has already passed its own gate, which
none has.

Three things are worth separating here, because they are different kinds of
claim:

- **The recall@1 null was derived before it was measured.** Every rule preserves
  rank order for the first admitted item and `packUnderBudget` admits
  `entries[0]` first in both branches, so position 1 of the pack cannot move.
  The pre-registration says so. The measurement agreeing is a check on the
  derivation, not a finding.
- **The recall@10 null was not derived, and it is the one that kills the lever.**
  A capped pack is a subsequence of the shipped pack with repeat-session items
  removed and extra sessions appended, and removing repeats cannot reorder
  first appearances. The first ten distinct sessions therefore come out
  identical, and the extra sessions all land past them. The pre-registration
  predicted +2.0 to +8.0 points here and was wrong.
- **P3 collapsing onto P1 is the informative part.** Round-robin never reached a
  second pass: admitting one claim from each session exhausts the budget at
  about 92 items, the same item count the shipped rule spends on 62 sessions.
  The packer is not spending its budget on redundant chunks it could give back.
  It is simply full, and a 32,000-token budget buys about 92 claims however they
  are allocated. Reaching a gold at median pool rank 106 is a budget question,
  and the non-goals rule budget increases out for good reasons.

## Combined — a wider pack handed to the re-ranker, and it still fails

The spec makes the combined cell the one that decides, because a newly admitted
gold is a ranking problem. P1 is the packing input (23 admitted golds, median 92
sessions) and D1 is the signal, re-ranking over **the whole pack** rather than
its top 50. Packing preserves rank order, so a wider pack does not change what
`W = 50` contains, and the extra sessions only exist below it.

| Condition | shipped | pack only (P1) | pack + re-rank (P1 + D1) | Δ vs shipped | Sign test | Oracle |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Pooled recall@1 | 0.246 | 0.246 | **0.254** | **+0.8** | W52/L48/T400, p=0.7644 | **0.776** |
| Pooled recall@10 | 0.508 | 0.508 | 0.538 | +3.0 | — | — |
| Anchor recall@1 | 0.880 | 0.880 | **0.854** | **−2.6** | W32/L45/T423, p=0.1711 | 1.000 |

**Gate: FAIL on every clause.** +0.8 points against a required +5.0, p = 0.7644
against a required p < 0.05, and a 2.6-point anchor loss against a 0.5-point
allowance. Model cost is 3,766 ms p50 per pooled compile, nine times the whole
compile it would be added to.

The oracle is the number that makes this final. Widening the pack raised the
reachable ceiling from 0.730 to **0.776** — (254 + 111 + 23) / 500 — and the
combined system captured **0.8 of the 53.0 points** that ceiling offers. Giving
the re-ranker more of what retrieval already found does not help, because the
re-ranker was never the thing that was short of candidates.

## E-LAT2 — #294's lever is worth 1.4%, and two of its premises are wrong

Falsifier 5's threshold was fixed in the pre-registration at ≥ 5% pooled compile
p95 reduction. L1 hoists the candidate CTE's membership and retention predicates
into per-request sets, and deleting those predicates outright is the most any
hoist could recover, so the ceiling was priced **before** any authorization code
was written. An authorization change is a data-leak path; one that cannot pay
for itself should not be attempted, and this one cannot.

Measured through `bun:sqlite` (bun 1.3.14, SQLite 3.53.0) on a read-only copy of
the pooled store, product `planFtsQuery` terms, every fifth instance, 1,000
candidates, the same sampling the 2026-08-08 scope-price probe used.

| Component | Median | Share of the query |
| --- | ---: | ---: |
| FTS `MATCH` plus `LIMIT`, nothing else | 68.2 ms | 20.0% |
| plus the join to `claims` and the scope/lifecycle conjunction | 329.9 ms | 96.5% |
| the access predicate — **L1's entire target** | **4.9 ms** | **1.4%** |
| the `contradictedSql` subquery | 2.4 ms | 0.7% |
| the three `context_feedback` counts | 0.6 ms | 0.2% |
| the outer `SELECT` — all post-CTE hydration | 4.2 ms | 1.2% |
| whole candidate query | 341.8 ms | 100% |

**Gate: FAIL, by more than 3x.** L1's ceiling is 1.4% of the candidate query and
about 1.2% of a 419 ms compile, against a 5% threshold. #294's remaining lever
is exhausted and no hoisting code was written.

Three corrections fall out, and they matter more than the failed gate:

1. **The residual is not post-CTE hydration.** That is the issue's title and its
   headline finding. Measured here, the entire outer `SELECT` — the
   `contradictedSql` subquery, the three feedback counts, the claim hydration —
   costs **4.2 ms of 341.8 ms**. The `cte_only` cell lands within noise of the
   full query.
2. **The residual is the join inside the CTE.** Going from the bare FTS match to
   the match joined against `claims` with the scope, lifecycle and temporal
   conjunction costs **261.7 ms**, 77% of the query. That is a rowid probe into
   a 342,129-row table for every FTS-matched row, and the match reaches far more
   rows than the `LIMIT` keeps. Everything else is rounding.
3. **bun:sqlite does not drive from observations.** The plan captured from the
   actual runtime seeks `claim_sources` on its covering index and then probes
   `observations` by id. `observations_workspace_scope` appears in none of the
   nine captured plans. The 79-second join shape is not present under SQLite
   3.53.0, so the python3 3.51.2 plan that opened #294 was a planner-version
   divergence, which is one of the two outcomes the issue itself named as
   acceptable.

This also reconciles the earlier figure rather than contradicting it. The
2026-08-08 cycle measured a "bare FTS candidate query" at a median 65.6 ms; the
`fts_match_only` cell here measures **68.2 ms**. The two agree. What was wrong
was the inference drawn from it — that everything above 65.6 ms must be
post-CTE hydration — when the missing 274 ms was inside the CTE all along, in
the join that the bare-FTS shape had dropped.

## Predictions, scored

Written before the first cell and quoted from the pre-registration.

| # | Prediction | Outcome |
| --- | --- | --- |
| 1 | D1 between −2.0 and +4.0 and fails | **RIGHT** (+0.2, FAIL) |
| 2 | D2 between −2.0 and −8.0 | **RIGHT** (−4.8) |
| 3 | D3 between −1.0 and +2.0 and fails | **RIGHT** (−0.2, FAIL) |
| 4a | P1–P3 move recall@1 by exactly 0.0 | **RIGHT** (derived, then confirmed) |
| 4b | P1–P3 raise recall@10 by 2.0 to 8.0 points | **WRONG** — exactly 0.0 |
| 4c | 20 to 50 of the 98 in-pool golds admitted | **RIGHT** (23) |
| 5 | The combined cell fails | **RIGHT** (+0.8, p=0.7644) |
| 6 | L1 reduces pooled p95 by 0 to 5% | **RIGHT** (ceiling 1.4% of the query) |
| 7 | Nothing ships | **RIGHT** |

Prediction 4b is the informative miss: it assumed a deeper pack reorders what is
near the top, and the pack's first ten distinct sessions turn out to be
invariant under every allocation rule tried.

## What changes in EVALS and claims

- **No headline number changes.** Pooled 0.246, anchor 0.880, pooled compile p95
  864 ms all stand.
- **Deep re-ranking is now measured-closed, at both depths.** Nine cells across
  three signals and three windows, with the two prior-cycle results reproduced
  exactly at `W = 10`. The claim that the top-10 window was the limit is
  withdrawn: the limit is the signal.
- **Packing is measured-closed as a standalone lever and in combination.** The
  pack's first ten distinct sessions are invariant under per-session allocation,
  a 32,000-token budget buys about 92 claims however they are allocated, and
  handing the wider pack to the re-ranker captured 0.8 of 53.0 available points.
- **#294 closes**, with its premise corrected in two places and its lever priced
  at 1.4%. The named next lead is the CTE's per-matched-row join to `claims`,
  which is 77% of the query and has never been attacked.
- **A pack's tail is not reproducible across days without pinning `at`.** Anyone
  diffing two runs must pin it or compare only the head.

## What this does not show

- **No shipped behaviour changed, and no product code was written.** Every cell
  is a re-scoring of served output or a simulation licensed against it. Nothing
  here is a claim about a new build.
- **The E-DEEP arms score whole session text from the fixture, which the product
  does not hold.** They are an upper bound on a shipped re-ranker of that class,
  not a shippable configuration, declared as an instrument in the
  pre-registration. A claim-text re-ranker would have less to work with, not
  more, so the failure carries; a pass would not have.
- **The E-PACK results come from a capture taken with `LIMITS.maxTokens` raised**,
  which is a measurement instrument and was reverted immediately. No recall or
  latency figure is taken from those runs. The simulator's licence is the
  byte-identical P0 reproduction, and nothing beyond that is claimed for it.
- **The E-LAT2 profile is raw SQL on a store copy, not a served compile.** It
  reconciles, since the 341.8 ms query sits inside a 419.3 ms served p50, but the
  component shares are shares of the query, not of compile.
- **Only one cross-encoder was tried**, the one V5 already used, because the
  window had to be the only variable. A different model is untested at any depth.
- **The combined cell's model cost shared the box with the test suites.** Its
  3,766 ms p50 is an upper bound, not a clean measurement; the clean figure it
  has to beat is D1's 1,924 ms at a strictly narrower window, measured alone.
  No gate turns on either number.
- **Latency is concurrency 1 on loopback**, no concurrency sweep, no answer
  accuracy, no managed-product comparison. The pooled and anchor latency cells
  ran on a box that had just finished a CPU-heavy re-ranking pass; the pooled
  figures land within 0.4% of published, and anchor p95 is reported with its
  repeat spread below rather than as a point estimate.
- **Anchor p95 has a wide cold/warm spread.** The first pass over a freshly
  copied store reads 145.41 ms against 34.92 ms on a warm repeat. Any anchor
  latency comparison must say which pass it came from.
- **`single-session-preference` is untouched.** C1 bounded it at 30 instances
  with 13 golds outside the pool, and nothing in this cycle addresses candidate
  generation.

## Evidence

Artifacts and checksums under
[`results/2026-08-08-pooled-recall-recovery/`](./results/2026-08-08-pooled-recall-recovery/).
Raw captures are preserved on `rama-tuf` under `~/titen-bench-20260808r/`; the
two instrument captures are several hundred megabytes and are listed by checksum
in the manifest rather than committed.
