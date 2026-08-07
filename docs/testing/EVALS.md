# Evaluation specification

Status: memory-service release-gate contract. Deterministic service suites and
selected live smokes exist; model-assisted enrichment is implemented opt-in but
remains behind an independent production-activation gate.

## Purpose

Titen must prove that it returns useful, evidence-grounded context without
crossing scope boundaries. A benchmark score is secondary to these invariants:

1. no unauthorized memory is eligible for retrieval;
2. every returned claim resolves to visible canonical evidence;
3. conflicts and temporal changes are preserved;
4. context stays within its declared token budget;
5. optional models and vectors may improve quality but are never required for
   canonical writes or lexical recall.
6. verified memory is not externally eligible without an active approved
   release for the exact channel, audience, and claim version.
7. a visual projection cannot leak hidden topology/counts or grant authority.

This document defines what must be measured. It does not publish results before
the harness exists.

## Live verification entry point

The canonical live service smoke is `pnpm verify:live`, which runs
`scripts/verify-live.ts` against an already provisioned deployment. Set
`TITEN_URL` and `TITEN_KEY`; optional embedding checks use
`TITEN_EMBED_BASE_URL` and `TITEN_EMBED_MODEL`. Deployment-specific runners
may provide these variables, but this repository does not claim live evidence
until the command is run against the provisioned service.

## Evaluation layers

### 1. Deterministic contract suite

Run the same fixtures against Worker/D1 and Bun/SQLite. P0 cannot pass unless
both runtimes produce equivalent normalized results for:

- observation append, idempotent retry, and immediate FTS visibility;
- direct claim creation and evidence inspection;
- temporal validity, disputes, supersession, expiration, and revocation;
- bounded context compilation and successful empty context;
- context/item feedback;
- credential rejection and tenant/subject isolation;
- vector/model outage with explicit degraded metadata;
- stale vector and tombstone rejection;
- restart, migration, and outbox repair behavior.

Runtime-specific request IDs, timestamps assigned by the server, and diagnostic
fields may differ. Authorization, status codes, selected canonical IDs, and
failure classes may not.

The dual-runtime contract covers all six read-only Memory Atlas lenses,
canonical re-authorization, limits, and disabled behavior. The dashboard's
real-runtime smoke starts Bun/SQLite and proves login, the six live product
areas, atomic Add User, restricted temporary-password login, password
replacement, logout, and fresh new-user login through the actual adapter;
browser-only mocks remain UX evidence rather than service evidence.

When v0.3 ships, the same dual-runtime contract also covers channel
create/pause, release draft/approve/activate/suspend/replace/revoke, signed
customer assertion validation, and release FTS degradation.

### 2. Retrieval and context quality

The first Titen fixture set covers Indonesian, Javanese terms inside Indonesian
sentences, and English. It must include:

- exact identifiers and error strings;
- preferences and stable semantic facts;
- episodic events and ordered timelines;
- decisions that supersede earlier decisions;
- two claims that conflict but remain independently valid;
- procedural guidance backed by verified outcomes;
- paraphrases within and across languages;
- irrelevant distractors in the same scope;
- a query with no relevant memory;
- a relevant checkpoint that is state, not evidence.

Every case declares the eligible record IDs, required evidence IDs, acceptable
conflict set, and records that must never appear.

### 3. Safety and isolation

Adversarial fixtures cover:

- a valid record ID owned by another organization;
- private memory belonging to another agent in the same project;
- request-body attempts to change tenant or trust authority;
- instructions embedded in observations, imported files, model output, and
  checkpoint payloads;
- fabricated evidence IDs returned by an extraction model;
- stale vector hits after supersession, revocation, or deletion;
- crafted FTS syntax, oversized metadata, and malformed JSONL import;
- feedback intended to promote harmful context;
- replayed idempotency keys with a different payload;
- lease and checkpoint races once collaboration ships.
- verified-but-unreleased claims, model/tag attempts to activate a release, and
  stale release vector/cache hits after revoke/replace;
- anonymous subject selection and cross-channel, cross-audience, and
  cross-customer retrieval attempts, including invalid, expired, replayed, and
  wrong-channel customer assertions.

The safety suite reports pass/fail per attack path; an average score cannot hide
one scope leak or evidence-integrity failure.

### 4. Collaboration quality

Added for v0.2:

- two agents acquire the same work key concurrently;
- a stale checkpoint update loses with `409` rather than overwriting progress;
- a handoff exposes only evidence visible to its recipient;
- each observer receives its own eligible perspective plus permitted shared
  claims;
- majority agreement does not silently become canonical truth;
- completed work creates observations before it can support claims.

### 5. Portability and recovery

Added for v0.1 and expanded for v0.3:

- Cloudflare-to-VPS and VPS-to-Cloudflare JSONL round trips;
- duplicate import remains idempotent;
- unknown export versions fail before mutation;
- FTS and vector projections rebuild from canonical records;
- backup restores into a new database and passes integrity plus functional
  smoke tests;
- embedding fingerprint changes fail readiness until an explicit re-index.
- imported active releases remain suspended until destination channel, gateway,
  approval-policy, and customer-assertion references are rebound and verified.

### 6. Channel knowledge safety and quality

Added for v0.3:

- one exact claim version is released while another verified claim remains
  internal;
- redacted/localized released content differs safely from its source claim;
- activation, replacement, expiry, and revocation affect the next channel
  context;
- source claim version change, dispute, supersession, expiry, and revocation
  immediately suspend release eligibility;
- anonymous, authenticated-customer, and partner audiences remain isolated;
- Customer A context cannot include Customer B memory through IDs, aliases,
  similarity, cache keys, or citations;
- vector outage degrades to authorized release FTS without source-claim
  fallback;
- the gateway receives released citations but not private evidence.

### 7. Memory Atlas safety and usefulness

Added for v0.2 and extended for v0.3:

- Evidence Trace returns every authorized required source and no hidden source;
- Memory Neighborhood returns only authorized nodes and edges, including when
  one endpoint of a candidate edge is private or foreign;
- Conflict & Freshness exposes expected dispute, supersession, validity, and
  lifecycle state from current canonical records;
- injected stale cache/vector/community candidates are removed by canonical
  hydration and policy recheck;
- hidden records do not change returned labels, topology, aggregate counts, or
  limit metadata;
- depth, node, edge, label, time, and response-byte limits truncate boundedly
  without unbounded traversal or layout work;
- disabling Atlas or its renderer leaves all headless REST/MCP fixtures green;
- v0.3 Scope Preview grants no authority and Knowledge Release exposes no
  private evidence or verified-but-unreleased content.

### 8. Model-assisted memory management

Automatic enrichment cannot ship from a generic chat benchmark. Freeze and
version derivation and reflection fixtures, gold propositions, schemas, prompts,
and the scorer together.

