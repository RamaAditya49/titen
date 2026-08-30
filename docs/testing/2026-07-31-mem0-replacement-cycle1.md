# Titen 0.3.0 versus Mem0 replacement cycle 1

Date: 2026-07-31
Verdict: **blocked; keep Mem0 active**

This is the first side-by-side replacement evaluation against the current
Mem0 service on `deployment-host`. It is not a cutover approval. The run used only
synthetic memory and left the production Mem0 containers, database, routes, and
credentials unchanged.

## Tested release and topology

- Titen npm artifact: `titen-memory@0.3.0`, SHA-1
  `568d56175257f515ee3c79c7672d62bc39c07dda`, tag commit
  `9f10bfd625ba947897056f1dbc0ab7bfc4ce6304`.
- Titen runtime: Bun 1.3.13 in a pinned Debian OCI image, with the deliberately
  opt-in `sqlite-vec@0.1.9` installed explicitly.
- Titen canary: non-root, 1 CPU, 512 MiB limit, separate canonical/vector
  databases, loopback `127.0.0.1:8787`, no public route.
- Mem0: existing five-container Wulan deployment, gateway loopback
  `127.0.0.1:20131`; no service restart or reset.
- Both retrieval paths used `tuf/embeddinggemma`, 768 dimensions, through the
  same Wulan 9router service. The endpoint did not attest an immutable model
  revision, so exact revision equivalence remains a blocker rather than an
  assumed fact.
- The load generator ran on the workstation through one SSH connection to both
  loopback services. Reported request latency includes the same tunnel path for
  both products; host telemetry in the manifest describes the runner, not the
  two services. Service CPU/RSS saturation was not measured in this cycle.

Credentials remain outside the repository in mode-`0600` profiles. The
benchmark artifacts contain fixture IDs, result IDs, timings, and metrics, but
no credential, prompt, memory statement, query, provider response, or raw
embedding.

A dedicated 9router canary key was inserted but the running router did not
hot-reload it and returned `401`; the key was immediately disabled without a
router restart. The canary temporarily reuses the already active Wulan key.
Production activation requires a dedicated revocable Titen key and a safe
9router reload/rotation window; shared credentials are not an accepted final
topology.

## Fairness boundary

Two capabilities were scored separately:

1. **Controlled retrieval:** both products received the same eight gold facts.
   Mem0 used `infer:false`; Titen stored an observation and the same direct
   evidence-linked claim. Both then answered the same eight queries ten times
   in a seeded, balanced AB/BA order.
2. **Native memory management:** Mem0 received raw messages with `infer:true`.
   Titen 0.3.0 has no automatic derivation/reflection runtime, so its result is
   `UNSUPPORTED/FAIL`. An external LLM call was not counted as a Titen success.

The complete redacted artifacts are under
[`results/2026-07-31-titen-030-vs-mem0-cycle1`](./results/2026-07-31-titen-030-vs-mem0-cycle1/).

## Controlled retrieval result

Eighty measured searches completed per product with zero request errors.

| Metric | Titen 0.3.0 | Mem0 | Current result |
| --- | ---: | ---: | --- |
| Recall@1 | 0.857 | 0.857 | tied |
| Recall@5 | 1.000 | 1.000 | tied on this tiny corpus |
| MRR@10 | 0.886 | 0.929 | Titen worse |
| nDCG@10 | 0.912 | 0.947 | Titen worse |
| no-result false-positive rate | 1.000 | 1.000 | both fail at threshold zero |
| p50 request latency | 170.3 ms | 444.2 ms | directional Titen advantage |
| p95 request latency | 200.7 ms | 514.1 ms | directional Titen advantage |
| p99 request latency | 307.5 ms | 721.7 ms | directional Titen advantage |

The paired Titen-minus-Mem0 mean latency was `-284.6 ms`, with a simple 95%
mean interval from `-294.0` to `-275.2 ms`. This does not prove Titen is faster
in production: the corpus has eight facts, concurrency is one, the runner is
remote, service resources were not sampled per request, and Titen did not do
automatic extraction. The quality gate also did not pass because Titen's
MRR/nDCG were lower and no-result behavior was unsafe.

One post-run `docker stats --no-stream` sample showed the Titen canary at
34.6 MiB memory, while the five Mem0 containers summed to about 479 MiB. The
Titen image was 89.5 MB and its synthetic state directory about 8.0 MB. These
are topology snapshots, not an efficiency win: the products did different
work, the Mem0 API was active during sampling, and no time-series/saturation
trial controlled cache state or background work.

Mem0 `infer:true` created and retrieved one synthetic native memory; ingestion
took about 6.0 seconds in this single unscored capability probe. Titen could not
run the same lane. This is the primary replacement blocker.

## Model and embedding canary

The live provider returned ten finite, unit-normalized, 768-dimension
`embeddinggemma` vectors. Observed embedding latency was 237 ms p50 and 403 ms
p95. This is a route smoke, not a throughput or model-revision benchmark.

An additional three-case classification canary covered an explicit preference,
credential/prompt injection, and unrelated third-party fact. Each Luna, Terra,
and Sol route passed 9/9 HTTP, exact-schema, and exact-decision checks. Luna was
fastest on this trivial canary. It does **not** override the broader 333-call
pilot: Luna previously failed 66/66 non-empty derivation schemas, Terra did not
show a reflection advantage, and Sol passed 35/36 exact reflection trials.

