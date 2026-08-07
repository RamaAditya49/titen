# Pooled-improvement cycle, measured — nothing ships, all six ranking variants and the latency cap fail their gates

Date: 2026-08-08. Protocol [pre-registered](./2026-08-08-pooled-improvements-prereg.md) before every scored run; every headline number below was independently recomputed from the ranked artifacts through the shared scorer (`common.score` / `common.sign_test`), n=500 with failures in the denominator throughout, pooled baseline 0.246/0.3259 and anchor baseline 0.880 re-verified from the 2026-08-07 artifacts before any comparison. Where the verifier's recomputation contradicted a reported claim, the verifier's number is used and the contradiction is stated.

Verdict up front, because the discipline says losses get the same prominence as wins: **every gate in this cycle failed, and the shipped system survives its own improvement attempts unchanged.** The E-LAT candidate-cap prediction (30–60% p95 cut) was wrong by an order of magnitude — the actual cut is **4.5%** — so the 864.9 ms latency falsifier from 2026-08-07 stands. All **six** pre-registered E-RANK variants fail their gate, including V5: the orchestrator's inputs reported V5 as not run, but the verifier found its completed artifact and independently reproduced it — a **contradicted** null, corrected here; V5 is the sixth recorded loser. The third embedding family (E-VEC) landed 16.8 points below FTS-only, resolving the prereg's verdict rule against the embedding space itself. The one prediction that was right is the one that kills hope of a cheap latency fix: the scope conjunction costs 40.75% of the FTS query, inside the predicted 20–50% band — but the whole FTS stage is a minority of compile time, so neither lever reaches the gate. The +26.2-point top-10 ceiling is real and remains unreached; the shipped BM25 order and best-chunk aggregation are now ablation-backed rather than incidental.

## E-LAT — candidate-cap ablation: gate FAIL, falsifier stands

All cells: 500 compiles on the served full pooled store (`pooled-19829.db`, 342,129 claims), `titen-memory@0.7.0`, `max_tokens=32000`, `top_k=1000`, concurrency 1, loopback, quiet box (1-min load 0.08), 0 failures in all 1,500 compiles.

| Cell | max_candidates | recall@1 | MRR@10 | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline re-run | 1000 | 0.246 | 0.3259 | 418.48 ms | 863.39 ms | 1,013.5 ms |
| cap 200 | 200 | 0.246 | 0.3259 | 393.78 ms | **824.90 ms** | 965.44 ms |
| cap 100 | 100 | 0.246 | 0.3259 | 391.80 ms | 828.71 ms | 956.75 ms |