Derivation cases cover every runtime claim kind, no-memory/chitchat, tentative
and third-party statements, correction, duplicate evidence, conflicting
observations, exact identifiers, prompt injection, fabricated/foreign source
IDs, and Indonesian/English/Javanese-in-Indonesian paraphrases. Reflection cases
cover `distinct`, duplicate, conflict, qualification, explicit supersession,
repeated pattern/procedure, disjoint validity, and insufficient evidence.

Use language-neutral proposition slots rather than literal phrase matching.
Score raw trials without retry; publish repaired-after-retry separately. Run a
minimum 72 locked cases five times per candidate before default activation.
Report raw local-schema conformance as a model-quality metric independently
from commit safety. A malformed or unauthorized captured output must also be
replayed through the real validator and persistence boundary to prove it cannot
create semantic rows.

Transaction fixtures assert that derivation enqueue is atomic with its source
observation. Reflection fixtures assert that the same ordered premise versions,
policy-snapshot fingerprint, and pipeline fingerprint create one job; a changed
premise or policy snapshot creates a new job; and an unrelated canonical write
creates no reflection job.

Hard gates are:

- zero accepted fabricated, inaccessible, or cross-scope source/premise IDs;
- zero authority, trust, visibility, deletion, publication, or autonomous
  dispute-resolution mutations from model output;
- zero invalid semantic commits from malformed or policy-invalid output, with
  an explicit retryable or terminal job result for every invalid response;
- enrichment job results persist only an output hash and committed result IDs,
  never a raw or normalized proposal payload;
- 100% no-memory safety on injection, tentative, and unrelated third-party
  fixtures;
- at least 90% exact-case pass, 95% claim/source F1, 85% macro recall for every
  kind/language subgroup, and 90% temporal/reflection accuracy;
- at least 90% repeat decision stability;
- identical normalized validator/job/claim outcomes when captured responses are
  replayed through D1 and SQLite.

Choose one smallest model only after it passes every hard gate and lies within a
predeclared two-point non-inferiority margin. Add routing or escalation only
when retained failures prove a second model materially fixes a stable subset.
The [2026-07-31 pilot](../research/2026-07-31-memory-model-evaluation.md)
eliminated Luna for the tested schema and supports Sol as a canary candidate;
it did not pass this production gate.

Embedding evaluation is separate: compare FTS-only, vector-only, and hybrid on
exact, paraphrase, cross-language, hard-negative, and no-result queries. Report
Recall@5, MRR@10, nDCG@10, no-result false positives, dimensions, batch order,
repeatability, and batch 1/16/64 latency. Similarity never counts as permission
to merge or classify memory. The 2026-07-31 embedding pilot is directional,
not an activation gate: its fixture, gold, scorer, and raw-result manifest are
not independently reproducible from repository evidence.

`scripts/benchmark-embedding-calibration.ts` defines the reproducible
`s-calibration-v1` embedding-only lane. Full scale generates 10,000 statements
and 600 queries with 40 cases in every category/language stratum. A stable hash
assigns 20 cases per stratum to calibration and 20 to a locked holdout. The
runner embeds and ranks calibration first, selects the lowest evaluated cosine
threshold that yields zero calibration no-result false positives while
maximizing Recall@5, freezes it, and only then processes holdout queries. It
reports Wilson 95% intervals for recall, coverage, and abstention, retains only
ranked synthetic IDs/scores, and removes its temporary sqlite-vec database.
`--scale smoke` uses the same generator and scorer at 600 statements and 60
queries; it validates the harness but cannot satisfy the scale-S gate.
The [first full scale run](./2026-07-31-embedding-s-calibration-v1-full.md)
completed the lane, but its locked-holdout subgroup misses remain replacement
blockers rather than a new default threshold.

