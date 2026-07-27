# ADR-0003: Memory Atlas is an authorized derived projection

- Status: accepted
- Date: 2026-07-27
- Decision owners: Titen maintainers

## Context

Operators need to understand why an agent remembered a claim, which evidence
supports it, whether it is stale or disputed, and which scope may inspect it. A
whole-database graph is not a safe answer: it is noisy, can imply false
relationships, and can leak the existence or topology of private records.

Titen must remain useful as a headless service on Cloudflare and Bun/VPS. The
visual surface must not introduce a graph database, frontend dependency, or
separate release requirement into the Level 5 kernel.

## Decision

Titen will define **Memory Atlas** as an optional, read-only operator surface in
the same repository behind a separate integration boundary.

Memory Atlas consumes authenticated REST contracts. It never imports SQL,
runtime bindings, or storage adapters from the dashboard layer. Every graph,
trace, cluster, label, layout, and count is a rebuildable projection of records
already authorized for the requesting principal. SQL remains canonical.

The initial v0.2 lenses are:

- Evidence Trace;
- Memory Neighborhood;
- Conflict & Freshness.

v0.3 adds Scope Preview and Knowledge Release inspection after governance and
channel-isolation gates pass. Full-dataset constellation, temporal playback,
stored layout, and a separate visualization repository require measured need
and a later decision.

`POST /v1/memory-views/compile` is the read-only projection boundary. The server
authorizes before traversal, bounds nodes/edges/work, re-authorizes canonical
records during hydration, and omits unauthorized topology without including it
in aggregate counts. The operation is not added to the ordinary-agent MCP
profile.

No renderer or visualization library is selected by this ADR. A future
implementation may lazy-load a browser renderer only inside Memory Atlas; the
headless server and core package must not require it.

## Consequences

- operators can diagnose provenance, conflicts, freshness, and visibility
  without opening the database;
- disabling Memory Atlas changes no REST/MCP memory or collaboration behavior;
- both runtimes must expose the same view contract, but may serve static UI
  assets differently or not at all;
- topology-leakage, impersonation-preview, stale-projection, and resource-limit
  fixtures become release gates;
- the first implementation remains bounded and read-only rather than a general
  graph explorer.

## Rejected alternatives

- **Make graph storage canonical:** duplicates temporal and authorization state
  and adds unnecessary operational infrastructure.
- **Render the full tenant graph:** creates clutter, resource risk, and hidden
  topology leakage.
- **Expose Memory Atlas through ordinary-agent MCP:** expands the minimal tool
  surface for an operator-only use case.
- **Create a separate repository now:** contracts, security policy, and release
  gates would drift before ownership or release cadence justifies the split.
- **Depend on Graphify at runtime:** Graphify is useful design inspiration for
  provenance and community navigation, but Titen's runtime memory model and
  authorization semantics are different.

## Related

- [Memory Atlas architecture](../architecture/memory-atlas.md)
- [Memory Atlas work spec](../specs/done/2026-07-27-memory-atlas.md)
- [ADR-0002](./0002-channel-release-not-public-memory.md)
