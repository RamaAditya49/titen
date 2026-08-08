# Pre-registration — pooled-recall recovery cycle

Date: 2026-08-08. Spec
[`2026-08-08-pooled-recall-recovery`](../specs/active/2026-08-08-pooled-recall-recovery.md),
plan [`2026-08-08-pooled-recall-recovery`](../plans/active/2026-08-08-pooled-recall-recovery.md).

This file is committed **before any cell in this cycle is scored** (AC-PRR-001).
Everything below — variant definitions, access paths, fusion rules, gates and
predictions — is fixed at commit time. A protocol written after a number is not
a protocol, so anything added later is marked as an amendment with its reason
and the date, and no gate moves after a number is seen.

## Fixed environment

All cells run on `rama-tuf` against preserved stores. Nothing is rebuilt.

| Thing | Pinned value |
| --- | --- |
| Corpus | LongMemEval-S, 500 instances, `~/titen-bench-20260804/fixtures/longmemeval_s` |
| Scorer | `~/titen-bench-20260804/harness/common.py` — `common.score`, `common.sign_test` |
| Denominator | 500 always; a failed or missing instance scores zero and stays in |
| Pooled store | `~/titen-bench-20260807/lanes/pooled-19829.db`, 19,829 sessions / 342,129 claims, read-only original, served only from a copy |
| Anchor store | `~/titen-bench-20260804/lanes/titen/fts-500.db`, per-instance scoped, 424,168 claims |
| Pooled baseline | recall@1 **0.246**, recall@10 0.508, MRR@10 0.3259 |
| Anchor baseline | recall@1 **0.880** |
| Compile parameters | `max_tokens: 32000`, `max_candidates: 1000`, `top_k: 1000`, concurrency 1, loopback |
| Build under test | this repository at the commit that carries this file (`0.7.2` line) |
| Session-order rule | a pack's session ranking is first appearance of `item.observer_id`, exactly as `tclient.compile_ranked` derives it today |

The build under test is the build whose pooled ranked lists were already
reproduced **byte-identically for all 500 instances** against the 2026-08-07
artifact on 2026-08-08 (`titen-fts-pooled-19829-20260808-headfix.ranked.json`).
That reproduction is re-run in this cycle before any variant is scored; if it
fails, the cycle stops and reports the divergence rather than scoring anything.

## Instruments, declared before use

Two things in this cycle are measurement instruments and not product
configurations. Both are disclosed here so no result can later be read as a
shipped shape.

1. **Raised token ceiling for capture only.** `LIMITS.maxTokens` is 32,000, so
   the served API cannot return the ranked candidate list that exists *before*
   packing. One capture run is served from a build with that single constant
   raised, at `max_tokens` far above any real budget, purely to record the
   pre-pack ranked order, each item's `estimateJsonTokens` cost and its session.
   Every E-PACK variant is then simulated offline against the real 32,000-token
   budget. The patch is never committed and nothing is scored from the raised
   budget itself. **Validation:** the offline simulator must reproduce the
   shipped 32,000-token pack byte-identically for all 500 instances before any
   E-PACK variant is scored. If it does not, E-PACK is not scored offline.
2. **Full session text in E-DEEP.** The cross-encoder arms score
   `(question, session_text[:2000])` pairs built from the fixture, which is what
   V5 scored on 2026-08-08. The product path holds packed *claims*, not whole
   session text, so these arms are an **upper bound** on what a shipped
   re-ranker of that class could reach, not a shippable configuration. A failure
   here therefore falsifies the shippable form as well; a pass would require a
   second, claim-text cell before anything could ship.

## E-DEEP — re-rank deeper than the top-10

The 2026-08-08 cycle's six variants re-ranked strictly inside the shipped
top-10. The 111 `in_pack_below_10` golds sit at median rank 21, so that window
could not reach them. **The window is the variable under test.** D1 and D2 are
therefore the same signals as V5 and V1 with only the window changed; anything
else that moved would confound the experiment.

**Window `W`.** The first `W` distinct sessions of the shipped order. Sessions
at position `W+1` and below keep their shipped relative order and are appended
unchanged. `W = 50` for the primary cells. `W = pack` (every distinct session in
the returned pack) is used only in the combined cell, where a wider pack is the
point.

**Aggregation.** One score per session, taken as the maximum over that session's
scored units. Best-of aggregation, not sum: V3 measured sum-of-chunks at −11.8
points, so summing here would confound the window with a known loser.

**Tie-break.** Shipped order. A variant may reorder, never randomize.

| V | Variant | Signal | Access path | Fusion rule |
| --- | --- | --- | --- | --- |
| **D0** | identity control | none | stored ranked artifact only | re-emit the shipped order through the same window machinery |
| **D1** | cross-encoder @ W=50 | `Xenova/ms-marco-MiniLM-L-6-v2`, fastembed 0.8.0 `TextCrossEncoder`, ONNX CPU, control venv | stored pooled/anchor ranked artifacts + fixture session text, `(question, session_text[:2000])` | sort window by score desc, shipped order breaks ties |
| **D2** | term-coverage @ W=50 | fraction of the query's distinct content terms (`planFtsQuery` term selection, same stopword list) present in the session text | same, no model | sort window by coverage desc, shipped order breaks ties |
| **D3** | RRF(shipped, D1) @ W=50 | reciprocal rank fusion, `k=60`, equal weights | D1's scores, no additional model calls | `Σ 1/(60 + rank)` over the two orders within the window |

**D0 is a correctness gate, not a cell.** It must reproduce 0.246 and the
shipped ranked lists exactly. If it does not, the window machinery is wrong and
no D-cell is reported.

## E-PACK — admit more of what was already retrieved

