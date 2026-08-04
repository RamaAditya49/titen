# Neutral-corpus head-to-head, 0.6.0 candidate versus self-hosted Mem0

Date: 2026-08-04. Host `rama-tuf`, 16 cores. Models served by one OpenAI-compatible
router shared by both systems: embeddings `tuf/embeddinggemma` at 768 dimensions.
Neither system called an LLM on the retrieval path.

Corpus: Mr.TyDi Indonesian, **externally authored**, 25 queries over 100
documents, fixture sha256 `a4a2f050…81ff`, top-k 10, threshold 0.0. Titen's own
fixture is reported separately in the release notes and is not used for any
cross-system claim.

Comparator: `mem0ai` 2.0.13 in **library mode** with reranking, its reranker and
its graph store disabled, local embedded Qdrant. That is Mem0's weakest
configuration; Titen has no equivalent of any of the three. A fairer rematch is
expected to raise Mem0's numbers.

Every Titen row is 10 repeats, fresh database, fresh subject namespace, fresh
server and free port per repeat, two untimed warm-up queries discarded. Values
are median [min–max across repeats]. Mem0's accuracy artifacts are reused from
the same day and are deterministic: one ranking signature across five repeats,
zero-width range on every metric.

## Accuracy

| run | recall@1 | recall@3 | recall@10 | MRR@10 | nDCG@10 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Titen 0.6.0, FTS+vector | 0.8000 [0.8000] | 1.0000 | 1.0000 | 0.8667 [0.8667] | 0.9000 [0.9000] |
| Titen 0.5.7, FTS+vector | 0.6200 [0.5200–0.6800] | 1.0000 | 1.0000 | 0.7767 [0.7267–0.8067] | 0.8336 [0.7967–0.8557] |
| Mem0, matched input | 0.7200 | 0.9200 | 1.0000 | 0.8180 | 0.8632 |
| Mem0, stock input | 0.6400 | 0.9200 | 1.0000 | 0.7780 | 0.8336 |
| Titen 0.6.0, FTS-only | 0.4400 [0.4400] | 0.8400 [0.8000–0.8400] | 0.9600 | 0.6304 [0.6270–0.6304] | 0.7122 [0.7094–0.7122] |
| Titen 0.5.7, FTS-only | 0.4400 [0.4400] | 0.8200 [0.8000–0.8400] | 0.9600 | 0.6287 [0.6270–0.6304] | 0.7108 [0.7094–0.7122] |

`no_result` correctness is **not measured** on this lane and cannot be: the
Mr.TyDi fixture contains zero no-result cases. Any number reported for it would
be fabricated.

## Latency and ingest

| run | ingest wall-clock | query p50 | query p95 |
| --- | ---: | ---: | ---: |
| Titen 0.6.0, FTS+vector | 1,833 ms | 188.5 ms | 209.2 ms |
| Titen 0.6.0, FTS-only | 111 ms | 0.70 ms | 1.41 ms |
| Mem0, matched input | 17,548 ms | 361.1 ms | 407.5 ms |

The latency comparison is structurally biased **against** Titen: Mem0 runs
in-process with no HTTP layer, while every Titen figure carries a loopback HTTP
round trip and JSON encode/decode. Titen's advantage is understated, not
inflated. Mem0's latency was measured earlier the same day under different load
and is not load-matched; measured drift on an unchanged Titen build over that
interval was about 11%.

## What this establishes

**Against the previously published 0.5.7 build: separation, in the vector lane
only.** recall@1 [0.8000, 0.8000] versus [0.5200, 0.6800], MRR@10 [0.8667] versus
[0.7267, 0.8067], nDCG@10 [0.9000] versus [0.7967, 0.8557] — disjoint on each.
The candidate beats not only the old median but the old build's single best
repeat, and no case regressed. The FTS-only lane does **not** separate: every
metric's range overlaps and recall@1 is identical.

**Against Mem0: no separation.** The point estimates favour Titen on every
metric, and the across-repeat ranges are disjoint — but that rule is vacuous
here, because both systems are deterministic on this harness. A zero-width range
on both sides reduces "ranges do not overlap" to "the medians differ", which any
non-zero difference satisfies. The uncertainty that governs a between-system
claim is query-sampling uncertainty over 25 queries, and repeating a
deterministic run measures none of it.

Paired sign tests over the same 25 queries, candidate versus Mem0 matched input:

| metric | Titen wins | Mem0 wins | two-sided p |
| --- | ---: | ---: | ---: |
| recall@1 | 2 | 0 | 0.500 |
| recall@3 | 2 | 0 | 0.500 |
| MRR@10 | 3 | 1 | 0.625 |
| nDCG@3, nDCG@10 | 3 | 1 | 0.625 |
| recall@10 | 0 | 0 | 1.000 (tied at ceiling) |

Absolute rank-1 hits: 20 of 25 against 18 of 25. The entire advantage is two
queries, and Titen loses one query (`mrtydi_9`) to both Mem0 configurations.

## Claims this run supports

- retrieval **parity** with self-hosted Mem0 on this corpus;
- lower query latency than self-hosted Mem0, ~1.9x with vector search enabled and
  ~400x in the FTS-only configuration, understated by the transport asymmetry;
- ~9.6x faster ingest, with LLM extraction off on both sides;
- **deterministic ranking when vector search is enabled** — one whole-run
  signature across 10 repeats, against 10 distinct signatures for 0.5.7;
- rank-1 retrieval improved over the published 0.5.7 build in the FTS+vector
  lane, from a median 0.62 to a deterministic 0.80.

## Claims this run does not support

- better rank-1 retrieval than Mem0, or beating Mem0 on any metric;
- "deterministic ranking" without the vector-search qualifier — the FTS-only
  lane still produces 10 distinct signatures in 10 repeats, exactly as 0.5.7 did;
- any improvement in the FTS-only lane;
- any claim for the temporal-polarity change, which touches 1 of 25 queries here;
- any abstention or no-result behaviour;
- superiority over "Mem0" in general, as opposed to self-hosted Mem0 in library
  mode with its reranker and graph store disabled.

## Correction to the 2026-08-04 baseline record

The earlier five-repeat run recorded Titen 0.5.7 FTS+vector at recall@1 0.680 and
MRR@10 0.807. Re-scoring that same artifact per repeat gives
`[0.68, 0.56, 0.68, 0.60, 0.68]` and `[0.8067, 0.7467, 0.8067, 0.7667, 0.8067]`:
the published figures were the **top** of the range, not the median. The true
0.5.7 median is 0.62. The published build was further behind Mem0 than that
record implied, and five repeats were not enough to see it. Do not requote 0.680,
0.807, or the 170 ms query p50 from that run.

## Limitations that still apply

- The corpus is the Mr.TyDi **train** split, used because the test and dev splits
  ship empty passage text. MIRACL-id was unavailable and Mem0's published LoCoMo
  subset was not attempted.
- 25 queries is a small sample; every between-system p-value above reflects that.
- Mem0 ran in library mode, not server mode, and with two of its ranking
  subsystems disabled.
- Retrieval semantics differ: Titen compiles a token-budgeted context pack and
  the harness truncates client-side; Mem0 returns a true top-k.
- One embedding model, one language, one host, one day.
