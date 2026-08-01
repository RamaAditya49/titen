# Titen functional requirements document

- Status: feature baseline; memory service and opt-in model-assisted enrichment
  verified locally, production enrichment activation gated
- Product: Level 6 collaborative memory fabric
- Kernel: Level 5 evidence-grounded context memory
- Target runtimes: Cloudflare Workers/D1 and Bun/SQLite
- Related documents: [PRD](./PRD.md), [DESIGN](./DESIGN.md),
  [roadmap](./ROADMAP.md), [architecture](./architecture/overview.md), and
  [API](./reference/api.md)

## 1. Purpose

This document turns the product requirements into testable product behavior. It
defines the features Titen must expose, who may use them, their release order,
failure behavior, and the acceptance journeys required before each release.

The documents have distinct responsibilities:

- the PRD defines product scope, users, and success;
- this FRD defines externally observable feature behavior;
- the API reference defines request and response contracts;
- architecture documents define implementation boundaries;
- ADRs resolve decisions that are expensive to reverse.

This FRD is the feature baseline, not proof that implementation has started or
finished. Every complex implementation slice must reference its FRD IDs, turn
the selected behavior into identified EARS acceptance criteria, and follow the
paired `spec -> plan -> implement -> done`
[requirements workflow](./engineering/requirements-workflow.md).

If requirements conflict, security invariants and accepted ADRs take precedence;
the PRD owns product scope and this document must be updated to match it.

## 2. Product boundary

Titen stores evidence, derives memory, compiles authorized context, and records
bounded coordination state. It does not select agents, run model loops, schedule
workflows, or execute tools.

```text
Agent runtime
    |
    | remember / context / checkpoint / handoff
    v
Titen
    |-- evidence and claims
    |-- context compilation and feedback
    |-- identity, visibility, and policy
    |-- approved channel knowledge releases
    |-- checkpoints, leases, and handoffs
    `-- optional progressive operator dashboard, beginning with Memory Atlas
