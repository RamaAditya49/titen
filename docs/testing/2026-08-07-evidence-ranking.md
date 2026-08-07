# Evidence-aware ranking: a measured null, and why the corpus could not say otherwise

Measured 2026-08-07 on `rama-tuf`, LongMemEval-S, all 500 instances, the shared
2026-08-04 scorer used unmodified, failures kept in the denominator, zero
failures in either pass. Protocol fixed in
[the pre-registration](./2026-08-07-evidence-ranking-prereg.md), committed in
`00e21fc` — before the first scored run, and before the ranker existed.

Raw artifacts, runners, and checksums:
[`results/2026-08-07-evidence-ranking/`](./results/2026-08-07-evidence-ranking/).

## The one-paragraph result

Evidence-aware ranking captured **0.0 of the 10.2-point oracle ceiling**:
recall@1 0.8800 before and 0.8800 after, MRR@10 0.9147 both, and the two ranked
lists are **byte-identical on all 500 instances** (0 wins / 0 losses / 500 ties,
p = 1.0). That is not a close call that fell the wrong way. It is a structural
zero: every evidence signal Titen ranks on takes exactly one value across all
424,168 claims in this corpus, so no ranker built on them could have moved
anything. **LongMemEval-S cannot falsify evidence-aware ranking in either
direction.** We are not claiming a retrieval improvement, here or anywhere.

## What was actually built, and what turned out not to need building

Five signals were named as candidates before any measurement. Resolving each
against the shipped 0.7.0 code left one. That audit is the first half of the
deliverable.

| Signal | Status at 0.7.0 | Built |
| --- | --- | --- |
| trust | already a weighted component, `RANK_WEIGHTS.trust = 0.20` | no, already ships |
| conflict (`disputed`) | already a weighted component, `RANK_WEIGHTS.conflict = 0.05` | no, already ships |
| feedback outcomes | already a weighted component, `RANK_WEIGHTS.utility = 0.10` | no, already ships |
| provenance `recalled` | **unreachable** | no |
| evidence depth | not ranked, derivable with no schema change | **yes** |

The `recalled` row is worth stating plainly, because it is the signal the
strategy leans hardest on. `src/core/claims.ts` refuses a `recalled` observation
as claim evidence at consolidation, because S3 closed the loop at the write path
rather than labelling it, and `src/core/context.ts` ranks claims, never
observations.
**No claim can carry recalled provenance, so a ranking penalty for one is code
that can never execute.** The store confirms it: 25,112 observations, provenance
`corpus` on every one, zero `recalled`.

What shipped is corroboration: `evidence_depth`, the count of authorized
*supporting* observations behind a claim, as a **tie-break key** placed after the
weighted score and after vector similarity, ahead of the existing statement
fallback. It is deliberately not a seventh weighted term. No corpus on this
machine has both varying evidence depth and gold labels, so a weight could only
have been fitted on the data it would then be scored on. A tie-break needs no
weight, so nothing was fitted.

## 1. The corpus carries no evidence variation at all

Measured directly from the ingested store with
[`signal-distribution.ts`](./results/2026-08-07-evidence-ranking/signal-distribution.ts),
not inferred from the ingest script. 424,168 claims over 25,112 observations:

| Signal | Distinct values across 424,168 claims |
| --- | --- |
| `trust` | 1 — `asserted` |
| `status` | 1 — `active`; zero disputed |
| `confidence` | 1 — 0.80 |
| `version` | 1 |
| `actor_id` | 1 |
| `created_at` | one calendar day, a 13.5-minute span |
| `claim_sources.relation` | 1 — `supports`; zero `contradicts`, zero `qualifies` |
| supporting observations per claim | **1, for every claim** |
| `context_feedback` rows | 0 |
| observation provenance | 1 — `corpus`; zero `recalled` |

Five of the six weighted ranking components are therefore constant, and the
one new signal is constant too. The arithmetic falls out exactly: every one of
the 500 instances returns a rank-1 score of **0.794374**, and that is the only
top score observed in the entire run.

```
0.4 × 1.000000  relevance   (min-max normalization pins the best to 1)
0.2 × 0.333333  trust       (asserted = 1 of 3)
0.15 × 0.984713 recency     (2 whole days old)
0.1 × 0.500000  utility     (below the three-signal gate)
0.05 × 1.000000 conflict    (nothing disputed)
0.1 × 0.800000  confidence
= 0.794374
```

