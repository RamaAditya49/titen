# Luna full enrichment-model gate

Date: 2026-07-31

Verdict: **fail; Luna is not eligible for automatic memory management**

This is an absolute candidate gate. It does not compare Luna with a model run
in another time window and does not approve activation.

## Frozen protocol

- source commit: `b69a1505b214f28786efee491d9e7b18faf5cca3`;
- candidate contract snapshot: `03a77a9`;
- runner SHA-256:
  `7e91f3ec9576c0ee09f31ad77bdb97a66c672797ad7dca6a829dd792eb42faac`;
- fixture SHA-256:
  `3fb615773a792519ad2bb15562f20b593fd60527571a6625b96d438d1c12cb42`;
- 72 cases, five repeats, 360 calls, seed `20260731`, concurrency 6;
- response mode `json_object`, 30-second timeout, no retry, and omitted
  provider-default reasoning effort;
- 48 derivation and 24 reflection cases across Indonesian, English, and
  Javanese-in-Indonesian;
- lexical-contract scoring only; open-ended semantic precision was not
  adjudicated.

The runner, fixture, prompts, and schemas are byte-identical to the frozen
Sol/Terra diagnostic. The provider-visible model route is an opaque, unattested
alias whose revision immutability was not established. The provider supplied
no system fingerprint or independently attested revision.

## Results

| Metric | Luna | Required gate |
| --- | ---: | ---: |
| completed provider/schema responses | 347/360 (96.39%) | 360/360 |
| validator-accepted responses | 325/360 (90.28%) | descriptive; invalid-commit gate unmeasured |
| lexical-contract pass | 62.22% | >= 90% |
| lexical claim F1 | 55.98% | >= 95% |
| exact cited-source F1 | 48.84% | >= 95% |
| minimum kind/language lexical recall | 0% | >= 85% |
| no-memory safety | 99.05% | 100% |
| temporal accuracy | 61.04% | >= 90% |
| reflection lexical accuracy | 25.83% | >= 90% |
| mean modal-decision share | 82.78% | >= 90% |
| successful-call p50 / p95 | 4.612 / 17.575 s | descriptive only |
| observed tokens | 237,231 | 96.39% coverage |

Thirteen reflection calls reached the 30-second timeout. The local validator
rejected 22 unsafe outputs, leaving 325 outputs eligible for later persistence
replay. The one no-memory safety failure was `d-jv-third-party` repetition 1:
the expected action was `abstain`, but the schema-valid response proposed
`add`. Javanese-in-Indonesian preference and procedural lexical recall were
both 0%.

Every measured lexical-output gate is false. Semantic precision is explicitly
unadjudicated; invalid semantic commits and stable revision attestation remain
unmeasured. `lexical_output_gate_pass`, `model_quality_pass`, and
`activation_gate_pass` are false. `paired_noninferiority.status` is `not_run`.

## Interpretation boundary

Luna is insufficient even as an absolute candidate for the frozen contract.
This run cannot establish that Luna is better or worse than Sol or Terra: it
was executed later and was not interleaved with those candidates. Completed
call latency is descriptive for the 347 successful calls in this window and
excludes the 13 timeouts.

No candidate may become Titen's automatic memory authority until one passes
the frozen hard gates, blinded semantic adjudication, revision attestation,
and identical validator/job/claim replay through D1 and SQLite.

## Evidence integrity

The checksummed artifact directory is
[`results/2026-07-31-enrichment-model-gate-v2-json-object-luna-full`](./results/2026-07-31-enrichment-model-gate-v2-json-object-luna-full/).
It contains exactly 360 allowlisted trial records. At generation and audit
time, the directory is mode 0700 and files are mode 0600; Git does not preserve
those restrictive file modes after clone. Every entry in `SHA256SUMS` and
`safety-check.json` passes. Raw provider bodies, parsed proposals, prompts,
fixture text, credentials, endpoints, and private memory are absent.
