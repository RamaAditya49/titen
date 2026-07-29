---
work_id: titen-p0-dual-runtime-vertical-spike
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-29
updated: 2026-07-29
owner: titen-maintainers
---

# P0 dual-runtime vertical spike

## Problem

Titen has a complete product contract, a documented data model, and a tested
static dashboard, but no memory service. Nothing in the repository proves that
the Level 5 loop can run identically on Cloudflare Workers/D1 and Bun/SQLite,
that scope isolation holds before retrieval, or that the architecture survives
without a vector database, model call, or framework. Every later release gate
depends on that proof, so it must be the next implementation.

## Requirement source

This spec normalizes the P0 subset of [FRD](../../FRD.md) `FND-001`,
`FND-002`, `FND-003`, `MEM-001`, `MEM-002`, `RET-001`, `CTX-001`, `CTX-002`,
the `GET /v1/claims/:id/evidence` read path of `MEM-005`, and the
[roadmap](../../ROADMAP.md) P0 gate. The HTTP shapes follow
[api.md](../../reference/api.md); the SQL entities follow
[data-model.md](../../reference/data-model.md).

## Intended outcome

One shared TypeScript core plus two thin runtime adapters serve the same
authenticated vertical path — resolve project, append observation, materialize
an evidence-linked claim, compile a bounded context pack, record feedback,
inspect claim evidence — verified by one contract suite executed against
Worker/D1 and Bun/SQLite, with measured footprint recorded.

## In scope

- one shared core using only Web Standards APIs, plus a minimal SQL driver
  boundary implemented once for D1 and once for `bun:sqlite`;
- forward-only SQL migrations applied identically on both runtimes;
- bearer-key authentication that derives organization, principal, and scope,
  with hashed key storage and a local administrative bootstrap path;
- `GET /healthz`, `GET /readyz`, `POST /v1/projects/resolve`,
  `POST /v1/observations`, `POST /v1/consolidations` (deterministic direct
  claims only), `POST /v1/context/compile`, `POST /v1/context/:id/feedback`,
  and `GET /v1/claims/:id/evidence`;
- atomic observation write covering canonical row, record history, FTS row, and
  indexing outbox entry;
- idempotency replay for mutations;
- FTS5-only candidate retrieval with deterministic ranking and token packing;
- one contract suite plus adversarial cross-scope tests executed on both
  runtimes;
- measured Worker bundle size, request latency, memory, and storage footprint;
- API reference, deployment guide, README, and roadmap status updates for the
  behavior that actually ships.

## Out of scope

- model-based extraction and reconciliation (`MEM-003`), claim lifecycle
  transitions beyond initial `active` status (`MEM-004`), and the full
  `MEM-005` history surface;
- `POST /v1/observations/batch`; the P0 gate is proven by single-append
  durability, and batch semantics land with `MEM-001` completion in v0.1;
- vector retrieval, embeddings, Vectorize, `sqlite-vec`, and any outbox
  consumer; the outbox row is written but has no P0 worker;
- checkpoints, JSONL export/import, API-key management endpoints, MCP,
  collaboration, Atlas view compilation, channel releases, webhooks, and events;
- dashboard integration; the Astro preview keeps its synthetic fixture;
- CI workflows, Docker, queue, Redis, Postgres, ORM, router framework,
  validation library, and dependency-injection container;
- production deployment; the spike proves local Worker and Bun runtime smoke.

## Constraints

- SQL is canonical; FTS and any future projection stay rebuildable.
- Authorization and scope filtering run before candidate retrieval.
- Observations are append-only; no path edits or deletes canonical evidence.
- The Worker core uses native bindings, no account API token, and does not
  require `nodejs_compat`.
- The shared core contains no runtime-specific import.
- P0 default configuration enables no model and no vector capability.
- External JSON stays `snake_case` inside the documented success/error envelope.
- Content, credentials, prompts, and full private IDs stay out of logs, errors,
  health output, and audit metadata.

## EARS acceptance criteria

