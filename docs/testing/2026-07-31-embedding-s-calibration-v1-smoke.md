# Embedding S-calibration-v1 smoke

Date: 2026-07-31

Verdict: **runner smoke passed; scale-S gate remains open**

The smoke ran the committed `s-calibration-v1` generator and scorer from
`d8c936b75d7776f387fa818d9845e5a47e88a928` against the configured Wulan
OpenAI-compatible embedding route. It used only synthetic content. The mode-0600
credential profile, endpoint URL, provider responses, statement/query text, and
raw embeddings are absent from the artifacts.

## Protocol

- Model request: `tuf/embeddinggemma`; response model: `embeddinggemma`.
- Dimensions: 768; observed vector norms: 0.999999–1.000001.
- Corpus: 600 deterministic statements and 60 queries.
- Strata: exact, paraphrase, cross-language, hard-negative, and no-result in
  Indonesian, English, and Javanese-in-Indonesian.
- Split: stable hash, two calibration and two holdout queries in each of the 15
  category/language strata; 30 queries per split.
- Ranking: exact sqlite-vec L2 over normalized float32 vectors, converted to the
  equivalent cosine score; top 10.
- Threshold: `0.719207489`, chosen before holdout to give zero calibration
  no-result false positives and maximize calibration Recall@5.
- Vector storage: one temporary sqlite-vec database; removed successfully after
  the run.

## Result

| Locked-holdout metric | Result | Wilson 95% interval |
| --- | ---: | ---: |
| Recall@1 | 22/24 (91.67%) | 74.15%–97.68% |
| Recall@5 | 24/24 (100%) | 86.20%–100% |
| answerable abstention | 0/24 (0%) | 0%–13.80% |
| no-result false positive | 1/6 (16.67%) | 3.01%–56.35% |

MRR@10 was `0.947917`; nDCG@10 was `0.960900`. Cross-language Recall@1 was
4/6 while its Recall@5 was 6/6. Exact, paraphrase, and hard-negative Recall@1/5
were 6/6 in each category. The holdout false positive shows why the six-case
calibration no-result sample cannot establish a production threshold.

Embedding batches of up to 64 statements had p50/p95/p99 wall time
`601.992/963.747/963.747 ms`. Native exact retrieval was
`0.595/0.999/2.708 ms` p50/p95/p99 across 60 queries. These timings describe
this smoke and client/provider path, not Titen service latency or a Mem0
comparison.

## Evidence and limits

Checksummed sanitized evidence is under
[`results/2026-07-31-embedding-s-calibration-v1-smoke`](./results/2026-07-31-embedding-s-calibration-v1-smoke/).
The provider did not attest an immutable model revision. This smoke does not
test Titen authorization, evidence, lifecycle, automatic LLM enrichment,
Cloudflare/VPS parity, Mem0 quality, or replacement readiness. The full
10,000-statement/600-query run remains the active plan item.