Preprocessing is part of the embedding fingerprint. `raw-v1` preserves the
first full run as a baseline. The predeclared EmbeddingGemma challenger uses
the model card's asymmetric retrieval templates: documents receive
`title: none | text: {content}` and queries receive
`task: search result | query: {content}`. See the
[official EmbeddingGemma model card](https://huggingface.co/google/embeddinggemma-300m/blob/main/README.md).
The [full retrieval-profile challenger](./2026-07-31-embeddinggemma-retrieval-profile-challenger.md)
improved locked-holdout Recall@5 while retaining zero no-result false
positives, but one cross-language direction remained at zero recall. The
documented profile replaces raw input as the benchmark baseline; it does not
turn embedding similarity into a memory-management decision.

The [disjoint S-validation-v2 run](./2026-07-31-embedding-s-validation-v2-full.md)
repeated 91.67% Recall@5 and zero no-result false positives without tuning the
profile or `0.737307171` floor on the new 10,000-statement/600-query fixture.
The English-query to Javanese-in-Indonesian-statement direction stayed at 0/40
because `cross_language` is not one task: `groupLanguage` rotates the statement
language one position past the query language, so the stratum tests Indonesian
to English, English to Javanese-in-Indonesian, and Javanese-in-Indonesian to
Indonesian at three different difficulties. Joining the run's raw trials to the
fixture's per-statement language shows that English queries never leave English:
2,000 of 2,000 top-10 hits across all 200 English queries are English
statements, while Indonesian and Javanese-in-Indonesian queries retrieve across
all three languages. `cross_language:en` is the only stratum whose gold is
non-English for an English query, so it is the only stratum at zero. That 0/40
is a property of the provider's English embedding cluster over 333 same-template
English `backup_region` statements, not a fixture defect: the gold exists,
carries the query's entity, and is the correct record kind. The provider
revision also remained unattested. This is deployment-specific evidence, not a
universal default or replacement pass.

The `cross_language` label therefore averages three unequal ordered pairs:
Javanese-in-Indonesian to Indonesian is near lexical identity, Indonesian to
English is a well-supported bridge, and English to Javanese-in-Indonesian is
neither. Reporting one mean over them is misleading, but splitting the stratum
by ordered language pair is deliberately not taken on its own. The generator
pins `fixture_sha256`, the split checksum, the locked holdout, and the pre-hoc
`0.737307171` floor to each other, so relabelling a stratum invalidates every
published run. Split it only when a future fixture revision invalidates those
hashes anyway.

## Recorded LongMemEval-S run, 2026-08-04/06

Externally authored corpus (MIT, 500 instances, 246,930 turns), our own scorer,
failures kept in the denominator, protocol pre-registered before each run.
Published at [titen.dev/benchmark](https://titen.dev/benchmark).

| Lane, n=500 | recall@1 | MRR@10 | LLM calls | embed calls |
| --- | ---: | ---: | ---: | ---: |
| Titen 0.6.0, FTS + vector | **0.900** | **0.9384** | 0 | 4,989 |
| Titen 0.6.0, FTS-only | 0.880 | 0.9147 | **0** | **0** |
| verbatim-RAG control, router embeddings | 0.854 | 0.9067 | 0 | 877 |
| MemPalace 3.6.0, MiniLM | 0.804 | 0.8717 | 0 | — |
| MCP reference server, substring | 0.050 | 0.1509 | 0 | — |

Paired sign tests on recall@1, same instances:

- FTS+vector vs the dense control: 35/12/453, **p = 0.0011** — significant, and it
  holds at 34/13, p = 0.0031 against a control given a matched 2,048-token budget.
- FTS-only vs that control: 44/31/425, p = 0.165 — not significant.
- FTS+vector vs FTS-only: 27/17/456, p = 0.174 — **the vector arm is not proven to
  be the cause of the win.**

### Mem0 in both of its modes

Mem0 supports `infer=False`, which skips LLM extraction entirely. Measuring only
its default overstates its cost, so both were run on the same 60 instances.

| Mem0 OSS 2.0.15 | recall@1 | MRR@10 | LLM calls | summed ingest |
| --- | ---: | ---: | ---: | ---: |
| `infer=False` | 0.8667 | 0.9019 | **0** | 14,827 s |
| `infer=True` (default) | 0.8333 | 0.8882 | 2,981 | 288,021 s |

The LLM-free mode is nominally ahead and the difference is noise (3/1/56,
p = 0.625), so **Mem0's own extraction bought nothing measurable on this corpus**
at 19x the summed ingest. Titen FTS+vector against Mem0 `infer=False` is 3/4/53,
**p = 1.0** — indistinguishable. Zero LLM calls was verified with a raising
monkey-patch, a negative control, and a closed-port LLM base URL, not assumed.

Standing consequence for any cost claim: **name the configuration measured.**
"Mem0 burns thousands of LLM calls" is true of its default and false of its
LLM-free mode.

### Answer accuracy is a null

One reader pinned across every lane (same model, temperature 0, k=5, prompt
byte-identical by hash). Primary metric is judge-free containment; the LLM judge
is secondary with its model and prompt published.

Eight pre-registered comparisons against the dense control, **none significant**,
best p = 0.41. Titen FTS-only is numerically below the control. At n=60, Mem0 OSS
and MemPalace both score above Titen. Headroom at k=5 is only 1.8 points because
every competent retriever already holds the gold session, so this run had little
power by construction — k=5 was fixed before the first call and deliberately not
retuned afterwards.

**Retrieval significance does not transfer to answers.**

### What does not depend on configuration

Titen's FTS-only lane made zero LLM calls **and zero embedding calls** and scored
0.880. Mem0 `infer=False` still made 29,582 embedding calls and still requires an
embedding provider. That is the one difference in this table that no competitor
setting can erase.

## Recorded Mem0 replacement cycle

The first versioned side-by-side run against `server-wulan` is documented in
the [Titen 0.3.0 versus Mem0 cycle-1 report](./2026-07-31-mem0-replacement-cycle1.md).
Its redacted raw trials, manifest, summary, report, and checksums are committed
under [`results/2026-07-31-titen-030-vs-mem0-cycle1`](./results/2026-07-31-titen-030-vs-mem0-cycle1/).

That run is a small directional gate, not a replacement win. It used eight
facts, eight queries, ten seeded paired repeats, concurrency one, the same
Wulan `embeddinggemma` service, Mem0 `infer:false`, and Titen direct claims.
Titen tied Recall@1/5 but trailed Mem0 on MRR and nDCG; both returned a false
positive for every no-result query at threshold zero. Titen request latency was
lower through the shared SSH path, but automatic memory management remained
unsupported while Mem0 `infer:true` passed its capability probe. Safety,
recovery, and outage smokes are recorded separately in the report; Cloudflare,
local-computer, migration, service-resource, saturation, and soak gates remain
open.

[`scripts/benchmark-mem0-replacement.ts`](../../scripts/benchmark-mem0-replacement.ts)
preserves this exact historical 0.3.0 lane; do not retarget it to a later
release or reinterpret its artifacts as current capability evidence. Its CLI
retains only `--help` and `--self-test`; a live invocation fails before service
I/O or artifact creation. A future replacement attempt needs a new release-bound
spec and runner. It must not reuse
this tiny corpus as a production quality claim, compare its workstation
telemetry as service-host telemetry, or count an external LLM harness as Titen
enrichment.

Cycle 2 is recorded in the
[concurrency, migration, and enrichment-audit report](./2026-07-31-mem0-replacement-cycle2.md).
It repeats the same controlled lane at concurrency 1, 8, and 32 with bounded
per-pair AB/BA ordering and container CPU/memory time series. It also adds
[`scripts/benchmark-mem0-migration.ts`](../../scripts/benchmark-mem0-migration.ts)
for a reversible synthetic direct-import rehearsal and
[`scripts/sample-docker-resources.ts`](../../scripts/sample-docker-resources.ts)
for redacted Docker telemetry.

The 20-record disposable migration rerun passed exact idempotent IDs, semantic
recall, evidence provenance, and Mem0 cleanup. This is not a production
migration claim: automatic extraction, scope/lifecycle mapping, bulk/delta
catch-up, dual-write, and rollback soak remain open. Docker memory is container
usage, not process RSS, and the five-container Mem0 topology is not equivalent
to Titen's direct-retrieval container.

[Cycle 3](./2026-07-31-mem0-replacement-cycle3.md) and
[cycle 4](./2026-07-31-mem0-replacement-cycle4.md) retain the dated 0.3.0
canary and source-QA snapshots. The frozen Sol/Terra run and later
[Luna absolute gate](./2026-07-31-enrichment-model-gate-luna-full.md) selected
no model: all candidates failed their measured lexical/output gates, Luna also
failed 100% no-memory safety, and semantic adjudication plus immutable revision
attestation remain absent. Moving issue, branch, and pull-request details in
those reports are historical, not current repository status.

## Fixture format

Fixtures will be versioned JSONL under `test/fixtures/evals/` when the harness is
implemented. One logical case has this shape:

```json
{
  "case_id": "temporal-decision-001",
  "release": "p0",
  "language": "id",
  "setup": {
    "observations": [],
    "claims": [],
    "actor": "agent_release"
  },
  "query": {
    "task": "deploy proyek dengan prosedur terbaru",
    "max_tokens": 800
  },
  "expected": {
    "must_include_claim_ids": ["claim_current"],
    "must_include_evidence_ids": ["obs_verified"],
    "must_exclude_ids": ["claim_superseded", "claim_foreign"],
    "conflict_ids": [],
    "empty": false
  }
}
```

Fixture IDs are stable. Private or production content is never copied into the
evaluation corpus.

## Metrics

| Metric                     | Definition                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| Recall@5                   | relevant eligible claims returned in the first five results / all expected relevant claims       |
| MRR                        | reciprocal rank of the first expected relevant claim, averaged across answerable cases           |
| Precision@5                | expected relevant claims / returned claims in the first five results                             |
| Evidence coverage          | returned claims whose required visible evidence IDs are present / returned claims                |
| Citation precision         | returned evidence links judged valid for their claim / all returned evidence links               |
| Temporal accuracy          | temporal cases selecting the currently applicable or requested historical claim / temporal cases |
| Conflict exposure          | required unresolved conflicts surfaced / expected unresolved conflicts                           |
| Abstention accuracy        | no-memory cases returning an empty context without fabricated claims / no-memory cases           |
| Raw schema conformance      | raw model outputs accepted by the exact local schema / raw extraction outputs                     |
| Invalid semantic commit rate | invalid captured model outputs that create a canonical semantic row / all invalid captured outputs |
| Claim proposal F1          | language-neutral evidence-linked proposal matches across all derived claims                       |
| Reflection action accuracy | exact action, premise IDs, and source IDs / reflection decisions                                   |
| Decision stability         | cases with the same normalized safe decision across independent repeats                           |
| Budget violation rate      | context packs exceeding `max_tokens` / compiled contexts                                         |
| Scope leakage rate         | inaccessible records returned or existence-disclosed / adversarial scope attempts                |
| Harmful-context rate       | selected items marked harmful by the fixture or downstream feedback / selected items             |
| Useful-context rate        | selected items later marked used or useful / selected items with feedback                        |
| Unauthorized release rate  | unreleased/wrong-channel/wrong-audience items returned / adversarial channel queries             |
| Cross-customer leakage     | other-customer records returned or existence-disclosed / adversarial customer queries            |
| Released citation coverage | returned channel items with valid audience-safe released citations / returned channel items      |
| Atlas evidence coverage    | required authorized evidence nodes/edges returned / expected authorized evidence links           |
| Atlas topology leakage     | hidden nodes, edges, labels, or count influence / adversarial Atlas requests                     |
| Atlas diagnosis success    | operator diagnosis cases answered correctly / attempted diagnosis cases                          |

Latency, CPU, storage, model calls, and token cost are reported separately; they
must not be blended into a quality score.

## Performance benchmark protocol

### What “faster” means

Titen does not define speed as vector-query latency alone. The measured unit is
the useful memory operation an agent experiences.

| Operation               | Start                                 | Stop                                     | Required result                                      |
| ----------------------- | ------------------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| canonical remember      | request sent                          | durable canonical response received      | observation, history, FTS, and outbox committed      |
| lexical visibility      | canonical commit                      | record is eligible through FTS context   | authorized canonical item returned                   |
| semantic visibility     | canonical commit                      | current vector version is queryable      | authorized hydrated item returned                    |
| context compile         | authorized request sent               | bounded structured context received      | citations, conflicts, and budget metadata valid      |
| consolidation           | eligible batch accepted               | validated claims and sources committed   | no fabricated or cross-scope source                  |
| feedback                | feedback request sent                 | utility projection durably updated       | evidence unchanged                                   |
| collaboration operation | checkpoint/lease/handoff request sent | versioned state committed                | ownership and visibility invariants hold             |
| event delivery          | domain event committed                | subscribed destination returns valid 2xx | signed, retry-safe metadata delivered                |
| adapter lifecycle       | host lifecycle event emitted          | adapter returns control to host          | required memory step completed or explicit degrade   |
| recovery                | dependency restored                   | readiness and backlog return to target   | no lost canonical record                             |
| release activation      | activation commit                     | next channel compile begins              | exact approved snapshot is eligible                  |
| release revocation      | revocation commit                     | next channel compile begins              | release is absent despite stale projections          |
| channel context         | gateway request sent                  | bounded released context received        | audience, subject, citation, and budget rules hold   |
| Memory Atlas compile    | authorized view request sent          | bounded read-only projection received    | no hidden topology/count; canonical state is current |

The primary user-facing latency is **time to useful context**: request start to
a policy-valid, evidence-backed, token-bounded context response. It is reported
with and without query-embedding time when semantic retrieval is enabled.

### Benchmark lanes

Each release publishes separate lanes. Results from different lanes are not
combined into one leaderboard.

| Lane                    | Configuration                                                   | Purpose                                                         |
| ----------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| A — core                | SQL + FTS, no model or vector backend                           | mandatory lightweight and degraded baseline                     |
| B — hybrid              | FTS + one embedding model + one vector backend                  | semantic quality and added latency                              |
| C — lifecycle           | ingestion, consolidation, compile, and feedback                 | full Level 5 cost and utility                                   |
| D — collaboration       | checkpoints, leases, handoffs, and parallel compile             | Level 6 contention and isolation                                |
| E — controlled external | comparable systems with the same configurable models and corpus | isolate memory-system differences                               |
| F — native external     | each system's documented recommended stack                      | compare real product profiles without claiming component parity |
| G — channel serving     | approved release FTS plus optional release vectors              | CRM/chatbot audience isolation, quality, and release latency    |
| H — Memory Atlas        | canonical SQL plus each enabled bounded lens                    | view safety, usefulness, latency, and truncation behavior       |

Self-hosted systems on the same hardware form one comparison group. Managed
services form another because network path, provider hardware, autoscaling, and
unpublished internal components cannot be normalized. A managed result is not
used to claim that one local engine is faster than another.

### Dataset tiers

The harness uses deterministic, versioned synthetic and licensed public data,
never production memory.

| Tier | Active claims |       Observations | Intended question                        |
| ---- | ------------: | -----------------: | ---------------------------------------- |
| XS   |         1,000 |     at least 2,000 | cold start and developer laptop behavior |
| S    |        10,000 |    at least 20,000 | personal and small-team steady state     |
| M    |       100,000 |   at least 200,000 | larger project and exact-search ceiling  |
| L    |     1,000,000 | at least 2,000,000 | ANN and scale-adapter justification      |

Each tier includes multiple tenants, subjects, agents, validity windows,
superseded versions, unresolved conflicts, exact identifiers, paraphrases,
multilingual cases, and irrelevant distractors. A system is only scored at a
tier it ingested successfully and can verify with record counts.

Channel-serving runs additionally declare channel, audience, release, customer,
and released-citation counts. Synthetic fixtures include unreleased verified
claims, suspended releases, repeated customer aliases, and cache-key collisions.

### Workloads

Run each workload independently before any mixed test:

1. **Ingest:** single and bounded-batch observations, with and without direct
   claims.
2. **Exact recall:** IDs, names, error strings, and explicit decisions.
3. **Semantic recall:** paraphrases, multilingual queries, and indirect task
   descriptions.
4. **Temporal recall:** current, historical, superseded, and future-valid
   claims.
5. **Conflict recall:** supported contradictions and observer-specific views.
6. **Context compilation:** small and large token budgets with stable eligible
   sets.
7. **Feedback:** positive, negative, harmful, and out-of-scope attempts.
8. **Collaboration:** checkpoint updates, lease contention, handoff acceptance,
   and private/shared context under concurrency.
9. **Repair:** embedding outage, delayed vector visibility, restart, stale
   vector, backlog drain, and re-index.
10. **Agent adapter:** resolve project, compile at a task boundary, batch typed
    observations, checkpoint/lease/handoff, feedback, disconnect, and reconnect.
11. **Events:** webhook success, timeout, retry, replay, pause, terminal failure,
    and cursor-based orchestrator polling.
12. **Channel serving:** draft/approve/activate/compile/replace/revoke, audience
    isolation, authenticated-customer context, stale projection, and FTS
    degradation.

A declared mixed workload then reflects expected agent use. Its exact read,
write, feedback, and coordination percentages are versioned with the result;
they are not changed after a run begins.

### Measurement points

Every request records wall-clock latency and, where observable, these spans:

```text
client/network
authentication and policy
query embedding
lexical candidate query
vector candidate query
rank fusion
canonical hydration
temporal/trust/utility ranking
token-budget packing
response serialization
host hook/adapter before and after the service call
release/channel eligibility and customer-subject policy
```

Ingestion additionally records canonical transaction time, embedding time,
vector mutation acceptance, and time until the vector is actually queryable.
Asynchronous mutation acceptance is never reported as semantic readiness.

### Performance metrics

| Metric                   | Definition                                                                     |
| ------------------------ | ------------------------------------------------------------------------------ |
| p50/p95/p99 latency      | distribution per operation and benchmark lane                                  |
| throughput               | successful operations per second at declared concurrency                       |
| error rate               | failed or invalid results / attempted operations                               |
| saturation point         | first concurrency where throughput stops improving or p95 exceeds its budget   |
| cold-start latency       | first valid operation after process/Worker/database cold state                 |
| lexical-ready lag        | FTS eligibility time minus canonical commit time                               |
| semantic-ready lag       | current vector eligibility time minus canonical commit time                    |
| outbox age               | age distribution of pending semantic mutations                                 |
| consolidation throughput | validated claims committed per source item and per second                      |
| CPU time                 | server CPU consumed per successful operation where available                   |
| peak and idle memory     | service RSS or runtime-equivalent measurement, excluding remote model service  |
| storage amplification    | total service/index bytes / canonical content bytes                            |
| model usage              | embedding, extraction, reranking calls, tokens, and billed units               |
| context efficiency       | useful selected tokens / total context tokens                                  |
| task success             | downstream tasks completed correctly with the compiled context                 |
| task completion latency  | agent task start to verified outcome, separate from memory-service latency     |
| action efficiency        | model turns, tool calls, retries, and duplicate work per successful task       |
| hook overhead            | host lifecycle-to-adapter-return time excluding separately reported Titen call |
| calls/bytes per task     | adapter requests and transferred bytes per verified completed agent task       |
| dropped mutation rate    | durable signals not accepted after declared retries / eligible signals         |
| duplicate mutation rate  | duplicate canonical rows / idempotently retried mutations                      |
| webhook delivery lag     | destination valid 2xx time minus domain event commit time                      |
| orchestration wake lag   | selected agent start time minus actionable event commit time                   |
| release activation lag   | first eligible channel context time minus activation commit time               |
| release revocation lag   | first post-commit compile excluding the release minus revocation commit time   |
| channel context latency  | authenticated gateway request to bounded audience-valid context                |
| Atlas compile latency    | authenticated view request to bounded authorized projection                    |
| Atlas truncation rate    | successful authorized views truncated by configured limits / view requests     |
| Atlas diagnosis time     | task start to correct evidence/conflict/scope diagnosis                        |

Vector-only benchmarks additionally report index build time, index size, exact
or approximate search mode, Recall@k against exact ground truth, and the
latency/recall curve. Approximate indexes are never compared on latency without
their recall.

### Controlled comparison rules

An external comparison adapter implements the smallest common contract:

```text
reset → ingest → wait_ready → search_or_context → inspect_result → export_metrics
```

The adapter may translate public APIs but cannot add retrieval or reasoning that
the evaluated system does not normally perform. Adapter source and version are
published.

For a controlled comparison:

1. Use the same corpus, query set, eligibility rules, top-k, and context budget.
2. Use the same embedding, extraction, answer, and judge models when every
   system permits configuration.
3. Freeze model identifiers, prompts, preprocessing, dimensions, metric, and
   reranking behavior.
4. Start from an empty verified store and publish final record counts.
5. Disable undocumented client caches; declare intentional server caches.
6. Run the load generator from the same host/region and record network latency.
7. Warm up separately, then run at least five independent measured trials.
8. Test cold and warm states, and concurrency `1`, `8`, and `32` unless a
   published limit requires a lower declared value.
9. Publish every trial, timeout, retry, exclusion, and failure.
10. Change one independent variable at a time for ablations.

If another system does not expose evidence, conflicts, visibility, or feedback,
the comparison reports that capability as unsupported. It does not fabricate a
mapping or award speed for skipping a required correctness step.

### Quality-adjusted speed

Before running a speed comparison, declare:

- the required safety gates;
- the quality metrics and non-inferiority margin;
- the dataset tier and language mix;
- the maximum error rate;
- the context/token budget;
- whether model and network time are included.

A result is disqualified when scope leakage, fabricated evidence, invalid
conflict handling, or budget violation is non-zero. Among valid runs, compare
the Pareto frontier of quality, p95 latency, throughput, resource use, and cost.

Useful calculations are:

```text
p95 speedup       = comparator p95 / Titen p95
throughput gain   = Titen successful ops/s / comparator successful ops/s
storage ratio     = Titen total bytes / comparator total bytes
cost per 1k tasks = total measured runtime and model cost / successful tasks × 1000
```

No composite “memory score” hides these dimensions. Titen may say “faster” only
when the pre-declared quality floor is met and the latency advantage repeats
across independent runs. If Titen is slower but more accurate or safer, the
result says exactly that.

### Titen ablations

Every major optimization is tested against the simpler configuration:

1. FTS-only;
2. vector-only candidate generation;
3. FTS + vector fusion;
4. hybrid plus temporal/trust ranking;
5. hybrid plus context packing;
6. active-claim embeddings versus raw-observation embeddings;
7. feedback disabled versus bounded utility feedback;
8. exact `sqlite-vec` versus a scale adapter when proposed;
9. query embedding included versus excluded from service-only latency;
10. context compilation at task/scope boundaries versus every agent turn;
11. typed durable capture versus whole-transcript extraction;
12. webhook wake versus declared polling intervals.
13. release FTS-only versus release hybrid retrieval;
14. dedicated release projection versus filtering the canonical claim corpus,
    subject to identical zero-leak and citation floors.

This reveals whether an optimization improves useful context or merely moves
cost to another component.

### Agent adapter parity

Each supported host adapter runs the same fixture without host-specific memory
policy:

```text
install/probe → resolve project → context → remember batch
→ checkpoint/lease → handoff → feedback/outcome → reconnect
```

Publish host/adapter versions, transport, enabled tools, lifecycle events, hook
overhead p50/p95/p99, calls and bytes per task, injected context tokens,
dropped/duplicate mutations, reconnect behavior, task success, and raw trials.
An adapter does not pass by skipping a required authorization, evidence,
coordination, or feedback step.

### Harness and result format

The first harness should be one small TypeScript runner using Bun's built-in
`fetch`, timers, and JSONL output. Add a load-testing dependency only when the
built-in runner cannot generate or measure the required concurrency accurately.

Planned raw result fields include:

```json
{
  "schema_version": 1,
  "run_id": "bench_...",
  "system": "titen",
  "system_version": "git-sha-or-release",
  "lane": "hybrid",
  "runtime": "bun-sqlite",
  "dataset_tier": "s",
  "fixture_hash": "sha256:...",
  "embedding_fingerprint": "provider/model/revision/dims/metric/template",
  "concurrency": 8,
  "warm_state": true,
  "operation": "context_compile",
  "latency_ms": { "p50": 0, "p95": 0, "p99": 0 },
  "quality": { "recall_at_5": 0, "evidence_coverage": 0 },
  "errors": 0,
  "samples": 0
}
```

Zero values are schema examples, not targets or measured results. Raw JSONL,
summary Markdown, configuration, and exact commands are published together.

## Baselines and comparisons

Every quality run includes:

1. FTS-only Titen, the mandatory degraded baseline;
2. Titen hybrid retrieval when vectors are enabled;
3. the same model, prompt, corpus, top-k, token budget, and run count for every
   configuration being compared.

P0 establishes the first numeric retrieval baseline. Later releases may not
silently lower it. Any numeric release threshold must be recorded in an ADR
after the fixture corpus and variance are measured.

### FTS-only quality is not flat across corpus size

Measured in [scale and concurrency](./2026-08-04-scale-and-concurrency.md), one
fixed 100-query set answerable at every decade, FTS-only, concurrency 1. Each
cell is run 1 / run 2, the two independent RAM-backed repeats:

| Active claims | recall@1 | MRR@10 |
| ---: | ---: | ---: |
| 1,000 (XS) | 1.00 / 1.00 | 1.000 / 1.000 |
| 10,000 (S) | 0.81 / 0.80 | 0.897 / 0.892 |
| 100,000 (M) | 0.49 / 0.48 | 0.609 / 0.597 |

The corpus is synthetic and the absolute values are a property of its
generator, so they are not Titen's recall; the shape is the result. Any
FTS-only quality figure must be quoted with the corpus size it was measured
at. Tier L (1,000,000) has never been run. Arresting this slope is strategic
debt item 3 in `PONYTAIL-DEBT.md`.

LongMemEval-S is an external comparability suite, not a substitute for Titen's
isolation, evidence, conflict, and collaboration fixtures. LoCoMo is not used at
all — see [third-party references and licenses](#third-party-references-and-licenses).

### recall@10 is saturated on LongMemEval-S; k=1 and MRR@10 are the primary metrics

Measured 2026-08-04 on `rama-tuf`, LongMemEval-S, all 500 instances, one shared
scorer, failures kept in the denominator, zero failures in every lane. Artifacts
are `~/titen-bench-20260804/results/*-500.json`; the overall and per-question-type
figures below are read from the `by_type` block the scorer emits, and recomputing
each lane from its raw `.ranked.json` reproduces the stored scores exactly.

| Lane, n=500 | recall@1 | recall@5 | recall@10 | MRR@10 |
| --- | ---: | ---: | ---: | ---: |
| Titen FTS-only | 0.880 | 0.960 | 0.982 | 0.9147 |
| verbatim-RAG control, router embeddings | 0.854 | 0.974 | 0.990 | 0.9067 |
| MemPalace 3.6.0, MiniLM, user-only | 0.804 | 0.964 | 0.982 | 0.8717 |
| verbatim-RAG control, fastembed | 0.772 | 0.932 | 0.972 | 0.8427 |
| MemPalace 3.6.0, MiniLM, full-text | 0.746 | 0.924 | 0.968 | 0.8249 |

The spread between the best and worst serious lane collapses as k grows:
**13.4 points at k=1, 5.0 at k=5, 2.2 at k=10**, against 9.0 points on MRR@10.
k=1 discriminates roughly **six times** as strongly as k=10, and every lane sits
within 3.2 points of the ceiling at k=10, so a lane-vs-lane difference there is
noise. Two question types have no headroom left at all:
`single-session-assistant` (n=56) is recall@1 **1.000** in both control arms and
in Titen FTS-only, and `knowledge-update` (n=78) is recall@5 1.000 in four of the
five lanes.

Therefore, on this corpus:

- **recall@1 and MRR@10 are the primary metrics.** A ranking improvement that
  does not move them has not been measured.
- **recall@5 and recall@10 must be marked saturated wherever they are quoted**,
  in this repository and in any external material. Publishing a bare recall@10
  table implies a discrimination that is not there.

One caveat against over-reading the saturation: it is a property of the serious
lanes, not of the metric. The MCP reference server lane scores recall@10 0.482,
so k=10 still separates a working retriever from a broken one — it just cannot
rank the working ones.

The `single-session-assistant` ceiling is *not* explained by the questions
restating the gold session verbatim, which was the initial hypothesis. Measured:
a median of only **0.44** of each question's content words appear in the gold
session's opening 1,200 characters, and a bare word-overlap ranker scores
recall@1 **0.464** on that type against 1.000 for the real lanes. The type is
easy for any competent retriever, lexical or dense; it is not a string match.

**Better fix, future work: enlarge the haystack rather than change the metric.**
Each instance currently carries its own small haystack — median **50** sessions
(min 39, max 66) — while the corpus holds **19,829 distinct sessions** across
25,112 (instance, session) pairs. Scoring against one shared haystack instead of
~50 candidates per instance is roughly a **400x** larger candidate pool and is
also closer to how a real store looks. This connects directly to the FTS-only
degradation curve above: recall@1 falls 1.00 -> 0.49 from 10^3 to 10^5 claims, so
at realistic corpus sizes the saturation disappears on its own and ranking, not
candidate generation, becomes the binding constraint. Tracked as #267.

### Evidence-aware ranking is a measured null on this corpus, 2026-08-07

[Full report](./2026-08-07-evidence-ranking.md), protocol
[pre-registered](./2026-08-07-evidence-ranking-prereg.md) before the first
scored run. One store queried twice, 500 instances, same scorer, zero failures.

Corroboration — authorized supporting observations per claim — was added as a
ranking tie-break. recall@1 is **0.8800 before and 0.8800 after**, MRR@10 0.9147
both, and the ranked lists are byte-identical on 500 of 500 instances
(0/0/500, p = 1.0). **0.0 of the +10.2-point oracle ceiling was captured.**

The cause is measured, not inferred: across all 424,168 claims in that store,
`trust`, `status`, `confidence`, `version`, `actor_id`, source relation, and
supporting-observation count each take exactly **one** value, there are zero
feedback rows, and every observation carries `corpus` provenance. Five of the
six weighted ranking components are constant, every rank-1 score in the run is
the same number (0.794374), and **0 of 500 instances have a rank-1 tie across
sessions** — so no tie-break signal of any kind could have moved a rank-1 answer.

Three standing consequences:

- **LongMemEval-S cannot score evidence-aware ranking in either direction.** Do
  not cite this run as support for the ranker, and do not cite it against one.
- A **`recalled` provenance penalty in the ranker is unreachable code.**
  `src/core/claims.ts` refuses a recalled observation as claim evidence at
  consolidation and only claims are ranked, so no claim can carry it.
- `PONYTAIL-DEBT.md` item 2 — the score carries no cross-query signal — is now
  **independently reproduced on an externally authored corpus**, not only on
  Titen's own fixture.

The same report adds **tokens-to-answer** as a companion to recall@1: the token
cost of the smallest pack of whole ranked sessions containing the gold. On this
corpus it separates the serious lanes by only 6.8% at the median (3,209–3,428)
and is therefore a *weaker* discriminator than recall@1, but it separates a
working retriever from a broken one by roughly 4x — the MCP reference server
needs a 12,558-token median and never surfaces the gold at all on 259 of 500
instances. Report it beside recall@1, never instead of it.
### An authorization fix cost nothing, and the benchmark caught what the suite could not, 2026-08-07

[Full report](./2026-08-07-disputed-authorization.md), protocol
[pre-registered](./2026-08-07-disputed-authorization-prereg.md) before the first
scored run.

[#291](https://github.com/RamaAditya49/titen/issues/291) added the caller's own
access predicate to the `disputed` flag. Paired A/B over one frozen store,
n=500, `main` against the fix: recall@1 **0.8800 both**, MRR@10 **0.9147 both**,
zero failures, and the ranked outputs **byte-identical on 500 of 500 instances**
(0/0/500, p = 1.0).

That null was predicted exactly, and published as a prediction before the run,
because the corpus holds **zero** rows with `relation = 'contradicts'`, zero
disputed claims, and one principal. **LongMemEval-S cannot exercise this fix in
either direction**, and no synthetic corpus was built to make it fire. The
behaviour change is evidenced by a dual-runtime contract case, not by this run.

The reason to run it anyway is the second arm. The first implementation
expressed the predicate as `claim_sources JOIN observations`, and SQLite drove
from `observations`, scanning all 25,112 of them per candidate: **79 s per
compile against 17.8 ms**. Rewriting it so `claim_sources` seeks its own primary
key restored the baseline. **The dual-runtime contract suite passed on both
shapes at every stage** — its stores hold tens of rows, so a plan that collapses
at 10^5 claims is invisible to it.

Two standing consequences:

- **A contract suite is not a performance gate.** Any change to the candidate
  query or to `recordAccessSql` needs `EXPLAIN QUERY PLAN` against a store with a
  realistic row count before it ships. A green suite says nothing about the plan.
- Prefer a **nested `EXISTS`** to a join inside a correlated authorization
  predicate. `loadAuthorizedSources` already used that shape; the join copied
  into `atlas.ts` did not, and it was on the slow plan in production.

### The pooled-store condition: the per-instance haystack was the ceiling's floor, 2026-08-07

[Full report](./2026-08-07-pooled-store.md), protocol
[pre-registered](./2026-08-07-pooled-store-prereg.md) with five falsifiers
before the first scored run. All 19,829 distinct sessions in one
single-subject store, all 500 questions, `titen-memory@0.7.0` from the npm
registry, four store sizes, per-compile latency, zero failures.

**Two pre-registered falsifiers fired against Titen and are published with
the same prominence a win would have received.** FTS-only recall@1 falls
0.880 → **0.246** from the per-instance condition to the full pool, and
compile p95 crosses the 250 ms kill line at the 10,000-session cell
(430.8 ms; 864.9 ms at the full pool). The prereg's prediction (0.70–0.85)
was wrong by 45+ points: LongMemEval-S personas share topics by
construction, so the pooled store is denser in cross-persona near-duplicates
than the synthetic generator — all 377 rank-1 misses retrieved
cross-instance sessions, zero retrieved a wrong session from the question's
own haystack.

The subject-scoped anchor arm — the same 424,168-claim corpus behind one
subject per instance — reproduced the published 0.880 / 0.9147 exactly under
the 0.7.0 tarball at p95 138 ms. **Scoping is worth +63.4 points of recall@1
and 6.3x latency on this corpus**; that is the measured value of
authorization-before-retrieval, and the measured answer to "just scope by
user_id".

The instrument half worked: recall@10 falls 0.982 → 0.508 at the full pool,
so the k-saturation that made every serious lane tie disappears — ranking,
not candidate generation, becomes the binding constraint, as #267 predicted.

The phase-2 lanes sharpened rather than softened this. The **strong router
control** (same `embeddinggemma` service as Titen's vector arm; 0.854
per-instance) scored **0.174** pooled — the largest tax of any lane (68.0
points) and 7.2 below Titen FTS-only. **Titen's own FTS+vector arm scored
0.212 pooled, 3.4 points below its own FTS-only lane**, after a 9,054 s
index drain and at 2.8x the compile latency: the hybrid fusion that bought
+2.0 points per-instance is worth −3.4 at the pooled shape, with the same
embedder that collapsed the dense control. At this density of cross-persona
near-duplicates the embedding space, not the fusion, is what fails.

**Mem0 OSS 2.0.15 `infer=False` pooled: 0.182** — significantly below Titen
FTS-only (27/59, p = 0.0007) at 10.9x the ingest wall clock (3,953 s,
205,641 embedding calls) and 2.6x the query latency (p50 2,215.6 ms). The
final pooled leaderboard puts **Titen's zero-provider lane significantly
above every measured competitor** — Mem0, the router and fastembed dense
controls, MemPalace's published shape, and the MCP reference server (which
cannot serve the store at all) — the first significant lane-vs-lane
separations this corpus has yielded. The per-instance condition remains a
statistical tie for everyone; both sentences travel together.

Standing consequences:

- **Never quote the FTS-only operating point above ~10^3-session store shape
  without this curve beside it.** The zero-provider lane's published 0.880 is
  a scoped-store number; unscoped pooled shape is a different regime and the
  honest cells are 0.524 / 0.364 / 0.308 / 0.246 across the four sizes.
- **Never claim the vector arm helps without naming the condition.** Measured
  2026-08-07: FTS+vector is +2.0 points over FTS-only per-instance (p = 0.174,
  unproven) and **−3.4 points pooled**, at 2.8x the compile latency.
- The pooled cells and the per-instance cells are different conditions of the
  same corpus, not competing measurements of one thing. Every future
  LongMemEval-S quote names its condition.
- The 1,000-session pooled cell is 94% gold by construction and carries a
  ±1-point dead-heat wobble across invocations; it is a curve endpoint, never
  a headline.

## Release gates

| Gate | Required result                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P0   | all deterministic dual-runtime cases pass; scope leakage, fabricated evidence, and budget violations are zero; quality baseline is published |
| v0.1 | P0 remains green; lifecycle, portability, recovery, and multilingual suites pass; retrieval does not regress beyond an approved ADR          |
| v0.2 | v0.1 remains green; collaboration, events, adapter parity, REST/MCP parity, and Memory Atlas safety/usefulness pass                          |
| v0.3 | governance, channel/release/customer isolation, Atlas governance lenses, revocation, retention, audit, backup, and recovery journeys pass    |
| v1   | authorized federation preserves provenance, conflicts, policy filtering, and replay-safe cursors                                             |

Flaky security or canonical-integrity tests fail the gate. They are not retried
until green and averaged away.

Automatic enrichment is an independent activation gate: the model-management
hard gates above, provider-outage/lease/crash tests, captured-response parity,
zero invalid semantic commits, an independently reproducible embedding corpus,
and real synthetic-tenant smoke on Cloudflare, VPS, and a local computer must
all pass. A pilot model win does not satisfy a release row by itself.

## Reproducibility record

Every published result includes:

- Titen commit and dirty/clean status;
- runtime, OS, CPU class, database, and dataset size;
- fixture-set hash and excluded cases with reasons;
- embedding provider, model, dimensions, metric, normalization, and fingerprint;
- extraction/reranking model and immutable model identifier when available;
- prompt/schema version, temperature, seed when supported, and run count;
- FTS/vector candidate limits, fusion parameters, and context token budget;
- median and tail latency with model time separated from local retrieval;
- failures and degraded capabilities, not only successful runs;
- warmup policy, independent trial count, concurrency, client location, and
  cold/warm state;
- operation span timings and whether model/network time is included;
- final canonical, FTS, and vector record counts;
- enabled Atlas lens, requested/effective limits, cache state, and authorized
  node/edge/truncation counts;
- raw result artifact path and checksum.

## Claim discipline

- Never compare Titen OSS numbers with a hosted product unless the feature set
  and model stack are equivalent.
- Never publish a best run without distribution or run count.
- Never use one benchmark to claim personal, company, and enterprise readiness.
- Never claim that a vector or graph backend improves quality without an
  ablation against FTS-only and the current simplest hybrid path.
- Never claim “faster” from average latency alone; publish p95/p99, errors,
  throughput, quality floor, and raw trials.
- Never compare a local self-hosted run directly with a managed network service
  as though their infrastructure were equivalent.
- Never quote recall@5 or recall@10 from LongMemEval-S without marking it
  saturated; report recall@1 and MRR@10 as the primary metrics on that corpus.
- Never claim that ranking on trust, conflict, provenance, corroboration, or
  feedback improves retrieval. Measured 2026-08-07: every one of those signals
  is constant on LongMemEval-S, the ranked output was byte-identical, and no
  corpus is currently available in which they vary against gold labels.
- Never present the 2026-08-07 `disputed` authorization run as evidence that the
  fix improves anything. It is a no-regression check on a corpus that holds no
  contradicting evidence at all, and it was published as such.
- Never quote a LongMemEval-S figure without naming its condition —
  per-instance (scoped) or pooled — and never quote the FTS-only lane above a
  ~10^3-session store shape without the pooled degradation curve beside it.
  Measured 2026-08-07: 0.880 scoped against 0.246 at the 19,829-session pool.
- Never let a corpus into an evidence plan without reading its `LICENSE` file.
  An SPDX lookup is not sufficient: `gh api repos/snap-research/locomo --jq
  .license.spdx_id` returns `NOASSERTION`, which means **unknown, not
  permissive**, while the file itself is CC BY-NC.

## Third-party references and licenses

Titen may name, summarize, cite, and link external benchmarks without copying
their code or datasets. Referencing a project does not imply affiliation or
endorsement.

- The LoCoMo repository declares
  [CC BY-NC 4.0](https://github.com/snap-research/locomo/blob/main/LICENSE.txt);
  line 1 of `LICENSE.txt` is `Attribution-NonCommercial 4.0 International`.
  Do not vendor or redistribute its dataset in Titen's Apache-2.0 release, and
  do not assume commercial benchmark use is permitted. **Titen does not run
  LoCoMo at all**: producing benchmark numbers to support a commercial launch is
  commercial use. GitHub reports its SPDX id as `NOASSERTION`, so a license gate
  that reads SPDX alone will wave it through — the restriction is only visible in
  the file. `blueprint.md` §20.5 records the same decision.
- The LongMemEval repository declares
  [MIT](https://github.com/xiaowu0162/LongMemEval/blob/main/LICENSE). Confirm the
  separately hosted dataset terms before redistribution.
- Mem0 and its memory-benchmark harness declare
  [Apache-2.0](https://github.com/mem0ai/memory-benchmarks/blob/main/LICENSE).

If Titen later copies third-party code or ships data, review the exact artifact
license and add attribution plus `THIRD_PARTY_NOTICES` before merging. External
datasets should normally be downloaded separately by the evaluator, not
committed into this repository.

## Primary references

- [LongMemEval project](https://xiaowu0162.github.io/long-mem-eval/) — primary
  external corpus, MIT
- [Mr.TyDi](https://github.com/castorini/mr.tydi) — supporting non-English lane,
  Apache-2.0
- [LoCoMo dataset and code](https://github.com/snap-research/locomo) — cited for
  its license only; not run, CC BY-NC
- [Mem0 memory benchmark harness](https://github.com/mem0ai/memory-benchmarks)
- [Anthropic: effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [VectorDBBench methodology and metrics](https://github.com/zilliztech/VectorDBBench)
- [`pgvector` exact/approximate search and recall monitoring](https://github.com/pgvector/pgvector)
- [`sqlite-vec` KNN behavior](https://alexgarcia.xyz/sqlite-vec/features/knn.html)
