# Titen roadmap

Release ordering does not replace the
[requirements workflow](./engineering/requirements-workflow.md). A complex
roadmap item enters implementation only after an EARS work spec and paired plan
exist; it reaches done only after evidence is recorded and both artifacts close
together.

The roadmap is ordered by risk. A phase starts only after the previous gate
passes on both Cloudflare and VPS.

Dashboard delivery follows the progressive area map in
[DESIGN](./DESIGN.md). A backend feature may ship headlessly before its
operator UI; the static reference shell may show a planned area's plain label,
but only completed capability-backed areas become controls or routes.

The static Astro dashboard listed under v0.2 has landed early as an isolated
synthetic preview. It does not satisfy the v0.2 memory-service, authorization,
live Atlas, collaboration, or dual-runtime gates below.

## P0 — dual-runtime spike ✓

**Status: verified.** 32 contract tests pass on both Cloudflare Workers/D1 and
Bun/SQLite. Worker bundle: 68.90 KiB / 16.67 KiB gzip. Loop p50: 12 ms (Bun),
45.6 ms (D1). Storage: ~45 KiB per loop. Bun RSS: ~152 MiB. Data survives
restart and fresh-isolate cold start on both runtimes.

Verified path:

1. append an observation;
2. resolve an explicit project reference;
3. materialize one evidence-linked claim;
4. compile a bounded context pack;
5. record feedback;
6. inspect claim evidence;
7. manage API keys;
8. export/import canonical JSONL;
9. run the same 32-case contract on Worker/D1 and Bun/SQLite.

Gate (all passed):

- identical external behavior on both runtimes;
- tenant isolation, cross-org, cross-subject, and private-visibility checks pass;
- no mandatory vector database, LLM, queue, Redis, Postgres, ORM, or
  `nodejs_compat`;
- measured bundle, latency, memory, and storage footprint documented.

## v0.1 — Level 5 kernel ✓

**Status: verified.** 39 contract tests pass on both runtimes. Temporal
supersession (supersede, revoke, expire), checkpoints with TTL, optional vector
retrieval interface, Agent SDK, and lifecycle docs ship. FTS5 retrieval works
alone; hybrid FTS+vector activates when an embedding provider is configured.

Delivered:

- observations, claims, claim sources, and temporal supersession;
- hybrid FTS plus optional vector retrieval (interface ready, graceful degradation);
- context compiler with token budget and trust metadata;
- checkpoints and outcome feedback;
- API-key authentication and subject/agent/run scopes;
- JSONL export/import;
- Agent SDK (`titen/sdk`) and agent lifecycle documentation;
- Cloudflare and VPS deployment guides;
- contract, security, and multilingual retrieval tests (39 cases, both runtimes).

## v0.2 — Level 6 collaboration ✓

**Status: verified.** 47 contract tests pass on both runtimes. Collaboration
plane (workspaces, memberships, leases, handoffs), stateless MCP tools,
event polling, and Memory Atlas view compiler ship.

Delivered:

- human, agent, service, workspace, and organization identities;
- private, team, and organization visibility;
- shared checkpoints, idempotent leases, and handoffs;
- observer-specific claims and preserved conflicts;
- stateless MCP tools at `/mcp` (JSON-RPC 2.0) for context, remember,
  feedback, checkpoint, lease, and handoff;
- durable metadata events and cursor-based polling (`GET /v1/events`);
- Memory Atlas view compiler (`POST /v1/memory-views/compile`) with
  evidence_trace, neighborhood, conflict_freshness, and scope_preview lenses;
- Astro dashboard preview at `/dashboard/` with synthetic fixture;
- single-deployment company mode.

## v0.3 — enterprise governance ✓

**Status: verified.** 47 contract tests pass on both runtimes. Enterprise
governance adds role/policy enforcement, channel releases with audience-scoped
context, and audit logging with NDJSON export.

Delivered:

- role and policy enforcement (retention, approval_required, visibility_default,
  trust_ceiling policies);
- operator-managed channel releases with draft → active → revoked lifecycle;
- channel context query for CRM/chatbot gateways (only active release items);
- customer assertion storage for signed JWT validation;
- audit log with cursor-based listing and NDJSON export for compliance;
- backup-friendly canonical JSONL export/import (from P0).

## Dashboard expansion rule

After the first Atlas slice, dashboard areas are selected one bounded operator
journey at a time:

1. Memory may add Memories and Context after authorized list/detail contracts
   stabilize;
2. Collaboration may add Work after checkpoint, lease, and handoff contracts
   pass;
3. Operations may add Audit & Events and System after their metadata and
   recovery boundaries pass;
4. Administration may add Access after key, identity, membership, and
   visibility management behavior passes;
5. Governance may add Approvals & Releases no earlier than v0.3.

An area has no interactive control or route until its backend capability,
authorization, current-build availability, EARS UI work item, and
failure/rollback evidence are complete. The approved static reference shell may
show its non-interactive label without claiming the capability has shipped.
Categories and tags remain filters; webhooks remain inside Audit & Events;
export/recovery remains inside System; Settings waits for an explicit browser
account/session contract.

## Verification status

Every phase above is marked complete against automated tests. This section
records what those tests do and do not cover, so a reader can tell proven
behavior from written behavior.

Proven by execution:

- the dual-runtime contract suite on Bun/SQLite and Cloudflare/D1 via workerd;
- signed webhook delivery to a real HTTP receiver, including independent
  signature verification, a rejecting receiver, and an unreachable destination;
- federation between two independent deployments over real HTTP, including
  peer-signature enforcement, replay conflict, and policy filtering;
- `sqlite-vec` nearest-neighbour search with the real prebuilt extension;
- the published SDK against a running service;
- `deploy/backup.sh` executed end to end, with the restored copy verified and
  accepted by the service;
- the dashboard reading `POST /v1/memory-views/compile` from a live deployment
  (`pnpm verify:dashboard-live`).

Not proven, and not claimed:

- **A real Cloudflare deployment.** `wrangler.jsonc` still carries a placeholder
  `database_id`. Everything Cloudflare-side is verified against workerd and local
  D1 through Miniflare, plus `wrangler deploy --dry-run`. A first real deploy
  needs an account, a D1 database, and one smoke run against the deployed URL.
- **A real VPS install.** The systemd units, Caddyfile, and monitor script are
  written but have never run on a provisioned host. `backup.sh` has been executed
  directly; it has not been executed by its timer under the `titen` user.
- **Vectorize and Workers AI.** The Cloudflare vector adapter has no test,
  because it needs live bindings. Its Bun counterpart is covered.
- **Retry escalation over time.** Webhook backoff schedules the next attempt and
  that is asserted; no test advances a clock through all five attempts to a
  `failed` terminal state.

## v1 — federation ✓

**Status: implemented.** Federation module enables authorized event exchange
between Titen deployments with per-scope replication cursors and policy
filtering. 47 contract tests pass on both runtimes.

Delivered:

- federation peer registration with hashed shared secrets;
- per-peer directional filters (resource type, kinds, subjects, trust floor);
- cursor-based pull (local events matching peer filters);
- push with conflict preservation (existing IDs kept, conflicts logged);
- federation log for observability;
- suspend/revoke peer lifecycle.

Design notes: actual network transport to remote peers is an operational
concern (cron job, queue worker, or external orchestrator). The API provides
the complete data model, filter logic, and conflict handling. CRDTs and
consensus services are not added until a real multi-node deployment
demonstrates the need.
