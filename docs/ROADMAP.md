# Titen roadmap

Release ordering does not replace the
[requirements workflow](./engineering/requirements-workflow.md). A complex
roadmap item enters implementation only after an EARS work spec and paired plan
exist; it reaches done only after evidence is recorded and both artifacts close
together.

The roadmap is ordered by risk. A phase starts only after the previous gate
passes on both Cloudflare and VPS.

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
