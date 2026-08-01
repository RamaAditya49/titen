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
- **Interactive prototype** — usable UI behavior without a live service.
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
| Memory Atlas dashboard | Implemented; Verified locally | [dashboard guide](./dashboard.md), [browser tests](../tests/), [live adapter smoke](../scripts/verify-dashboard-live.ts) | Live health/readiness and four authorized Atlas lenses pass through the same-origin adapter against temporary Bun/SQLite; this is not a provisioned external deployment claim. |
| Containerized Bun service with `embeddinggemma` | Historical live evidence: 0.3.0 canary | [evaluation record](./testing/EVALS.md), [cycle 1](./testing/2026-07-31-mem0-replacement-cycle1.md), [cycle 2](./testing/2026-07-31-mem0-replacement-cycle2.md), [end-to-end script](../scripts/verify-live.ts) | The evaluated npm 0.3.0 canary ran loopback-only on Wulan with explicit `sqlite-vec`; this is not evidence for a later package, systemd, or Cloudflare. |
| Model-assisted derivation and reflection | Implemented; Verified locally; activation gated | [ADR-0004](./decisions/0004-model-assisted-memory-enrichment.md), [paired work spec](./specs/done/2026-07-31-model-assisted-enrichment-0136.md), [dual-runtime contracts](../tests/contract/enrichment.ts), [model gate](./testing/2026-07-31-enrichment-model-gate-luna-full.md) | Durable jobs, provider, and validator are shipped opt-in. No tested candidate passed the frozen activation gate; revision attestation and three-target runtime smoke remain absent. |
| Replace Wulan Mem0 with Titen | Historical 0.3.0 evaluation: NO-GO | [cycle 1](./testing/2026-07-31-mem0-replacement-cycle1.md), [cycle 2](./testing/2026-07-31-mem0-replacement-cycle2.md), [cycle 3](./testing/2026-07-31-mem0-replacement-cycle3.md), [cycle 4](./testing/2026-07-31-mem0-replacement-cycle4.md) | The evaluated 0.3.0 canary did not pass ranking, abstention, native LLM, production migration, real Cloudflare/local, exact resource, and soak gates. This does not describe later source or package state. |
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

### Future — model-assisted memory management

Adds optional asynchronous derivation and reflection through one leased SQL job
contract on D1 and SQLite. It remains disabled until the locked multilingual
model gate, dual-runtime replay, crash/lease tests, and real Cloudflare, VPS, and
local-computer smokes pass. Embedding remains candidate retrieval, not a memory
decision.

### v0.2 — collaboration

Adds identities and memberships, scoped visibility, leases, handoffs,
observer-specific conflicts, MCP, durable metadata events, Memory Atlas view
compilation, and an optional live same-origin dashboard client.

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
