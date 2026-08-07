# The pooled-store condition, measured — and the zero-provider lane does not survive it

Date: 2026-08-07. Protocol
[pre-registered](./2026-08-07-pooled-store-prereg.md) before the first scored
run; the prereg commit precedes every artifact. Axis selection recorded in
[the performance-axis answer](../research/2026-08-07-performance-axis.md).

Verdict up front, because the discipline says losses get the same prominence
as wins: **the pre-registered prediction was wrong, two falsifiers fired
against Titen, and the pooled condition de-saturates LongMemEval-S exactly as
the instrument framing hoped.** FTS-only recall@1 falls from the published
0.880 to **0.246** when the ~50-session per-instance haystack becomes the one
real 19,829-session store, and compile p95 crosses the pre-registered 250 ms
kill line at 10,000 sessions. The synthetic scale curve did not overstate
real-data degradation; it understated it.

## What was measured

All 19,829 distinct LongMemEval-S sessions in ONE single-subject store per
lane; all 500 questions against it; four store sizes (gold-first nested
prefixes); per-compile latency at concurrency 1; store build cost per lane. A
subject-scoped anchor arm re-queried a copy of the published per-instance
store with the same tarball.

System under test: `titen-memory@0.7.0` from the npm registry (dist.shasum
`620af9a392b13c9bef91a215cf96eee2569e8f3e`), not a checkout. Host: `rama-tuf`
(AMD Ryzen 9 8945H, 16 threads, 30 GiB RAM), loopback, zero request failures
in every scored lane.

## Falsifier verdicts, in the prereg's order

1. **Anchor gate: PASS.** The 0.7.0 tarball re-queried the copied 424,168-claim
   per-instance store at recall@1 **0.880**, MRR@10 **0.9147** — exactly the
   published 0.6.0 numbers, run four times during orchestration repair with
   identical scores each time.
2. **Axis existence: the axis exists, decisively.** Titen FTS-only loses
   **63.4 points** of recall@1 from the per-instance condition to the full
   pool (0.880 → 0.246). The ≥2-point threshold is exceeded thirty-fold.
3. **Frontier: HOLDS, in the opposite direction from the fear.** Titen
   FTS-only at the full pool is **12.2 points above** the best zero-LLM
   control lane run so far (0.246 against 0.124), not 10 below it, and its
   paired tax (63.4 points) is statistically indistinguishable from the
   control's (64.8) rather than ≥5 points worse. The stronger router-embedded
   control is phase 2 and could still change this row; the verdict is scoped
   to the lanes actually run.
4. **No-relative-claim: does not fire.** The lane-vs-lane differences at the
   pooled condition are significant, not indistinguishable — see the sign
   tests below.
5. **Latency: FIRED against Titen.** Compile p95 at the full pool is
   **864.9 ms** against the pre-registered 250 ms line, which was already
   crossed at the 10,000-session cell (430.8 ms). Published anyway, as
   promised.

The pre-registered prediction — full-pool recall@1 0.70–0.85 — **was wrong by
more than 45 points.** The reasoning error is instructive and recorded below.

## Titen FTS-only: the curve on real data

| Store | Claims | recall@1 | recall@5 | recall@10 | MRR@10 | Ingest | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| per-instance anchor (scoped) | 424,168 | **0.880** | 0.960 | 0.982 | 0.9147 | — | 70.5 ms | 138.1 ms | 194.1 ms |
| pooled 1,000 sessions | 23,084 | 0.524 | 0.754 | 0.830 | 0.6239 | 16.8 s | 44.6 ms | 69.3 ms | 78.0 ms |
| pooled 5,000 | 91,105 | 0.364 | 0.614 | 0.700 | 0.4675 | 86.4 s | 122.0 ms | 227.4 ms | 258.4 ms |
| pooled 10,000 | 175,306 | 0.308 | 0.506 | 0.626 | 0.3976 | 172.1 s | 219.2 ms | 430.8 ms | 492.3 ms |
| pooled 19,829 (full) | 342,129 | **0.246** | 0.444 | 0.508 | 0.3259 | **363.8 s** | 424.7 ms | **864.9 ms** | 1,010.6 ms |

