# Titen documentation

This directory is the product and engineering source of truth for Titen.
Documentation is plain Markdown so it works on GitHub, offline, and in agent
context without a documentation-site dependency.

## Start here

| Document | Purpose |
| --- | --- |
| [PRD](./PRD.md) | Product scope, users, requirements, and acceptance criteria |
| [Roadmap](./ROADMAP.md) | Delivery order and release gates |
| [Architecture](./architecture/overview.md) | Components, runtime boundaries, and planned repository tree |
| [Memory model](./architecture/memory-model.md) | Evidence, claims, temporal state, context, and feedback |
| [Collaboration](./architecture/collaboration.md) | Identity, visibility, parallel work, governance, and federation |
| [API](./reference/api.md) | Initial HTTP contract and compatibility rules |
| [Cloudflare](./deployment/cloudflare.md) | Worker, D1, Vectorize, and scheduled processing |
| [VPS](./deployment/vps.md) | Bun, SQLite, optional sqlite-vec, and service hardening |
| [ADR-0001](./decisions/0001-level-6-product-level-5-kernel.md) | Why Level 6 is built on a Level 5 kernel |

## Documentation rules

- `PRD.md` defines **what and why**.
- `architecture/` defines **how and where boundaries live**.
- `decisions/` records choices that are expensive to reverse.
- `reference/` describes externally observable contracts.
- `deployment/` contains runtime-specific operations.
- `blueprint.md` at the repository root remains research evidence, not the
  current product contract.

Add a docs-site generator only when plain GitHub navigation becomes a measured
problem.