This independently reproduces, on an externally authored corpus, what
`PONYTAIL-DEBT.md` item 2 recorded on Titen's own fixture: the score carries no
cross-query signal, because everything except relevance is the same number
everywhere.

## 2. Pass A against pass B

One store, a copy of the 2026-08-04 `fts-500.db`, never re-ingested, queried
twice. Pass A ran from the branch base commit *before the ranker was written*;
pass B from the branch head against the same file.

| Pass, n=500 | recall@1 | recall@5 | recall@10 | MRR@10 | failures |
| --- | ---: | ---: | ---: | ---: | ---: |
| A — 0.7.0 base | **0.8800** | 0.9600 † | 0.9820 † | **0.9147** | 0 |
| B — evidence tie-break | **0.8800** | 0.9600 † | 0.9820 † | **0.9147** | 0 |

† saturated on this corpus; see `EVALS.md`. recall@1 and MRR@10 are the primary
metrics.

Paired two-sided sign test on recall@1: **0 wins, 0 losses, 500 ties, p = 1.0.**
The ranked lists are identical at rank 1, in the top 10, and over the full list,
on 500 of 500 instances.

### Cross-build reference

Pass A reproduces the published 0.6.0 `titen-fts-500.ranked.json` at rank 1 on
**500 of 500** instances and in the top 10 on **499 of 500**, with identical
recall@1, recall@5, recall@10 and MRR@10. The full list differs on 113
instances; every one of those differences is a candidate-*set* difference, and
the earliest differing position across all 113 is **rank 10**: the 1,000-row
candidate cutoff admitting slightly different claims at its boundary, not a
reordering. This is reported rather than smoothed over, and it is a stronger
reproduction than the run needed.

## 3. Oracle ceiling: how much was captured

| | recall@1 |
| --- | ---: |
| baseline (pass A) | 0.8800 |
| oracle over the existing top-10 | 0.9820 |
| **ceiling** | **+10.2 points** |
| evidence ranker (pass B) | 0.8800 |
| **captured** | **+0.0 points — 0.0% of the ceiling** |

Zero is published because zero is the number. The ceiling remains entirely
open, and nothing in this run makes it smaller.

## 4. Against the lexical signals that already failed

The same top-10 re-ranking harness from the 2026-08-04 reranker-ceiling
analysis, re-run against pass A as the baseline:

| Variant | recall@1 | MRR@10 | sign test vs baseline @1 |
| --- | ---: | ---: | --- |
| baseline, pass A | 0.8800 | 0.9147 | — |
| **evidence depth (this work)** | **0.8800** | **0.9147** | 0 / 0 / 500, p = 1.0 |
| question-word coverage | 0.8440 | 0.8929 | 12 / 30 / 458, **p = 0.0079** |
| IDF-weighted coverage | 0.8480 | 0.8971 | 16 / 32 / 452, **p = 0.0293** |
| session-level Okapi BM25 | 0.8660 | 0.9082 | 14 / 21 / 465, p = 0.3105 |
| RRF(base, IDF coverage) | 0.8760 | 0.9141 | 7 / 9 / 484, p = 0.8036 |
| RRF(base, BM25) | 0.8800 | 0.9161 | 5 / 5 / 490, p = 1.0 |
| MemPalace recipe, 0.6 sim + 0.4 BM25 | 0.8860 | 0.9186 | 9 / 6 / 485, p = 0.6072 |

Read honestly: the evidence ranker does not *beat* any of these. It is
indistinguishable from the baseline because it did nothing, while two of the
lexical signals are significantly **worse** than the baseline and the rest are
noise. "Better than a signal that loses" is not a win, and the best lexical
variant on this table (+0.6 points at p = 0.61) is still not a win either. The
honest summary of the whole reranking programme so far is that **nothing tested
has moved recall@1 on this corpus.**

## 5. Per question type

Every delta is exactly zero, which is what a byte-identical ranking implies.
Included because a signal that helps one type and hurts another is a different
finding from one that helps uniformly, and this is neither.

