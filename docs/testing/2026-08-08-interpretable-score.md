# An interpretable `score`, measured — it ships, and the safety gate it cleared could not have failed

Date: 2026-08-08. Protocol
[pre-registered](./2026-08-08-interpretable-score-prereg.md) and committed
before any cell was scored. Change under test: `d3bd8c9`, against its parent
`22944bb`. Every cell is scored by the shared scorer (`common.score` /
`common.sign_test`) over all 500 LongMemEval-S instances with failures kept in
the denominator; there were none.

Verdict up front: **AC-INT-003 passes and the change ships.** Both conditions
return the baseline to four decimals — anchor recall@1 0.880 → 0.880, pooled
0.246 → 0.246 — and both paired sign tests are W0/L0/T500, p = 1.0.
**AC-INT-002 is split and one of its two readings fails**; the gate's own
sentence is satisfied and its other plausible reading is not, and this report
does not choose between them after the fact. AC-INT-001 and AC-INT-004 pass.

The number that matters most here is not a gate. Across both stores, all 500
questions and 89,467 packed items, `scoreCandidate` produced **exactly one
distinct non-relevance component tuple**. With trust, recency, utility,
conflict and confidence constant, `score` is a strictly monotone function of
the relevance component, and the relevance component is a strictly monotone
function of `-bm25` under the old min-max transform *and* under the new
saturating one. The ranking is therefore identical by arithmetic. **AC-INT-003
could not have failed on this corpus**, and a passed gate that could not have
failed is not evidence about the risk it was written to catch.

## What reproduced before anything was compared

Both stores were copied, served from this repository's `22944bb` worktree, and
re-queried at the published parameters (`max_tokens` 32,000, `max_candidates`
1,000, `top_k` 1,000, concurrency 1, loopback), with `at` pinned to each
published run's own timestamp.

| Condition | recall@1 | recall@5 | recall@10 | MRR@10 | failures | published |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Anchor, per-instance scoped, 424,168 claims | **0.8800** | 0.9600 | 0.9820 | 0.9147 | 0 | 0.880 / 0.9147 |
| Pooled, 19,829 sessions / 342,129 claims | **0.2460** | 0.4440 | 0.5080 | 0.3259 | 0 | 0.246 / 0.3259 |

Both match exactly, and the ranked lists are **byte-identical to the 2026-08-07
artifacts on all 500 instances in both conditions**. The anchor needed `at`
pinned to `2026-08-07T11:40:15Z` to get there, which is the tail-reproducibility
property recorded in
[`2026-08-08-pooled-recall-recovery.md`](./2026-08-08-pooled-recall-recovery.md);
pooled was pinned to `2026-08-07T11:58:17Z` for the same reason even though it
had previously reproduced unpinned. Every run in this report was executed twice
end to end, and pass 2 returned output identical to pass 1 in all four cells.

## Gates

| Gate | Verdict |
| --- | --- |
| AC-INT-001 — rank-1 score separates a strong from a weak match by ≥ 0.05 | **PASS** |
| AC-INT-002 — rank-1 score ties fall | **SPLIT: passes across queries, fails within a pack** |
| AC-INT-003 — retrieval quality does not regress (**decides shipping**) | **PASS** |
| AC-INT-004 — compile p95 does not rise above +5% | **PASS** |

### AC-INT-001 — PASS

Reproducing the pre-registration's own three candidate sets by calling
`rankCandidates` directly, on both builds:

| candidate set | `bm25` | rank-1 `score` at `22944bb` | at `d3bd8c9` |
| --- | --- | ---: | ---: |
| strong lexical match | −18.0, −2.0 | 0.796667 | **0.728464** |
| weak lexical match | −0.4, −0.1 | 0.796667 | **0.435691** |
| single candidate | −0.02 | 0.796667 | **0.398817** |

Strong minus weak: **0.000 → 0.292773**. The gate asked for 0.05.

The served anchor lane says the same thing over 500 real questions. Rank-1
`score` across the 500:

