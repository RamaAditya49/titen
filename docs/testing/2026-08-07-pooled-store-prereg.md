# Pre-registration — the pooled-store condition on LongMemEval-S

Date: 2026-08-07. Committed ahead of every scored pooled artifact; the git
history is the evidence of ordering. Protocol follows the house rules: one
shared scorer, failures kept in the denominator, paired sign tests,
falsifiers written before any run.

## Question

Every published LongMemEval-S number — Titen's, MemPalace's, Mem0's, the
controls', and every vendor headline — gives each question its own ~50-session
haystack. A real memory store is one shared, cumulative corpus. This run
measures the condition [`EVALS.md`](./EVALS.md) proposed and
[#267](https://github.com/RamaAditya49/titen/issues/267) tracked but nobody —
vendor or academic — has ever executed:

1. recall@1 and MRR@10 when all 500 questions run against ONE store holding
   all 19,829 distinct sessions;
2. per-compile wall-clock latency (p50/p95/p99, loopback, concurrency 1) at
   store sizes 1,000 / 5,000 / 10,000 / 19,829 sessions;
3. the measured cost of building each lane's store (wall clock, LLM calls,
   embedding calls).

Field context, verified in the
[2026-08-07 landscape survey](../research/2026-08-07-memory-agent-landscape.md):
BEAM (arXiv:2510.27246) publishes accuracy-vs-token-scale for managed stacks
and paper configurations on a fully synthetic corpus; **no self-hosted OSS
configuration has a published quality-vs-store-size curve on externally
authored conversational data, and zero memory systems publish tail latency at
10^5+ stored items.**

## Fixture facts, verified 2026-08-07 before any run

- 500 instances, 25,112 (instance, session) pairs, **19,829 distinct session
  ids**; sid -> text is unique (0 of 19,829 sids carry more than one distinct
  text), so pooling is well defined.
- 940 gold sessions (union of `answer_session_ids`), all present in the pool.
- Pool text: 199,632,942 bytes, 31,884,485 whitespace tokens.
- Fixture artifact: the same `longmemeval_s` file as the 2026-08-04 programme.

## Store construction

One store per lane. Distinct sessions ingested once each under a **single
organization and single subject** (`pooled-v1`), so the candidate pool is
genuinely pooled — Titen's FTS `MATCH` conjoins `org_scope`/`subject_scope` by
design (`src/core/retrieval.ts`), and a multi-subject store would silently
reintroduce scoping.

- Order: gold sessions first, then non-gold, each stratum sorted by
  sha256("20260804|" + sid) — the `benchmark-scale.ts` isolation trick. Every
  question is answerable at every prefix; distractor volume is the only
  variable that moves between sizes.
- Prefixes at 1,000 / 5,000 / 10,000 / 19,829 are nested (strict prefix).
- The 1,000-session cell is 94% gold sessions by construction. It is the
  low-distractor end of the curve, never a headline, and never comparable to
  the published per-instance condition.
- The pooled store deduplicates sessions (19,829 ingests) where the
  per-instance condition ingested 25,112 (instance, session) pairs; both are
  stated wherever the two conditions appear in one table.

## Query arms

- **Unscoped-pooled** (the new cell): every question compiled against the
  single pooled subject.
- **Subject-scoped anchor** (the published condition): the existing
  2026-08-04 per-instance store (`fts-500.db`, 424,168 claims, one subject
  per instance) is **copied**, served by the system under test, and re-queried
  — the original file is never opened. This arm is simultaneously the anchor
  gate and the measured answer to "real products scope by user_id": what
  scoping buys, in the same table as what it cannot buy.

## Systems under test, every configuration named

