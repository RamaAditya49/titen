# Embedding S-validation-v2

This run tests whether the previously selected EmbeddingGemma retrieval profile
and cosine floor repeat on new synthetic data. It does not recalibrate the
threshold and is not a Mem0 replacement verdict.

## Locked method

- runner source: `87685f662585c83e95003dabb805c47fae8dd045`, clean at run start;
- fixture: 10,000 statements from groups 1000 through 1999 and 600 queries,
  disjoint from S-calibration-v1 groups 0 through 999;
- profile: `embeddinggemma-retrieval-v1`;
- fixed cosine floor: `0.737307171`, selected by S-calibration-v1 before this
  fixture existed;
- split: all 600 queries are holdout cases; no current-fixture threshold search;
- provider route, model, dimensions, and preprocessing fingerprint match the
  first full profile run;
- retained artifacts contain IDs, scores, timings, metrics, and hashes only.

## Result

| Metric | S-validation-v2 |
| --- | ---: |
| Recall@1 | 88.75% (426/480) |
| Recall@5 | 91.67% (440/480) |
| MRR@10 | 0.901042 |
| nDCG@10 | 0.905084 |
| answerable abstention | 0/480 |
| no-result false positives | 0/120 |

Recall@5 was 100% for Indonesian and Javanese-in-Indonesian queries and 75%
for English queries. Exact, paraphrase, and hard-negative Recall@5 were 100%.
Cross-language Recall@5 was 66.67%; the English-query to
Javanese-in-Indonesian-statement direction remained 0/40.

That direction is one of three the stratum contains: `groupLanguage` rotates the
statement language one position past the query language, so `cross_language`
tests Indonesian to English, English to Javanese-in-Indonesian, and
Javanese-in-Indonesian to Indonesian, and only the English case has non-English
gold. Joining the raw trials to the fixture's per-statement language shows that
2,000 of 2,000 top-10 hits across all 200 English queries are English
statements, so the 0/40 measures the provider's English embedding cluster over
333 same-template English `backup_region` statements rather than a missing or
malformed gold.

The overall Recall@5 and no-result result exactly repeat the first full profile
run (91.67% and zero false positives) on a disjoint fixture. This supports the
profile and floor for this measured deployment. It does not justify a bundled
default: the provider still does not attest an immutable model revision, the
cross-language direction remains weak, and this lane does not measure evidence,
authorization, lifecycle, enrichment, or Mem0 parity.

## Evidence

The checksummed artifacts are under
[`results/2026-07-31-embedding-s-validation-v2-full/`](./results/2026-07-31-embedding-s-validation-v2-full/):

- fixture SHA-256: `d76e58c45e6889f142d73bd32303b4be81c8a63ac323c01f466c87f5abd1ee01`;
- split SHA-256: `0007221bfa99d22d005796f31bed24d92ddb8750368f3674d942006c48d3b7c6`;
- model fingerprint SHA-256: `274141aedbd0fab5adcfec87af1d1baa1402b0af7a8358468fbf72931e93ee49`;
- raw-trial SHA-256: `ea62e606b4ffe7ef28446b40a460d4579ba56e1caa1fa400028dfa0e5a12215d`.

`sha256sum -c SHA256SUMS` passes. A forbidden-content scan found no endpoint,
credential marker, fixture sentence, internal synthetic endpoint, or embedding
array. The disposable 32,636,928-byte sqlite-vec database was removed by the
runner before success.
