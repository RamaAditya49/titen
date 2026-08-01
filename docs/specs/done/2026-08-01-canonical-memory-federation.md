---
work_id: canonical-memory-federation-2026-08-01
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-01
owner: maintainers
---

# Canonical recallable-memory federation

## Problem

Signed federation currently transports metadata events only. An explicitly
authorized peer cannot transfer the evidence and claim behind an event into the
destination canonical store, so the destination cannot recall that memory.

## Scope

- Extend the existing signed pull/push protocol with an opt-in versioned memory
  bundle for claim events.
- Federate organization-visible direct claims and their complete evidence.
- Preserve source IDs, actors, timestamps, hashes, lifecycle state, project
  reference, and contradictory evidence.
- Bind the first successfully imported source organization immutably to its
  destination peer so one signer cannot mix provenance domains.
- Import under destination organization authority, enqueue rebuildable indexes,
  and make active/disputed claims available to normal context compilation.
- Keep SQL canonical and the shared core identical on Cloudflare/D1 and
  Bun/SQLite.

## Out of scope

- Replicating credentials, workspaces, memberships, private/team memory,
  enrichment execution state, or vectors.
- Automatic peer transport, consensus, CRDTs, deletion propagation, or
  bidirectional conflict resolution.
- Treating a peer signature as a local human/agent identity.

## Constraints and risks

- Existing event-only clients must remain compatible.
- Source and destination policy must both authorize the claim bundle.
- A replay or conflicting reuse of a remote record ID must not create or mutate
  canonical evidence.
- A failed bundle must not leave a partial claim graph.

## Acceptance criteria

- **AC-FMEM-001 — Optional feature:** Where `include_memory=true` is requested
  by a principal with export authority and an explicit claim filter, Titen
  shall attach a versioned organization-visible claim bundle only when the
  claim and all evidence are currently authorized to that principal.
- **AC-FMEM-002 — Unwanted behavior:** If a bundle contains private/team data,
  incomplete evidence, a foreign project domain, malformed hashes/timestamps,
  `policy_approved` trust, trust above destination authority, or fails the
  destination claim filter, then Titen shall reject it before canonical
  mutation. Only the local claim-approval workflow may assign
  `policy_approved`.
- **AC-FMEM-003 — Event-driven:** When an owned active peer receives a valid
  HMAC-signed bundle under federation and import authority, Titen shall
  atomically append destination observations, evidence links, claim, history,
  FTS projection, optional index work, federation provenance, audit, and event
  records inside the authenticated destination organization.
- **AC-FMEM-004 — Unwanted behavior:** If a push is unsigned, tampered, owned
  by another organization/principal, or reuses a remote record identity with a
  different payload, reuses an event identity for a different canonical graph,
  or names a source organization different from the peer's immutable first-use
  binding, then Titen shall fail closed without disclosing or mutating
  destination memory.
- **AC-FMEM-005 — State-driven:** While an identical signed event or record is
  replayed, Titen shall create no duplicate canonical observation, claim,
  evidence link, or provenance row and shall return an explicit `replayed`
  result.
- **AC-FMEM-006 — Event-driven:** When a valid active or disputed remote claim
  is imported, Titen shall preserve source provenance and contradictory
  evidence and make the destination claim recallable through the normal
  project/subject-scoped context compiler.
- **AC-FMEM-007 — Ubiquitous:** Titen shall implement the same migration,
  authorization, import, and recall contract on Cloudflare/D1 and Bun/SQLite
  without a new dependency or hosted service.

## Done conditions

- Dual-runtime contract tests cover successful recall, provenance, conflict
  preservation, cross-organization denial, unsigned/tampered input, replay,
  filter denial, and migration readiness.
- PRD, FRD, architecture, API, data model, roadmap, and threat model describe
  only the shipped boundary.
- Workflow, type, unit/contract, build, and Ponytail debt checks pass.

## Closure evidence

The shared Cloudflare/D1 and Bun/SQLite contract imports one signed disputed
claim with supporting and contradicting evidence, recalls it through normal
project/subject context compilation, and proves immutable provenance. The same
fixture rejects cross-organization, unsigned, tampered, scope-limited,
policy-filtered, private, `policy_approved`, orphan-evidence, changed-identity,
changed-event-graph, and changed-source-organization input before canonical
mutation. A concurrent first-use race commits one source organization and its
complete graph only; the SQL trigger rejects direct source spoofing. Exact and
alternate-event replay leave observations, claims, provenance, and import-audit
counts unchanged.

Migration 19 is forward-only, atomic on failure, and shared by both runtime
adapters. Full API, integration, SDK/type, Worker dry-build, route-doc,
workflow, and diff checks passed without adding a dependency or deployment
service. Deployment and publication remain the parent release workstream; this
slice changes no GitHub, npm, or remote runtime state.
