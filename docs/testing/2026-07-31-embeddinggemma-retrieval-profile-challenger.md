# EmbeddingGemma retrieval-profile challenger

Date: 2026-07-31

Verdict: **use the documented retrieval profile; embedding-only still fails one locked subgroup**

The [official EmbeddingGemma model card](https://huggingface.co/google/embeddinggemma-300m/blob/main/README.md)
prescribes asymmetric retrieval preprocessing:

- document: `title: none | text: {content}`;
- query: `task: search result | query: {content}`.

This profile was selected from the primary documentation before its scores were
observed. The raw-input scale-S result remains immutable. The challenger changed
only preprocessing and repeated the same 10,000 statements, 600 queries,
stable-hash split, model route, dimensions, batch size, exact cosine ranking,
calibration objective, and locked-holdout scorer.

## Reproducibility

| Field | Raw baseline | Retrieval-profile challenger |
| --- | --- | --- |
| source commit | `7fb7d2cd378ef5e0981f37c3c95cd694e7f65c9c` | `97c472824f7eba7f783ce22adc847b825a478080` |
| fixture SHA-256 | `18affc5931bc7eaf8f0da3249e83b0d523d39c573118b29d4289e4fe20228992` | same |
| split SHA-256 | `01767a26076a3ddb2e326d073ddcf6aada080c3552d3511a4f1f3c506adf9dcb` | same |
| preprocessing | raw input | `embeddinggemma-retrieval-v1` |
| preprocessing SHA-256 | not present in the immutable baseline | `aeef4327d335d8e0d82867a6530d9533b448ff8d88a8853e20341d81783f45c2` |
| calibrated threshold | `0.765014377` | `0.737307171` |

The challenger manifest fingerprints the exact templates with the model,
endpoint hash, dimensions, precision, metric, and ranking method. The provider
returned `embeddinggemma` for the requested `tuf/embeddinggemma` route but did
not attest an immutable model revision.

## Locked-holdout comparison

| Metric | Raw baseline | Retrieval profile | Change |
| --- | ---: | ---: | ---: |
| Recall@1 | 79.58% | 85.83% | +6.25 points |
| Recall@5 | 82.08% | 91.67% | +9.58 points |
| MRR@10 | 0.808390 | 0.881736 | +0.073346 |
| nDCG@10 | 0.818005 | 0.890558 | +0.072553 |
| answerable coverage | 93.33% | 100% | +6.67 points |
| answerable abstention | 6.67% | 0% | -6.67 points |
| no-result false positive | 0/60 | 0/60 | unchanged |

Recall@5 by language improved from 90.00% to 100% for Indonesian, 65.00% to
75.00% for English, and 91.25% to 100% for Javanese-in-Indonesian. By category,
paraphrase improved from 85.00% to 100%, hard-negative from 88.33% to 100%, and
cross-language from 55.00% to 66.67%; exact remained 100%.

The paired 240 answerable holdout cases separate as follows:

| Recall@5 outcome | Cases |
| --- | ---: |
| both profiles correct | 196 |
| retrieval profile only | 24 |
| raw input only | 1 |
| neither profile correct | 19 |

That is a net gain of 23 cases. An exact two-sided McNemar test over the 25
discordant pairs gives `p=0.00000155`; the quality change is not explained by
independent fixture sampling. Both profiles still produced 0/60 no-result false
positives on the locked holdout.

The aggregate improvement does not hide the failed stratum. English queries
against Javanese-in-Indonesian statements fell from 1/20 to 0/20 Recall@5,
while the other two cross-language directions reached 20/20. The documented
profile fixes input misuse and is the correct future baseline, but it does not
meet a per-language/direction quality floor.

## Timing and decision

Statement embedding p50/p95 changed from `601.940/673.476 ms` to
`614.457/747.741 ms`; total wall time changed from 112.171 to 117.176 seconds.
These adjacent single runs do not establish a latency regression. Both runs
used disposable sqlite-vec files and retained no raw embeddings, endpoint URL,
credential, statement text, query text, or provider response.

Checksummed challenger evidence is under
[`results/2026-07-31-embedding-s-calibration-v1-embeddinggemma-retrieval-full`](./results/2026-07-31-embedding-s-calibration-v1-embeddinggemma-retrieval-full/).
EmbeddingGemma retrieval prefixes should be part of any Titen deployment
fingerprint, but embeddings remain candidate retrieval only. They do not
classify memory, establish provenance/truth, resolve conflicts, or replace the
separate LLM-management and deterministic-validator gates. The harness does not
fix product issues [#144](https://github.com/RamaAditya49/titen/issues/144) or
[#155](https://github.com/RamaAditya49/titen/issues/155); both remain open.
Because this comparison inspected the first holdout while selecting the future
profile, production selection needs a second untouched holdout and an attested
model revision.
