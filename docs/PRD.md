# Titen product requirements document

- Status: product baseline; see the evidence-based maturity matrix in [ROADMAP](./ROADMAP.md#maturity-matrix)
- Product direction: Level 6 collaborative memory fabric
- Kernel: Level 5 evidence-grounded context memory
- Target runtimes: Cloudflare Workers and Bun on a VPS
- Language/tooling: TypeScript, pnpm, Bun
- License: Apache-2.0

## 1. Summary

Titen helps AI agents remember and work together. It stores immutable evidence,
derives temporal claims, compiles task-specific context, and records whether
that context helped. A collaboration layer adds private, team, and organization
visibility plus checkpoints, leases, handoffs, policy, and audit. Signed
federation event exchange is available; canonical recallable-memory federation
remains planned.
An enterprise release layer lets authorized CRM/chatbot gateways serve reviewed
knowledge snapshots without exposing canonical memory.

Personal, company, and enterprise installations use one engine and one external
contract. Titen is self-hostable and does not require a hosted Titen service.

## 2. Problem

Existing agent memory commonly fails in four ways:

1. raw chat logs consume context without becoming reliable knowledge;
2. vector retrieval returns similar text without sufficient provenance or
   temporal validity;
3. automatic consolidation may overwrite disagreement or stale facts without
   an audit trail;
4. multiple agents cannot tell what is private, shared, already being worked
   on, or safe to hand off.

The result is duplicated work, conflicting actions, accidental data sharing,
and confident reuse of untrusted memory.

## 3. Beachhead user and canonical scenario

The beachhead is a **small team running 2–10 agents** on one project. They
already feel context drift, duplicate research or execution, fragile handoffs,
and conflicts between stale or differently sourced claims. Individual,
company, enterprise, CRM, and framework users remain valid secondary personas,
but they do not define the initial product story.

The canonical scenario has four roles:

1. a **researcher** records source-backed findings and unresolved uncertainty;
2. a **writer** compiles a bounded, cited context pack and produces a draft;
3. an **operator** claims the delivery task, records execution evidence, and
   hands off the outcome;
4. a **reviewer** traces claims to evidence, preserves or resolves conflicts,
   and records feedback for later recall.

The scenario succeeds when the writer and operator reuse the research without
repeating it, no two agents silently own the same task, the reviewer can trace
recalled claims and conflicts, and a handoff can be resumed from explicit state.
Measure duplicate-work rate, successful handoff rate, lease-conflict rate,
evidence coverage of recalled claims, context usefulness, and time-to-resume.

### Comparison guidance

- **Raw files/logs** are simple and inspectable, but callers must implement
  scoping, freshness, conflict handling, packing, and coordination themselves.
- **A vector database** improves semantic candidate search, but similarity is
  not provenance, authorization, temporal validity, task ownership, or truth.
- **Simpler memory libraries** are a better fit for one agent that only needs
  persistence and recall. Titen earns its complexity when several agents need
  evidence-grounded context plus coordination and explicit handoffs.

## 4. Jobs to be done

- Remember a verified outcome without storing an entire private conversation.
- Retrieve the smallest context that is relevant to the current actor and task.
- Explain where every recalled claim came from and when it was valid.
- Let agents resume, claim, and hand off work without silently duplicating it.
- Connect different agent hosts through one small REST/MCP contract and explicit
  project identity.
- Preserve disagreement between agents until evidence or authorized policy
  resolves it.
- Release a reviewed claim version to a specific CRM/chatbot audience without
  exposing internal evidence or another customer's memory.
- Export canonical data and move between Cloudflare and VPS deployments.

## 5. Product principles

1. **Evidence before inference.** Derived memory must reference supporting
   observations.
2. **Scope before search.** Authorization filters candidates before lexical or
   semantic ranking.
3. **Conflict before overwrite.** Contradictory claims coexist until explicitly
   superseded or resolved.
4. **Context, not a dump.** Recall produces a bounded context pack with trust,
   provenance, and uncertainty.
5. **Coordination, not orchestration.** Titen records leases, checkpoints, and
   handoffs but does not run agent loops.
6. **Local and portable.** Canonical storage works without a hosted dependency;
   indexes are rebuildable.
7. **Light by default.** No graph database, queue, Redis, Postgres, Docker, or
   LLM is mandatory for the first useful path.
8. **Trust is not disclosure.** Evidence authority, internal visibility, and
   external channel release remain independent decisions.
9. **Observability is not authority.** A visual projection may explain an
   authorized result, but it cannot grant access, publish knowledge, or become
   a new source of truth.
10. **Interaction is a truth claim.** Only shipped, authorized product areas
    become dashboard links, controls, or routes. A reference shell may show the
    canonical area map as non-interactive orientation, never as a locked,
    disabled, paid, or promotional menu.

## 6. Product modes

### Personal

- one owner and multiple private agents;
- private-by-default memory;
- Level 5 context kernel;
- optional local-only model endpoints.

### Company

- organizations, workspaces, projects, members, and service agents;
- private, team, and organization visibility;
- shared checkpoints, leases, handoffs, and audit;
- an optional progressively disclosed operator dashboard whose first slice is
  read-only Memory Atlas evidence, neighborhood, conflict, and freshness
  inspection;
- optional governed knowledge serving through an authorized CRM/chatbot
  gateway;
- one deployment is sufficient.

### Enterprise

- policy and role enforcement;
- retention and legal-hold primitives;
- identity-provider integration boundary;
- channel, audience, approval, redaction, validity, and revocation policy for
  customer-facing knowledge;
- governed Scope Preview and Knowledge Release lenses for authorized operators;
- governed signed event exchange between deployments when required by region or
  data ownership; canonical recallable-memory federation remains planned.

## 7. Functional requirements

These are product-level requirements, not active-work status. Before any
complex implementation begins, the selected slice MUST be expressed as
identified EARS acceptance criteria in a paired work spec and plan following
the [requirements workflow](./engineering/requirements-workflow.md).

### FR-1 — observations

- The system MUST append observations with actor, subject, scope, source,
  occurrence time, ingestion time, trust, and content hash.
- It MUST NOT silently mutate observation content.
- Tool outcomes MUST be marked verified only when the caller provides a trusted
  execution result under an authorized identity.

### FR-2 — claims

- The system MUST materialize typed claims from one or more observations.
- Claims MUST carry confidence, validity time, creation time, status, and source
  links.
- Claims MAY be superseded, disputed, expired, or revoked without deleting
  their source observations.
- Deterministic writes MUST work without an LLM.

### FR-3 — context compilation

- The system MUST compile context for an authenticated actor, task/query,
  scope, and token budget.
- It MUST filter by policy before retrieval.
- It MUST return provenance, trust, temporal validity, and unresolved conflicts.
- It MUST support FTS-only operation when embeddings are unavailable.
- Retrieved memory MUST be labeled as untrusted reference data.

### FR-4 — feedback

- A caller MUST be able to mark a context item used, useful, irrelevant,
  incorrect, or harmful.
- Feedback MUST NOT rewrite canonical observations.
- Utility signals MAY affect future ranking after sufficient evidence exists.

### FR-5 — execution state

- Checkpoints MUST be stored separately from semantic claims.
- Checkpoints MUST support TTL, version, status, and resumable payload.
- A stale checkpoint MUST NOT be presented as a durable fact.

### FR-6 — collaboration

- The system MUST identify humans, agents, and services independently.
- It MUST support private, team, and organization visibility.
- It MUST provide idempotent leases and handoffs for bounded coordination.
- It MUST preserve observer-specific claims and disagreement.
- It MUST record who wrote, read, shared, resolved, or revoked collaborative
  memory.
- It MUST expose durable metadata events for explicit orchestrator
  subscriptions without turning Titen into a scheduler.

### FR-7 — isolation and policy

- Tenant/organization authority MUST come from authentication, not request data.
- Cross-tenant IDs MUST return a non-disclosing not-found response.
- Subject-scoped credentials MUST NOT escape their subject.
- High-trust procedural memory MUST support stronger write policy than ordinary
  episodic memory.

### FR-8 — portability

- Canonical records MUST export as a versioned JSONL format.
- Export MUST exclude credentials and vectors by default.
- Import MUST be idempotent and reindex with the destination embedding
  fingerprint.

### FR-9 — runtimes

- The same contract tests MUST pass against Cloudflare and VPS adapters.
- Cloudflare MUST use native bindings for D1, Vectorize, and Workers AI.
- VPS MUST use Bun, `bun:sqlite`, and optional `sqlite-vec`.
- An OpenAI-compatible HTTP model boundary MUST be sufficient on VPS.

### FR-10 — channel knowledge release

- `trust`, internal `visibility`, and external release eligibility MUST remain
  separate.
- A release MUST reference one exact claim version and carry an explicit
  channel, audience, approved snapshot, status, validity window, and approver.
- Release status MUST be one of `draft`, `approved`, `active`, `suspended`,
  `replaced`, `expired`, or `revoked`; reactivating a suspended snapshot
  requires approval again.
- `verified` MUST NOT imply publishable, and model output, tags, similarity, or
  feedback MUST NOT activate a release.
- CRM/chatbot gateways MUST authenticate as service principals; public users
  MUST NOT receive direct canonical-memory access.
- Authenticated customer memory MUST be selected from a subject resolved from a
  short-lived signed channel assertion and MUST NOT enter anonymous or
  other-customer release context.
- Revoked, expired, replaced, source-invalidated, or out-of-audience releases
  MUST be ineligible before the next channel context compile, even when a
  derived index or asynchronous status update is stale.

### FR-11 — Memory Atlas observability

- Titen MUST offer Memory Atlas as an optional, read-only operator surface;
  REST/MCP memory operations MUST remain complete when it is disabled.
- The v0.2 surface MUST support Evidence Trace, Memory Neighborhood, and
  Conflict & Freshness lenses. Scope Preview and Knowledge Release lenses are
  v0.3 governance features.
- Every view MUST be derived from authorized canonical SQL records; layout,
  clusters, summaries, counts, and caches MUST remain rebuildable projections.
- Authorization MUST run before traversal and apply to both endpoints of every
  returned edge. Hidden records MUST NOT leak through labels, topology, counts,
  or timing-dependent expansion behavior.
- Canonical hydration MUST recheck lifecycle version, visibility, and release
  eligibility before returning a cached or indexed candidate.
- Requests MUST have bounded depth, nodes, edges, labels, execution time, and
  response bytes, with explicit truncation or degraded metadata.
- The view compiler MUST use the same authenticated REST contract on
  Cloudflare and VPS, remain outside the six ordinary-agent MCP tools, and add
  no graph-database or renderer dependency to the core.

### FR-12 — progressive dashboard information architecture

- Titen MUST treat the dashboard as an optional authenticated REST client;
  disabling it MUST leave complete headless REST/MCP behavior unchanged.
- The initial implemented frontend MUST expose Memory Atlas as its first and
  only active product area and MUST identify its data as a synthetic fixture
  until the authorized view compiler is integrated.
- Later dashboard areas MUST follow the canonical groups defined in
  [DESIGN](./DESIGN.md): Memory, Collaboration, Operations, Administration, and
  Governance.
- An area MUST NOT become a link, control, or route until its backend contract
  is implemented, the current build declares it available, its authorization
  and failure behavior pass, and its paired EARS UI work item is complete.
- The approved reference shell MAY show unavailable area names as
  non-interactive orientation, but MUST NOT render them as placeholder routes,
  locks, disabled controls, paid upgrades, or shipped functionality.
- Categories and tags MUST remain memory filters; webhooks MUST remain inside
  Audit & Events; export and recovery MUST remain inside System; account
  settings MUST remain absent until an account/session lifecycle exists.
- Navigation and route discovery MUST NOT bypass authorization or reveal a
  foreign resource, hidden capability, record count, or private scope.

## 8. Non-functional requirements

### Security

- Memory content is untrusted input.
- API keys are high entropy, stored only as hashes, scoped, revocable, and never
  logged.
- Logs exclude content, prompts, embeddings, credentials, and full private IDs.
- Destructive tenant purge requires explicit administrative tooling and backup.

### Reliability

- SQL is canonical; vector and compiled indexes are recoverable projections.
- Canonical mutations, history, and outbox entries commit atomically.
- A vector outage degrades recall but does not lose writes.
- Readiness fails closed on migration or embedding-dimension mismatch.

### Performance budgets

- Worker bundle compressed target: below 1 MiB.
- VPS idle RSS target: below 100 MiB excluding model runtimes.
- Normal recall target: one query embedding, one lexical query, one vector query,
  and one hydration batch.
- Every loop and overlay is bounded.

### Compatibility

- External JSON uses stable snake_case fields.
- Breaking API and export-format changes require versioning and migration docs.
- Web Standards APIs are preferred over runtime-specific abstractions in core.

## 9. Initial external operations

Kernel:

```text
POST /v1/projects/resolve
POST /v1/observations
POST /v1/observations/batch
POST /v1/consolidations
POST /v1/context/compile
POST /v1/context/:id/feedback
GET  /v1/claims/:id/evidence
```

Collaboration is added after the kernel gate:

```text
POST /v1/checkpoints
POST /v1/leases
POST /v1/handoffs
GET  /v1/events
GET  /v1/audit/events
```

Optional read-only operator views are added with v0.2:

```text
POST /v1/memory-views/compile
```

Governed channel knowledge is added with v0.3:

```text
POST /v1/channels
GET  /v1/channels
PATCH /v1/channels/:id
POST /v1/knowledge-releases
GET  /v1/knowledge-releases
POST /v1/knowledge-releases/:id/approve
POST /v1/knowledge-releases/:id/activate
POST /v1/knowledge-releases/:id/revoke
POST /v1/channels/:id/context/compile
```

The exact schemas live in [API reference](./reference/api.md).

## 10. Acceptance criteria

P0 is accepted when:

1. the same observation-to-context fixture passes on Worker/D1 and Bun/SQLite;
2. every claim in the returned context traces to an observation;
3. unauthorized cross-scope access fails before retrieval;
4. FTS recall continues when vectors are disabled;
5. context budget is enforced deterministically;
6. incorrect feedback does not mutate evidence;
7. restart preserves canonical data; v0.1 additionally preserves resumable
   checkpoints;
8. measured resource usage is published.

Company collaboration is accepted when two agents can claim separate work,
observe shared checkpoints, hand off one task, preserve a disputed claim, and
complete the flow without reading each other's private memories. A signed event
may wake an external orchestrator, but webhook failure cannot roll back memory.

Channel knowledge is accepted when a service gateway can serve one approved
claim snapshot to the intended audience, cannot retrieve internal or another
customer's memory, rejects invalid/replayed customer assertions, and stops
serving a revoked or source-invalidated release before the next context.

Memory Atlas is accepted when an authorized operator can trace evidence,
inspect a bounded neighborhood, and diagnose conflicts without reading or
inferring hidden records; disabling the surface leaves headless REST/MCP
behavior unchanged. Its v0.3 preview lenses must not impersonate another
principal or convert verified memory into an active release.

The dashboard information architecture is accepted when Atlas is the only
active route, the final reference shell identifies its values as synthetic, and
each later area remains non-interactive until its backing capability,
authorization, EARS UI work item, and release evidence are complete. A label or
planned area in documentation is not implementation evidence.

## 11. Success measures

- retrieval: Recall@5, MRR, precision, and no-result quality;
- trust: percentage of returned claims with valid evidence and temporal fields;
- collaboration: duplicate-work rate, successful handoff rate, lease conflict
  rate, and unauthorized-access test pass rate;
- operations: p50/p95 latency, degraded recall rate, outbox age, CPU, memory,
  storage, and model cost;
- integration: hook overhead, calls/bytes per completed task, semantic-ready and
  webhook lag, orchestration wake time, and dropped/duplicate mutation rate;
- channel serving: unauthorized-release rate, cross-customer leakage,
  activation/revocation lag, citation coverage, and useful-answer rate;
- operator observability: authorized evidence-trace coverage, topology leakage
  rate, view-compile p95, truncation rate, and diagnosis success/time;
- dashboard usability: task-completion rate, navigation error rate, unauthorized
  route leakage count, and time to identify evidence or work state;
- portability: successful Cloudflare-to-VPS and VPS-to-Cloudflare round trips.

## 12. Non-goals

- running an agent or model loop;
- general workflow orchestration;
- general chat UI or a mandatory hosted control plane; Memory Atlas is an
  optional read-only integration in this repository;
- placeholder, locked, promotional, or paid-upgrade navigation for unshipped
  dashboard areas;
- an unauthenticated public canonical-memory/search endpoint or automatic
  publication of verified claims;
- mandatory graph traversal or graph database;
- automatic deletion of canonical evidence;
- arbitrary provider plugin marketplace;
- strong global consensus across regions in early releases.

## 13. Open decisions

- exact stable Bun, pnpm, TypeScript, and Wrangler versions at P0;
- first extraction model after a structured-output mini-eval;
- additional host-native plugins after the Codex reference plugin, selected only
  with an active adopter and install/parity evidence;
- identity-provider interface when enterprise work starts;
- exact signed customer-assertion format and issuer/key-rotation contract at
  v0.3;
- transport/orchestration and canonical recallable-memory federation semantics
  after a real multi-node requirement exists;
- measured Memory Atlas server-side caps after the authorized reference fixture
  exists;
- the first post-Atlas dashboard area, selected only after its operator journey
  and authorized list/detail API are stable.
