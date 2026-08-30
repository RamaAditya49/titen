# Pre-registration — pooled-regression improvements (E-LAT, E-RANK, E-VEC)

Date: 2026-08-08. Committed ahead of every scored run of this cycle. Paired
with spec/plan `2026-08-08-pooled-regression-improvements`. Stores are the
2026-08-07 pooled artifacts' stores (still on disk on `benchmark-host`) or rebuilt
from the same pinned gold-first order; the system under test remains the
`titen-memory@0.7.0` registry tarball for served cells.

## Distractor-density audit, computed before any prediction (AC-PRI-006)

Content-word audit over the full 19,829-session pool (stopworded, ≥3 chars):
sessions containing **all** of a question's content words — min 0, p25 0,
**median 0**, p75 2, p90 9, max 390; **366 of 500 questions have ≤1 such
session**. The pooled recall collapse is therefore not driven by full-match
competitors: it is **partial-overlap distractors outscoring the gold under
BM25**. This is why term-coverage is pre-registered as the most promising
cheap ranking signal below, and that expectation is recorded here, before
any variant runs.

## E-LAT — latency ablation, quiet box, concurrency 1

Cells, in order, each 500 compiles on the served full pooled store:

1. Baseline re-run (`max_candidates=1000, top_k=1000`) — must reproduce the
   published p50/p95 within repeat spread or the box is not quiet.
2. `max_candidates=200`, then `100`; recall@1 and latency per cell.
3. `EXPLAIN QUERY PLAN` of the compile candidate query, committed verbatim.
4. Scope-conjunction price: the same FTS query with the single-valued
   scope term dropped, measured read-only against a copy of the database
   (not through the product path).

**Gate:** a change ships only if compile p95 ≤ 250 ms at the full pool with
recall@1 within 0.5 points of 0.246, implemented without a new flag, with a
dual-runtime contract case and EXPLAIN evidence.

**Prediction, written first:** candidate-cap reduction cuts p95 by 30–60%
but does not alone reach 250 ms; the scope conjunction accounts for 20–50%
of query time on a one-subject store. Reaching the gate likely needs both.

## E-RANK — ranking variants against the measured ceiling

Ceiling, re-verified from stored artifacts before variants run: pooled
recall@10 0.508 against recall@1 0.246 → **+26.2 points inside the top-10**.

Exactly six variants, named now; anything else is a different cycle:

| V | Variant | Model calls |
| --- | --- | ---: |
| V1 | term-coverage re-rank of top-10 (fraction of query content words present) | 0 |
| V2 | term-proximity re-rank (minimum window containing matched terms) | 0 |
| V3 | chunk-aggregation: sum-of-chunk-scores per session vs the shipped best-chunk | 0 |
| V4 | coverage + proximity combined (V1 then V2 as tie-break) | 0 |
| V5 | local cross-encoder over top-10 (fastembed-class ONNX reranker, local only) | local |
| V6 | RRF fusion of shipped order with V1 order | 0 |

Scored by the shared scorer on the same stores/artifacts, paired sign tests
against the 0.246 baseline, per-type breakdown, failures in denominator.

**Gate:** a variant ships only if it gains ≥2.0 points of pooled recall@1 at
p < 0.05 AND loses < 0.5 points on the per-instance anchor condition AND
adds no provider dependency to the default path. At most one winner ships;
losers are recorded.

**Prediction, written first:** given the audit, V1/V4 capture +2–6 points;
V5 captures the most (+3–8) but is gated by its added latency; V3 is the
likeliest surprise in either direction because the shipped best-chunk
aggregation was never ablated.

## E-VEC — embedder isolation on the pooled store

Existing cells cited, not re-run: router `embeddinggemma` dense control
0.174; fastembed `bge-small-en-v1.5` dense control 0.124; Titen FTS+vector
0.212. New cell: **one additional local embedder**, dense-control shape
only, from fastembed's supported list, distinct from both existing families;
exact model named in the artifact.

**Verdict rule:** if the third embedder's dense lane also lands below
FTS-only (0.246), the failure class is the embedding space at this
distractor density, and the vector arm's documentation is scoped to
scoped/per-instance stores. If it lands above, the profile/fusion becomes
the suspect and a fusion fix gets its own spec. Either way is published.

**Prediction, written first:** below 0.246 — whole-session embeddings at
this density have shown the same collapse in two families already.

## Reporting

All cells land in `docs/testing/2026-08-08-pooled-improvements.md` with
artifacts + SHA256SUMS under `results/2026-08-08-pooled-improvements/`;
every gate verdict is stated even when it kills the work.
