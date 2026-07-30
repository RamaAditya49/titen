# Titen roadmap and maturity

Release ordering does not replace the
[requirements workflow](./engineering/requirements-workflow.md). Product
requirements, roadmap intent, implementation, and verification are different
claims. This page is the canonical status source; other documents link here
instead of using phase checkmarks.

## Status vocabulary

- **Implemented** — code or documentation exists in this repository.
- **Verified locally** — reproducible repository tests pass against local or
  emulated runtimes.
- **Verified live** — a documented check passed against provisioned external
  infrastructure.
- **Interactive prototype** — usable UI behavior backed by synthetic data, not
  a live service.
- **Planned** — intended behavior without completed implementation evidence.
- **Out of scope** — deliberately excluded from the current product boundary.

A row may list more than one status where, for example, implementation is
locally verified but has no live deployment evidence.

## Maturity matrix

| Capability | Status | Concrete evidence | Boundary |
| --- | --- | --- | --- |
| Evidence kernel: observe, claim, compile, feedback | Implemented; Verified locally | [P0 done spec](./specs/done/2026-07-29-p0-dual-runtime-vertical-spike.md), [contract tests](../tests/contract/) | Shared suite covers Bun/SQLite and local workerd/D1; this is not a live Cloudflare claim. |
| Temporal claims, checkpoints, SDK, optional hybrid retrieval | Implemented; Verified locally | [agent guide](./agent-guide.md), [contract tests](../tests/contract/), [integration tests](../tests/integration/) | FTS works without vectors; live Vectorize/Workers AI is not verified. |
| Identities, visibility, leases, handoffs, MCP, events, Atlas compiler | Implemented; Verified locally | [collaboration architecture](./architecture/collaboration.md), [API reference](./reference/api.md), [contract tests](../tests/contract/) | Local/emulated runtime evidence only. |
| Enterprise policy and governed releases | Planned | [FRD governance requirements](./FRD.md), [ADR-0002](./decisions/0002-channel-release-not-public-memory.md) | Withdrawn from the current route inventory until authorization and lifecycle gates are complete. |
| Enterprise audit | Implemented; Verified locally | [FRD governance requirements](./FRD.md), [contract tests](../tests/contract/) | No claim of a provisioned enterprise deployment. |
| Memory Atlas dashboard | Interactive prototype | [dashboard guide](./dashboard.md), [browser tests](../tests/) | Checked-in UI uses a synthetic fixture; it is not evidence of live API integration. |
| Containerized Bun service with `embeddinggemma` | Verified live | [evaluation record](./testing/EVALS.md), [end-to-end script](../scripts/verify-live.ts) | Evidence covers the recorded container run, not systemd/VPS packaging or Cloudflare. |
| Signed federation event exchange | Implemented; Verified locally | [collaboration federation boundary](./architecture/collaboration.md#signed-federation-event-exchange), [contract tests](../tests/contract/) | Exchanges filtered signed events and cursors. It does not make remote memory canonically recallable. |
| Canonical recallable-memory federation | Planned | [FRD federation feature](./FRD.md#13-signed-federation-event-exchange-and-planned-memory-federation), [collaboration boundary](./architecture/collaboration.md#signed-federation-event-exchange) | Destination ingestion, authorization, indexing, lifecycle, and recall semantics require new work and evidence. |
| Real Cloudflare deployment; live Vectorize/Workers AI | Planned | [Cloudflare guide](./deployment/cloudflare.md) | Configuration and local emulation are not live deployment evidence. |
| Provisioned VPS systemd/Caddy install | Planned | [VPS guide](./deployment/vps.md) | Container execution does not verify the systemd and reverse-proxy path. |
| Agent loop/orchestrator, graph database, global consensus | Out of scope | [PRD non-goals](./PRD.md#12-non-goals) | Titen records coordination and keeps SQL canonical. |

## Release sequence

### P0 — evidence kernel

The first slice establishes canonical observations, evidence-linked claims,
bounded context compilation, feedback, authentication, JSONL portability, and
the same local contract on Bun/SQLite and workerd/D1.

### v0.1 — memory lifecycle

Adds temporal supersession, expiring checkpoints, the Agent SDK, and optional
hybrid retrieval with FTS-only degradation.

### v0.2 — collaboration

Adds identities and memberships, scoped visibility, leases, handoffs,
observer-specific conflicts, MCP, durable metadata events, and Memory Atlas
view compilation. The dashboard remains a separate synthetic-data prototype.

### v0.3 — governance (planned)

Will add role/policy enforcement, approved channel releases, audience-scoped
context, and audit export.

### v1 transport — signed federation event exchange

The current module registers peers, filters outbound events, advances cursors,
verifies signatures, preserves replay conflicts, and supports suspension and
revocation. Network scheduling remains an operator/orchestrator concern.

### Future — canonical recallable-memory federation

A future slice may define how remote evidence becomes destination canonical
records, how destination policy authorizes it, how indexes are rebuilt, and
how compiled context cites and resolves remote lifecycle/conflicts. It must not
be inferred from event transport and needs its own requirements and runtime
verification.

## Dashboard expansion rule

An area has no interactive control or route until its backend capability,
authorization, current-build availability, EARS UI work item, and
failure/rollback evidence are complete. The approved static shell may show a
non-interactive label without claiming the capability shipped.
