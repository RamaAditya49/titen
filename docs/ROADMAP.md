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
| Temporal claims, checkpoints, SDK, optional hybrid retrieval | Implemented; Verified locally; Verified live | [agent guide](./agent-guide.md), [contract tests](../tests/contract/), [Cloudflare live evidence](./specs/done/2026-08-01-cloudflare-live-production.md) | FTS remains sufficient; the isolated `titen-test-*` stack additionally proves BGE-M3/Vectorize retrieval with canonical hydration. |
| Identities, visibility, leases, handoffs, MCP, events, Atlas compiler | Implemented; Verified locally | [collaboration architecture](./architecture/collaboration.md), [API reference](./reference/api.md), [contract tests](../tests/contract/) | Local/emulated runtime evidence only. |
| Enterprise policy and governed releases | Implemented; Verified locally | [FRD governance requirements](./FRD.md), [ADR-0002](./decisions/0002-channel-release-not-public-memory.md), [enterprise governance done spec](./specs/done/2026-08-01-enterprise-governance-v03.md), [contract tests](../tests/contract/) | Roles, typed policy, exact-version approvals, channels/releases, retention/legal hold, identity mapping, and governance Atlas lenses pass the shared local Bun/D1 contract; no claim of a provisioned enterprise deployment. |
| Enterprise audit | Implemented; Verified locally | [FRD governance requirements](./FRD.md), [contract tests](../tests/contract/) | No claim of a provisioned enterprise deployment. |
| Six-area operator dashboard and human user administration | Implemented; Verified locally; Verified live | [dashboard guide](./dashboard.md), [browser tests](../tests/), [live adapter smoke](../scripts/verify-dashboard-live.ts), [0.5.5 delivery evidence](./specs/done/2026-08-01-ponytail-zero.md#delivery-evidence) | Default `owner`, forced first-login password change, all six areas, atomic Add User, logout, and sealed sessions pass against the exact `rama-tuf` image and live Cloudflare API through the loopback adapter. |
| Containerized Bun service with `embeddinggemma` | Historical live evidence: 0.3.0 canary | [evaluation record](./testing/EVALS.md), [cycle 1](./testing/2026-07-31-mem0-replacement-cycle1.md), [cycle 2](./testing/2026-07-31-mem0-replacement-cycle2.md), [end-to-end script](../scripts/verify-live.ts) | The evaluated npm 0.3.0 canary ran loopback-only on Wulan with explicit `sqlite-vec`; this is not evidence for a later package, systemd, or Cloudflare. |
| Model-assisted derivation and reflection | Implemented; Verified locally; activation gated | [ADR-0004](./decisions/0004-model-assisted-memory-enrichment.md), [paired work spec](./specs/done/2026-07-31-model-assisted-enrichment-0136.md), [dual-runtime contracts](../tests/contract/enrichment.ts), [model gate](./testing/2026-07-31-enrichment-model-gate-luna-full.md) | Durable jobs, provider, and validator are shipped opt-in. No tested candidate passed the frozen activation gate; revision attestation and three-target runtime smoke remain absent. |
| Replace Wulan Mem0 with Titen | Latest evaluated package 0.4.1: NO-GO | [terminal 0.4.1 gate](./testing/results/2026-08-01-titen-041-replacement-gate/report.md), [historical cycles](./testing/2026-07-31-mem0-replacement-cycle4.md) | The frozen 0.4.1 package failed pre-registered correctness gates. A stable 0.5.x code or release result does not grant Mem0 cutover authority; replacement needs a new release-bound evaluation. |
| Signed federation event exchange | Implemented; Verified locally | [collaboration federation boundary](./architecture/collaboration.md#signed-federation-event-and-canonical-memory-exchange), [contract tests](../tests/contract/) | Exchanges filtered signed events and cursors; event-only remains the default. |
| Canonical recallable-memory federation | Implemented; Verified locally | [FRD federation feature](./FRD.md#13-signed-federation-event-and-canonical-memory-exchange), [completed work spec](./specs/done/2026-08-01-canonical-memory-federation.md), [dual-runtime contracts](../tests/contract/) | Opt-in import covers organization-visible active/disputed direct claims and complete evidence. Private/team memory, enrichment graphs, deletion propagation, and automated transport are excluded. |
| Real Cloudflare deployment; live Vectorize/Workers AI | Implemented; Verified live | [Cloudflare guide](./deployment/cloudflare.md), [0.5.5 delivery evidence](./specs/done/2026-08-01-ponytail-zero.md#delivery-evidence) | The retained Rama Digital `titen-test-*` stack, on the maintainer's own Cloudflare account, proves schema 21, native bindings, scoped BGE-M3/Vectorize retrieval, bounded repair, Cron, auth, persistence, and actual rollback/recovery. It is isolated test production — not general availability, customer cutover, or extraction-model activation. Another account needs its own ready, drain, and query smoke. |
| Provisioned VPS systemd ingress | Rootless Quadlet/Podman verified; private-ingress activation is operator-controlled | [VPS guide](./deployment/vps.md), [secure ingress guide](./deployment/secure-ingress.md), [0.5.5 delivery evidence](./specs/done/2026-08-01-ponytail-zero.md#delivery-evidence) | Exact 0.5.5 API and dashboard survive systemd-user restart on `rama-tuf` at schema 21; both listeners are loopback-only. Copyable Tailscale Serve and Cloudflare Tunnel plus Access paths are documented, but neither is claimed active. |
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

### v0.3 — governance

Adds role/policy enforcement, exact-version approval and governed channel
release workflows, signed audience-scoped context, retention/legal hold,
identity mappings, audit evidence, and governance Atlas projections. The
shared contract is locally verified; external enterprise deployment remains a
separate release claim.

### v1 transport — signed federation event exchange

The current module registers peers, filters outbound events, advances cursors,
verifies signatures, preserves replay conflicts, and supports suspension and
revocation. Network scheduling remains an operator/orchestrator concern.

### v1 canonical recallable-memory federation

The explicit `include_memory` slice turns a filtered active/disputed
organization-visible direct claim and its complete evidence into destination
canonical SQL after peer HMAC and destination import authorization. Replay is
idempotent, the peer is immutably bound to its first successful source
organization, remote policy approval is not inherited, conflicts remain
disputed, and normal context compilation recalls the imported claim. Automated
transport, private/team mappings, enrichment graphs, deletion propagation, and
consensus remain out of scope.

## Dashboard expansion rule

An area has no interactive control or route until its backend capability,
authorization, current-build availability, EARS UI work item, and
failure/rollback evidence are complete. The approved static shell may show a
non-interactive label without claiming the capability shipped.
