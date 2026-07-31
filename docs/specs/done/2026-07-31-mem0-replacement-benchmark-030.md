---
work_id: mem0-replacement-benchmark-030
status: done
stage: done
outcome: cancelled
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
---
# Titen 0.3.0 versus Mem0 replacement benchmark

## Problem

`titen-memory@0.3.0` is published and locally verified, but release tests do not
prove that it can replace the production Mem0 service on `server-wulan`. The
comparison must cover automatic memory management, retrieval quality, evidence
and scope safety, failure recovery, resource use, and migration rather than
declaring a win from one latency number.

## In scope

- Verify npm, tag, source, and package provenance for version `0.3.0`.
- Install an isolated Titen sidecar on `server-wulan` without modifying Mem0.
- Configure the available `tuf/embeddinggemma` endpoint and retain the existing
  Luna/Terra/Sol endpoint for a controlled model-evaluation lane.
- Run synthetic, versioned, repeatable Titen-versus-Mem0 functional, quality,
  safety, reliability, performance, and resource benchmarks.
- Retain machine-readable raw trials and report confirmed defects or missing
  replacement gates as deduplicated GitHub issues.
- Produce a fresh read-only Ponytail debt ledger after the benchmark cycle.

## Out of scope

- Stopping, replacing, mutating, or importing production Mem0 data in this
  cycle.
- Claiming Titen has LLM enrichment when the installed runtime does not execute
  it.
- Publishing a new package, changing production DNS, or exposing either memory
  service publicly.
- Comparing different models, embeddings, datasets, hardware windows, or safety
  policies and calling the result a product win.
- Implementing confirmed defects without a separate approved work item.

## Constraints and risks

- Mem0 remains the production authority until every replacement gate passes.
- Synthetic tenants and content are mandatory; production conversations and
  credentials never enter benchmark artifacts or issue bodies.
- The same embedding/model revision and bounded corpus must be used wherever
  both products support the role. Unsupported roles are reported as capability
  failures, not emulated invisibly outside the product.
- Titen and Mem0 share one host during the side-by-side run, so trials must be
  randomized, serialized where needed, and record system load.
- Provider latency and cost are reported separately from local storage and
  retrieval time.
- Every remote change needs an explicit isolated target, rollback, and runtime
  smoke; Mem0 service/container state must remain unchanged.

## Acceptance criteria

- **AC-MRB-001 — Ubiquitous:** The benchmark shall bind every result to the npm
  integrity, peeled Git tag commit, runtime versions, package contents, host,
  configuration fingerprint, corpus revision, and raw artifact checksum.
- **AC-MRB-002 — Event-driven:** When the Titen sidecar is installed on
  `server-wulan`, it shall use a dedicated database, vector database, config,
  service name, user/path, and loopback port that do not modify or shadow Mem0.
- **AC-MRB-003 — Optional feature:** Where embedding is enabled, Titen shall
  return a real 768-dimension `tuf/embeddinggemma` vector path, report vector
  readiness accurately, and degrade to authorized FTS when the dependency is
  unavailable.
- **AC-MRB-004 — Unwanted behavior:** If Titen 0.3.0 has no automatic LLM
  derivation/reflection runtime, then the benchmark shall fail that replacement
  capability, file or reference one issue, and shall not count an external
  harness call as a Titen product success.
- **AC-MRB-005 — Ubiquitous:** Titen and Mem0 quality comparisons shall use the
  same synthetic facts, languages, temporal/conflict cases, model and embedding
  revisions where supported, warmup, randomized order, concurrency, and repeat
  count, with unsupported capabilities scored explicitly.
- **AC-MRB-006 — Event-driven:** When raw messages are submitted end to end,
  each product shall be scored for supported claim precision/recall/F1,
  unsupported claims, exact evidence attribution, temporal interpretation,
  duplicate/conflict handling, and safe no-memory abstention.
- **AC-MRB-007 — Event-driven:** When equivalent atomic facts are available to
  both products, the benchmark shall report Recall@1/5, MRR@10, nDCG@10,
  no-result false positives, and per-language results for exact, paraphrase,
  hard-negative, temporal, Indonesian, English, and Javanese-in-Indonesian
  queries.
- **AC-MRB-008 — Unwanted behavior:** If an unauthorized organization, subject,
  workspace, source ID, or prompt-injected authority field is supplied, then
  Titen shall disclose and commit zero foreign data; a safety failure blocks
  replacement regardless of aggregate score.
- **AC-MRB-009 — Event-driven:** When either dependency is unavailable and then
  restored, the benchmark shall verify bounded failure, truthful readiness,
  retry/recovery, no lost acknowledged write, and no duplicate semantic result.
- **AC-MRB-010 — Event-driven:** When each sidecar is restarted and restored
  from a disposable backup, acknowledged synthetic records shall survive with
  integrity, provenance, idempotency, and recall checks, and the run shall
  report measured RPO and RTO.
