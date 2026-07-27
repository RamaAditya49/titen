# Titen documentation

This directory is the product and engineering source of truth for Titen.
Documentation is plain Markdown so it works on GitHub, offline, and in agent
context without a documentation-site dependency.

## Start here

| Document                                                          | Purpose                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [PRD](./PRD.md)                                                   | Product scope, users, requirements, and acceptance criteria                   |
| [FRD](./FRD.md)                                                   | Feature behavior, release scope, failure rules, and acceptance journeys       |
| [Roadmap](./ROADMAP.md)                                           | Delivery order and release gates                                              |
| [Requirements workflow](./engineering/requirements-workflow.md)   | EARS acceptance criteria and spec-plan-implement-done lifecycle               |
| [Architecture](./architecture/overview.md)                        | Components, runtime boundaries, and planned repository tree                   |
| [Memory lifecycle](./architecture/memory-lifecycle.md)            | End-to-end Level 5/6 flow, adaptation loop, and embedding/vector architecture |
| [Memory Atlas](./architecture/memory-atlas.md)                    | Authorized visual evidence, conflict, scope, and release projections           |
| [Agent integration](./architecture/agent-integration.md)          | MCP/REST install, hooks, attribution, tags, events, and orchestration         |
| [Memory model](./architecture/memory-model.md)                    | Evidence, claims, temporal state, context, and feedback                       |
| [Collaboration](./architecture/collaboration.md)                  | Identity, visibility, parallel work, governance, and federation               |
| [API](./reference/api.md)                                         | Versioned HTTP/MCP and channel-serving contracts                              |
| [Data model](./reference/data-model.md)                           | Logical SQL entities, state transitions, and transaction boundaries           |
| [Evaluation](./testing/EVALS.md)                                  | Quality, performance, safety, parity, and release-gate measurements           |
| [Threat model](./security/threat-model.md)                        | Assets, trust boundaries, threats, controls, and residual risks               |
| [Cloudflare](./deployment/cloudflare.md)                          | Worker, D1, Vectorize, and scheduled processing                               |
| [VPS](./deployment/vps.md)                                        | Bun, SQLite, optional sqlite-vec, and service hardening                       |
| [Agent-memory landscape](./research/competitive-landscape.md)     | Mem0, Honcho, Karpathy, and Titen's falsifiable position                      |
| [Brand guide](./BRAND.md)                                         | Kawung mark, palette, typography, mascot, and usage rules                     |
| [ADR-0001](./decisions/0001-level-6-product-level-5-kernel.md)    | Why Level 6 is built on a Level 5 kernel                                      |
| [ADR-0002](./decisions/0002-channel-release-not-public-memory.md) | Why customer-facing knowledge uses approved channel releases                  |
| [ADR-0003](./decisions/0003-memory-atlas-authorized-projection.md) | Why visual memory is a bounded derived projection in the same repository       |

## Documentation rules

- `PRD.md` defines **what and why**.
- `FRD.md` defines **externally observable feature behavior and acceptance**.
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

Add a docs-site generator only when plain GitHub navigation becomes a measured
problem.
