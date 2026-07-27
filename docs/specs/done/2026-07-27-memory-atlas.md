---
work_id: titen-memory-atlas-docs
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-27
updated: 2026-07-27
owner: titen-maintainers
---

# Memory Atlas product and architecture contract

## Problem

Titen can expose evidence, temporal claims, conflicts, context selection, and
feedback through APIs, but operators also need a safe way to understand why an
agent remembered something. A generic whole-database graph would be visually
noisy and could leak hidden topology, while omitting visual observability would
make incorrect or stale memory harder to diagnose.

## Scope

- define Memory Atlas as an optional read-only observability surface;
- place the minimal evidence, neighborhood, conflict, and freshness lenses in
  v0.2;
- place scope preview and channel knowledge-release inspection in v0.3;
- define an authorized, bounded, rebuildable projection contract;
- align product, architecture, API, data, security, deployment, and evaluation
  documentation.

## Out of scope

- implementing a dashboard, renderer, CSS, or visualization dependency;
- adding a graph database or canonical graph tables;
- changing the six-tool ordinary-agent MCP profile;
- full-dataset constellation, 3D graph, time-machine playback, or stored layout;
- enabling GitHub Actions or deploying any surface.

## EARS acceptance criteria

- **AC-ATLAS-001 — Ubiquitous:** Titen shall treat every Memory Atlas graph, trace, layout, cluster, and summary as a derived projection of authorized canonical SQL records rather than canonical memory.
- **AC-ATLAS-002 — Event-driven:** When an authorized principal compiles a Memory Atlas view, Titen shall return a bounded graph containing only nodes, edges, labels, counts, and provenance that the principal may inspect.
- **AC-ATLAS-003 — Unwanted behavior:** If a requested node, edge endpoint, scope, audience, or customer subject is unauthorized, then Titen shall omit it without revealing its content, label, relationship, or existence through aggregate counts.
- **AC-ATLAS-004 — State-driven:** While a cache, layout, vector hit, or community assignment is stale, Titen shall re-authorize canonical records during hydration and shall exclude revoked, expired, superseded, disputed-ineligible, or otherwise hidden data.
- **AC-ATLAS-005 — Optional feature:** Where Memory Atlas is disabled or its renderer is unavailable, Titen shall preserve the complete headless REST/MCP memory, collaboration, and channel-serving contract.
- **AC-ATLAS-006 — Optional feature:** Where v0.3 governance lenses are enabled, Titen shall require explicit impersonation-preview or release-inspection authority and shall never let preview grant access to the selected principal or audience.
- **AC-ATLAS-007 — Unwanted behavior:** If a view exceeds configured traversal or response limits, then Titen shall truncate only after authorization, report bounded authorized-result metadata, and avoid unbounded traversal or layout work.
- **AC-ATLAS-008 — Ubiquitous:** Titen shall keep Memory Atlas in the same repository behind a separate integration boundary, shall expose it through authenticated REST rather than ordinary-agent MCP, and shall require no dashboard dependency in the memory kernel.

## Release boundary

- P0 and v0.1 remain headless and unchanged.
- v0.2 adds read-only Evidence Trace, Memory Neighborhood, and Conflict &
  Freshness lenses after the collaboration/security gate.
- v0.3 adds Scope Preview and Knowledge Release lenses after governance policy
  and release isolation pass.
- Full constellation and temporal playback require measured operator value and
  a later EARS spec.

## Done conditions

- all affected canonical documents use the same phases and invariants;
- endpoint, lens names, security rules, and test requirements agree;
- formatting, links, workflow checks, and whitespace checks pass;
- this spec and its plan move to matching `done/` paths together.
