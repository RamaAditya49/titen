# Titen product requirements document

- Status: draft for implementation
- Product direction: Level 6 collaborative memory fabric
- Kernel: Level 5 evidence-grounded context memory
- Target runtimes: Cloudflare Workers and Bun on a VPS
- Language/tooling: TypeScript, pnpm, Bun
- License: Apache-2.0

## 1. Summary

Titen helps AI agents remember and work together. It stores immutable evidence,
derives temporal claims, compiles task-specific context, and records whether
that context helped. A collaboration layer adds private/shared visibility,
checkpoints, leases, handoffs, policy, audit, and optional federation.

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

## 3. Users

| User | Need | Default deployment |
| --- | --- | --- |
| Individual | Persistent private agent context across sessions | Bun/SQLite or Worker/D1 |
| Small team | Shared project knowledge and parallel agent handoffs | One Titen deployment |
| Company | Workspace isolation, roles, audit, and retention | Managed Worker or private VPS |
| Enterprise | Governance, data boundaries, regional nodes, and federation | Multiple governed deployments |
| Agent framework author | Stable HTTP/MCP memory and coordination primitives | Embedded client or remote service |

## 4. Jobs to be done

- Remember a verified outcome without storing an entire private conversation.
- Retrieve the smallest context that is relevant to the current actor and task.
- Explain where every recalled claim came from and when it was valid.
- Let agents resume, claim, and hand off work without silently duplicating it.
- Preserve disagreement between agents until evidence or authorized policy
  resolves it.
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
- one deployment is sufficient.

### Enterprise

- policy and role enforcement;
- retention and legal-hold primitives;
- identity-provider integration boundary;
- governed federation between deployments when required by region or data
  ownership.

## 7. Functional requirements

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
POST /v1/observations
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
GET  /v1/audit/events
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
7. restart preserves canonical data and resumable checkpoints;
8. measured resource usage is published.

Company collaboration is accepted when two agents can claim separate work,
observe shared checkpoints, hand off one task, preserve a disputed claim, and
complete the flow without reading each other's private memories.

## 11. Success measures

- retrieval: Recall@5, MRR, precision, and no-result quality;
- trust: percentage of returned claims with valid evidence and temporal fields;
- collaboration: duplicate-work rate, successful handoff rate, lease conflict
  rate, and unauthorized-access test pass rate;
- operations: p50/p95 latency, degraded recall rate, outbox age, CPU, memory,
  storage, and model cost;
- portability: successful Cloudflare-to-VPS and VPS-to-Cloudflare round trips.

## 12. Non-goals

- running an agent or model loop;
- general workflow orchestration;
- chat UI or hosted control plane in the core repository;
- mandatory graph traversal or graph database;
- automatic deletion of canonical evidence;
- arbitrary provider plugin marketplace;
- strong global consensus across regions in early releases.

## 13. Open decisions

- exact stable Bun, pnpm, TypeScript, and Wrangler versions at P0;
- first extraction model after a structured-output mini-eval;
- whether MCP ships in v0.1 or v0.2;
- identity-provider interface when enterprise work starts;
- federation transport after a real multi-node requirement exists.
