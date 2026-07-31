# Titen 0.3.0 versus Mem0 replacement cycle 2

Date: 2026-07-31

Verdict: **blocked; keep Mem0 active**

Cycle 2 extends the first Wulan evaluation with concurrency, container resource
time series, an idempotent synthetic migration rehearsal, post-merge embedding
validation review, and a fresh audit of the proposed LLM memory-management
runtime. It is not a production cutover approval.

The live comparison still uses exact npm `titen-memory@0.3.0`, SHA-1
`568d56175257f515ee3c79c7672d62bc39c07dda`, tag commit
`9f10bfd625ba947897056f1dbc0ab7bfc4ce6304`, and the existing loopback-only
Wulan canary. Mem0 remained the production authority. No production
conversation or credential entered an artifact.

## Concurrency matrix

The controlled lane retained the cycle-1 fixture and fairness boundary: eight
facts, eight queries, ten seeded paired repeats, the same Wulan
`tuf/embeddinggemma` route, Mem0 `infer:false`, and Titen direct
evidence-linked claims. Each pair preserved serial AB/BA order while different
pairs ran through a bounded worker pool. Every run completed 80 searches per
product with zero request errors.

| Concurrency | Titen p50 / p95 / p99 | Mem0 p50 / p95 / p99 | Paired mean Titen - Mem0 |
| ---: | ---: | ---: | ---: |
| 1 | 167.0 / 207.6 / 250.9 ms | 446.2 / 485.5 / 525.0 ms | -276.7 ms |
| 8 | 184.5 / 239.5 / 290.8 ms | 1,419.0 / 1,887.4 / 2,051.3 ms | -1,173.9 ms |
| 32 | 311.8 / 441.1 / 471.4 ms | 6,255.7 / 10,104.4 / 10,147.2 ms | -5,446.4 ms |

Quality was identical across the three concurrency levels:

| Metric | Titen 0.3.0 | Mem0 | Gate |
| --- | ---: | ---: | --- |
| Recall@1 | 0.857 | 0.857 | tied |
| Recall@5 | 1.000 | 1.000 | tied on the tiny corpus |
| MRR@10 | 0.886 | 0.929 | Titen worse |
| nDCG@10 | 0.912 | 0.947 | Titen worse |
| no-result false-positive rate | 1.000 | 1.000 | both fail |

The latency advantage is strong for this direct-retrieval lane, especially when
Mem0 saturates the two-vCPU host. It is not a product victory: Titen performed
no automatic LLM extraction/reflection, the corpus has only eight claims, the
products were paired rather than run as independent throughput services, and
the ranking and abstention gates failed.

Checksummed artifacts:

- [concurrency 1](./results/2026-07-31-titen-030-vs-mem0-cycle2-c1/);
- [concurrency 8](./results/2026-07-31-titen-030-vs-mem0-cycle2-c8/);
- [concurrency 32](./results/2026-07-31-titen-030-vs-mem0-cycle2-c32/).

## Container resource telemetry

One persistent SSH sampler captured `docker stats` every nominal 500 ms during
each run. The numbers below are p95 samples. Mem0 CPU is the sum across its five
containers; memory is their complete-sweep sum.

| Concurrency | Titen CPU | Mem0 CPU | Titen container memory | Mem0 container memory | Titen / Mem0 sweeps |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.87% | 73.23% | 36.5 MiB | 478.9 MiB | 39 / 38 |
| 8 | 5.75% | 161.71% | 39.5 MiB | 503.6 MiB | 18 / 16 |
| 32 | 2.44% | 177.88% | 43.4 MiB | 515.8 MiB | 24 / 21 |

These are directional topology measurements. Docker container memory is not
process RSS, Titen is one direct-retrieval container while Mem0 is a five-service
system, provider work happens outside the Titen container, and neither cost nor
automatic-management work is equivalent. Exact RSS, storage growth, cold-start
and sustained throughput therefore remain open gates rather than inferred wins.