| question_type | n | A recall@1 | B recall@1 | delta |
| --- | ---: | ---: | ---: | ---: |
| single-session-user | 70 | 0.9000 | 0.9000 | 0.0000 |
| single-session-assistant | 56 | 1.0000 | 1.0000 | 0.0000 |
| single-session-preference | 30 | 0.4000 | 0.4000 | 0.0000 |
| multi-session | 133 | 0.9023 | 0.9023 | 0.0000 |
| temporal-reasoning | 133 | 0.8496 | 0.8496 | 0.0000 |
| knowledge-update | 78 | 0.9744 | 0.9744 | 0.0000 |

`single-session-preference` at 0.400 over n=30 remains the weakest type by a
wide margin and is where the addressable ceiling actually concentrates. Nothing
in this work touches it.

## 6. The tie-break has no headroom here either

Beyond the signal being constant, the *mechanism* has nothing to act on. Probed
across all 500 instances with
[`tie_probe.py`](./results/2026-08-07-evidence-ranking/tie_probe.py):

- instances whose rank-1 position is tied across two different sessions: **0 of 500**;
- packs with a unique top score: **499 of 500**;
- median pack: 92 items carrying 88 distinct scores.

So even a perfect tie-break signal — evidence, lexical, or an oracle — could
change **zero** rank-1 answers on this corpus. That is a property of the corpus,
not evidence against tie-breaking.

## 7. Cost, and a design that was measured and rejected

Kill criterion 3 says a signal with no significant recall gain does not ship if
it costs latency. The recall gain is exactly zero, so the cost had to be
measured rather than argued.

The **first** implementation loaded evidence for every candidate on every
compile. At `top_k=5` with `max_candidates=200` it measured roughly **+1.4 ms
p50 (+7%)**, slower on three of four paired comparisons, against round-to-round
noise of the same order. Not clean, but the mechanism was unambiguous: the
sources query grew from 5 ids to up to 200. By the pre-registered criterion that
design does not ship, so it did not. Its numbers are kept in
[`latency-top-k.json`](./results/2026-08-07-evidence-ranking/latency-top-k.json)
rather than deleted.

The shipped design decides whether the returned window holds a genuine dead
heat from the preliminary ranking alone, with no database work, and looks
corroboration up only then. Re-measured, alternating builds against the same store:

| `top_k` | build | p50 | p95 | mean |
| ---: | --- | ---: | ---: | ---: |
| 5 | A base | 17.10–17.33 ms | 23.3–24.6 ms | 17.53–17.83 ms |
| 5 | B evidence | 17.25–17.45 ms | 23.0–23.8 ms | 17.70–17.79 ms |
| 1000 | A base | 18.64 ms | 25.24 ms | 18.97 ms |
| 1000 | B evidence | 18.74 ms | 25.99 ms | 19.28 ms |

p50 differs by at most 0.35 ms and the sign is not consistent across rounds.
Criterion 3 passes, and the 500-instance ranked output is byte-identical between
the two designs.

## 8. Tokens-to-answer

Pre-registered as an addition, not a replacement. recall@10 is saturated at
0.982–0.990 across every serious lane and discriminates nothing; the question a
caller actually pays for is how many tokens they must buy before the answer is
in the pack.

Definition: the token count of the smallest pack of **whole ranked sessions**
that contains a gold session, meaning the sessions at ranks 1..r where r is the
rank of the first gold session. Tokenizer:
`onnx-community/embeddinggemma-300m-ONNX` `tokenizer.json`, one tokenizer for
every lane. Instances with no gold session at any depth have no finite value;
they are counted explicitly and never imputed or dropped.

| Lane, n=500 | recall@1 | median | p25 | p75 | max | no gold at any depth |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Titen FTS + vector | **0.9000** | **3,209** | 2,654 | 3,735 | **37,291** | 0 |
| Titen FTS-only (pass A and pass B) | 0.8800 | 3,212 | 2,636 | 3,744 | 74,499 | 0 |
| verbatim-RAG control, router | 0.8540 | 3,282 | 2,643 | 3,892 | 82,272 | 0 |
| MemPalace 3.6.0, user-only | 0.8040 | 3,346 | 2,643 | 4,055 | 92,572 | 0 |
| verbatim-RAG control, fastembed | 0.7720 | 3,361 | 2,686 | 4,183 | 90,896 | 0 |
| MemPalace 3.6.0, full-text | 0.7460 | 3,428 | 2,741 | 4,569 | 94,660 | 0 |
| MCP reference server, substring | 0.0500 | 12,558 | 7,364 | 18,636 | 31,138 | **259** |

Two things to read here and one not to.