```

The minimum useful path must work without an LLM or vector database.

## 3. Release feature map

| Release | Required feature set                                                                                                                                                                                  | Gate                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| P0      | dual-runtime contract, health, scoped authentication/project resolution, observations, direct claims, context compilation, feedback, FTS-only retrieval                                               | the same fixture passes on Worker/D1 and Bun/SQLite                                |
| v0.1    | complete Level 5 kernel, caller-supplied consolidation, temporal/conflict lifecycle, evidence inspection, private checkpoints, API-key lifecycle, export/import                                      | one agent can remember, verify, resume, and move its data safely                   |
| v0.2    | identities and memberships, visibility, shared checkpoints, leases, handoffs, observer-specific claims, audit, stateless MCP, events/webhooks, read-only Memory Atlas, progressive dashboard boundary | two agents collaborate and operators diagnose memory without private-data leakage  |
| v0.3    | roles and policy, approvals, channel knowledge releases, retention/legal hold, identity boundary, audit/recovery, governance Atlas lenses                                                             | company and enterprise policy, release, channel-isolation, and recovery tests pass |
| v1      | signed federation event exchange                                                                                                                                                                      | authorized scopes exchange signed events without losing provenance or conflicts    |

No feature in a later release is required to implement an earlier gate.
Automatic model-assisted derivation/reflection is a separately gated optional
capability; its implementation does not change the `v0.1` caller-supplied claim
path or prove production extraction activation.

## 4. Actors and authority

### 4.1 Principal types

- **Human:** a person acting directly or through an approved client.
- **Agent:** an AI/software actor operating under a human or team policy.
- **Service:** non-agent automation such as an importer or deployment system.
- **Channel gateway:** a scoped service principal serving CRM, website,
  support, or partner interactions; it is never an anonymous Titen principal.
- **Administrator:** a human/service with explicit management capabilities.
- **Auditor:** a principal permitted to inspect selected audit metadata.

Human, agent, and service identities are distinct records. Every agent and
service receives its own labeled, revocable credential.

### 4.2 Authority rules

1. Organization, workspace, project, subject, and agent authority come from the
   authenticated principal and membership, never from trusted request fields.
2. Authorization filters candidate scopes before FTS or vector retrieval.
3. A foreign-tenant identifier returns a non-disclosing `404`.
4. Private memory is not eligible for another agent merely because it is
   semantically relevant.
5. Only an authorized tool/service identity may assert `verified` trust.
6. Procedural or organization-wide memory may require approval stronger than
   ordinary episodic memory.
7. Administrator access does not automatically inject private content into a
   team context pack.
8. Verified evidence is not externally releasable until an independent channel
   approval permits one exact claim version and audience.

P0 uses capabilities attached to scoped credentials. Named role bundles and
external identity mappings are added in v0.3; a policy language is not required.

## 5. Common functional rules

All features obey these rules:

- canonical records live in SQL; vectors and compiled views are rebuildable;
- memory content and model output are untrusted data, never instructions;
- mutations accept an `Idempotency-Key` where retry duplication is possible;
- external JSON uses `snake_case` and versioned envelopes;
- content, prompts, embeddings, credentials, and full private IDs are excluded
  from normal logs;
- timestamps keep occurrence, ingestion, validity, and record-history meanings
  separate;
- model/vector failure may degrade optional behavior but cannot turn a failed
  canonical write into success;
- no LLM may silently delete evidence, resolve a dispute, or declare consensus.
- no tag, similarity score, feedback label, model output, or trust value may
  publish memory without an explicit authorized channel release.
- no derived Memory Atlas view, layout, cluster, or summary may become
  canonical evidence, grant access, or publish a release.
- no dashboard area may become an interactive control or route before its
  backing contract, authorization, and EARS UI work item are complete;
  non-interactive reference-shell labels are not shipped navigation.
- complex work may not enter implementation without an active EARS work spec
  and paired plan.

## 6. Foundation features

### FND-001 — Dual-runtime external contract

**Release:** P0

Titen must expose the same HTTP behavior from Cloudflare Workers/D1 and
Bun/SQLite.

Required behavior:

- use the same request/response schemas, status codes, authorization semantics,
  idempotency behavior, and export format;
- keep runtime-specific bindings outside the domain core;
- run one shared contract suite against both adapters;
- report runtime capabilities without exposing credentials or internal paths;
- avoid requiring `nodejs_compat` in the Worker core.

Acceptance:

- the canonical observation-to-context fixture produces equivalent normalized
  responses on both runtimes;
- deliberate invalid, unauthorized, conflict, and degraded cases return the
  same error codes and envelope shape.

### FND-002 — Health, readiness, and capability reporting

**Release:** P0

Implemented P0 behavior:

- `GET /healthz` reports process liveness without sensitive details;
- `GET /readyz` checks migrations, canonical SQL, and signing-secret
  decryptability;
- readiness capability contract version 1 reports FTS, vector, embedding,
  extraction, background enrichment, background-repair freshness, and
  export/import state; the legacy `model` field aliases embedding for `0.3.x`;
- readiness performs no provider or vector-index network probe, persists the
  configured semantic fingerprint locally, and fails semantic readiness on
  invalid configuration, vector initialization failure, missing legacy
  fingerprint evidence, or fingerprint mismatch;
- responses include a non-secret request ID and deployed revision/build value.
- a transient optional embedding/vector/extraction outage is visible under its
  own capability while canonical FTS-only operation remains available.

Remaining proposed readiness extensions:

- when channel serving is enabled, readiness also checks release FTS schema and
  configured customer-assertion issuer/key references without exposing them;

Acceptance:

- a missing canonical database or pending incompatible migration fails ready;
- a disabled vector capability does not prevent observation and FTS context;
- health output contains no key, content, prompt, embedding, or private ID;
- a configured semantic mismatch returns `configured_error` with a fixed local
  diagnostic and no provider call on both runtime adapters.

### FND-003 — Scoped credential verification

**Release:** P0; lifecycle completed in v0.1

Required behavior:

- protected operations require `Authorization: Bearer <key>`;
- keys are high entropy, shown only at creation, hashed at rest, labeled, scoped,
  and revocable;
- bootstrap of the first owner credential is local/administrative and cannot be
  called as an open public endpoint;
- authentication derives the principal and permitted organization/scope;
- missing, invalid, expired, or revoked credentials return `401`;
- safe same-tenant authorization denial returns `403`; foreign-tenant resources
  return `404`.

Acceptance:

- changing an organization/project ID in the request cannot cross scope;
- revocation takes effect on the next request;
- raw keys never appear in SQL rows, logs, errors, health, audit, or exports.

Project scope behavior:

- a client may resolve a normalized, credential-free project reference to an
  opaque `project_id` under its authenticated organization;
- a hosted Git origin should normalize to lowercase `owner/repo` when
  unambiguous; local absolute paths are not shared project identifiers;
- resolution never creates membership, and creating a missing project requires
  an explicit capability;
- Titen never infers project scope from memory content or a model response.

## 7. Level 5 memory kernel

### MEM-001 — Append observations

**Release:** P0

An observation is immutable evidence received or verified by Titen.

Required input semantics:

- subject and optional project/agent/run scope;
- kind: user statement, tool result, imported source, decision, or system event;
- bounded content and content hash;
- source type and source reference;
- `occurred_at` when known; Titen assigns `ingested_at`;
- trust: `unverified`, `asserted`, `verified`, or `policy_approved`;
- visibility allowed by the authenticated principal.

Required behavior:

- append the observation, history entry, FTS row, and indexing outbox atomically;
- derive actor and tenant authority from authentication;
- never silently edit observation content;
- an idempotent retry returns the original result;
- equal content is not automatically treated as the same event;
- semantic indexing may remain pending without losing the canonical write;
- accept a bounded batch form with item-level client mutation IDs;
- caller-supplied tags, when enabled, are normalized and bounded but never
  alter scope, visibility, trust, or lifecycle authority;
- returned content is labeled as untrusted reference data.

Acceptance:

- a committed observation survives restart and is immediately FTS-searchable;
- an invalid trust assertion is rejected before write;
- SQL failure leaves no partial history, FTS, or outbox state;
- an embedding failure still returns canonical success with degraded metadata.

### MEM-002 — Materialize direct claims

**Release:** P0

A claim is a compact, temporal, disputable memory supported by evidence.

Required behavior:

- authorized callers may create deterministic claims without an LLM;
- a claim identifies kind, subject, optional observer, confidence, trust,
  `valid_from`, optional `valid_to`, and status;
- every ordinary claim has at least one authorized claim-source link;
- a source relation is `supports`, `contradicts`, or `qualifies`;
- supported initial kinds are `semantic_fact`, `episodic_event`, `preference`,
  `procedural`, `decision`, and `relationship`;
- claim creation cannot raise trust above its evidence or caller authority;
- version history and source links are retained when status changes.

Acceptance:

- every claim selected by P0 context can be traced to an observation;
- a source from another unauthorized scope is rejected without disclosure;
- creating a direct claim performs no model call.

### MEM-003 — Derive and reflect over memory

**Release:** Optional, independently activated

**Status:** Implemented and dual-runtime tested; disabled by default and not
production-activated before the locked evaluation and real runtime smokes.

The implemented `POST /v1/consolidations` path validates claims supplied by an
authorized caller and performs no model call. The optional automatic capability
uses separate asynchronous derivation and reflection jobs; it does not change
that route's acknowledgement semantics.

Required behavior:

- atomically enqueue one versioned derivation job with an accepted observation
  when automatic enrichment is enabled;
- skip work already completed for the same source set and pipeline fingerprint;
- lease work persistently with bounded attempts, timeout, backoff, concurrency,
  and output size;
- run deterministic eligibility and exact-duplicate rules before any model call;
- accept only bounded structured model proposals using supplied source/premise
  IDs and runtime claim/action enums;
- validate every proposed claim, action, and source link before committing it;
- preserve contradictory claims and mark disputes instead of overwriting;
- derive organization, subject, scope, maximum visibility, and trust ceiling
  from authentication and canonical evidence, not from a proposal;
- record provider/model, prompt, schema, and source-set fingerprints without
  storing credentials, raw prompts, or raw model output in operational logs;
  retain bounded input/output digests and committed result row IDs for audit;
  keep the proposal only in worker memory during validation so the job does not
  duplicate private claim content;
- expose extraction and background-enrichment pending/degraded state separately
  from embedding/vector state;
- use embeddings only to shortlist authorized duplicate or related claims;
- run reflection only over bounded authorized clusters and treat duplicate,
  conflict, pattern, procedure, and supersession outputs as proposals;
- never autonomously delete canonical evidence.

Activation gate:

- replaying the same direct consolidation or enrichment job is idempotent;
- malformed/model-hallucinated source IDs create no claims;
- model output cannot widen scope/trust/visibility, publish memory, or resolve a
  dispute;
- disabling enrichment leaves observations, direct claims, FTS, context, and
  claim lifecycle paths functional;
- a valid no-memory decision marks its job complete without creating a claim or
  retry loop;
- the same captured provider responses produce equivalent validated results on
  D1 and SQLite.

### MEM-004 — Claim lifecycle and conflict resolution

**Release:** v0.1

Supported statuses are `active`, `disputed`, `superseded`, `expired`, and
`revoked`.

Required behavior:

- contradictory claims coexist and expose their evidence;
- supersession names the prior claim and the evidence or authority for change;
- expiration follows validity time without deleting history;
- revocation records actor, reason code, and timestamp;
- an authorized resolution records the chosen status transition and evidence or
  policy authority;
- observer-specific opinions remain scoped to that observer;
- lifecycle changes invalidate or repair stale vector projections.

Acceptance:

- unresolved contradictions appear in relevant context packs;
- a superseded/revoked claim cannot be revived by a stale vector hit;
- no lifecycle transition mutates its source observation.

### MEM-005 — Inspect claim evidence and history

**Release:** v0.1

Required behavior:

- `GET /v1/claims/:id/evidence` returns an authorized claim plus supporting,
  contradicting, and qualifying observations;
- return claim versions and lifecycle metadata without leaking inaccessible
  source content;
- indicate when a source exists but is not visible to the caller without
  disclosing foreign-tenant existence;
- preserve stable record IDs in authorized audit/export flows.

Acceptance:

- a caller can explain every returned claim using visible evidence;
- a caller without evidence permission cannot infer its content or tenant.

## 8. Retrieval and context features

### RET-001 — FTS-first retrieval with optional vectors

**Release:** P0

Required behavior:

- apply tenant, membership, subject, scope, visibility, status, and temporal
  eligibility before ranking;
- always support bounded SQLite FTS5 candidate retrieval;
- optionally add vector candidates when a valid capability is enabled;
- hydrate canonical SQL rows and reject missing, stale, revoked, or expired IDs;
- expose normalized score components without promising a stable raw provider
  score;
- bound candidate counts and canonical hydration;
- repair vector mutations from a durable outbox.

Current implementation note: adapters carry an immutable model revision, named
role-aware input profile, dimensions, and operator-calibrated cosine floor. Bun
HTTP and Cloudflare Workers AI share the exact query/document transforms, unit
normalization, and validation for output cardinality, ordered provider indices
when present, dense dimensions, and finite numeric coordinates. Sub-threshold
IDs are discarded before canonical hydration. Titen persists and compares that
semantic contract before exposing vector retrieval.

Implemented compatibility requirements:

- persist provider/model, dimensions, distance metric, normalization,
  preprocessing/template, and semantic-unit schema as a versioned fingerprint;
- compare that fingerprint with the configured index before declaring semantic
  readiness or running indexing/querying.
- reject a best available vector neighbor when its absolute cosine falls below
  the fingerprinted model/profile calibration policy.

Acceptance:

- FTS-only mode returns relevant results without a model/vector service;
- vector outage cannot lose writes or bypass authorization;
- stale vector records never return canonical content;
- the fingerprint mismatch gate passes on both runtime adapters.

### CTX-001 — Compile a bounded context pack

**Release:** P0

Required input:

- authenticated actor;
- task/query;
- permitted subject scope plus a concrete project, unscoped-only omission, or
  explicitly capability-gated cross-project mode;
- positive maximum token budget;
- optional request to include eligible checkpoints.

Required output:

- stable `context_id`;
- requested and used token budget;
- selected claims with kind, trust, confidence, validity, status, and evidence
  IDs;
- unresolved conflicts and qualifying evidence;
- score components and degraded capability metadata;
- effective project mode and the capability-backed reason for broad access;
- explicit instruction that every item is untrusted reference data.

Required behavior:

- filter policy before lexical/vector retrieval;
- treat omitted project scope as canonical `project_id IS NULL`; require
  `context:compile:all` and an explicit request before removing that project
  predicate;
- rank eligible claims using task relevance, trust, temporal validity, utility,
  diversity, conflict coverage, and checkpoint relevance;
- pack deterministically under the token budget;
- never truncate an item into misleading content;
- return a successful empty context when no eligible memory is relevant;
- record selected IDs and policy snapshot reference, not the raw prompt by
  default.

Acceptance:

- output never exceeds the requested deterministic budget;
- another agent's private memory is excluded;
- relevant unresolved conflict is visible rather than silently resolved;
- repeated compilation against unchanged state is explainably stable.

### CTX-002 — Record context outcome feedback

**Release:** P0

Supported labels are `used`, `useful`, `irrelevant`, `incorrect`, and `harmful`.

Required behavior:

- attach feedback to a context run or selected item;
- record actor, outcome, timestamp, and optional bounded reason code/metadata;
- make retries idempotent;
- never mutate observations, evidence links, trust, or authorization;
- use aggregated feedback as a bounded ranking signal only after a defined
  minimum evidence threshold;
- preserve negative feedback for evaluation even if a claim is later revoked.

Acceptance:

- incorrect/harmful feedback cannot delete evidence or bypass approval;
- unauthorized actors cannot submit feedback for inaccessible context;
- evaluation can calculate usefulness and harmful-context rates.

## 9. Private execution state

### EXE-001 — Private resumable checkpoints

**Release:** v0.1

A checkpoint stores progress, not durable truth.

Required behavior:

- create a private checkpoint for a bounded work item;
- store owner, scope, status, monotonic version, bounded state payload, TTL,
  timestamps, and optional result observation IDs;
- update only when the expected version matches;
- return `409` for a stale version;
- exclude expired checkpoints from context by default;
- retain checkpoint history according to policy;
- require completed findings to become observations before supporting claims.

Acceptance:

- a checkpoint can resume after process restart;
- concurrent stale updates cannot silently overwrite progress;
- checkpoint content never appears as a verified fact by itself.

Shared checkpoint visibility, leases, and handoffs are v0.2 features.

## 10. Portability and key lifecycle

### IAM-001 — API-key lifecycle

**Release:** v0.1

Required behavior:

- an authorized owner/admin can create, label, scope, list, rotate, and revoke
  human/agent/service keys;
- secret material is displayed once; listings return only identifier, label,
  scope, status, created time, and last-used metadata;
- rotation can overlap old/new keys for an explicit bounded window;
- keys cannot grant capabilities the issuer does not possess;
- audit metadata records creation, rotation, and revocation without the key.

Acceptance:

- separately scoped agent keys cannot read each other's private records;
- revocation and rotation survive restart and export excludes secrets.

### POR-001 — Versioned JSONL export/import

**Release:** v0.1

Required behavior:

- stream canonical records in a documented, versioned JSONL format;
- exclude credentials, vectors, model secrets, and transient compiled content by
  default;
- include record IDs, scope, provenance, lifecycle, timestamps, and version;
- support validation/dry-run before mutation;
- make import idempotent and reject unknown incompatible versions;
- require explicit authorized destination scope mapping;
- rebuild FTS and enqueue optional vector re-indexing using the destination's
  configured embedder and verified destination fingerprint;
- preserve conflicts and history rather than last-write-wins replacement;
- when v0.3 channel schemas are enabled, export channel/release snapshots and
  lifecycle history but no gateway credential or assertion-verification secret;
  imported releases remain suspended until an authorized operator rebinds and
  verifies channel, gateway, approval-policy, and assertion-issuer references.

Acceptance:

- restoring/importing an active release cannot make it externally eligible
  before destination-specific channel security bindings pass validation;
- Cloudflare-to-VPS and VPS-to-Cloudflare round trips preserve canonical
  normalized records;
- importing the same export twice creates no duplicate canonical records;
- a crafted export cannot escape the authenticated destination scope.

## 11. Level 6 collaboration features

### IAM-002 — Identities, memberships, and scopes

**Release:** v0.2

Required behavior:

- represent organization, workspace, project, human, agent, and service records;
- attach memberships/capabilities at the narrowest useful scope;
- distinguish actor, subject, observer, and agent on memory records;
- disable an identity without deleting its authored evidence;
- prevent shared credentials from substituting for membership;
- keep personal mode simple by provisioning one internal organization/workspace.

Acceptance:

- removal from a team stops new team-context access immediately;
- authored records retain non-secret provenance after identity disablement;
- project membership does not imply organization-memory write authority.

### VIS-001 — Private, team, and organization visibility

**Release:** v0.2

Required behavior:

- support `private`, `team`, and `organization` visibility;
- default personal/agent memory to private;
- require explicit sharing or an authorized policy result to widen visibility;
- record visibility changes and actor in history/audit;
- prevent lowering a high-trust procedure's required write/approval authority;
- exclude public/internet visibility from the canonical memory model; governed
  external distribution uses channel releases instead.

Acceptance:

- semantic similarity cannot make private content team-visible;
- widening and narrowing visibility take effect before the next retrieval;
- organization-visible writes require stronger authority than ordinary private
  episodic writes.

### COL-001 — Shared versioned checkpoints

**Release:** v0.2

Required behavior:

- allow authorized team members/agents to observe and update shared checkpoints;
- preserve the private checkpoint rules from EXE-001;
- use optimistic version checks and append update history;
- identify current owner/responsible party separately from record creator;
- include only relevant, unexpired shared checkpoints in team context.

Acceptance:

- two concurrent writers cannot silently overwrite each other;
- private checkpoint payloads remain excluded from teammates.

### COL-002 — Idempotent work leases

**Release:** v0.2

A lease is temporary ownership of a bounded work key, not a task scheduler.

Required behavior:

- acquire, renew, and release a lease using work key, actor, TTL, and
  idempotency key;
- return the same lease for an idempotent retry by the same actor;
- return `409` with non-sensitive metadata for an active competing lease;
- make expired work available without deleting checkpoint history;
- enforce bounded TTL and renewal authority;
- release or mark the lease completed when its linked work completes.

Acceptance:

- two agents cannot simultaneously acquire the same active work key;
- process restart does not extend or lose the lease incorrectly;
- expiry never converts unfinished progress into a fact.

### COL-003 — Explicit handoffs

**Release:** v0.2

Required behavior:

- offer a handoff to a principal or authorized team;
- reference a checkpoint, visible evidence, expected next action, and sender;
- support `offered`, `accepted`, `declined`, `completed`, and `cancelled` states;
- require the recipient to accept before responsibility changes;
- retain lifecycle timestamps and actors;
- reject handoffs that expose evidence unavailable to the recipient;
- make retries idempotent.

Acceptance:

- an accepted handoff lets the recipient resume from the referenced checkpoint;
- declining/cancelling does not destroy source progress;
- completion links durable findings through observation IDs.

### COL-004 — Observer-specific claims and disagreement

**Release:** v0.2

Required behavior:

- store the observer when a claim represents a perspective;
- keep observer-specific opinions separate from shared verified facts;
- preserve conflicting perspectives until evidence or authorized resolution;
- compile the actor's own eligible perspective plus permitted shared memory;
- never let an LLM silently turn majority agreement into canonical truth.

Acceptance:

- two agents may hold different claims about one subject without overwriting;
- each agent receives only the perspectives it is authorized to inspect;
- an authorized resolution preserves both prior claims and its authority trail.

### AUD-001 — Metadata-only audit trail

**Release:** v0.2

Required behavior:

- record authentication/key lifecycle, memory creation/status, visibility,
  policy decisions, denied access, context selection IDs, feedback, checkpoint,
  lease, handoff, export/import, and administrative operations;
- include actor, action, resource type/ID reference, scope, result, timestamp, and
  request ID;
- avoid copying content, prompts, embeddings, credentials, or full private IDs;
- provide authorized cursor pagination;
- make audit retention independently configurable in v0.3.

Acceptance:

- a company collaboration journey can be reconstructed without reading memory
  content from the audit log;
- an auditor cannot use audit access to retrieve private content.

### MCP-001 — Stateless agent tools and lifecycle adapters

**Release:** v0.2

Required behavior:

- expose a small default tool set for context, remember, feedback, checkpoint,
  lease, and handoff;
- reuse the same HTTP/domain authorization and validation paths;
- carry no durable agent session state inside the MCP process;
- return structured provenance and degraded metadata;
- support Streamable HTTP at `/mcp` and retain REST as the universal fallback;
- let thin host adapters map task/session/tool/finish events without owning
  memory policy;
- recall once per task/scope boundary by default, not before every tool call;
- capture typed durable signals rather than whole transcripts or routine tool
  output;
- keep hook work bounded and prevent a hook from recursively observing its own
  Titen operation;
- never embed credentials in tool descriptions, resources, or logs.

Acceptance:

- REST and MCP operations produce equivalent authorized domain results;
- disconnecting/restarting MCP loses no canonical state;
- each supported host adapter passes the same resolve, context, remember,
  checkpoint, lease, handoff, feedback, and reconnect fixture.

### EVT-001 — Durable orchestration events and signed webhooks

**Release:** v0.2

Required behavior:

- append a metadata-only domain event in the same canonical transaction as each
  subscribed state transition;
- deliver webhooks asynchronously after canonical acknowledgement;
- support explicit event-type and organization/workspace/project subscription
  scope;
- sign each bounded request and include a timestamp plus opaque event ID for
  replay protection and receiver idempotency;
- allowlist destinations, reject credential-bearing URLs, and prevent SSRF;
- retry transient failures with bounded jittered backoff and retain terminal
  failure metadata;
- exclude memory content by default and require an explicit stronger capability
  before content delivery;
- provide cursor-based metadata event polling for orchestrators that cannot
  receive inbound webhooks;
- never infer a destination from memory, tags, or model output.

Acceptance:

- a failed or slow destination cannot delay or roll back a canonical write;
- replaying one delivery creates no duplicate receiver action in the reference
  orchestrator fixture;
- deleting/pausing a subscription stops future delivery without deleting the
  source event or memory;
- webhook and delivery logs contain no credential, prompt, embedding, or memory
  content.

### OBS-001 — Memory Atlas authorized views

**Release:** v0.2; governance lenses extend it in v0.3

Required behavior:

- expose one authenticated, read-only REST view compiler while keeping the six
  ordinary-agent MCP tools unchanged;
- support `evidence_trace`, `memory_neighborhood`, and `conflict_freshness` in
  v0.2, then `scope_preview` and `knowledge_release` in v0.3;
- derive every node, edge, label, count, summary, cluster, and layout from
  authorized canonical SQL records without adding canonical graph tables;
- authorize candidates before traversal, authorize both endpoints of every
  edge, and recheck lifecycle/version/visibility/release state at hydration;
- bound traversal depth, nodes, edges, labels, execution time, and response
  bytes, and return explicit authorized-only truncation/degraded metadata;
- keep cache entries principal- and policy-scoped and prevent hidden topology,
  existence, or counts from crossing an authorization boundary;
- preserve the complete headless REST/MCP contract when Atlas or its renderer
  is disabled or unavailable;
- use the same view contract on Cloudflare and VPS with no graph database,
  renderer, or dashboard dependency in the memory kernel.

Acceptance (EARS):

- **AC-ATLAS-001 — Ubiquitous:** Titen shall treat every Memory Atlas graph, trace, layout, cluster, and summary as a derived projection of authorized canonical SQL records rather than canonical memory.
- **AC-ATLAS-002 — Event-driven:** When an authorized principal compiles a Memory Atlas view, Titen shall return a bounded graph containing only nodes, edges, labels, counts, and provenance that the principal may inspect.
- **AC-ATLAS-003 — Unwanted behavior:** If a requested node, edge endpoint, scope, audience, or customer subject is unauthorized, then Titen shall omit it without revealing its content, label, relationship, or existence through aggregate counts.
- **AC-ATLAS-004 — State-driven:** While a cache, layout, vector hit, or community assignment is stale, Titen shall re-authorize canonical records during hydration and shall exclude revoked, expired, superseded, disputed-ineligible, or otherwise hidden data.
- **AC-ATLAS-005 — Optional feature:** Where Memory Atlas is disabled or its renderer is unavailable, Titen shall preserve the complete headless REST/MCP memory, collaboration, and channel-serving contract.
- **AC-ATLAS-006 — Optional feature:** Where v0.3 governance lenses are enabled, Titen shall require explicit impersonation-preview or release-inspection authority and shall never let preview grant access to the selected principal or audience.
- **AC-ATLAS-007 — Unwanted behavior:** If a view exceeds configured traversal or response limits, then Titen shall truncate only after authorization, report bounded authorized-result metadata, and avoid unbounded traversal or layout work.
- **AC-ATLAS-008 — Ubiquitous:** Titen shall keep Memory Atlas in the same repository behind a separate integration boundary, shall expose it through authenticated REST rather than ordinary-agent MCP, and shall require no dashboard dependency in the memory kernel.

### OPS-002 — Opinionated operator queues

**Release:** the read-only reviewer queue ships as a Memory Atlas lens in v0.2;
operations and publication queues remain specified but unimplemented.

Queues are authorized projections over canonical records, not new canonical
workflow state. No queue may create a generic task row, infer an owner, or make
a lifecycle/publication decision. The dashboard and headless clients consume
the same bounded projection.

Every queue item uses this common schema:

| Field | Contract |
| --- | --- |
| `id` / `type` | Canonical resource identifier and type. |
| `status` | Current canonical lifecycle state; never a parallel queue status. |
| `priority` / `reasons` | Deterministic server-computed rank and explicit eligibility reasons. |
| `owner_id` | Canonical actor/assignee/holder/approver field; never model-inferred. |
| `next_action` | One informational action from a bounded enum; it grants no authority. |
| `deadline` | Existing expiry/validity/retry timestamp or `null`. |
| `terminal_state` | Existing terminal lifecycle state or `null`; no queue-only terminal state. |
| `evidence_refs` / `audit_refs` | Opaque references authorized for this caller; never hidden IDs or counts. |

The implemented `review_queue` lens selects an authorized claim when its
canonical status is `disputed`, it has an authorized contradicting source, its
confidence is below `0.7`, or it has `incorrect`/`harmful` context feedback.
Priority is stable and testable: harmful feedback (`4`), disputed or authorized
contradiction (`3`), incorrect feedback (`2`), then low confidence (`1`), with
ties ordered by confidence ascending, creation time ascending, and claim ID
ascending. It supports the stable `review_reason`, `subject_id`, and `owner_id`
filters plus an opaque keyset cursor. Authorization and filters execute before
window counts and `LIMIT`.

Reviewer state transitions reuse claim lifecycle only:

```text
active/disputed and eligible -> review_queue projection
review_queue projection --supersede--> superseded (terminal, omitted)
review_queue projection --expire-----> expired (terminal, omitted)
review_queue projection --revoke-----> revoked (terminal, omitted)
active no longer eligible ------------> omitted on next compile
```

The planned operations queue is a union of typed projections, not one generic
table: handoff (`pending -> accepted|rejected|expired`), lease
(`active -> released|expired`), checkpoint (`active -> expired|deleted`), and
webhook delivery (`pending -> success|failed`). Owners come respectively from
`to_principal`, `holder_id`, `agent_id`, and the subscription principal;
deadlines come from existing expiry or retry columns. Each subtype retains its
own transition endpoint and authorization policy.

The planned publication queue projects a future governed release snapshot with
channel, audience, source version, approver, disclosure-risk reasons, validity,
and authorized evidence/audit references. Its specified transition is
`draft -> approved -> active -> suspended|replaced|expired|revoked`; activation
requires the separately specified approval and signed channel/audience gates.
No publication queue route ships until those gates and their adversarial tests
exist.

Acceptance (EARS):

- **AC-OPS-009 — Ubiquitous:** Titen shall compute queue eligibility, filters,
  counts, and limits only from records authorized for the caller.
- **AC-OPS-010 — Event-driven:** When a caller advances a keyset cursor, Titen
  shall preserve deterministic ordering without duplicating or skipping an
  unchanged eligible item.
- **AC-OPS-011 — Unwanted behavior:** If evidence or audit provenance is not
  authorized, then a queue item shall omit its identifiers and any hidden count.
- **AC-OPS-012 — State-driven:** While a canonical item is terminal or no longer
  eligible, it shall be absent on the next projection without a queue mutation.

### UI-001 — Progressive dashboard information architecture

**Release:** Memory Atlas is live through the same-origin adapter; later areas
follow their backing feature release and a separate completed UI work item

The canonical area map is defined in [DESIGN](./DESIGN.md). It groups operator
jobs without claiming that every planned area is implemented:

- Memory: Atlas, Memories, and Context;
- Collaboration: Work;
- Operations: Audit & Events and System;
- Administration: Access;
- Governance: Approvals & Releases.

Required behavior:

- keep the dashboard optional and consume only authenticated REST contracts;
- render Memory Atlas as the only active route in the reference shell, using
  only same-origin health, readiness, and authorized view compiler responses;
- allow the approved shell to show the canonical area map as non-interactive
  orientation without implying those labels have routes or backend behavior;
- add a later area only after its backend behavior is implemented, the current
  build reports it available, the principal may discover it, and its paired
  EARS UI work item is complete;
- expose no route or interactive control for unavailable areas and never render
  their orientation labels as placeholders, locks, disabled controls, upgrade
  badges, or shipped menus;
- authorize every route and request independently from navigation state and
  return a non-disclosing response for foreign resources;
- keep categories and tags as Memory filters, webhooks inside Audit & Events,
  export/import and recovery inside System, and runtime configuration read-only
  until a mutation contract exists;
- omit Settings until a browser account/session, profile, or password lifecycle
  is explicitly specified;
- keep read-only diagnosis visibly distinct from key, approval, release,
  retention, or recovery mutations;
- use the same built client and external behavior on Cloudflare and VPS, while
  leaving headless REST/MCP complete when the client is disabled.

Acceptance (EARS):

- **AC-UI-001 — State-driven:** While a dashboard area lacks an implemented authorized backend contract or completed EARS UI work item, Titen shall expose no route or interactive control for it and shall keep any approved reference-shell label non-interactive.
- **AC-UI-002 — Optional feature:** Where the final reference shell is enabled, Titen shall render Memory Atlas as the sole active product area and may show the canonical area map only as non-interactive orientation.
- **AC-UI-003 — Event-driven:** When an area passes its emergence gate, Titen shall convert only that authorized discoverable area into an interactive control and route under the canonical DESIGN group.
- **AC-UI-004 — Unwanted behavior:** If a principal requests an unauthorized or foreign dashboard route or resource, then Titen shall return a non-disclosing state and shall clear prior private content that could be mistaken for the requested result.
- **AC-UI-005 — Ubiquitous:** Titen shall keep categories and tags as Memory filters, webhooks inside Audit & Events, portability and recovery inside System, and Settings absent until an account/session contract exists.
- **AC-UI-006 — State-driven:** While runtime configuration lacks an authorized mutation contract, Titen shall expose configuration only as non-secret read-only capability and readiness state.
- **AC-UI-007 — Optional feature:** Where the dashboard is disabled or omitted, Titen shall preserve complete authorized REST/MCP behavior on Cloudflare and VPS.
- **AC-UI-008 — Unwanted behavior:** If documentation or a reference-shell label names a dashboard area whose emergence gate has not passed, then Titen shall not present that area as a shipped route, control, or implementation claim.

## 12. Enterprise governance features

### GOV-001 — Roles and policy enforcement

**Release:** v0.3

Required behavior:

- bundle capabilities into organization/workspace/project roles;
- evaluate actor, action, resource scope, visibility, memory kind, and trust;
- support explicit stronger controls for procedural and organization memory;
- record allow/deny policy decisions by policy version/reference;
- fail closed when policy state is unavailable or invalid;
- provide a stable external identity mapping boundary without requiring one SSO
  vendor in the kernel.

Acceptance:

- role changes take effect before retrieval/write;
- a writer cannot self-promote or approve its own restricted memory unless
  policy explicitly permits it;
- policy failure never falls back to permissive search.

### GOV-002 — Approval workflow for high-trust memory

**Release:** v0.3

Required behavior:

- submit procedural/organization claims for approval;
- approve, reject, revoke, or request replacement with actor and reason;
- require visible supporting evidence;
- prevent pending/rejected claims from appearing as policy-approved context;
- keep approval lifecycle separate from evidence content.

Acceptance:

- only an authorized approver can assign `policy_approved` trust;
- revocation removes future eligibility while preserving evidence/history.

### REL-001 — Governed channel knowledge releases

**Release:** v0.3

A knowledge release is an approved external-serving snapshot, not a fourth
canonical memory visibility level.

Required behavior:

- keep evidence `trust`, internal `visibility`, and external release eligibility
  as independent policy inputs;
- define operator-managed channels scoped to an organization and gateway
  service principal;
- list and pause/disable channels without exposing gateway credentials or
  assertion-verification key material; a disabled channel makes every release
  ineligible before the next compile;
- support initial audiences `anonymous`, `authenticated_customer`, and
  `partner`;
- create a draft release from one exact active claim version with bounded
  proposed content, channel, audience, optional locale/product metadata,
  validity window, proposal actor/reason, and status;
- allow approved content to be redacted, summarized, or localized without
  mutating the source claim;
- require a configured minimum claim trust and an independent release approval;
  `verified` alone never makes a claim publishable;
- record the exact reviewed snapshot/hash, approval actor/reason, approval time,
  and expected version before activation;
- activate or revoke releases explicitly; suspend or expire them through
  canonical eligibility rules, and replace them by approving a new immutable
  row while preserving history, audit, and post-commit domain events;
- make a release immediately ineligible when its exact source claim version is
  no longer current and active or becomes disputed, superseded, expired, or
  revoked; record `suspended` state asynchronously if needed, but never wait for
  that state write to deny channel retrieval;
- compile channel context only for an authenticated gateway and only from active
  releases matching its channel, audience, validity, and policy;
- resolve an authenticated customer subject from trusted gateway/session
  identity rather than an arbitrary public request field; the channel contract
  uses a short-lived signed assertion with issuer, channel/audience, expiry, and
  replay validation;
- keep customer-specific memory separate from release indexes and exclude it
  from anonymous, partner, and other-customer context;
- expose released citations/provenance without exposing private source content
  or internal evidence the audience cannot inspect;
- keep release FTS/vector indexes rebuildable from canonical release rows and
  re-authorize/hydrate every vector result;
- treat live balances, inventory, payment state, and order status as source-tool
  data rather than durable public memory unless an explicit bounded snapshot is
  intended.

Acceptance:

- a verified but unreleased claim never enters channel context;
- a release for one channel/audience is absent from every other unauthorized
  channel/audience;
- anonymous requests cannot select a customer subject;
- invalid, expired, replayed, wrong-channel, or wrong-audience customer
  assertions expose no subject or memory;
- Customer A cannot retrieve Customer B memory through IDs, similarity,
  aliases, cache keys, or released citations;
- activation and revocation affect eligibility before the next context compile,
  while stale vector/cache entries are rejected during canonical hydration;
- a source claim version or lifecycle change suspends release eligibility before
  the next compile and requires a new approval before reactivation;
- replacing a release preserves the prior released snapshot and audit history;
- disabling a channel suppresses all of its releases without deleting them;
- model/vector failure may degrade to authorized release FTS but cannot widen
  eligibility or expose canonical internal memory.

### GOV-003 — Retention and legal hold

**Release:** v0.3

Required behavior:

- assign retention policy by authorized scope and record type;
- place/release legal holds with explicit authority and audit;
- prevent purge while a legal hold applies;
- expire retrieval eligibility separately from physical purge;
- require explicit administrative purge tooling, exact scope, and backup/impact
  confirmation;
- never use retention as silent claim rewriting.

Acceptance:

- held records survive retention expiry;
- expired records are not recalled unless explicitly authorized;
- purge cannot target a broader scope than the authenticated operation.

### OPS-001 — Audit export, backup, restore, and recovery drill

**Release:** v0.3

Required behavior:

- export authorized metadata-only audit ranges;
- create canonical backups without depending on vector projections;
- restore into a new D1/SQLite destination before cutover;
- verify integrity, migrations, scopes, provenance, FTS, and outbox;
- rebuild optional vectors with the destination's configured embedder and, once
  implemented, its verified fingerprint;
- document and test rollback/recovery procedures on both runtimes.

Acceptance:

- a restored instance passes the same protected observation/context fixture;
- backup and audit export contain no credentials or embeddings;
- a failed restore cannot overwrite the currently active canonical store.

## 13. Signed federation event exchange and planned memory federation

The current feature boundary is signed, filtered event transport. Remote events
do not become destination canonical claims, indexes, or recallable context by
virtue of exchange. Canonical recallable-memory federation is planned and must
define destination ingestion, authorization, lifecycle, and recall separately.

### FED-001 — Governed event exchange

**Release:** v1, only after a demonstrated multi-node requirement

Required behavior:

- exchange append-only authorized events by scope and replication cursor;
- apply source policy before transmission and destination policy before use;
- preserve source node, actor reference, timestamps, record version, and
  integrity hash/signature;
- never replicate credentials;
- preserve concurrent/conflicting claims instead of last-write-wins;
- allow a scope to stop future sharing without corrupting received history;
- retry idempotently and expose replication lag/failure metadata.

Acceptance:

- two deployments exchange an allowed scope and reject a denied scope;
- replay creates no duplicates;
- network partition preserves both local histories and exposes unresolved
  conflicts after reconnect.

CRDTs, consensus services, and global strong consistency are not requirements
until measured concurrent/offline mutation cases prove they are necessary.

## 14. Common errors and edge behavior

| Condition                                     | Required behavior                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| invalid request                               | `400` with stable validation code and no sensitive echo                                |
| missing/invalid/revoked key                   | `401`                                                                                  |
| safe same-tenant denial                       | `403`                                                                                  |
| foreign tenant/resource                       | non-disclosing `404`                                                                   |
| stale checkpoint version                      | `409`                                                                                  |
| active competing lease                        | `409` with non-sensitive lease metadata                                                |
| duplicate idempotency key, same payload       | return original result                                                                 |
| duplicate idempotency key, different payload  | `409`                                                                                  |
| embedding/vector unavailable                  | canonical path succeeds where possible and reports semantic degradation                |
| optional extraction/background enrichment unavailable | canonical path succeeds; retain bounded work and report extraction degradation |
| webhook destination unavailable               | canonical path succeeds; delivery retries or terminates visibly                        |
| release is pending/revoked/expired/ineligible | omit or return non-disclosing `404`; never fall back to source claim                   |
| stale release claim version                   | `409`; require a new reviewed release snapshot                                         |
| invalid/expired/replayed customer assertion   | generic `403`; resolve/disclose no customer subject                                    |
| channel vector index unavailable              | use authorized release FTS and report degraded capability                              |
| unauthorized Atlas focus/scope                | non-disclosing `404`; return no hidden node, edge, label, or count                     |
| Atlas limit reached                           | return a bounded authorized view with explicit `truncated=true`                        |
| stale Atlas cache/index                       | re-authorize canonical hydration; omit newly ineligible records                        |
| unavailable dashboard area or direct route    | optional plain shell label; no control/route; direct request gets non-disclosing `404` |
| canonical SQL unavailable                     | fail; never claim a write succeeded                                                    |
| token budget too small for any item           | successful empty context with budget metadata                                          |
| unsupported export version                    | reject before mutation                                                                 |

## 15. Acceptance journeys

### Journey A — Personal Level 5 memory

1. Bootstrap an owner and one private agent credential.
2. Resolve one stable project reference without granting new membership.
3. Append an asserted observation and a verified tool-result observation.
4. Create an evidence-linked deterministic claim.
5. Compile context under a token budget with vectors disabled.
6. Inspect the claim's evidence and submit usefulness feedback.
7. Create/update a private checkpoint and restart the service.
8. Resume the checkpoint and recompile context without data loss.
9. Export, import into the other runtime, and compare canonical records.

Pass conditions:

- no unauthorized data is returned;
- every claim traces to evidence;
- budget and FTS-only operation hold;
- feedback and checkpoint state survive restart;
- cross-runtime round trip is idempotent.

### Journey B — Company multi-agent collaboration

1. Create two separately credentialed agents in one project.
2. Store private memory for each and shared project evidence.
3. Confirm neither agent can retrieve the other's private memory.
4. Create separate shared checkpoints.
5. Race both agents for one work lease; exactly one succeeds.
6. Hand off the winning checkpoint and visible evidence to the other agent.
7. Accept, resume, produce a result observation, and complete the handoff.
8. Deliver the handoff/completion events to a signed reference webhook and
   replay one event safely.
9. Preserve and expose two observer-specific conflicting claims.
10. Reconstruct the flow from metadata-only audit events.
11. Compile Evidence Trace, Memory Neighborhood, and Conflict & Freshness views
    for visible records, then probe each with a foreign/private record ID.
12. Open the live dashboard, compile an authorized Atlas view, and confirm
    Atlas is the only active product area; other approved shell labels are
    plain, non-interactive orientation with no route or shipped-capability
    treatment.

Pass conditions:

- no duplicate active lease or silent checkpoint overwrite;
- no private-memory leak;
- handoff preserves context and responsibility history;
- webhook failure/replay cannot lose or duplicate canonical state;
- disagreement is not silently merged;
- audit contains no memory content or credential.
- Atlas returns useful authorized provenance without leaking hidden topology or
  aggregate counts; disabling it does not affect the journey.
- dashboard navigation exposes no unshipped route or unauthorized scope.

### Journey C — Enterprise governance and recovery

1. Assign scoped roles and a high-trust approval requirement.
2. Submit, approve, retrieve, and revoke a procedural claim.
3. Release one exact approved claim version to an anonymous CRM channel.
4. Confirm an unreleased internal claim and another customer's memory are absent.
5. Revoke the release and verify it is absent from the next channel context.
6. Apply retention and legal hold to selected evidence.
7. Export audit metadata and create a canonical backup.
8. Restore into a new destination and rebuild projections.
9. Re-run authorization, provenance, channel, context, and recovery smoke tests.
10. Use Scope Preview and Knowledge Release lenses to inspect eligibility and
    release state without granting the previewed principal any access.
11. Expose Approvals & Releases only after its governance UI work item passes,
    and confirm direct access remains independently authorized.

Pass conditions:

- unauthorized approval and purge fail closed;
- verified-but-unreleased and cross-customer content never reaches a channel;
- release revocation takes effect before the next channel context;
- legal hold wins over retention expiry;
- revoked procedure no longer enters context;
- restored canonical data and provenance match the source.
- preview and release views expose only authorized policy results and never
  convert verification into publication.
- governance navigation is absent before its emergence gate and grants no
  authority after it appears.

## 16. Quality and success measures

Each tagged release publishes measurements appropriate to its features:

- retrieval: Recall@5, MRR, precision, multilingual cases, and no-result quality;
- trust: context claims with valid evidence and temporal fields;
- security: unauthorized/cross-visibility test pass rate and poisoning cases;
- channel serving: unauthorized-release and cross-customer leakage count,
  activation/revocation lag, released-citation coverage, and useful-answer rate;
- collaboration: duplicate-work, lease-conflict, successful-handoff, and stale
  checkpoint rates;
- operations: p50/p95 latency, outbox age, degraded recall, CPU, memory, storage,
  and model cost;
- integration: hook overhead, calls/bytes per task, semantic-ready lag, webhook
  delivery lag, orchestration wake time, and dropped/duplicate mutations;
- operator observability: authorized evidence-trace coverage, zero hidden
  topology/count leakage, view-compile p50/p95, truncation, and diagnosis
  success/time;
- dashboard usability: task completion, navigation error, unauthorized route
  leakage, and time to identify evidence, context, or work state;
- portability: normalized round-trip success across Cloudflare and VPS;
- footprint: compressed Worker target below 1 MiB and VPS idle RSS target below
  100 MiB, excluding model runtimes.

Measurements must state dataset, runtime, enabled capabilities, model/embedder,
and token/retrieval budget. A benchmark result without that context is not a
release claim.

## 17. PRD traceability

| PRD requirement           | FRD features                                                         |
| ------------------------- | -------------------------------------------------------------------- |
| FR-1 observations         | MEM-001                                                              |
| FR-2 claims               | MEM-002, MEM-003, MEM-004, MEM-005                                   |
| FR-3 context compilation  | RET-001, CTX-001                                                     |
| FR-4 feedback             | CTX-002                                                              |
| FR-5 execution state      | EXE-001, COL-001, COL-002, COL-003                                   |
| FR-6 collaboration        | IAM-002, VIS-001, COL-001 through COL-004, AUD-001, MCP-001, EVT-001 |
| FR-7 isolation and policy | FND-003, IAM-001, IAM-002, VIS-001, GOV-001, GOV-002                 |
| FR-8 portability          | POR-001, OPS-001, FED-001                                            |
| FR-9 runtimes             | FND-001, FND-002, RET-001, OPS-001                                   |
| FR-10 channel release     | GOV-001, GOV-002, REL-001, AUD-001, EVT-001                          |
| FR-11 Memory Atlas        | OBS-001, MEM-005, AUD-001, GOV-001, REL-001                          |
| FR-12 dashboard IA        | UI-001, FND-002, IAM-001, IAM-002, AUD-001, EVT-001, OBS-001         |
| FR-13 proposed model memory | MEM-003, MEM-004, MEM-005, RET-001, FND-001, FND-002               |

## 18. Explicit non-features

The following are not Titen features for the planned releases:

- agent execution, scheduling, retries, or model-loop orchestration;
- general chat UI or mandatory hosted control plane; the optional read-only
  Memory Atlas is explicitly in scope;
- placeholder, locked, disabled, promotional, or paid-upgrade navigation for
  unshipped dashboard areas;
- top-level Categories, Webhooks, Export, Configuration, or Settings areas
  without the grouping and emergence rules in DESIGN;
- direct public/internet access to canonical memory or automatic publication of
  verified claims; approved channel releases are the supported external path;
- mandatory LLM, vector database, graph database, Redis, Postgres, or Docker;
- autonomous evidence deletion;
- provider/plugin marketplace;
- social popularity as truth or automatic consensus;
- full Mem0 API compatibility;
- CRDT or global consensus implementation before a measured federation need.

## 19. Implementation-entry gate

A feature may enter implementation only when:

1. its release, actor, authority, input/output, and failure behavior are clear;
2. its acceptance check can run on the applicable runtime(s);
3. it preserves evidence, isolation, and degraded-operation invariants;
4. the API reference is updated for externally visible behavior;
5. the smallest feature slice satisfies the release gate without scaffolding
   later releases.