| build | distinct values | min | p10 | median | p90 | max | spread |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `22944bb` | **1** | 0.7944 | 0.7944 | 0.7944 | 0.7944 | 0.7944 | **0.0000** |
| `d3bd8c9` | **498** | 0.4875 | 0.5274 | 0.5794 | 0.6245 | 0.6632 | **0.1757** |

The served constant is 0.794374 rather than the pre-registration's 0.796667
because the anchor's claims carry a recency of 0.984715 at the pinned `at`
rather than 1. It is a constant either way: one distinct value over 500
questions, which is the defect #227 describes.

**The calibration mostly held, and where it did not is worth stating.** 3.7 was
fitted on the first 300 anchor questions to put a median rank-1 relevance at
0.50. Measured on all 500: anchor median relevance **0.463** (p10 0.333, p90
0.575) against a predicted 0.50 / 0.40 / 0.60. Pooled lands closer to the
target than the store it was calibrated on — median **0.509**, p10 0.429, p90
0.608.

### AC-INT-002 — split, and the failing reading is reported first

The gate reads: *"Two poorly-matching results do not tie at the ceiling: on the
anchor store, the rate of exact rank-1 score ties across the 500 questions falls
below the current rate."* That admits two readings and the pre-registration did
not fix one, so both were scored.

**Within a pack — FAILS.** A question counts if ≥ 2 items in the same pack share
that pack's maximum score.

| measure (anchor) | `22944bb` | `d3bd8c9` |
| --- | ---: | ---: |
| questions with a tied top score | 1 of 500 (0.002) | 1 of 500 (0.002) — **the same question** |
| score collisions anywhere in the pack | 2,419 of 43,389 (5.58%) | 2,428 of 43,385 (**5.60%**) |
| the same, pooled | 935 of 46,088 (2.03%) | 974 of 46,082 (**2.11%**) |

The rate does not fall. It rises very slightly, and the mechanism is the change
itself: saturation compresses the relevance range, so more neighbouring
candidates round to the same value at six decimals. The absolute effect is
small and it does not reach rank 1, but the gate said *falls* and it did not
fall.

**Across queries — PASSES.** A question counts if its rank-1 score equals the
before-build's constant. This is the reading the gate's own headline sentence
describes: the pre-registration demonstrates the defect with three *different*
queries all scoring 0.796667.

| measure (anchor) | `22944bb` | `d3bd8c9` |
| --- | ---: | ---: |
| rank-1 score at the ceiling constant | 500 of 500 (**1.000**) | 0 of 500 (**0.000**) |
| distinct rank-1 score values | 1 | 498 |

The gate is not moved and neither reading is discarded. AC-INT-002 is not the
shipping gate; AC-INT-003 is.

### AC-INT-003 — PASS on every clause, in both conditions

| Condition | build | recall@1 | recall@5 | recall@10 | MRR@10 | failures |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Anchor | `22944bb` | 0.8800 | 0.9600 | 0.9820 | 0.9147 | 0 |
| Anchor | `d3bd8c9` | **0.8800** | 0.9600 | 0.9820 | 0.9147 | 0 |
| Pooled | `22944bb` | 0.2460 | 0.4440 | 0.5080 | 0.3259 | 0 |
| Pooled | `d3bd8c9` | **0.2460** | 0.4440 | 0.5080 | 0.3259 | 0 |

Per-question-type breakdowns are identical between builds in both conditions.

| clause | required | measured | verdict |
| --- | --- | ---: | --- |
| anchor recall@1 | ≥ 0.875 | 0.880 (Δ 0.0) | PASS |
| pooled recall@1 | ≥ 0.241 | 0.246 (Δ 0.0) | PASS |
| anchor recall@10 fall | ≤ 1.0 pt | 0.0 pt | PASS |
| pooled recall@10 fall | ≤ 1.0 pt | 0.0 pt | PASS |

Paired sign tests, `22944bb` against `d3bd8c9`:

