# Memory model and embedding evaluation — 2026-07-31

## Decision summary

- The embedding pilot indicates that vectors can improve semantic candidate
  retrieval; it is directional, not independently reproducible release
  evidence, and cannot substitute for claim extraction, temporal reasoning,
  conflict handling, or authority validation.
- The safest first implementation atomically enqueues derivation with its
  observation and schedules reflection idempotently from a bounded snapshot;
  both then run `SQL job -> Sol proposal -> deterministic validator -> ADD-only
  commit`. Do not build a model-tier router yet.
- Luna is not usable through the tested route for the proposed schema. Terra is
  a future challenger, not an evidence-backed role. Sol is a canary candidate,
  not a production default.
- Automatic extraction is not currently implemented in Titen. This report is
  architecture and model-selection evidence, not runtime or deployment proof.

## What was tested

The live OpenAI-compatible endpoint ran 9router `0.5.40` on `server-wulan`.
Its catalog exposed 14 model IDs, including:

- `cx/gpt-5.6-luna`;
- `cx/gpt-5.6-terra`;
- `cx/gpt-5.6-sol`.

The embedding endpoint was a separate private OpenAI-compatible service using
`embeddinggemma`; it was not advertised by 9router's `/v1/models` response.

A dedicated existing API credential was read and used only inside the server
process. It was not printed, copied to the workstation, committed, or included
in artifacts. All memory fixtures were synthetic.

OpenAI's current model guidance describes Luna as the efficient high-volume
tier, Terra as the balanced tier, and Sol as the flagship tier. The 9router IDs
were still evaluated as opaque routes because the exact upstream revision and
pricing were not independently attested. See [OpenAI model
guidance](https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6).

## Structured-output compatibility

All three routes returned HTTP 200 when sent a strict `json_schema`, but none
obeyed that schema in the compatibility probe. `json_object` plus an explicit
contract produced parseable JSON, after which a local exact-key/enum/ID
validator was applied.

