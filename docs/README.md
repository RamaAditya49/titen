# Titen documentation

This directory is the product and engineering source of truth for Titen.
Documentation is plain Markdown so it works on GitHub, offline, and in agent
context without a documentation-site dependency.

## Start here

| Document                                                           | Purpose                                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [PRD](./PRD.md)                                                    | Product scope, users, requirements, and acceptance criteria                   |
| [FRD](./FRD.md)                                                    | Feature behavior, release scope, failure rules, and acceptance journeys       |
| [DESIGN](./DESIGN.md)                                              | Progressive dashboard areas, emergence gates, interaction, and visual rules   |
| [Dashboard](./dashboard.md)                                        | Live read-only Atlas client, same-origin adapter, tests, and hosting boundary  |
| [Roadmap](./ROADMAP.md)                                            | Delivery order and release gates                                              |
| [Requirements workflow](./engineering/requirements-workflow.md)    | EARS acceptance criteria and spec-plan-implement-done lifecycle               |
| [Architecture](./architecture/overview.md)                         | Current repository state, target components, and runtime boundaries           |
| [Memory lifecycle](./architecture/memory-lifecycle.md)             | End-to-end Level 5/6 flow, adaptation loop, and embedding/vector architecture |
| [Memory Atlas](./architecture/memory-atlas.md)                     | Authorized visual evidence, conflict, scope, and release projections          |
| [Agent integration](./architecture/agent-integration.md)           | MCP/REST install, hooks, attribution, tags, events, and orchestration         |
| [Memory model](./architecture/memory-model.md)                     | Evidence, claims, temporal state, context, and feedback                       |
| [Collaboration](./architecture/collaboration.md)                   | Identity, visibility, parallel work, governance, and federation               |
| [API](./reference/api.md)                                          | Versioned HTTP/MCP and channel-serving contracts                              |
| [Data model](./reference/data-model.md)                            | Logical SQL entities, state transitions, and transaction boundaries           |
| [Evaluation](./testing/EVALS.md)                                   | Quality, performance, safety, parity, and release-gate measurements           |
| [Threat model](./security/threat-model.md)                         | Assets, trust boundaries, threats, controls, and residual risks               |
| [Cloudflare](./deployment/cloudflare.md)                           | Worker, D1, Vectorize, and scheduled processing                               |
| [VPS](./deployment/vps.md)                                         | Bun, SQLite, optional sqlite-vec, and service hardening                       |
| [Agent-memory landscape](./research/competitive-landscape.md)      | Mem0, Honcho, Karpathy, and Titen's falsifiable position                      |
| [Memory model evaluation](./research/2026-07-31-memory-model-evaluation.md) | Live Luna/Terra/Sol and embedding pilot, limitations, and rollout evidence |
| [Brand guide](./BRAND.md)                                          | Kawung mark, palette, typography, mascot, and usage rules                     |
| [ADR-0001](./decisions/0001-level-6-product-level-5-kernel.md)     | Why Level 6 is built on a Level 5 kernel                                      |
| [ADR-0002](./decisions/0002-channel-release-not-public-memory.md)  | Why customer-facing knowledge uses approved channel releases                  |
| [ADR-0003](./decisions/0003-memory-atlas-authorized-projection.md) | Why visual memory is a bounded derived projection in the same repository      |
| [ADR-0004](./decisions/0004-model-assisted-memory-enrichment.md)   | Why automatic derivation/reflection uses bounded SQL background jobs          |

## Current implementation status

| Surface                            | Current state                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| Astro dashboard | Six authorized Atlas lenses use the live same-origin adapter; local Bun/SQLite checks pass and external `0.5.0` deployment evidence is pending |
| Memory service and REST/MCP | Implemented and verified locally on Bun/SQLite and workerd/D1 |
| Enterprise governance | Roles, policies, approvals, releases, retention, legal holds, identity mappings, and two governance Atlas lenses pass the shared contract |
| Canonical federation | Opt-in signed claim/evidence bundles preserve provenance and conflicts; filtered import, replay, source binding, and cross-scope failures pass the shared contract |
| Optional embedding/indexing | Implemented on Bun and in Cloudflare adapter code; deployment evidence varies |
| Automatic LLM derivation/reflection | Implemented and dual-runtime tested; opt-in and not production-activated |
| Live deployment | One earlier Bun/container embedding smoke is recorded; the exact `0.5.0` API and dashboard smoke is still pending |

## Documentation rules

- `PRD.md` defines **what and why**.
- `FRD.md` defines **externally observable feature behavior and acceptance**.
- `DESIGN.md` defines **operator interface structure and presentation rules**;
  it does not prove a route has shipped.
- `architecture/` defines **how and where boundaries live**.
- `decisions/` records choices that are expensive to reverse.
- `reference/` describes externally observable contracts.
- `deployment/` contains runtime-specific operations.
- `testing/` defines reproducible release evidence and quality gates.
- `specs/` and `plans/` record active and terminal complex work using the same
  work slug.
- `engineering/` defines contributor-facing delivery standards.
- `security/` models threats beyond vulnerability-reporting policy.
- `research/` records dated external evidence, not product promises.
- `BRAND.md` defines the contributor-facing identity system.
- `blueprint.md` at the repository root remains research evidence, not the
  current product contract.

Files under `specs/done/` and `plans/done/` are historical terminal evidence.
They may describe a design that a later completed work item explicitly
superseded; use the current PRD, FRD, DESIGN, architecture, source, and tests for
the active contract.

Add a docs-site generator only when plain GitHub navigation becomes a measured
problem.