Titen is measured as the **public npm artifact `titen-memory@0.7.0`**
(dist.shasum `620af9a392b13c9bef91a215cf96eee2569e8f3e`), installed fresh from
the registry on the bench host — not a checkout. The published per-instance
numbers were produced by 0.6.0; two intervening changes (the evidence-depth
tie-break and the #291 `disputed` authorization fix) were both measured
byte-identical at n=500 on this corpus, so the anchor gate below is expected
to pass and fails loudly if that expectation is wrong.

Day-1 lanes:

| Lane | Configuration | Expected provider calls |
| --- | --- | --- |
| Titen FTS-only | tarball; serve script unsets every `TITEN_EMBED_*`/`TITEN_EXTRACT_*` | 0 |
| verbatim-RAG control | fastembed `BAAI/bge-small-en-v1.5`, local, same ~100-line ranker as 2026-08-04 | 0 external |
| MemPalace 3.6.0 | published-benchmark raw shape: bare chromadb, user-turns-only documents, default MiniLM — the configuration that scored 0.804 at n=500 | 0 external |
| MCP reference server | substring, pooled graph, n=60 stratified questions | 0 |

Phase-2 lanes (same prereg; published when complete; absent cells are em
dashes, never extrapolated):

| Lane | Configuration |
| --- | --- |
| Titen FTS+vector | router `embeddinggemma` retrieval profile, explicit drain before query |
| verbatim-RAG control, router arm | same pinned embedder as Titen's vector arm |
| Mem0 OSS 2.0.15 | `infer=False` — its LLM-free mode, named per the standing rule |

Mem0 `infer=True` is **never a scored lane** at pooled scale: its measured
per-turn cost (2,981 LLM calls / 288,021 summed seconds for 60 instances)
makes the pooled store a five-figure-call ingest. That asymmetry — one lane in
the table cannot afford to be measured at production shape on one machine —
is itself a published result, reported as a clearly-labeled extrapolation.

MemPalace ingest-cost attribution, resolving a contradiction the judge pass
flagged: the repository carries both 486.1 s (n=500, `vendorrepro-useronly-
minilm` — the published configuration) and 6,065.8 s (n=60, a router-embedded
vector configuration). These are different configurations; only the former is
the published lane, and only its shape is run here. The pooled lane reports
its own measured ingest either way.

## Scoring

- Session-ID gold (`answer_session_ids`), the one shared scorer
  (`common.py`), failed or missing instances scored zero and kept in the
  denominator.
- recall@1 and MRR@10 primary. recall@5/@10 reported; their saturation status
  is **re-evaluated at the pooled condition** — if the k=10 spread across
  serious lanes exceeds 5 points, the saturation marker is dropped for the
  pooled condition and that change is reported explicitly.
- Paired two-sided sign tests: each lane full-pool vs its own published
  per-instance ranked lists on identical instances; lane-vs-lane at the full
  pool.
- **Contamination audit:** rank-1 misses that retrieved a cross-instance
  session are sampled (n=50, seed-pinned), checked for answer containment
  against the instance's gold answer string, and the raw sample is published
  for third-party rejudging. The residual bias direction is disclosed.
- Latency: per-compile wall clock per qid; p50/p95/p99 with client location
  (loopback) and concurrency (1) stated. Control-lane latency reports the
  dot+sort separately from the measured query-embedding cost.
- Build cost per lane: wall clock, provider calls; service CPU from `/proc`
  where the lane runs a service.

## Falsifiers, written before any scored run

1. **Anchor gate.** The subject-scoped anchor arm must reproduce the
   published n=500 numbers (recall@1 0.880, MRR@10 0.9147) within ±0.002
   recall@1, or the harness/tarball combination is broken and nothing else is
   reported.
2. **Axis-existence.** If no serious lane loses ≥2 points of recall@1 from
   the per-instance condition to the full pool, pool size does not matter on
   real conversational data at this corpus's maximum size. Finding A's premise
   fails on external data; the null is published, the axis is retired, and the
   #267 reasoning is corrected in print.
3. **Frontier.** If Titen FTS-only at the full pool falls more than 10 points
   of recall@1 below the best zero-LLM control lane, or its paired scale tax
   exceeds the dense control's by ≥5 points (sign test, p < 0.05), the
   zero-provider operating point does not survive the de-saturated shape. The
   frontier claim is dead; the result is published as deployment guidance and
   the product story retreats to the hybrid lane.
4. **No-relative-claim.** If all serious lanes' taxes are statistically
   indistinguishable, there is no lead — only a field-first absolute
   degradation curve, claimed as exactly that.
5. **Latency.** If Titen's compile p95 at the full pool exceeds 250 ms
   (loopback, concurrency 1), the latency half of the frontier is dead
   regardless of recall, and the number is published anyway.

## Prediction, written before the run

The synthetic-corpus slope (recall@1 1.00 -> 0.49 across 10^3 -> 10^5 claims)
will not transfer in intercept: that corpus engineered ~250 same-topic
competitors per query, denser than real conversations. Expected Titen FTS-only
full-pool recall@1: **0.70–0.85**. Expected full-pool compile p95:
**30–250 ms**, extrapolated from 11.6 ms p50 at 10^5 synthetic claims and the
harness-validation smoke below.

## Harness validation, disclosed

Before this document was finalized, the pooled runner was smoke-tested
end-to-end on a 940-session gold-only store (all 500 queries, zero failures)
to validate plumbing. That store is not a prereg cell, its numbers are not
results, and they are not quoted anywhere. The latency falsifier above was set
after seeing the smoke's latency (p95 67 ms at 940 sessions); this ordering is
disclosed rather than hidden.

## Artifacts

Runners: `pooled_common.py`, `pooled_run.py`, `control_pooled.py`,
`mp_pooled.py`, `prep_pooled.py` + `run_pooled.js`, and the tarball serve
script — committed under
[`results/2026-08-07-pooled-store/harness/`](./results/2026-08-07-pooled-store/harness/).
Raw per-lane artifacts (`*.json`, `*.ranked.json` with per-qid latencies,
manifests, `SHA256SUMS`) land under `~/titen-bench-20260804/results/` on
`benchmark-host` before any summary number is written down; checksummed summaries
are committed under `results/2026-08-07-pooled-store/`.