## Synthetic Mem0 migration rehearsal

The migration test ran against a disposable Titen container created from a
verified canary backup on loopback port 8788. It never wrote to the Titen canary
database. Each synthetic Mem0 record was fetched back through Mem0 before being
mapped to a Titen `imported_source` observation and direct evidence-linked
claim.

The first attempt lost its separate SSH tunnel before the first Titen write. It
still deleted all 20 exact Mem0 IDs in `finally`; the immutable failed artifact
is retained as transport and cleanup evidence. A fresh tunnel and output path
then passed:

| Check | Result |
| --- | ---: |
| Mem0 create + GET export source | 20 / 20 |
| Titen first-pass observations + claims | 20 + 20 |
| Exact idempotent replay IDs | 40 / 40 |
| Semantic recall | 20 / 20 |
| Exact observation/source provenance | 20 / 20 |
| Mem0 cleanup | 20 / 20 |
| Failed trials in successful rerun | 0 |

Evidence:

- [failed transport run with complete cleanup](./results/2026-07-31-mem0-to-titen-migration-cycle2/);
- [successful idempotent rerun](./results/2026-07-31-mem0-to-titen-migration-cycle2-rerun1/).

The disposable container was stopped after the run and its isolated evidence
directory retained. This proves a small direct mapping, retry safety, recall,
and provenance. It does not prove bulk production export, user/workspace
mapping, conflict/lifecycle fidelity, automatic derivation, delta catch-up,
dual-write soak, or cutover rollback.

## Embedding validation after PR 145