The packer fills greedily in rank order under `32000 − ENVELOPE_TOKENS`. The
median pack holds 92 claims spanning 62 distinct sessions while 848 candidates
are omitted, and the 98 `in_pool_not_pack` golds sit at median session rank 106.

**Derived before measuring, so it cannot be reported as a discovery:** every
variant below preserves rank order for the first admitted item, and
`packUnderBudget` always admits `entries[0]` first in both its branches.
Position 1 of the pack is therefore invariant under E-PACK, so **pooled
recall@1 cannot move under E-PACK alone**. This is arithmetic, not a result. It
is still measured, because a derivation that contradicts its own measurement is
a bug in one of them. E-PACK's own reported metrics are recall@10, distinct
sessions admitted, and how many of the 98 `in_pool_not_pack` golds enter the
pack. Its recall@1 relevance exists only through the combined cell.

| V | Variant | Rule, inside the unchanged 32,000-token budget |
| --- | --- | --- |
| **P0** | shipped control | today's `packUnderBudget`, simulated; must reproduce the served pack byte-identically |
| **P1** | one claim per session | admit at most the single best-ranked claim of each session |
| **P2** | two claims per session | as P1 with a cap of 2 |
| **P3** | round-robin by session | repeated passes in rank order, each pass admitting each session's best not-yet-admitted claim, until the budget is exhausted |

No budget increase, no `max_candidates` change, no `top_k` change, no schema or
migration. P1–P3 are allocation rules over the same entries the packer already
holds.

## E-LAT2 — the residual compile cost (#294)

The candidate CTE evaluates `recordAccessSql`'s membership `EXISTS` and
retention `NOT EXISTS` per FTS-matched row, before `LIMIT`. **L1** hoists both
into per-request sets computed once: the principal's workspace ids and the
organization's retention-excluded claim ids, generated from a helper placed
beside `recordAccessSql` so the correlated and hoisted forms cannot drift, with
the correlated form retained as the fallback when a set is too large to bind.

Access path: `bun:sqlite`, served, both stores. `EXPLAIN QUERY PLAN` captured
from `bun:sqlite` before and after against a realistic-row-count store, per
AC-PRR-006 and the standing rule in `src/core/authorization.ts`.

**L1 ships only if the ranked output is byte-identical on both stores.** A
latency change that moves an answer is a different change and is out of scope
here.

## Gates

Applied exactly as written in the spec. Conjunctive; no clause is traded.

- **Recall (AC-PRR-003).** ≥ **5.0 points** pooled recall@1 over 0.246, paired
  sign test **p < 0.05**, and anchor recall@1 no more than 0.5 points below
  0.880.
- **Cost (AC-PRR-004).** Pooled compile p95 no more than **10%** above the
  same-cycle measured baseline, and anchor p95 not above its measured repeat
  spread.
- **Shape (AC-PRR-005).** No new external import in `src/core/**`, no new
  dependency, no migration, no configuration flag on the default path. A local
  re-ranker may only ship as an opt-in projection in the shape the vector path
  already uses.
- **E-LAT2 (falsifier 5).** "Measurably" is fixed here as **≥ 5% pooled compile
  p95 reduction** with byte-identical ranked output on both stores. Below that,
  #294's remaining lever is exhausted and the issue closes with the residual
  profile published.

**At most one configuration ships.** If several clear, the one with the largest
pooled gain ships and the others are recorded. A variant that clears recall but
breaches cost is a measured trade: opt-in only, or not at all.

## Oracle bounds

Computed from the stored artifacts as R1's own deliverable, **after** this file
is committed and appended to it as an amendment before any variant runs. What is
fixed now is the definition: recall@1 if a perfect re-ranker acted over the
shipped top-10, top-20, top-50, and the whole returned pack; and the same with
each E-PACK variant's admitted set. These bound reachability. They are not
predictions, and clearing an oracle is not evidence that a real signal can.

## Predictions

Written before the first cell. The honest prior is that most of this is
unreachable: six signals have already failed at a smaller ceiling.

1. **D1 lands between −2.0 and +4.0 points and fails its gate.** V5 scored −1.2
   at W=10. The wider window adds 100 reachable golds but also 40 more
   distractors the model must beat, and it must beat BM25 rather than tie it.
2. **D2 lands below baseline, between −2.0 and −8.0 points.** Coverage was −2.4
   at W=10 and its failure mode — promoting question-echoing distractors — gets
   more room at W=50, not less.
3. **D3 lands between −1.0 and +2.0 and fails.** V6's RRF hedge was noise at
   W=10 and fusion cannot exceed the better of its inputs by much when one input
   is the baseline itself.
4. **P1–P3 move pooled recall@1 by exactly 0.0 points** (derived above) and
   raise recall@10 by 2.0 to 8.0 points. Between 20 and 50 of the 98
   `in_pool_not_pack` golds enter the pack under the best variant.
5. **The combined cell fails.** Widening the pack hands the re-ranker candidates
   that sit at pool rank 50–200; if it cannot promote a gold from rank 21, it
   will not promote one from rank 106.
6. **L1 reduces pooled compile p95 by 0 to 5%**, below its own threshold. The
   2026-08-08 measurement put ~85% of compile time outside the FTS candidate
   scan, and this lever is inside it.
7. **Overall: nothing ships.** Stated plainly so that publishing the null costs
   nothing and finding a winner has to survive a gate that was set against it.

If a prediction is wrong, the report says so in the same words used here.

## What would make this cycle wrong

- Scoring any cell whose definition is not above.
- Reporting the oracle as an outcome.
- Dropping an instance from the denominator to make a p-value.
- Reading a raised-`max_tokens` capture as a product measurement.
- Reporting a pack simulated offline without the byte-identical reproduction of
  the served pack that licenses the simulator.