- **AC-P0-001 — Ubiquitous:** Titen shall implement every P0 operation in one shared core that imports no runtime-specific module and shall expose it through one Cloudflare Worker adapter and one Bun adapter whose combined runtime-specific code holds only binding, server, and driver wiring.
- **AC-P0-002 — Event-driven:** When the shared contract suite runs the canonical resolve-observe-claim-compile-feedback-evidence fixture against Worker/D1 and against Bun/SQLite, Titen shall return normalized-equivalent status codes, envelopes, and payload fields from both runtimes.
- **AC-P0-003 — Event-driven:** When an authorized principal appends an observation, Titen shall commit the canonical row, its record-history entry, its FTS row, and its indexing-outbox entry in one transaction and shall return the stored identifier with a server-assigned `ingested_at`.
- **AC-P0-004 — Event-driven:** When a mutation is retried with a previously used `Idempotency-Key` and an identical request body, Titen shall return the original response and shall create no additional canonical row.
- **AC-P0-005 — Unwanted behavior:** If any statement of an observation write fails, then Titen shall abort the transaction and shall leave no canonical, history, FTS, or outbox row for that request.
- **AC-P0-006 — Event-driven:** When a client resolves a hosted Git project reference, Titen shall normalize it to lowercase `owner/repo` under the authenticated organization, shall return a stable opaque `project_id`, and shall create no membership.
- **AC-P0-007 — Unwanted behavior:** If a project reference contains credential material, a query string, or a local absolute path, then Titen shall reject the request with a validation error and shall store no project row.
- **AC-P0-008 — Event-driven:** When an authorized principal requests a deterministic direct claim, Titen shall create the claim with at least one authorized `supports`, `contradicts`, or `qualifies` source link, shall record its history entry, and shall make no model call.
- **AC-P0-009 — Unwanted behavior:** If a requested claim source references an observation outside the authenticated organization, then Titen shall return a non-disclosing `404`, shall create no claim, and shall not reveal whether the record exists.
- **AC-P0-010 — Ubiquitous:** Titen shall reject any claim whose asserted trust exceeds the trust of its supporting evidence or the authority of the authenticated principal.
- **AC-P0-011 — Event-driven:** When an authorized principal compiles context with a positive `max_tokens` budget, Titen shall return a stable `context_id` and a deterministic pack whose reported `used_tokens` does not exceed that budget, whose items carry kind, trust, confidence, validity, status, evidence IDs, and score components, and whose payload states that every item is untrusted reference data.
- **AC-P0-012 — Ubiquitous:** Titen shall apply organization, subject, project, visibility, status, and temporal eligibility filters before lexical candidate retrieval and shall exclude records the authenticated principal cannot read from results, counts, and score metadata.
- **AC-P0-013 — Event-driven:** When no eligible claim matches the compile request, Titen shall return a successful empty pack with zero used tokens instead of an error.
- **AC-P0-014 — Optional feature:** Where vector retrieval and model capabilities are disabled, Titen shall serve retrieval from SQLite FTS5 alone and shall report those capabilities as disabled in readiness and in compile metadata.
- **AC-P0-015 — Event-driven:** When an authorized principal records `used`, `useful`, `irrelevant`, `incorrect`, or `harmful` feedback for a context run or one of its items, Titen shall persist the actor, outcome, and timestamp, shall treat a repeated client mutation ID as the same record, and shall modify no observation, claim, source link, or trust value.
- **AC-P0-016 — Event-driven:** When an authorized principal requests a claim's evidence, Titen shall return the claim with its visible supporting, contradicting, and qualifying observations and shall indicate that a source is hidden without disclosing its content or organization.
- **AC-P0-017 — Unwanted behavior:** If a request carries a missing, malformed, unknown, or revoked credential, then Titen shall return `401` in the documented error envelope, shall log no key material, and shall return `404` rather than `403` for a resource belonging to another organization.
- **AC-P0-018 — Ubiquitous:** Titen shall store only a hashed representation of an API key and shall keep raw key material out of SQL rows, logs, error bodies, health output, and test snapshots.
- **AC-P0-019 — Event-driven:** When the canonical database is unreachable or a required migration has not been applied, Titen shall fail `GET /readyz` with a non-sensitive reason while `GET /healthz` continues to report liveness without internal paths or credentials.
- **AC-P0-020 — State-driven:** While a committed observation and its claim exist, Titen shall return the same records and FTS matches after a process restart or a fresh Worker instance without a rebuild step.
- **AC-P0-021 — Ubiquitous:** Titen shall record measured Worker bundle size, end-to-end loop latency, peak process memory, and per-observation storage growth for both runtimes in the plan evidence.
- **AC-P0-022 — Ubiquitous:** Titen shall run the P0 path with no vector database, model provider, queue, Redis, Postgres, ORM, router framework, or account API token inside the Worker, and shall not require `nodejs_compat` for the shared core.

## Risks and mitigations

| Risk                                                     | Mitigation                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| D1 and `bun:sqlite` diverge on SQL, types, or errors     | Keep one narrow driver interface, one migration list, and one contract suite that must pass on both before any merge   |
| A parity harness is harder than the feature itself       | Build the harness first against a trivial endpoint, then add features behind an already-green two-runtime gate         |
| Scope filtering drifts into post-retrieval filtering      | Compile the authorization predicate into the candidate query and add adversarial cross-organization tests per endpoint |
| Token budget overflow from a naive estimator             | Use a deterministic conservative estimator, assert the reported budget in tests, and never truncate item content       |
| P0 grows into v0.1 through convenient extras             | Every out-of-scope item stays out; new behavior needs its own work ID                                                  |
| Worker bundle or D1 statement limits surface late        | Measure footprint in the same step that adds the last endpoint, before the docs update                                 |
| Documentation claims runtime support before smoke passes | Update README, roadmap, and deployment status only after both runtime smokes are recorded                              |

## Done conditions

- every acceptance criterion has reproducible evidence recorded in the plan;
- the contract suite passes on Worker/D1 and Bun/SQLite from a clean checkout;
- adversarial cross-scope, credential, and transaction-failure tests pass;
- footprint measurements are recorded;
- the Astro dashboard build, browser tests, and workflow-document check still
  pass;
- API reference, deployment guides, README, and roadmap describe only verified
  behavior;
- the plan has no unchecked item and both artifacts move to `done/` with
  `outcome: completed` in the same change.