PR [#145](https://github.com/RamaAditya49/titen/pull/145) merged as
`377900a`. Its built-in Bun HTTP and Workers AI adapter matrix passed 51 tests;
the post-merge audit also passed 91 D1 contracts, 113 Bun/core/SDK contracts,
133 integration tests, workflow/routes checks, Worker bundle, npm pack, and a
clean-consumer smoke.

The fix was incomplete at the shared extension boundary. The documented
`ServeOptions.vectors` path accepts a ready-made `EmbeddingProvider`; a
post-merge provider returning an empty array for one eligible claim produced:

```json
{"drain_status":200,"indexed":1,"undefined_reached_store":true,"outbox_state":"done"}
```

Malformed output reached the vector store and was acknowledged. Issue
[#137](https://github.com/RamaAditya49/titen/issues/137) was therefore reopened.
The Wulan npm canary remains 0.3.0 and was not changed by this source-level
validation.

Current-main probes also reconfirmed:

- [#138](https://github.com/RamaAditya49/titen/issues/138): a broken configured
  vector capability still reports readiness `200`, `ready:true`, vector/model
  enabled;
- [#144](https://github.com/RamaAditya49/titen/issues/144): one candidate with
  absolute similarity `0.000001` is normalized to relevance `1`, so safe
  abstention is impossible.

## LLM memory-management audit

Issue [#136](https://github.com/RamaAditya49/titen/issues/136) has a substantial
local worktree implementation, but no remote branch or PR and no shipped
runtime. Its shared-core direction is sound: SQL ledger, strict local
validation, asynchronous leases, a native fetch adapter, Bun timer, Cloudflare
scheduled hook, and SQLite/Miniflare replay. Activation remains blocked by the
following confirmed design/implementation gaps:

1. migration 14 can be applied before the still-unmerged readiness migration
   13, after which the current `MAX(version)` migrator will skip 13;
2. background maintenance freezes time across a model call, allowing a commit
   to pass its lease fence after real expiry;
3. a new pipeline can lease an old-fingerprint job and terminal-fail it as
   `source_changed` ([#148](https://github.com/RamaAditya49/titen/issues/148));
4. configured extraction errors and background-enrichment health are absent
   from readiness;
5. one worst-case reflection commit expands to roughly 139 prepared statements,
   beyond Cloudflare D1 Free's 50-query invocation budget; the default 50-job
   drain can also exceed Paid's 1,000-query budget
   ([#149](https://github.com/RamaAditya49/titen/issues/149));
6. the new adapter uses `json_schema`, while the recorded scored model pilot
   used `json_object`; the exact production prompt/schema has not passed the
   locked 72-case x five-repeat gate;
7. reflection selects recent claims instead of bounded related FTS/vector
   candidates, and observations lack deterministic eligibility/dedup rules;
8. temporal output is not bounded to cited evidence time, and the transactional
   authority fence does not compare the exact pre-model policy snapshot;
9. the ADR-required output hash is missing; and
10. logical export/import drops model job/commit/result provenance
    ([#150](https://github.com/RamaAditya49/titen/issues/150)).

The model decision therefore remains unchanged: Sol is only a canary candidate,
Terra is a challenger after a predeclared non-inferiority run, and Luna is not
eligible for derivation after failing 66/66 non-empty schema cases in the larger
pilot. No LLM route is installed into the Titen product runtime yet. Embedding
remains candidate retrieval, never authority to classify, merge, trust, widen
visibility, or delete memory.

## Deployment-target verdict

- **VPS:** exact npm 0.3.0 direct retrieval, restart/restore, outage recovery,
  concurrency, and disposable migration have live evidence. Native LLM memory
  management, exact RSS, soak, and cutover do not.
- **Cloudflare:** shared D1/Miniflare tests are useful but no real D1,
  Vectorize, Workers AI, Cron, or query-budget smoke exists. #149 is a hard
  operability blocker.
- **Local computer:** package/consumer smoke exists, but no installed local
  vector + Sol enrichment + recovery/migration smoke exists.

None of the three targets is ready for the Level-6 automatic-management claim.

## Issue ledger for this cycle

- Reopened [#137](https://github.com/RamaAditya49/titen/issues/137) for the
  custom-provider validation bypass.
- Reconfirmed [#138](https://github.com/RamaAditya49/titen/issues/138) and
  [#144](https://github.com/RamaAditya49/titen/issues/144) on current main.
- Opened [#148](https://github.com/RamaAditya49/titen/issues/148) for
  rolling-pipeline terminal loss.
- Opened [#149](https://github.com/RamaAditya49/titen/issues/149) for the real
  Cloudflare D1 query budget.
- Opened [#150](https://github.com/RamaAditya49/titen/issues/150) for portable
  enrichment provenance.
- Existing replacement blockers #102, #136, #140, #141, #142, and #143 remain
  open.

## Fresh Ponytail debt

The read-only scan after adding the benchmark helpers still finds seven marked
shortcuts, all with a measurable trigger:

| Location | Shortcut / trigger |
| --- | --- |
| `plugins/claude/titen-memory/.clawhubignore:1` | remove the HTTP MCP bundle filter when stable bundle import ships |
| `src/core/context.ts:55` | add point-in-time `at` only when recall requires it (#118) |
| `src/core/idempotency.ts:21` | add content convergence when resync must exceed 24 hours (#101) |
| `src/core/migrations.ts:267` | implement table-specific retention/legal hold when adopted (#105) |
| `src/core/validate.ts:43` | raise/configure the candidate ceiling only after measured recall loss |
| `src/core/webhooks.ts:460` | add per-organization cursors when backlog misses freshness |
| `src/runtime/bun/server.ts:86` | profile workers/replicas only after equivalent-quality throughput misses (#123) |

**7 markers, 0 with no trigger.** The new concurrency, telemetry, and migration
helpers add no Ponytail marker.

## Replacement decision

Do not replace Mem0. The next credible gate requires product-native Sol
derivation/reflection with #136/#137/#138/#144/#148/#149 resolved, the exact
locked model corpus, a larger controlled retrieval corpus with calibrated
abstention, real Cloudflare/VPS/local smokes, exact RSS/storage/cost, production-
shaped migration with delta catch-up, and a seven-day shadow soak plus rollback
drill. Only two consecutive passing cycles may open a separate cutover work
item.