Reading order matters:

- **The anchor row is the product row.** One subject's own history at 424k
  claims: 0.880 at p95 138 ms. Authorization-before-retrieval is not overhead
  here; it is worth **+63.4 points of recall@1 and a 6.3x latency reduction**
  against the same corpus served unscoped. That is the measured answer to
  "just scope by user_id" — scoping is exactly what a memory system's
  authorization layer buys, and Titen's is on by construction.
- The 1,000-session cell is 94% gold by construction (the isolation trick):
  its density of cross-persona near-duplicates makes it *harder* per
  distractor than the larger cells, which is why the curve is steepest at the
  left. It is the low-distractor end of the curve, not a headline. Its
  repeatability wobble is ±1 point across invocations (0.514 observed in an
  aborted orchestration run, 0.524 in the scored run), consistent with the
  documented dead-heat identifier tie-break.
- Latency grows ~linearly in claim count (p50 44.6 → 424.7 ms across 23k →
  342k claims), the same one-thread FTS mechanism the synthetic scale report
  measured, now confirmed on real data.
- Ingest is the one coordinate that stays architectural: the full pooled
  store builds in **6.1 minutes for $0 with zero provider calls** — 199.6 MB
  of real conversation, ~31.9 M whitespace tokens, one process on one file.

## Why the prediction was wrong

The prereg predicted 0.70–0.85 on the reasoning that real conversations are
more lexically separable than the synthetic corpus's engineered same-topic
competitors. The audit shows why that reasoning failed: LongMemEval-S
instances share topics *by construction* — 500 personas asking about the same
life domains — so the pooled store is denser in cross-persona near-duplicates
than the synthetic generator's 250-competitor topic pools, not sparser. All
**377 of 377** rank-1 misses at the full pool retrieved a *cross-instance*
session; **zero** retrieved a wrong session from the question's own haystack.
The pooled tax is cross-persona interference, entirely.

## Contamination audit, pre-registered

On the seed-pinned n=50 sample of cross-instance rank-1 misses, **10 of 50
(20%)** of the retrieved top-1 sessions mechanically contain the instance's
gold answer string (lowercased containment — a lower bound, since paraphrased
answers read as false negatives). The strict session-ID score therefore
understates delivered utility at the full pool by at least a fifth of the
misses; the raw sample ships in the artifacts for third-party rejudging. Bias
direction disclosed: this correction, if applied, would favour every lane
roughly alike, and it is not applied to any headline number.

## The instrument result: the pooled condition de-saturates the benchmark

recall@10 falls from 0.982 (per-instance, saturated, 2.2 points of spread
across serious lanes) to **0.508** at the full pool, and the cross-lane
spread at the full pool is **12.2 points at k=1, 17.8 at k=5, 17.4 at k=10**
— against 2.2 points at k=10 in the per-instance condition. Every k
discriminates again; ranking, not candidate generation, becomes the binding
constraint — precisely the regime `EVALS.md` predicted and #267 proposed.

## Competitor lanes at the pooled condition

Same store order, same scorer, same 500 questions, zero failures.

**verbatim-RAG control, fastembed** (`BAAI/bge-small-en-v1.5` local, whole
sessions, exact brute-force cosine — the weak control config; per-instance it
scored 0.772):

| Store | recall@1 | recall@5 | recall@10 | Query p50 (dot+sort) |
| --- | ---: | ---: | ---: | ---: |
| pooled 1,000 | 0.330 | 0.562 | 0.674 | 0.06 ms |
| pooled 5,000 | 0.212 | 0.404 | 0.528 | 0.18 ms |
| pooled 10,000 | 0.166 | 0.326 | 0.428 | 0.39 ms |
| pooled 19,829 | **0.124** | 0.266 | 0.334 | 1.12 ms |

