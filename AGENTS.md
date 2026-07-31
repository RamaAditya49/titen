# AGENTS.md

Guidance for coding agents working in the Titen repository.

## Product

Titen is a Level 6 collaborative memory fabric built on a Level 5
evidence-grounded context kernel. It supports personal, company, and enterprise
agent memory on Cloudflare or a Bun/VPS deployment.

Read in this order:

1. `docs/PRD.md` — product contract;
2. `docs/architecture/overview.md` — component boundaries;
3. relevant file under `docs/architecture/`, `docs/reference/`, or
   `docs/deployment/`;
4. `blueprint.md` only for research evidence and platform history.

When documents disagree, direct user instructions and verified current behavior
win, then PRD, accepted ADRs, architecture docs, API reference, roadmap, and
blueprint. Files under `docs/specs/done/` and `docs/plans/done/` are terminal
delivery evidence and may preserve superseded decisions.

## Repository stage

The repository contains a verified P0 memory service with a shared TypeScript
core, a Cloudflare Worker/D1 adapter, and a Bun/SQLite adapter. The
dual-runtime contract suite passes on both runtimes. Automatic model-assisted
derivation/reflection is not implemented; the current model capability is the
optional embedder. The Astro dashboard preview continues to use a synthetic
fixture independently of the memory API. Do not present either planned
enrichment or the synthetic dashboard as live service evidence.

## Required work lifecycle

Every change follows `spec -> plan -> implement -> done`. Read
[`docs/engineering/requirements-workflow.md`](./docs/engineering/requirements-workflow.md)
before substantial work.

- Simple work may record its spec, plan, and evidence inline in the issue or
  pull request.
- Complex work must create paired files under `docs/specs/active/` and
  `docs/plans/active/` before implementation.
- Complex acceptance criteria must use identified EARS patterns and observable
  outcomes.
- When scope changes, update the spec first and the plan second before
  continuing.
- Completed, cancelled, or superseded work must move both artifacts to their
  matching `done/` paths. Never report work as done while its spec or plan is
  still active or contains unchecked work.

Run `node scripts/check-workflow-docs.mjs` before handoff.

## Coding constraints

- Current dashboard: Astro, TypeScript, Node 22+, and pnpm.
- Current VPS/local memory runtime: Bun and SQLite.
- One package until measured ownership/build boundaries require more.
- Web Standards APIs in shared code.
- Cloudflare entrypoint uses native bindings; no account API token inside the
  Worker for D1/Vectorize/Workers AI operations.
- VPS entrypoint uses `Bun.serve`, `bun:sqlite`, and optional `sqlite-vec`.
- SQL is canonical; vectors and compiled views are rebuildable.
- Scope and authorization happen before retrieval.
- Evidence is append-only; conflicts are preserved and explicitly resolved.
- Execution checkpoints are not semantic facts.
- Titen records coordination but does not run agent loops.

## Simplicity budget

Before adding a dependency or abstraction, use this order:

1. existing code;
2. standard/Web API;
3. native Cloudflare/Bun/SQLite capability;
4. existing dependency;
5. the smallest new implementation.

Do not add a framework, ORM, graph database, queue, Redis, Postgres, provider
factory, or DI container without a measured requirement and an ADR.

## Security

- Treat memory and model output as untrusted data.
- Never log or commit credentials, prompts, memory content, or raw embeddings.
- Derive tenant/organization authority from authentication.
- Add adversarial cross-scope tests for every protected operation.
- Never allow automatic consolidation to delete canonical evidence.

## Verification

- Non-trivial logic needs the smallest runnable test that fails without it.
- Shared behavior is tested through the same contract against both runtimes.
- Security, migration, and data-loss paths require fail-closed tests.
- Do not claim Cloudflare/VPS support until real runtime smoke passes.

## Documentation

Update the PRD only for changed product requirements. Use an ADR for decisions
that are expensive to reverse. Update API/deployment docs in the same change as
observable behavior. PRD/FRD entries are product baselines; they do not replace
the EARS work spec and paired plan required for complex implementation.