- **Baseline reproduced:** recall@1 0.246 exactly matches the published number; p50 418.48 vs published 424.7 (−1.5%), p95 863.39 vs 864.9 (−0.2%). The box qualifies as quiet under the prereg's own criterion.
- **Gate (p95 ≤ 250 ms with recall@1 within 0.5 pts of 0.246): FAIL.** The recall clause passes — 0.246 in every cell, MRR@10 identical, rankings effectively untouched by the cap. The latency clause misses by **3.3x**: best cell p95 is 824.90 ms.
- **Prediction (candidate cap cuts p95 30–60%): WRONG.** Actual cut 863.39 → 824.90 = **4.5%** (verifier's figure). The cap-100 p95 sitting above cap-200 is percentile-method noise (the ordering flips under the inclusive method), immaterial to the gate.
- **Prediction (scope conjunction is 20–50% of query time): RIGHT.** Median FTS query with the org/subject scope conjunction 65.597 ms, without 38.864 ms — price **26.733 ms = 40.75%**, measured read-only on a copy over 100 representative questions (every 5th, all six types) with the product's own `planFtsQuery` term selection.
- **Prediction ("reaching the gate likely needs both"): MOOT, and wrong in spirit.** Both levers combined recover ~65 ms of a ~575 ms gap. The whole FTS stage (~66 ms) is a minority of the ~420 ms compile p50; **~85% of compile time is outside the FTS candidate scan.**

**EXPLAIN-plan finding.** The committed-verbatim plan for the `retrieveClaimCandidates` query shows the post-CTE hydration is where the time must live, and names a suspect: on this planner, the disputed-status `contradictedSql` subquery (SUBQUERY 6) drives from `SEARCH o USING INDEX observations_workspace_scope (org_id=?)` *ahead of* the `claim_sources` covering-index seek — the exact drive-from-observations join shape that `src/core/authorization.ts` documents as the historical 79-second failure mode. Caveats that must travel with this: the plan was taken via python3's SQLite **3.51.2** (the run report said 3.45.1; the verifier corrected this from the artifact — version misstated in prose only), against a read-only copy, not through bun:sqlite. The lead is a hypothesis for the next cycle's prereg, not a finding about the product path, until the runtime planner is confirmed to do the same thing.

## E-RANK — six variants, six failures, no winner

Gate per variant: ≥ +2.0 points pooled recall@1 at p < 0.05 AND < 0.5-point anchor loss AND no provider dependency on the default path. Re-ranks operate strictly within each instance's shipped top-10; paired sign tests at k=1 against the 0.246 pooled / 0.880 anchor baselines, both baselines reproduced exactly before re-ranking. The V3 pass additionally reproduced the shipped ranked lists byte-identically (0W/0L/500T) from the served store, isolating its delta to the aggregation change alone.

| V | Variant | Pooled r@1 | Δ (pts) | Sign test (two-sided) | Anchor r@1 | Anchor Δ | Added latency | Gate |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | --- |
| V1 | term-coverage re-rank | 0.222 | −2.4 | W35/L47/T418, p=0.2242 | 0.808 | −7.2 | p50 3.7 / p95 6.5 ms | **FAIL** |
| V2 | term-proximity (min window) | 0.102 | −14.4 | W17/L89/T394, p<0.0001 | 0.100 | −78.0 | (same pass) | **FAIL** |
| V3 | chunk sum-of-scores | 0.128 | −11.8 | W19/L78/T403, p<0.0001 | not run¹ | — | — | **FAIL** |
| V4 | coverage + proximity tie-break | 0.210 | −3.6 | W36/L54/T410, p=0.0725 | 0.790 | −9.0 | (same pass) | **FAIL** |
| V5 | cross-encoder (ms-marco-MiniLM-L-6-v2, ONNX CPU)² | 0.234 | −1.2 | W38/L44/T418, p=0.5811 | 0.852 | −2.8 | **p50 642 ms/instance** | **FAIL** |
| V6 | RRF fusion (k=60) of shipped + V1 | 0.248 | +0.2 | W20/L19/T461, p=1.0 | 0.854 | −2.6 (p=0.0146) | (same pass) | **FAIL** |

¹ Per-chunk scores are unrecoverable from the anchor artifact; an anchor serve is warranted only if the pooled clause passes, and it failed decisively. The gate is conjunctive, so no anchor run could change the verdict.
² **Correction:** the orchestrated inputs to this report carried V5 as null/not-run and called it "the open prereg variant with headroom." The verifier's recomputation **contradicted** that: a completed V5 artifact exists (`improve-20260808-erank-xencoder.json`), its numbers reproduce exactly through the shared scorer, and it fails all three gate clauses while adding ~642 ms p50 per compile — on top of a p95 already 3.3x over the latency gate. V5 is closed, not open.

**Winner: none.** At-most-one-winner selection selects nothing; all six are recorded losers and nothing from E-RANK ships.

**Predictions, all wrong except the hedge.** V1/V4 predicted +2–6 points: actual −2.4 and −3.6 — wrong by 4.4–9.6 points and wrong in sign. V5 predicted the largest gain (+3–8): actual −1.2, wrong by 4.2–9.2 points, and its latency alone would have failed it. V3 was predicted as "the likeliest surprise in either direction": it resolved downward, −11.8 points at p < 0.0001. The prereg's audit-derived expectation that term coverage is the most promising cheap signal is falsified with it.

**Why, mechanically.** The V3b count-of-chunks diagnostic (0.122, within 0.6 points of sum-of-scores) shows sum aggregation is dominated by chunk multiplicity: long sessions full of partial-overlap chunks outvote a single high-scoring gold chunk — exactly the distractor class the density audit identified. The per-type breakdown explains the lexical failures: coverage-style signals help question-echo types (single-session-user 0.114→0.200 under V4, multi-session +6 pts under V1) but collapse single-session-assistant (0.714→0.321 under V1), where the gold answer shares few surface terms with the question. The two effects net negative under every mixing scheme tried, including rank fusion — V6's +0.2 is noise at p=1.0 and it still regresses the anchor significantly. Shipped BM25, with IDF and term-frequency weighting, beats every re-weighting of its own evidence at every margin tested. Any future attempt on the +26.2-point ceiling needs a signal that is not question-term overlap — and the cheapest local cross-encoder is now measured as not being that signal either.

## E-VEC — third embedding family: below FTS-only, verdict rule resolves against the embedding space

New cell: `snowflake/snowflake-arctic-embed-s` (fastembed 0.8.0, ONNX CPU, 384 dims, E5-class — distinct from the embeddinggemma and bge families as required). Dense-control shape identical to the prior cells: whole-session vectors, exact brute-force cosine over the full 19,829-session pool, all 500 questions, 0 failures.

| Cell, pooled 19,829 | recall@1 | recall@5 | recall@10 | MRR@10 | Embed ingest |
| --- | ---: | ---: | ---: | ---: | ---: |
| arctic-embed-s dense control | **0.078** | 0.138 | 0.174 | 0.1083 | 1,667.7 s |
| (cited) router embeddinggemma | 0.174 | — | — | — | — |
| (cited) fastembed bge-small | 0.124 | — | — | — | — |
| (cited) Titen FTS-only | **0.246** | — | — | — | — |

**Prediction (below 0.246): RIGHT**, by 16.8 points — the lowest dense cell yet. **Verdict rule: the below-FTS branch fires.** Three independent embedding families now collapse below lexical FTS on the pooled store, so the failure class is the whole-session embedding space at this distractor density, not any one model and not Titen's fusion. Per the prereg: the vector arm's documentation is scoped to scoped/per-instance stores, and **no fusion-fix spec is triggered.** By-type mirrors the other dense cells — single-session-assistant holds (0.536) while temporal, preference, and user types collapse toward zero.

## What changes in EVALS and claims

- **No headline number changes.** Pooled 0.246, anchor 0.880, compile p95 864.9 ms all stand; the 2026-08-07 latency falsifier remains fired.
- **The candidate-cap hypothesis is closed** as a recorded dead end: caps to 200/100 are recall-neutral and worth ~4.5% of p95. The named next lead for latency is the `contradictedSql` drive-from-observations join order in post-CTE hydration — usable only after bun:sqlite planner confirmation, which is the first line of any follow-up prereg.
- **The shipped ranking is now ablation-backed.** Best-chunk aggregation beats sum-of-chunks by 11.8 points (V3), and shipped BM25 order beats coverage, proximity, their combination, RRF fusion, and a local cross-encoder. EVALS may state this as evidence, not as a default that was never tested.
- **Vector-arm claims get scoped:** recommended for scoped/per-instance stores only; at pooled density three embedding families land 7.2–16.8 points below FTS-only.
- **The +26.2-point top-10 ceiling stays open and unclaimed.** All six pre-registered variants are spent; reaching it requires a new cycle with a new prereg and a non-lexical-overlap signal.

## What this does not show

- **The EXPLAIN plan and scope price are not product-path measurements.** Both come from python3's SQLite 3.51.2 on a read-only copy; bun:sqlite may plan the query differently. The join-order finding is a lead, not a diagnosis.
- **No latency fix is validated or even specced** — this cycle only eliminated one hypothesis and priced another's ceiling.
- Latency cells are concurrency 1 on a quiet box over loopback; no concurrency sweep, no answer accuracy, no managed-product comparison.
- V3's anchor arm was not run (conjunctive gate, pooled clause failed decisively); the anchor baseline for it is the standing 0.880, not a fresh measurement.
- The V3 pass ran at concurrency 2 sharing the box with E-LAT; its wall time is not comparable to the published latency numbers, and no latency claim is made for it.
- Re-ranks touch only positions 1–10 of the shipped order; nothing here measures recovering gold sessions that miss the top-10 entirely (49.2% of pooled instances).
- Two immaterial reporting discrepancies found in verification, recorded for completeness: the SQLite version misstated in run prose (3.45.1 vs the artifact's 3.51.2), and E-LAT percentiles computed by the `sorted[int(n*q)]` idiom (within 1 ms of `statistics.quantiles`; every conclusion is method-invariant).

## Evidence

All raw artifacts on `rama-tuf` under `~/titen-bench-20260804/`; the verifier confirmed all listed files exist plus the one unlisted V5 artifact. Checksummed summaries land under `docs/testing/results/2026-08-08-pooled-improvements/` per the prereg.

- E-LAT: `results/improve-20260808-elat.json` (sha256 `f9788c06…52b3`, verified; per-qid latencies, ranked lists, verbatim EXPLAIN, per-query scope timings), `results/improve-20260808-elat.cells.json`
- E-RANK lexical: `results/improve-20260808-erank-lexical.json` + per-variant `.v{1,2,4,6}.{pooled,anchor}.ranked.json` (8 files), harness `harness/erank_lexical.py`
- E-RANK chunk: `results/improve-20260808-erank-chunk.json`, `results/improve-20260808-erank-chunk.ranked.json`
- E-RANK cross-encoder (recovered by verification): `results/improve-20260808-erank-xencoder.json`
- E-VEC: `results/improve-20260808-evec-snowflake-arctic-embed-s.json`, `.ranked.json`, harness `harness/evec_pooled.py`, log `logs/improve-20260808-evec.log`

Housekeeping: the E-LAT server on 127.0.0.1:8899 (pid 3829974) was killed after verification; the port is free, and the canonical `pooled-19829.db` was never modified by any run in this cycle.