OpenAI's current model guidance describes Sol as flagship, Terra as the
quality/cost balance, and Luna as the efficient high-volume tier. The 9router
routes are still treated as opaque until evaluated. Titen should therefore use
one Sol canary for bounded asynchronous derivation/reflection, with local
validation, and challenge it with Terra only after a versioned non-inferiority
run. Luna is suitable only for a role whose full corpus it actually passes; the
three-case canary is not enough to assign one. See [official GPT-5.6 model
guidance](https://developers.openai.com/api/docs/guides/latest-model).

## Live reliability and safety evidence

- The installed-package evidence → claim → semantic context → feedback →
  supersession → audit loop passed. A keyword-free paraphrase retrieved the
  intended claim above the decoy after automatic indexing.
- A compile-only credential could not write.
- A second organization retrieved zero items from the first organization. A
  request body that injected the first organization ID was stored under the
  authenticated second organization instead.
- A Titen-only restart preserved semantic recall; Mem0 container identity and
  state stayed unchanged.
- A verified online canonical backup plus vector snapshot restored into a
  disposable container with RPO zero for the acknowledged synthetic claim and
  measured start-to-recall RTO of 1.373 seconds. The disposable container was
  removed; the proof databases remain under the root-only canary backup path.
- During an injected embedding-endpoint outage, canonical write and authorized
  FTS recall succeeded, indexing returned sanitized `UNAVAILABLE`, and semantic
  indexing recovered after the real endpoint returned. Readiness misleadingly
  remained healthy with vector/model enabled during the outage.
- The Wulan Mem0 gateway remained health `200` and unauthenticated `401` after
  every Titen test.

These checks cover one VPS container only. They do not prove real Cloudflare
Vectorize/Workers AI behavior, local-computer packaging, migration from Mem0,
load saturation, high availability, or a sustained shadow soak.

## Release-suite replay

- Clean installed-package smoke passed SDK exports, CLI/bootstrap, all 12
  migrations, FTS operation, and real vector retrieval after explicitly adding
  `sqlite-vec@0.1.9`.
- Bun/SQLite, vector, and SDK contracts passed 112/112.
- Integration tests passed 82/82.
- The first 91-case Cloudflare/D1 run failed one checkpoint concurrency case;
  the exact case then passed 10/10 isolated reruns and the complete file passed
  3/3 reruns. The original failure remains a release blocker under the flaky
  integrity-test rule and reopened #102.
- Benchmark runner self-test, Bun build, workflow docs, workflow checker
  self-test, route-doc inventory, artifact checksums, and secret scan passed.

## Confirmed issues

- [#136](https://github.com/RamaAditya49/titen/issues/136) — automatic
  evidence-grounded derivation/reflection is not implemented.
- [#137](https://github.com/RamaAditya49/titen/issues/137) — malformed embedding
  responses can pass the provider boundary.
- [#138](https://github.com/RamaAditya49/titen/issues/138) — configured semantic
  retrieval can silently degrade while readiness stays healthy.
- [#144](https://github.com/RamaAditya49/titen/issues/144) — relative vector
  normalization cannot safely abstain on non-empty but irrelevant memory.
- [#102](https://github.com/RamaAditya49/titen/issues/102) was reopened after
  one clean 0.3.0 Cloudflare/D1 contract run returned only ten of eleven
  expected update responses in a 12-way checkpoint race. Ten isolated and
  three subsequent full-file reruns passed, which makes this a flaky integrity
  gate, not evidence to average away.
- [#133](https://github.com/RamaAditya49/titen/issues/133) remains the separate
  SDK response-envelope blocker.

## Fresh Ponytail debt

The post-benchmark read-only scan found seven deliberate shortcuts. Every
marker includes a measurable upgrade trigger; none is triggerless.

| Marker | Current shortcut | Upgrade trigger |
| --- | --- | --- |
| `plugins/claude/titen-memory/.clawhubignore:1` | filter the remote HTTP MCP bundle file | remove it when stable OpenClaw bundle HTTP import ships |
| `src/core/context.ts:55` | compile only at current time | add optional `at` when point-in-time recall is required (#118) |
| `src/core/idempotency.ts:21` | fixed 24-hour replay window | add content/statement convergence when resync must exceed the window (#101) |
| `src/core/migrations.ts:267` | accept but do not execute retention policy | add table-specific retention and legal-hold semantics with erasure/recovery tests (#105) |
| `src/core/validate.ts:43` | fixed 200-candidate ceiling | make it configurable only after measured recall misses the ceiling |
| `src/core/webhooks.ts:460` | process one bounded page per maintenance pass | add per-organization cursors when measured backlog misses freshness |
| `src/runtime/bun/server.ts:86` | one process, one SQLite handle, synchronous calls | profile workers/read replicas only after equivalent-quality workload misses accepted latency/throughput (#123) |

**7 markers, 0 with no trigger.**

## Replacement decision

Do not replace Mem0 yet. A future cutover needs, at minimum:

1. #136, #137, #138, #144, #102, and #133 resolved with shared Bun/D1 tests;
2. the frozen 72-case × five-repeat model gate with zero invalid semantic
   commits, then real Cloudflare, VPS, and local-computer smokes;
3. a larger 10,000-claim controlled corpus where Titen is non-inferior on every
   quality subgroup and demonstrates a predeclared primary win;
4. zero scope leak, lost acknowledged writes, fabricated evidence, and unsafe
   no-result context;
5. measured CPU/RSS/storage/cost, concurrency 1/8/32, backup/reindex, Mem0 import
   rehearsal, seven-day shadow/dual-write soak, and rollback drill.

Until those gates pass twice consecutively, the Wulan Titen service remains a
loopback canary and Mem0 remains production authority.
