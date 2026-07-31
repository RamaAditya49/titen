# Architecture overview

The end-to-end evidence, context, feedback, collaboration, and semantic-index
flow is defined in the [memory lifecycle protocol](./memory-lifecycle.md).
Agent installation, hooks, project resolution, event delivery, and the
orchestration boundary are defined in the
[agent integration flow](./agent-integration.md).
The separation between canonical memory and externally served knowledge is
accepted in [ADR-0002](../decisions/0002-channel-release-not-public-memory.md).
The optional operator projection boundary is defined in
[Memory Atlas](./memory-atlas.md) and accepted in
[ADR-0003](../decisions/0003-memory-atlas-authorized-projection.md).
The progressive operator information architecture is defined in
[DESIGN](../DESIGN.md).
Proposed automatic memory management is defined in
[ADR-0004](../decisions/0004-model-assisted-memory-enrichment.md).

## System shape

Titen is one TypeScript package with a shared Web-Standards core. Runtime
entrypoints assemble concrete capabilities; the core does not load provider
factories or runtime-specific modules dynamically.

```mermaid
flowchart TB
    A[Agent / thin adapter] --> X[REST or MCP]
    G[CRM / chatbot gateway] --> X
    O[Operator / optional dashboard] --> X
    X --> H[Fetch API]
    H --> P[Auth and policy]
    P --> C[Level 6 collaboration]
    P --> R[Channel knowledge release]
    P --> MV[Read-only Memory Atlas compiler]
    C --> K[Level 5 memory kernel]
    K --> S[Canonical SQL]
    K --> I[Optional vector index]
    K --> EM[Optional embedding gateway]
    K -. proposed .-> XM[Proposed extraction gateway]
    C --> E[Event outbox]
    R --> S
    R --> I
    R --> E
    MV --> S
    MV -. optional candidates .-> I

    S --> D1[D1]
    S --> SQ[SQLite]
    I --> V[Vectorize]
    I --> SV[sqlite-vec]
    EM --> WAI[Workers AI]
    EM --> OAI[OpenAI-compatible HTTP]
    XM -. proposed .-> WAI
    XM -. proposed .-> OAI
    E --> W[Optional signed webhooks]
    E --> F[Signed federation event exchange]
```

## Component responsibilities

| Component          | Owns                                                   | Does not own      |
| ------------------ | ------------------------------------------------------ | ----------------- |
| HTTP app           | routing, validation, envelopes, request IDs            | memory policy     |
| Auth/policy        | identity, membership, scope, visibility, authorization | ranking           |
| Memory kernel      | observations, claims, context compilation, feedback    | agent loops       |
| Collaboration      | checkpoints, leases, handoffs, audit                   | task scheduling   |
| Channel release    | approved claim snapshots, channel/audience eligibility | public ingress    |
| Dashboard client   | progressively shipped operator interface               | domain authority  |
| Memory Atlas       | bounded authorized read-only projections               | canonical storage |
| Event delivery     | post-commit events, retries, signed webhooks           | agent selection   |
| Federation exchange | signed filtered event transport and cursors           | canonical remote recall |
| SQL adapter        | canonical transactions, FTS, hydration, outbox         | semantic policy   |
| Vector adapter     | rebuildable embedding index                            | canonical content |
| Embedding gateway  | vectors for candidate retrieval                         | classification    |
| Proposed extraction gateway | bounded derivation/reflection proposals        | authority/storage |
| Runtime entrypoint | bindings, startup, background trigger                  | domain logic      |

## Runtime matrix

| Capability | Cloudflare | VPS | Local computer |
| --- | --- | --- | --- |
| HTTP | Worker `fetch` | `Bun.serve` | `Bun.serve` on loopback |
| SQL | D1 | `bun:sqlite` | `bun:sqlite` |
| FTS | D1 SQLite FTS5 | SQLite FTS5 | SQLite FTS5 |
| Vector | optional Vectorize | optional `sqlite-vec` | optional `sqlite-vec` |
| Embedding adapter (implemented) | Workers AI | local or remote compatible HTTP | local or remote compatible HTTP |
| Additional Cloudflare embedding provider (proposed) | compatible HTTPS/VPC | n/a | n/a |
| Background maintenance | scheduled/manual index and delivery drain | startup/timer/manual index and delivery drain | startup/timer/manual index and delivery drain |
| Model enrichment (proposed) | Cron/manual drain plus Workers AI or compatible HTTPS/VPC | startup/timer/manual drain plus compatible local or remote HTTP | startup/timer/manual drain plus compatible local or remote HTTP |
| Crypto | Web Crypto | Web Crypto | Web Crypto |

The core does not require `nodejs_compat` on Workers.

The base VPS does not require Postgres. A future `pgvector` adapter is justified
only when measured scale, concurrency, or an existing enterprise Postgres
topology outweighs the operational cost. Every vector backend still requires a
compatible embedding model at write and query time.

## Repository state and target runtime shape