| test | wins | losses | ties | p (two-sided) |
| --- | ---: | ---: | ---: | ---: |
| anchor @1 | 0 | 0 | 500 | 1.0 |
| anchor @10 | 0 | 0 | 500 | 1.0 |
| pooled @1 | 0 | 0 | 500 | 1.0 |
| pooled @10 | 0 | 0 | 500 | 1.0 |

Not a single instance changed at either k. What did change is the far tail of
the returned session list: 8 of 500 anchor lists and 43 of 500 pooled lists
differ, all of them past position 10, none at position 1. That is the same
token-estimate mechanism the recovery report documented — the score serializes
to a different number of digits, `estimateJsonTokens` shifts by a byte or two,
and a different item is the last one that fits the budget.

### AC-INT-004 — PASS

Warm-pass p95, because the first pass over a freshly copied 2.2 GB anchor store
is page-cache bound and moves p95 by 4.2× on its own. Both builds served the
same copies in the same order; the before build paid the cold pass (anchor p95
137.56 ms) and the after build did not, so a cold-to-cold comparison is not
available and a cold-to-warm one would report a 4× speedup that is the file
cache.

| Condition | warm p95 `22944bb` | warm p95 `d3bd8c9` | Δ | gate |
| --- | ---: | ---: | ---: | --- |
| Anchor | 33.94 ms | 34.35 ms | **+1.21%** | PASS (≤ +5%) |
| Pooled | 838.05 ms | 843.64 ms | **+0.67%** | PASS (≤ +5%) |

Warm p50: anchor 20.57 → 20.76 ms, pooled 411.82 → 411.71 ms.

## Why AC-INT-003 could not have failed, and what that costs

Falsifier 1 predicted the most likely outcome: saturation compresses relevance,
so the other five components carry relatively more weight, the blend reorders
and recall drops. The measurement says the blend did not reorder at all. Before
reading that as reassurance, it is worth asking whether this corpus can reorder.

Every served pack was re-queried with its `score_components` captured:

| Condition | packed items | distinct non-relevance component tuples | packs with any internal variance |
| --- | ---: | ---: | ---: |
| Anchor | 43,385 | **1** — trust 0.333333, recency 0.984715, utility 0.5, conflict 1, confidence 0.8 | **0** |
| Pooled | 46,082 | **1** — trust 0.333333, recency 1, utility 0.5, conflict 1, confidence 0.8 | **0** |

Every claim in both stores was ingested by the same harness in one pass, so
every claim has the same trust, the same confidence, no dispute, no feedback,
and a created-at within the same recency bucket. With those five held constant,
`score = 0.4 × relevance + c`, and relevance is strictly increasing in `-bm25`
under min-max and under `strength / (strength + 3.7)` alike. Two strictly
monotone transforms of the same quantity induce the same order. **The identical
recall is a derivation, not a finding.**

The one place the pack order is not monotone in relevance is rounding: `score`
and `relevance` are each rounded to 1e-6, so two candidates can land on an equal
`score` while their relevance differs in the sixth decimal, and the tie-break
(vector boost, evidence depth, statement, id) then orders them. That accounts
for all 10 anchor and 25 pooled packs where relevance rises going down the list;
one such pair, question `06f04340` at position 17, has both items at score
0.478921 with relevance 0.211367 and 0.211368.

So falsifier 1 did not fire, and this benchmark could not have made it fire.
The cost is precise: **AC-INT-003 is evidence that the change is safe on a
uniformly ingested, single-trust, single-confidence, dispute-free, feedback-free
corpus, and is silent about every other corpus.** On a store where trust,
confidence, disputes or feedback vary between candidates, the compression is
real and reordering is possible; nothing here measured that, and the
pre-registration's own reasoning for why it would happen is untouched.

### The reordering the corpus could not contain, pinned by contract instead

Two corrections belong here, both found while checking this section rather than
accepting it.