Control latency excludes its measured query-embedding cost (reported in the
artifact) and its store is a RAM matrix with no service, no durability, and
no authorization — its sub-ms numbers are not comparable to a served store's.

**MemPalace 3.6.0, published-benchmark raw shape** (bare chromadb, user-only
documents, MiniLM — the configuration that scored 0.804 per-instance):
pooled 19,829 recall@1 **0.164**, recall@5 0.276, recall@10 0.374, MRR@10
0.2152, query p50 127.9 ms (HNSW + query embedding), ingest 346.7 s local.

**MCP reference server** (substring, n=60 stratified): running at
publication; its per-query cost on a 19,829-entity graph — the server
re-reads and re-parses the whole ~300 MB graph file on every tool call — is
itself the result, and the measured figure is appended to the artifacts when
the lane completes.

### Paired sign tests, recall@1, identical instances

| Comparison | W/L/T | two-sided p |
| --- | ---: | ---: |
| Titen pooled vs Titen scoped anchor | 0/317/183 | ≈ 0 |
| control pooled vs control per-instance | 0/324/176 | ≈ 0 |
| MemPalace pooled vs MemPalace per-instance | 0/320/180 | ≈ 0 |
| **Titen FTS-only vs control, both pooled** | **86/25/389** | **< 0.0001** |
| **Titen FTS-only vs MemPalace, both pooled** | **76/35/389** | **0.0001** |
| MemPalace vs control, both pooled | 47/27/426 | 0.0265 |

Two readings, both required:

- **The taxes are uniform.** Titen loses 63.4 points, MemPalace 64.0, the
  control 64.8: the pooled condition collapses the whole day-1 group
  together, within two points of each other. Nobody's architecture escapes
  cross-persona interference on this corpus.
- **Within the collapsed regime, the differences are finally significant.**
  Titen FTS-only beats the fastembed control 86/25 (p < 0.0001) and
  MemPalace's published shape 76/35 (p = 0.0001) at the full pool — the
  first statistically significant lane-vs-lane retrieval separations this
  programme has produced on this corpus. Scoped per-instance, these same
  lanes were inside each other's noise; the de-saturated condition is what
  makes the comparison measurable at all. The claim stops at the lanes run:
  the router-embedded control and Mem0 `infer=False` are phase 2, and no
  managed product is compared.

### Build cost at the full pool

| Lane | Ingest | Provider calls | $ |
| --- | ---: | ---: | ---: |
| Titen FTS-only | **363.8 s** | 0 | 0 |
| control fastembed | 1,548.1 s embed (local CPU) | 0 external | 0 |
| MemPalace raw shape | 346.7 s (local MiniLM) | 0 external | 0 |

Every day-1 lane is locally reproducible for $0; the cost asymmetries that
motivated the frontier framing (Mem0's modes) belong to phase 2 and are not
quoted here.

## What this run does not show

- No answer accuracy. No concurrency sweep. No managed-product comparison.
- The unscoped pooled store models a shared multi-persona store; the
  subject-scoped anchor row is the single-user shape. Neither alone is "the"
  deployment, and no shipped product — Titen included — serves the unscoped
  query pattern by default.
- Phase-2 lanes (Titen FTS+vector, control router arm, Mem0 OSS 2.0.15
  `infer=False`) had not completed at publication; their cells are em dashes,
  never extrapolations.
- The 20% audit containment is a lower bound from mechanical string matching,
  not a human judgment.

## Evidence

Raw artifacts (`*.json`, `*.ranked.json` with per-qid latency, `*.audit.json`,
`SHA256SUMS`) under `~/titen-bench-20260804/results/` on `rama-tuf`; the
harness, analysis script, and checksummed summaries under
[`results/2026-08-07-pooled-store/`](./results/2026-08-07-pooled-store/).