The current checkout contains the memory kernel, authenticated REST/MCP app,
SQL migrations, Cloudflare and Bun entrypoints, and a shared dual-runtime
contract suite. Their precise verification boundary is centralized in the
[roadmap maturity matrix](../ROADMAP.md#maturity-matrix).

The Astro dashboard is an interactive prototype backed by a frozen synthetic
fixture. Live dashboard/API integration is separate evidence and must not be
inferred from the preview. Signed federation event exchange is implemented;
turning remote events into authorized, indexed, recallable canonical memory is
planned.

Automatic model-assisted derivation/reflection is also planned. Current
maintenance drains claim indexing and delivery work only; it does not classify
observations. Capability contract version 1 reports `embedding`, `extraction`,
and `background_enrichment` separately. Deprecated `capabilities.model` mirrors
embedding for `0.3.x` compatibility and must not be read as extraction readiness.

## Write path

1. Authenticate actor and derive organization/subject authority.
2. Validate and normalize the observation.
3. Commit observation, deterministic claim if supplied, FTS rows, history, and
   indexing/event outbox in one SQL transaction.
4. Return canonical success even when semantic indexing or webhook delivery is
   pending.
5. Current background work drains indexing and delivery. After ADR-0004 is
   implemented, a separate leased enrichment job may propose and validate
   claims before enqueueing their index work.

## Context path

1. Authenticate actor and resolve permitted scopes and visibility.
2. Build lexical and optional vector candidates within those scopes.
3. Hydrate canonical rows; discard tombstones, stale versions, and expired
   checkpoints.
4. Preserve conflicts and group sources by claim.
5. Rank by task relevance, trust, temporal validity, utility, and diversity.
6. Pack items under the caller's token budget.
7. Return structured untrusted context and a context ID for feedback.

## Collaboration path

1. An agent creates or resumes a checkpoint.
2. It acquires a short, idempotent lease on a bounded work item.
3. Progress is appended to the checkpoint; durable findings become observations.
4. A handoff transfers responsibility and cites checkpoint/evidence IDs.
5. Completion records an outcome and releases the lease.

This records coordination without deciding which agent should run next.
An orchestrator may consume a signed event or poll an authorized event cursor,
select an agent, and pass it a handoff ID. Titen then enforces the recipient's
scope, lease, checkpoint, and context rules.

## Memory Atlas path

1. Authenticate an operator and resolve the requested lens, focus, and scope.
2. Apply policy before candidate traversal or expansion.
3. Build a bounded projection from canonical relationships; an optional index
   may propose candidates but cannot authorize them.
4. Hydrate canonical rows and recheck both endpoints of every edge plus current
   lifecycle/version/visibility/release eligibility.
5. Return authorized nodes and edges with explicit truncation and degraded
   metadata; never include hidden topology or counts.
6. Render in an optional client. Renderer failure does not affect REST/MCP.

The compiler is a read-only REST integration in the same repository, not an
ordinary-agent MCP tool. Layout, clusters, summaries, and caches are
rebuildable and cannot become canonical memory.

## Dashboard path

1. Serve one optional static client that consumes authenticated REST only.
2. Render only areas implemented in the current build and discoverable by the
   authenticated principal; navigation never replaces route authorization.
3. In the v0.3.1 static preview, keep Atlas as the only active route; the
   approved shell may show other area names only as plain non-interactive
   orientation.
4. Add later areas according to [DESIGN](../DESIGN.md), one completed EARS UI
   work item at a time.
5. Keep categories/tags as filters, webhooks within Audit & Events,
   export/recovery within System, and Settings absent until its own contract.

Disabling or rolling back the static client changes no canonical data, API
contract, or ordinary-agent MCP behavior.

## Channel knowledge path

1. An authorized publisher selects one exact active claim version.
2. An independent approval creates a bounded, optionally redacted/localized
   release snapshot for one channel, audience, and validity window.
3. SQL commits the release, history, FTS row, audit, and index/event outbox.
4. A CRM/chatbot gateway authenticates as a scoped service principal.
5. Channel context uses only active releases matching that gateway, audience,
   and validity; customer memory is added only after a short-lived signed
   assertion resolves an authenticated customer subject.
6. Revocation or replacement changes canonical eligibility before the next
   compile; stale cache/vector hits fail canonical hydration.

External users never query canonical memory directly. Live transactional facts
remain source-tool calls instead of stale knowledge releases.

## Failure boundaries

- SQL failure aborts the canonical mutation.
- Embedding/vector failure degrades semantic retrieval and leaves repairable
  index work.
- Under the proposed enrichment contract, extraction failure never rolls back
  evidence; it leaves bounded enrichment work pending or terminally failed with
  no semantic mutation.
- Policy failure denies before retrieval.
- Channel approval/policy failure denies before release activation or context;
  vector failure degrades only to authorized release FTS.
- Memory Atlas failure disables only operator visualization; stale projections
  are re-authorized at canonical hydration and cannot widen scope.
- dashboard failure or omission leaves all headless REST/MCP behavior complete;
  unavailable areas have no route or control, even when the approved shell shows
  their non-interactive labels.
- Expired lease/checkpoint never becomes a durable fact.
- Signed event-exchange failure never changes local canonical event history;
  remote events do not become recallable canonical memory implicitly.

## Dependency budget

Astro, Playwright, and local fonts support the optional dashboard. The memory
service uses native `Request`, `Response`, Web Crypto, D1, `bun:sqlite`,
`Bun.serve`, and `fetch`; optional `sqlite-vec` is already isolated to the Bun
vector capability. The proposed model-assisted enrichment design adds no
provider SDK, queue, Redis, graph database, or dependency-injection framework.
