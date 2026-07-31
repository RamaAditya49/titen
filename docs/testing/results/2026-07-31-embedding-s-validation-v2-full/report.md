# Embedding s-validation-v2 — full

Run: `s_val_d87475e1-7966-4880-9148-dcd58abaf5d1`
Model: `tuf/embeddinggemma` (768 dimensions)
Preprocessing: `embeddinggemma-retrieval-v1`
Threshold: `0.737307171` (fixed before the disjoint validation; no tuning)

## Disjoint validation holdout

- Recall@1: 88.8%
- Recall@5: 91.7%
- MRR@10: 0.901042
- nDCG@10: 0.905084
- no-result false positives: 0.0%
- answerable abstention: 0.0%

This validates one deployment-specific profile and threshold; it does not publish a universal default.
