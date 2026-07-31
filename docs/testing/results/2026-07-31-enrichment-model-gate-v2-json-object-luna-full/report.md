# Enrichment model gate (full)

- Runner: `enrichment-model-gate-runner-v2`
- Contract snapshot: `03a77a9`
- Fixture: `enrichment-model-gate-v2` (72 cases/model x 5 repeat)
- Provider response mode: `json_object`
- Request timeout: 30000 ms (audited production default)
- Models: luna
- Trial records: 360
- Coverage ceiling: 24 template concept families; reflection uses 1-3 active v1 premises (schema max 8), and gold ADD uses 1-2 claims (schema max 4).
- Claim scoring is locked lexical-contract compliance, not a general semantic judge. Latency/cost never selects a tier when completion or usage coverage differs.
- This is a candidate gate, not final Level-6 product evidence or dual-runtime persistence proof.
- Raw provider outputs, prompts, fixture text, credentials, and private memory are absent from this artifact.

See `summary.json` for sanitized metrics and `trials.jsonl` for fixture-ID-level outcomes.