**The old transform was not min-max.** `worst` was clamped by
`Math.min(...scores, 0)`, so the floor was always 0 and the transform was
`s / best`, not `(s − min) / (max − min)`. The pre-registration and this
report both call it min-max. What that language got right is the part the issue
turned on — the best candidate scored exactly `1` by construction, and a
zero span short-circuited to `1` — and what it got wrong is the shape of the
rest: relevance was **proportional** to `-bm25`, so ratios between candidates
were preserved rather than stretched. The pre-registration is left as written,
because a protocol edited after the numbers is not a protocol.

**That makes the untested risk sharper, not softer.** Proportional means a 25%
gap in `bm25` stayed a 25% gap in relevance; saturating means it does not.
Measured directly, `bm25` −60 against −45:

| | relevance gap | winner |
| --- | ---: | --- |
| `s / best` (before) | 0.250 | the better match, `asserted` |
| `s / (s + 3.7)` (after) | **0.018** | the worse match, **`verified`** |

The order flips. That is the intended direction — between two candidates that
both match well, which one matches 25% better is a weaker signal than which one
a human verified — but it is a real behaviour change, and the benchmark was
structurally incapable of showing it.

It is now a contract case,
`compressing relevance lets the other components decide between two strong
matches`, together with its bound: a genuinely weak match still loses to a
strong one however trusted it is. A deterministic assertion is not a recall
measurement, and it is not offered as one. It is what stops this from being
silent until someone's store hits it.

## Falsifiers

1. **The blend reorders and recall drops.** Did not fire — and, per the section
   above, could not have fired on either bench store. Not evidence of absence.
2. **The vector-arm change dominates.** **Unmeasured.** Both lanes are FTS-only;
   `/readyz` reports `vector: disabled` and `embed_calls` is 0 in all four runs.
   `normalizeVectorSimilarity` changed from min-max to raw cosine and no cell in
   this cycle exercised it. This is the largest untested surface in the change.
3. **The constant is wrong for the pooled store.** Did not fire, and the pooled
   store fits 3.7 slightly better than the anchor it was calibrated on: median
   rank-1 relevance 0.509 pooled against 0.463 anchor, target 0.50.
4. **Nothing regresses and nothing improves.** **Fired, exactly.** Recall,
   MRR and the per-type breakdown are unchanged to the last instance in both
   conditions. The change ships on AC-INT-001 and the across-query half of
   AC-INT-002 alone, which is what the pre-registration said would happen in
   this case.

## What this does not show

- **It does not show the change is safe on a heterogeneous corpus.** Both bench
  stores have exactly one distinct non-relevance component tuple, which is the
  condition under which the ranking is provably unchanged. That is the whole
  reason AC-INT-003 came back a perfect null.
- **It does not test the vector arm at all.** Removing min-max from cosine is
  half the diff and no run here had a vector index enabled.
- **It does not show that 3.7 transfers.** Two stores derived from the same
  fixture is not corpus diversity. BM25 magnitude depends on corpus statistics,
  and the pre-registration says so; measuring two LongMemEval-S stores does not
  discharge it.
- **It does not show the new score is well calibrated as a threshold.** The gate
  asked whether rank-1 scores separate, and they do — 498 distinct values over a
  0.176 span. Whether 0.55 is a *good* abstention threshold is a different
  question with a different gate, and no abstention was measured.
- **It does not show latency is unaffected under load.** Concurrency 1,
  loopback, single process. The change is arithmetic on values already in
  memory and both p95s moved under 1.3%, which is consistent with no effect,
  but this is not a load test.
- **A pack tail is still not reproducible across days unless `at` is pinned.**
  This change makes that worse in one narrow sense: rank-1 scores now vary per
  query, so the digit count of the serialized score varies too, and 43 of 500
  pooled tails differ between the two builds for that reason alone.

## Artifacts

[`results/2026-08-08-interpretable-score/`](./results/2026-08-08-interpretable-score/),
with `SHA256SUMS`. `harness/` holds every script written for this cycle —
`run.sh` is the exact sequence that produced `artifacts/`. The scorer is the
shared `common.score` / `common.sign_test` and was not modified.
