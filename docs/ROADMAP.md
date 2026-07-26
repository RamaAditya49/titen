# Titen roadmap

The roadmap is ordered by risk. A phase starts only after the previous gate
passes on both Cloudflare and VPS.

## P0 — dual-runtime spike

Prove the smallest vertical path:

1. append an observation;
2. materialize one evidence-linked claim;
3. compile a bounded context pack;
4. record feedback;
5. run the same contract on Worker/D1 and Bun/SQLite.

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
- Cloudflare and VPS deployment guides;
- contract, security, and multilingual retrieval tests.

## v0.2 — Level 6 collaboration

- human, agent, service, workspace, and organization identities;
- private, team, and organization visibility;
- shared checkpoints, idempotent leases, and handoffs;
- observer-specific claims and preserved conflicts;
- stateless MCP tools for remember, context, checkpoint, and handoff;
- single-deployment company mode.

## v0.3 — enterprise governance

- role and policy enforcement;
- retention, legal hold, and audit export primitives;
- approval gates for high-trust procedural memory;
- external identity integration boundary;
- backup/restore and disaster-recovery drills.

## v1 — federation when justified

- authorized event exchange between Titen deployments;
- per-scope replication cursors and policy filtering;
- conflict preservation across nodes;
- regional/data-residency controls.

Do not add CRDTs, consensus services, or a hosted control plane until a real
multi-node deployment demonstrates the need.
