# Agent-memory landscape

Research snapshot: 2026-07-26. This document records product lessons, not
endorsements, compatibility promises, or benchmark claims for Titen.

Repositories inspected at:

- Mem0 `b357a5a1b03c299ec8229c268e63cfac0f7c6566`;
- Honcho `3ee890fa6f55388abd23b7660fb726e14d83459d`.

Upstream projects move quickly. Re-check their current code, documentation, and
licenses before adopting an implementation detail.

## Evaluation lens

Titen compares memory systems across six questions:

1. What is canonical: raw evidence, a derived memory, a representation, or a
   generated answer?
2. Can a returned memory explain its provenance and temporal validity?
3. How are human, agent, observer, subject, and execution scopes separated?
4. Does recall produce search hits or compile task-specific context?
5. What happens when models/vectors fail or return stale data?
6. What is required to run the system privately on Cloudflare or a small VPS?

## Mem0

[Mem0](https://github.com/mem0ai/mem0) positions itself as a universal memory
layer for AI agents, with library, self-hosted server, and managed-platform
paths. Its public API centers on adding, searching, listing, updating, deleting,
and inspecting memory across user, agent, and run scopes.

The April 2026 algorithm described in its README shifted toward:

- one-pass ADD-only extraction rather than model-selected update/delete;
- agent-generated facts as first-class inputs;
- entity linking;
- semantic, BM25, and entity retrieval fused in parallel;
- temporal reasoning during retrieval.

### Strengths

- mature developer surface, SDKs, integrations, and migration paths;
- managed and self-hosted deployment choices;
- broad provider ecosystem;
- public benchmark harness and strong attention to long-conversation recall;
- current algorithm direction favors append-only accumulation and multi-signal
  retrieval.

### Trade-offs for Titen's goals

- the broad provider and integration surface creates a larger compatibility and
  testing matrix than a lightweight dual-runtime core needs;
- current published headline results describe the managed platform, whose
  proprietary optimizations are not all in the OSS SDK;
- generic memory CRUD does not by itself model evidence versus claims,
  checkpoint state, work leases, handoffs, or observer-specific disagreements;
- default library behavior depends on model and embedding services, while Titen
  requires a useful FTS-only path.

Titen should learn from Mem0's API ergonomics, ADD-only direction, temporal
retrieval, and reproducible eval work without copying its provider matrix or
claiming drop-in compatibility.

## Honcho

[Honcho](https://github.com/plastic-labs/honcho) is reasoning-first memory for
stateful agents. Its model treats humans, agents, groups, projects, and ideas as
peers that participate in sessions. Internal collections keyed by
`(observer, observed)` support self-representation and one peer's model of
another.

Its documented loop is:

```text
store messages/events → reason asynchronously → query → inject into an LLM
```

The current server includes a single-call Deriver, a tool-using Dialectic recall
agent, scheduled Dreamer specialists, session summaries, hybrid Postgres
FTS/pgvector retrieval, and managed or Docker-based self-hosting.

### Strengths

- human and agent identities are first-class under one peer model;
- observer/observed collections make perspective explicit;
- strong session, representation, and natural-language insight surfaces;
- asynchronous derivation separates ingestion latency from reasoning work;
- MCP and agent integrations are core product paths.

### Trade-offs for Titen's goals

- the Python/FastAPI, Postgres/pgvector, background-worker, cache, and multi-agent
  reasoning stack is heavier than Titen's intended Worker/D1 or Bun/SQLite
  footprint;
- agentic recall and dream consolidation can add model latency, cost, and more
  behavior to evaluate;
- peer modeling emphasizes changing representations and psychology, while Titen
  needs evidence-linked operational memory plus explicit work coordination;
- AGPL-3.0 is a valid open-source choice but creates different distribution and
  network-use obligations than Titen's Apache-2.0 license.

Titen should adopt the lesson that perspective belongs in the data model, not
copy Honcho's reasoning stack or peer-chat surface into the P0 kernel.

## Andrej Karpathy's LLM Wiki pattern

Karpathy's [LLM Wiki idea file](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
is a pattern, not an agent-memory server. It replaces repeated rediscovery over
raw documents with a persistent, LLM-maintained Markdown knowledge artifact.

It separates:

1. immutable raw sources;
2. an LLM-authored, interlinked wiki;
3. a schema/instruction document that governs maintenance.

The core operations are ingest, query, and lint. `index.md` supports navigation,
while an append-only `log.md` records the wiki's evolution. At moderate personal
scale, this can remain understandable, Git-native, and useful without a vector
database.

### Lessons for Titen

- compile knowledge once and let future work compound on a maintained artifact;
- keep raw evidence distinct from derived synthesis;
- make maintenance rules inspectable and versioned;
- lint for contradictions, stale claims, missing links, and data gaps;
- prefer simple lexical/index navigation until scale proves it insufficient.

### Boundary

A Markdown wiki does not by itself define tenant isolation, concurrent writes,
temporal claim state, execution leases, policy enforcement, or bounded API
contracts. Titen applies the compounding-artifact idea to structured,
evidence-linked records and generates a context pack rather than treating a wiki
page as authoritative truth.

## Current context-engineering practice

Anthropic describes context as a finite attention budget and recommends the
smallest high-signal set of tokens that enables the desired behavior. It also
identifies compaction, structured note-taking, just-in-time retrieval, and
separate subagent context as tools for long-running agents.

Titen operationalizes that direction by:

- filtering authorization before ranking;
- separating execution state from factual memory;
- compiling under an explicit token budget;
- including provenance, trust, time, conflicts, and degraded capabilities;
- recording selected IDs and outcome feedback rather than storing raw prompts by
  default.

## Positioning summary

| Dimension         | Mem0                                | Honcho                                               | LLM Wiki                        | Titen target                                                    |
| ----------------- | ----------------------------------- | ---------------------------------------------------- | ------------------------------- | --------------------------------------------------------------- |
| Primary unit      | memory/fact                         | peer message, conclusion, representation             | Markdown page                   | observation, claim, context item, checkpoint, knowledge release |
| Canonical basis   | memory records                      | peer/session records and derived representations     | immutable raw files             | immutable observations plus append-only history                 |
| Perspective       | user/agent/run scope                | explicit observer/observed peer pair                 | author/wiki conventions         | explicit actor, subject, observer, agent, and visibility        |
| Recall            | search plus temporal/entity signals | search, representation, context, or Dialectic answer | agent navigates maintained wiki | deterministic bounded context compilation                       |
| Coordination      | outside core focus                  | multi-peer sessions                                  | outside pattern                 | checkpoints, leases, handoffs, and outcomes                     |
| Minimum self-host | configurable memory stack/server    | FastAPI plus Postgres stack                          | files, Git, and an agent        | Worker/D1 or one Bun/SQLite process                             |
| License           | Apache-2.0                          | AGPL-3.0                                             | idea file/gist                  | Apache-2.0                                                      |

## Titen's falsifiable advantages

These are design hypotheses until P0 measurements exist:

1. **More auditable recall:** every selected claim exposes visible evidence,
   trust, temporal state, and conflicts.
2. **Safer parallel work:** private context, checkpoints, leases, and handoffs
   coordinate agents without turning state into truth.
3. **Smaller operational floor:** canonical memory works with D1 or SQLite and
   FTS5; models and vectors remain optional capabilities.
4. **Runtime portability:** one external contract and shared TypeScript core run
   on Cloudflare and a self-hosted Bun process.
5. **Honest degradation:** model/vector failure is explicit and repairable rather
   than a failed canonical write or silent empty answer.
6. **Separated disclosure:** evidence trust, internal visibility, and
   customer-facing channel release are independent, so verified memory is not
   automatically public.

P0 must measure bundle size, idle RSS, latency, retrieval quality, and failure
behavior before these become performance claims.

## Practices adopted

- immutable source evidence and derived, revisable synthesis;
- ADD-first ingestion and explicit lifecycle transitions;
- lexical retrieval as a dependable baseline;
- optional multi-signal retrieval with canonical hydration;
- observer-aware memory and conflict preservation;
- token-budgeted context rather than unbounded recall dumps;
- feedback and reproducible evaluation;
- no graph database, provider zoo, or reasoning loop without measured need.

## Primary sources

- [Mem0 repository](https://github.com/mem0ai/mem0) and [memory benchmark harness](https://github.com/mem0ai/memory-benchmarks)
- [Honcho repository](https://github.com/plastic-labs/honcho) and [documented agent architecture](https://github.com/plastic-labs/honcho/blob/main/CLAUDE.md)
- [Andrej Karpathy: LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
- [Anthropic: effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Titen's detailed research blueprint](../../blueprint.md)