**The medians barely separate the serious lanes.** 3,209 to 3,428 is a 6.8%
spread, because every competent lane puts the gold at rank 1 on most instances
and the median is then just the gold session's own length. On this corpus
tokens-to-answer is a **weaker** discriminator than recall@1, not a stronger
one, and it should not be promoted over it. The tail is where the lanes differ:
worst-case cost ranges from 37k tokens to 95k.

**It does separate a working retriever from a broken one, dramatically.** The
MCP reference server needs a 12,558-token median, roughly **4x**, and on 259 of
500 instances never surfaces the gold at all, so no budget buys the answer.
That is the same 441,501-downloads-a-month default the substitution spec targets.

**What not to read into it:** this is not a cost or a price claim. It counts
tokens in ranked whole sessions, which is what these lanes return; it is not a
measurement of what a compiled Titen pack costs, and it says nothing about
answer accuracy, which was a flat null across eight pre-registered comparisons
on 2026-08-06.

## Verdict against the pre-registered kill criteria

| Criterion | Result |
| --- | --- |
| 1. Ships only if it does not lose | recall@1 identical, 0/0/500. **Passes.** |
| 2. Must not move rankings where the signal is constant | 500 of 500 lists byte-identical. **Passes.** |
| 3. Must not cost latency without a significant gain | first design tripped it and was rejected; shipped design measures flat. **Passes.** |
| Retrieval claim | **withheld.** 0.0% of the ceiling captured. |

The change ships on its unit contract, which is proven by a dual-runtime case
that fails without it, and it ships with the retrieval claim explicitly
withheld. Its benefit on a real store is **unmeasured, not demonstrated.**

## What this measurement does not establish

- **Nothing about stores where evidence varies.** LongMemEval-S is a
  single-actor, single-trust, single-confidence, no-conflict, no-feedback,
  one-observation-per-claim corpus. Every store this ranker is designed for
  looks nothing like it. Whether corroboration helps real memory is untested,
  and this run does not make it more likely. It only fails to make it less.
- **Nothing about the vector arm.** Pre-registered as conditional on pass B
  differing from pass A anywhere; it did not, and a byte-identical ranking
  cannot become non-identical by adding cosines. The router lane was not run.
- **Nothing about answer accuracy.** Not re-run, and it was a null in August.
- **Nothing about Cloudflare D1 retrieval quality.** The dual-runtime contract
  proves the ranking code behaves identically on both drivers. It is not a
  benchmark score on D1.
- **Nothing about concurrency or throughput.** The latency figures are
  single-client, loopback, warm-cache, one host.
- **Nothing about the +10.2-point ceiling.** It is still there and still
  unclaimed. `single-session-preference` at recall@1 0.400 over n=30 is where it
  concentrates.

## What would falsify the design, next time

A corpus in which evidence signals actually vary, with gold labels. It does not
exist here, and building one ourselves would be grading our own homework: a
Titen-authored fixture with Titen-shaped evidence would prove only that we can
write a fixture. The honest next step is to find or construct a corpus where
corroboration count is externally determined, publish its construction before
scoring it, and accept whatever it says. Until then the correct statement is the
one at the top of this document: **we do not know, and we are not claiming.**

## Reproduction

```
# artifacts and runners
docs/testing/results/2026-08-07-evidence-ranking/

bun signal-distribution.ts <store.db>            # section 1
bash serve_lane.sh <store.db> <port> <log>       # never deletes, never bootstraps
python query_pass.py  --port <p> --key-file <bootstrap-log> --out <name>
python tie_probe.py   --port <p> --key-file <bootstrap-log>
python latency.py     --port <p> --key-file <bootstrap-log> --top-k 5
python analyze.py                                # sections 2-6 and 8
```

`~/titen-bench-20260804/harness/common.py` — the shared corpus loader, scorer,
and sign test — is imported unmodified by every one of them. One scorer, or the
lanes are not comparable.

Commit under test: branch `feat/evidence-aware-ranking`, baseline `00e21fc`
(byte-identical to `main` at 0.7.0). Store: a copy of
`~/titen-bench-20260804/lanes/titen/fts-500.db`, ingested 2026-08-04 by
`titen-memory@0.6.0`, opened here by 0.7.0 after its migrations applied. Host
`rama-tuf`, Bun 1.3.14, `bun:sqlite`, FTS-only, no embedding provider, no LLM
call, no network call.