This is why Titen cannot equate provider acceptance with schema enforcement.
Even official JSON mode guarantees valid JSON rather than semantic schema
compliance; local validation remains mandatory. See [OpenAI structured
outputs](https://developers.openai.com/api/docs/guides/structured-outputs#json-mode).

## LLM pilot protocol

- 25 derivation cases and 12 reflection cases;
- Indonesian, English, and Javanese-in-Indonesian fixtures;
- no-memory, tentative, third-party, injection, duplicate, correction,
  temporal, conflict, supersession, pattern, and procedure cases;
- three raw trials per case/model, 333 scored calls total;
- two unscored warmups per model, `temperature: 0`,
  `reasoning_effort: none`, non-streaming JSON object output;
- identical prompt hashes for every model in each lane;
- shuffled jobs with maximum concurrency six;
- no retry in scored trials;
- exact local validation rejected unknown IDs and authority fields.

One earlier 333-call execution was discarded because the result normalizer
failed before persisting an artifact. No values from it were used. The scored
run completed 333/333 HTTP calls and retained synthetic raw and summary
artifacts outside the repository for independent review.

Artifact manifest on `server-wulan` at review time:

- raw response/result SHA-256:
  `cd7a3565f88f1f0d70fde00a6c6ec8a86ecb747d86d1e1590999379764760d41`;
- summary SHA-256:
  `ef3fb3c5ba251816f315d3d88464ba7797d6440c648f6a50aa1cd9c3d238355c`;
- derivation prompt SHA-256:
  `3f0d604fbed66652f1c57c54f5ee3a5e53805465ab87408bc14e668b7c186fe2`;
- reflection prompt SHA-256:
  `15b1155f871b0528b85dcb5274dd81e4c5ff47edc3a7e43480dec666f79affd9`.

The first pilot did not version its fixture/gold/scorer source in the
repository, so those artifacts are auditable but not a fully reproducible
release benchmark. The production gate explicitly requires all four to be
committed and hashed together.

### Mechanically reliable results

| Model | Raw derivation schema | Raw reflection schema | Correct abstention | Derivation p50 / p95 | Reflection p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Luna | 9/75 | 35/36 | 9/12 | 2.74 s / 5.17 s | 1.61 s / 2.43 s |
| Terra | 75/75 | 36/36 | 11/12 | 2.99 s / 5.51 s | 1.68 s / 3.56 s |
| Sol | 75/75 | 36/36 | 12/12 | 3.27 s / 5.14 s | 2.39 s / 3.53 s |

Latency is wall time from one concurrency-six run, not isolated provider
latency or a price comparison. Mean total tokens were 472/367 for Luna,
466/366 for Terra, and 470/376 for Sol across derivation/reflection.

The schema columns count raw responses accepted by the local exact schema
before semantic scoring. They measure model conformance, not persistence
safety. No scored raw output referenced a fabricated ID or emitted an authority
key, but the pilot harness did not execute Titen canonical writes. Zero invalid
semantic commits therefore remains a separate integration gate: malformed and
policy-invalid captured outputs must leave canonical semantic row counts
unchanged.

Luna failed 66/66 non-empty derivation outputs because it explained the
`derivation` field instead of returning the allowed `explicit|inferred` enum;
some conflict links also used an invalid enum. It inferred a speculative
third-party preference in all three repetitions.

Reflection used exact closed-set actions and ID sets, making it the strongest
quality comparison:

| Model | Full reflection pass | Conflict cases | Supersession | Exact duplicate |
| --- | ---: | ---: | ---: | ---: |
| Luna | 27/36 | 0/6 | 2/3 | 3/3 |
| Terra | 27/36 | 0/6 | 2/3 | 3/3 |
| Sol | **35/36** | **5/6** | **3/3** | **3/3** |

Sol also passed repeated-pattern induction, procedure induction, disjoint-time
distinction, near-but-not-duplicate, and single-example abstention in all three
trials. It still misclassified several derivation fixtures and abstained once
on a conflict, so its output remains proposal-only.

### Metrics deliberately not used to rank models

The first derivation scorer used literal required phrases. It marked correct
English translations of Indonesian facts as failures and conflated temporal
correctness with representation choices such as `null`, reference time, and
inclusive end-of-day timestamps. Therefore its derivation grounded
precision/recall/F1, exact-case pass, and temporal score are not valid model
rankings and are not release evidence.

The production corpus must use language-neutral proposition slots, version its
fixtures/gold/scorer together, and retain raw results plus checksums.

## Embedding pilot

`embeddinggemma` was tested against 24 synthetic claims, 24 queries, and four
no-result probes. The query set included exact identifiers, paraphrases, hard
near-neighbors, Indonesian, English, and Javanese-in-Indonesian wording.

This report does not include a versioned embedding fixture/gold/scorer or a
checksummed raw-result manifest. The following numbers are exploratory and are
not independently reproducible from repository evidence; they cannot select a
production embedding or satisfy an activation gate.

| Retrieval | Recall@1 | Recall@3 | Recall@5 | MRR@10 |
| --- | ---: | ---: | ---: | ---: |
| SQLite FTS5 pilot | 79.17% | 95.83% | 95.83% | 0.8611 |
| embedding only | 95.83% | 100% | 100% | 0.9722 |
| FTS + vector RRF | 95.83% | 100% | 100% | 0.9792 |

The service returned 768 finite, unit-normalized dimensions. Batch-order and
repeat cosine checks were `1.0`. Observed p50 latency was 151 ms for batch 1,
319 ms for batch 16, and 643 ms for batch 64. Recall@5 was 100% in each small
language subgroup.

The four no-result top scores ranged from 0.226 to 0.342 while the lowest
answerable top score was 0.455. That tiny sample is not a production threshold.
Cosine remains a shortlist signal; it cannot establish truth, memory kind,
conflict, or whether a claim should exist.

## Recommended rollout

1. Keep direct structured claims deterministic and synchronous.
2. Commit each eligible unstructured observation and its derivation job in the
   same transaction.
3. Run deterministic eligibility and exact duplicate rules first.
4. Use embedding/FTS to retrieve a bounded authorized candidate set.
5. Create reflection jobs separately from bounded authorized snapshots and
   make them idempotent over premise versions, policy-snapshot fingerprint, and
   pipeline fingerprint.
6. Use Sol asynchronously for derivation and later reflection.
7. Reject anything outside the strict proposal schema or supplied IDs.
8. Persist only the output hash and committed result IDs, not the raw or
   normalized proposal payload.
9. Commit only validated ADD/link proposals; preserve conflicting evidence.
10. Keep enrichment disabled until a 72-case language-neutral corpus, five
   repeats, dual-runtime replay, and real Cloudflare/VPS/local smoke pass.
11. Re-evaluate Terra as a cheaper replacement only with a predeclared
   non-inferiority margin. Retest Luna only after strict schema compatibility
   and third-party abstention are fixed.

## Current implementation blockers

The model cannot be enabled by configuration alone:

- `POST /v1/consolidations` accepts complete caller-supplied claims and reports
  `model_used: false`;
- the physical `index_outbox` has no enrichment work kind, pipeline
  fingerprint, persistent lease, next retry, or safe output validator;
- no derivation transaction or reflection snapshot-idempotency contract exists;
- current readiness calls the embedder `model`, so extraction and embedding
  degradation are not independently observable;
- context retrieval searches claims, not pending observations, so an accepted
  observation is not claim-ready context until direct/derived claim creation;
- multi-source trust inheritance needs an explicit policy and fixture before
  automatic derivation: the current implementation selects the strongest
  supporting trust, while existing tests cover only a single weaker source;
  model output must never choose or raise that ceiling;
- the tested provider did not enforce strict JSON Schema despite accepting the
  parameter.

Each blocker belongs in the future runtime spec, migration, and shared
Cloudflare/Bun contract suite. None should be hidden behind prompt wording.

## Architecture research

The recommended split matches current evidence-linked memory systems without
copying their authority semantics:

- Mem0 moved toward one ADD-only structured extraction call before entity and
  embedding work ([SDK changelog](https://docs.mem0.ai/changelog/sdk),
  [prompts](https://github.com/mem0ai/mem0/blob/main/mem0/configs/prompts.py)).
- Honcho separates routine derivation from scheduled higher-order work
  ([repository](https://github.com/plastic-labs/honcho)).
- Letta uses stronger sleep-time compute outside the interactive path
  ([sleep-time compute](https://www.letta.com/blog/sleep-time-compute/)).
- Graphiti requires reliable structured output and has added guards for model
  schema failures ([repository](https://github.com/getzep/graphiti),
  [releases](https://github.com/getzep/graphiti/releases)).
- Zep's observations show higher-order pattern memory, but Titen retains its
  own append-only conflict and lifecycle rules
  ([observations](https://help.getzep.com/observations)).

Cloudflare portability relies on D1 transactional batches, Cron-triggered
bounded draining, local Workers AI/remote-provider validation, and Vectorize's
eventual mutation visibility. Queue is deferred until backlog evidence requires
it. See [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/),
[Workers AI JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/),
and [Vectorize insertion behavior](https://developers.cloudflare.com/vectorize/best-practices/insert-vectors/).
