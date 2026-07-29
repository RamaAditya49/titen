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

## P0 — dual-runtime spike

Prove the smallest vertical path:

1. append an observation;
2. resolve an explicit project reference;
3. materialize one evidence-linked claim;
4. compile a bounded context pack;
5. record feedback;
6. run the same contract on Worker/D1 and Bun/SQLite.

Gate:

- identical external behavior on both runtimes;
- tenant isolation and provenance checks pass;
- no mandatory vector database or LLM for direct writes;
- measured bundle, CPU, memory, and storage footprint are documented.

## v0.1 — Level 5 kernel

- observations, claims, claim sources, and temporal supersession;
- hybrid FTS plus optional vector retrieval;
- context compiler with token budget and trust metadata;
- checkpoints and outcome feedback;
- API-key authentication and subject/agent/run scopes;
- JSONL export/import;
- one small REST CLI/SDK and generic agent lifecycle instructions;
- Cloudflare and VPS deployment guides;
- contract, security, and multilingual retrieval tests.

## v0.2 — Level 6 collaboration

- human, agent, service, workspace, and organization identities;
- private, team, and organization visibility;
- shared checkpoints, idempotent leases, and handoffs;
- observer-specific claims and preserved conflicts;
- stateless MCP tools for context, remember, feedback, checkpoint, lease, and
  handoff;
- one reference host plugin after REST/MCP parity passes;
- durable metadata events, signed webhooks, and cursor polling for an external
  orchestrator;
- optional read-only Memory Atlas with Evidence Trace, Memory Neighborhood,
  and Conflict & Freshness lenses over authorized canonical records;
- one bounded `POST /v1/memory-views/compile` contract shared by Cloudflare and
  VPS, with no graph database and no dependency from the headless core;
- an Astro dashboard preview at `/dashboard/`, with Atlas as the only active
  route and the remaining canonical area labels shown only as non-interactive
  orientation against a synthetic fixture;
- single-deployment company mode.

## v0.3 — enterprise governance

- role and policy enforcement;
- operator-managed CRM/chatbot channels and explicit audience policy;
- versioned, redacted/localized knowledge releases from exact claim versions;
- authenticated channel context with no anonymous canonical-memory access;
- short-lived signed customer assertions with channel/audience, expiry, replay,
  and issuer/key-rotation validation;
- retention, legal hold, and audit export primitives;
- approval gates for high-trust procedural memory;
- external identity integration boundary;
- backup/restore and disaster-recovery drills;
- Memory Atlas Scope Preview and Knowledge Release lenses; preview computes
  eligibility but never impersonates a principal or grants access.
- Approvals & Releases appears in dashboard navigation only after its separate
  governance UI work item and authorization journeys pass.

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

## v1 — federation when justified

- authorized event exchange between Titen deployments;
- per-scope replication cursors and policy filtering;
- conflict preservation across nodes;
- regional/data-residency controls.

Do not add CRDTs, consensus services, or a hosted control plane until a real
multi-node deployment demonstrates the need.

Do not add a full memory constellation, time-machine playback, stored graph
layout, large-graph pipeline, or separate dashboard repository until bounded
views produce measured operator value and their limits are observed.
