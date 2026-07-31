# Embedding S-calibration-v1 full scale

Date: 2026-07-31

Verdict: **scale-S lane completed; embedding-only quality is not sufficient for replacement**

The full run used the clean committed harness at
`7fb7d2cd378ef5e0981f37c3c95cd694e7f65c9c` and the configured Wulan
OpenAI-compatible embedding route. It generated exactly 10,000 synthetic
statements and 600 synthetic queries. No production memory service, canonical
database, Mem0 data, or route was changed.

## Protocol

- Model request: `tuf/embeddinggemma`; response model: `embeddinggemma`.
- Dimensions: 768; observed vector norms: 0.999999–1.000001.
- Strata: 40 queries for every combination of exact, paraphrase,
  cross-language, hard-negative, or no-result with Indonesian, English, or
  Javanese-in-Indonesian.
- Split: stable-hash 20/20 calibration/holdout in every stratum, producing 300
  queries per split.
- Ranking: exact sqlite-vec L2 over unit-normalized float32 vectors, converted
  to equivalent cosine; top 10.
- Threshold: `0.765014377`, frozen after calibration achieved 0/60 no-result
  false positives and its maximum Recall@5 of 208/240 (86.67%). Holdout was not
  queried before threshold selection.
- Storage: one 32,636,928-byte temporary vector database, removed after the
  run; no raw embedding was retained.

## Locked-holdout result

| Metric | Result | Wilson 95% interval |
| --- | ---: | ---: |
| Recall@1 | 191/240 (79.58%) | 74.04%–84.20% |
| Recall@5 | 197/240 (82.08%) | 76.74%–86.42% |
| answerable coverage | 224/240 (93.33%) | 89.45%–95.86% |
| answerable abstention | 16/240 (6.67%) | 4.14%–10.55% |
| no-result abstention | 60/60 (100%) | 93.98%–100% |
| no-result false positive | 0/60 (0%) | 0%–6.02% |

MRR@10 was `0.808390`; nDCG@10 was `0.818005`. The safe no-result objective
generalized to this holdout, but it did so with substantial answerable-query
loss.

### Holdout subgroups

| Subgroup | Recall@1 | Recall@5 | Answerable abstention |
| --- | ---: | ---: | ---: |
| Indonesian | 85.00% | 90.00% | 0% |
| English | 63.75% | 65.00% | 11.25% |
| Javanese-in-Indonesian | 90.00% | 91.25% | 8.75% |
| exact | 100% | 100% | 0% |
| paraphrase | 85.00% | 85.00% | 15.00% |
| cross-language | 45.00% | 55.00% | 0% |
| hard-negative | 88.33% | 88.33% | 11.67% |

The sharpest failure was the English-query/Javanese-in-Indonesian-statement
cross-language stratum: Recall@1 was 0/20 and Recall@5 was 1/20. The reverse
Javanese-in-Indonesian-query/Indonesian-statement stratum reached 20/20
Recall@5, so the cross-language behavior is asymmetric rather than uniformly
multilingual.

## Timing

Embedding statements in batches of up to 64 took
`601.940/673.476/817.217 ms` p50/p95/p99 across 157 provider calls. Exact native
retrieval took `8.531/11.003/14.845 ms` p50/p95/p99 across 600 queries. Total
wall time was 112.171 seconds. Provider network/model time and local exact-index
time remain separate; these numbers are not Titen service or Mem0 latency.

## Decision and limits

Checksummed sanitized evidence is under
[`results/2026-07-31-embedding-s-calibration-v1-full`](./results/2026-07-31-embedding-s-calibration-v1-full/).
The provider did not attest an immutable model revision. This lane proves that
an absolute cosine threshold can abstain safely on this fixed no-result
holdout, but embedding similarity alone does not meet multilingual answerable
quality. It does not classify memory, establish truth, resolve conflicts, or
replace Titen's deterministic evidence/policy boundary. Hybrid retrieval and
product-native LLM management still need their independent controlled gates,
and this result is not a Mem0 replacement decision.
