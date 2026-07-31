---
work_id: model-assisted-memory-management-docs
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
spec: docs/specs/done/2026-07-31-model-assisted-memory-management.md
---
# Plan

- [x] Audit current runtime truth, prior decisions, documentation drift, and
  deployment boundaries without changing the dirty primary checkout.
- [x] Research current memory-management patterns and official OpenAI,
  Cloudflare, Bun/SQLite, and embedding guidance.
- [x] Run bounded live Luna/Terra/Sol derivation and reflection probes plus a
  separate embedding retrieval pilot; publish limitations and no secrets.
- [x] Record the reversible architecture decision and role-based model policy.
- [x] Align product, feature, architecture, reference, security, evaluation,
  deployment, roadmap, and onboarding documentation.
- [x] Run independent evidence and portability reviews; correct unsafe,
  overstated, stale, or non-portable claims.
- [x] Run repository workflow, formatting, link, and diff gates, then move this
  pair to `done`, commit with required attribution, and push the isolated branch.

## Acceptance evidence

- AC-MIM-001: PRD, FRD, README, and lifecycle docs separate embedding
  retrieval from untrusted LLM proposals and deterministic authority.
- AC-MIM-002: ADR-0004 and the data model atomically enqueue derivation with an
  eligible observation while reflection uses a separate snapshot-bound job.
- AC-MIM-003: API and agent guides preserve the implemented caller-supplied
  direct-claim path with `model_used: false` and FTS-only operation.
- AC-MIM-004: threat-model controls and evaluation gates reject foreign IDs,
  authority fields, evidence deletion, publication, and dispute resolution.
- AC-MIM-005: FRD/API/lifecycle docs label enrichment readiness as proposed and
  pending observations as not claim-ready context.
- AC-MIM-006: ADR/data-model docs define leases, bounded retry, lane-specific
  identities, fingerprints, and atomic ADD-only result commits.
- AC-MIM-007: the retrieval design and embedding pilot retain authorized FTS
  degradation and limit cosine similarity to candidate selection.
- AC-MIM-008: evaluation and lifecycle docs use exact runtime claim enums,
  supplied evidence IDs, local schema validation, and zero-invalid-commit gates.
- AC-MIM-009: reflection is a bounded scheduled lane whose outputs remain
  evidence-linked ADD/link/lifecycle-review proposals.
- AC-MIM-010: deployment guides map the same SQL contract to D1/Cron and
  Bun/SQLite on VPS/local without requiring Queue, Redis, or another broker.
- AC-MIM-011: the dated report publishes raw schema, abstention, reflection,
  latency, stability limitations, prompt/artifact hashes, and a locked gate.
- AC-MIM-012: the report excludes its biased derivation scorer from ranking,
  treats 9router routes as opaque, and labels Sol a canary rather than a default.

## Security, migration, deployment, smoke, and rollback

This slice changes documentation only. It performs no migration, provider
configuration, deployment, or production activation. Live probes use synthetic
memory and an existing dedicated credential read only inside its server; the
credential is never printed or written to the repository. Rollback is a revert
of the documentation commit. Runtime implementation requires a new active spec,
migration plan, dual-runtime contract tests, and real Cloudflare/VPS/local smoke.

## Verification

- Live LLM pilot: 333/333 scored HTTP calls completed across 25 derivation and
  12 reflection fixtures, three repetitions, with retained raw/summary hashes;
  no credential or private user content entered the repository.
- Embedding pilot: 24 synthetic claims/queries plus four no-result probes; its
  metrics are explicitly marked directional because the fixture/scorer/raw
  manifest is not independently reproducible from repository evidence.
- `pnpm test:api`: passed; Worker dry-build 223.06 KiB / 49.49 KiB gzip, 71
  Cloudflare D1 cases, and 90 Bun/vector/SDK cases.
- `pnpm test:integration`: passed, 68 cases across 11 files after rebasing onto
  current `origin/main`.
- `pnpm check:workflow`, workflow self-test, `pnpm check:routes`, relative
  Markdown-link audit, and `git diff --check`: passed after closure.
- Eight bounded research, evaluation, portability, and independent-review
  workstreams were completed across the available subagent slots; all reported
  blockers were corrected.
- The dirty primary checkout was inspected read-only and remained untouched;
  all documentation changes were isolated on the delivery branch.
