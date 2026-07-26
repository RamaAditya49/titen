# ADR-0001: Level 6 product on a Level 5 kernel

- Status: accepted
- Date: 2026-07-26

## Context

Titen must support personal agents, company agent teams, and enterprise agent
fleets. A Level 5 memory kernel can compile evidence-grounded context for one
actor, but parallel agents also need identity, visibility, handoff, conflict,
governance, and eventually federation.

Building all enterprise capabilities into the storage kernel would make the
personal and VPS modes unnecessarily heavy.

## Decision

Position Titen as a **Level 6 collaborative memory fabric** built on a **Level 5
evidence-grounded context memory kernel**.

- The kernel owns observations, claims, provenance, temporal validity,
  checkpoints, context compilation, and outcome feedback.
- The collaboration layer owns identities, memberships, visibility, leases,
  handoffs, policies, audit, and optional federation.
- The same engine supports personal, company, and enterprise deployments.
- Federation is not required for single-node collaboration.
- Titen does not run agent loops or become a general task scheduler.

## Consequences

Positive:

- personal mode remains lightweight;
- collaboration is a layer rather than a second product;
- enterprise controls can be enabled without forking the memory model;
- evidence and access decisions remain auditable.

Costs:

- every record needs explicit actor, scope, and visibility semantics;
- collaboration tests must cover conflicting writes and cross-scope access;
- federation must preserve provenance and policy rather than copying every row.

## Rejected alternatives

- **Level 5 only:** insufficient for shared agent work and enterprise governance.
- **Full Level 6 first:** too much surface before the memory kernel is proven.
- **Separate personal and enterprise products:** creates divergent semantics and
  doubles maintenance.
