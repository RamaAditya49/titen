# Embedding s-calibration-v1 — smoke

Run: `s_cal_0802aa37-bbcb-4c10-8550-5617cc0e77f6`
Model: `tuf/embeddinggemma` (768 dimensions)
Threshold: `0.719207489` (selected from calibration only)

## Locked holdout

- Recall@1: 91.7%
- Recall@5: 100.0%
- MRR@10: 0.947917
- nDCG@10: 0.9609
- no-result false positives: 16.7%
- answerable abstention: 0.0%

This is a smoke-scale harness check; the 10,000-statement/600-query scale-S gate remains open.