- **AC-MRB-011 — Ubiquitous:** Performance evidence shall include at least ten
  measured repetitions after warmup, raw trials, median and 95% confidence
  intervals, p50/p95/p99 latency, throughput, CPU, RSS, disk/index growth,
  startup, and provider time under equivalent workload conditions.
- **AC-MRB-012 — Ubiquitous:** A replacement win shall require every safety and
  durability gate to pass, retrieval and end-to-end memory quality to be
  non-inferior within a predeclared two-point margin, at least one primary
  quality metric to improve by five points or more, and no critical latency or
  resource metric to regress by more than twenty percent without an accepted
  tradeoff.
- **AC-MRB-013 — Event-driven:** When a distinct reproducible defect or missing
  gate is confirmed, the work shall search existing issues first and then add
  one evidence-backed issue with version, environment, reproduction, actual,
  expected, raw-artifact reference, and acceptance criteria.
- **AC-MRB-014 — Event-driven:** When the benchmark cycle finishes, the work
  shall run the Ponytail debt scan read-only and report every current marker,
  including markers without an upgrade trigger.
- **AC-MRB-015 — State-driven:** While any hard gate, LLM management capability,
  Mem0-data migration rehearsal, or sustained sidecar soak remains incomplete,
  Mem0 shall stay active and no production cutover shall be described as ready.
- **AC-MRB-016 — Event-driven:** When the embedding-only scale-S calibration
  lane runs, the benchmark shall generate exactly 10,000 deterministic
  synthetic statements and 600 stratified queries, select one cosine threshold
  from a stable-hash calibration split with zero no-result false positives and
  maximum Recall@5, then report locked-holdout quality, abstention, subgroup
  Wilson intervals, model fingerprint, fixture/result checksums, and no raw
  embeddings or credentials; any vector database shall be disposable.
- **AC-MRB-017 — Unwanted behavior:** If the embedding model's primary
  documentation prescribes asymmetric retrieval preprocessing, then the
  benchmark shall fingerprint and apply its distinct document/query templates,
  preserve the raw-input result as an immutable baseline, and evaluate a full
  locked-holdout challenger before drawing an embedding-quality conclusion.
- **AC-MRB-018 — Event-driven:** When the exact enrichment model gate runs, it
  shall use the versioned 72-case language-balanced corpus for five repeats,
  the production prompt and schemas, no semantic retries, and the hard safety,
  quality, subgroup, temporal, reflection, stability, and two-point
  non-inferiority thresholds already declared in `docs/testing/EVALS.md`.
  The exact lane shall retain the product adapter's 30-second default timeout,
  and provider response mode is a fingerprinted independent variable. Input
  identifiers shall be deterministic and opaque so they disclose no case,
  language, category, or expected-action label. Scorer self-tests shall reject
  token-substring, negated-polarity, invented-time, and repeat-instability
  mutations. Any smaller-model claim shall use paired case outcomes clustered
  across translated concept families and a predeclared one-sided 95% lower
  confidence bound against the two-point non-inferiority margin. Model revision
  attestation and token-usage coverage shall be explicit rather than inferred
  from a route name or missing values. The deterministic alias scorer shall be
  labeled lexical-contract evidence only: it cannot adjudicate appended
  hallucinations and therefore cannot satisfy the production semantic
  precision/F1 or model-quality gate without blinded independent or human
  adjudication. Artifact content shall be checked in memory before its first
  write, then retain only fixed diagnostics, hashes, aggregate metrics, and
  timings; credentials, endpoints, prompts, fixture text, raw model output,
  and normalized proposals shall not be persisted.
- **AC-MRB-019 — Event-driven:** When the selected embedding profile and cosine
  floor are validated a second time, the benchmark shall first freeze a
  disjoint deterministic fixture version and split salt, reuse the previously
  selected `embeddinggemma-retrieval-v1` profile and `0.737307171` threshold
  without tuning on the new data, generate exactly 10,000 synthetic statements
  and 600 stratified queries, and report quality, abstention, subgroup,
  endpoint/model fingerprint, and checksums without credentials, raw text, or
  embeddings. A result from an unattested model revision shall remain
  deployment-specific and shall not become a bundled universal default.

## Done conditions

This time-boxed benchmark closes when its retained evidence supports either a
replacement pass or a terminal NO-GO. A NO-GO closes the work as cancelled;
unchecked criteria stay recorded as unmet historical gates and do not become
product evidence. A future replacement attempt requires a new spec and fresh
runtime evidence rather than reopening this benchmark.

## Closure reason

The retained evidence produced a terminal NO-GO for replacing the evaluated
0.3.0 canary. Unmet quality, safety, migration, deployment, and soak criteria
remain historical blockers rather than implied passes.
