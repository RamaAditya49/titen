---
work_id: model-assisted-memory-management-docs
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-07-31
updated: 2026-07-31
review_after: 2026-08-14
owner: CADIS
spec: docs/specs/active/2026-07-31-model-assisted-memory-management.md
---
# Plan

- [ ] Audit current runtime truth, prior decisions, documentation drift, and
  deployment boundaries without changing the dirty primary checkout.
- [ ] Research current memory-management patterns and official OpenAI,
  Cloudflare, Bun/SQLite, and embedding guidance.
- [ ] Run bounded live Luna/Terra/Sol derivation and reflection probes plus a
  separate embedding retrieval pilot; publish limitations and no secrets.
- [ ] Record the reversible architecture decision and role-based model policy.
- [ ] Align product, feature, architecture, reference, security, evaluation,
  deployment, roadmap, and onboarding documentation.
- [ ] Run independent evidence and portability reviews; correct unsafe,
  overstated, stale, or non-portable claims.
- [ ] Run repository workflow, formatting, link, and diff gates, then move this
  pair to `done`, commit with required attribution, and push the isolated branch.

## Acceptance evidence mapping

- AC-MIM-001: PRD/FRD and memory lifecycle definitions for LLM versus embedding.
- AC-MIM-002: ADR and lifecycle transaction/outbox sequence.
- AC-MIM-003: optional capability and deterministic direct-claim path.
- AC-MIM-004: validator boundary and security threat/fixture matrix.
- AC-MIM-005: capability, readiness, and pending-context documentation.
- AC-MIM-006: job lifecycle, lease, retry, fingerprint, and idempotency contract.
- AC-MIM-007: retrieval architecture, embedding pilot, and FTS fallback.
- AC-MIM-008: derivation schema, runtime enum alignment, and validation gates.
- AC-MIM-009: separate reflection lane and ADD-only proposal authority.
- AC-MIM-010: Cloudflare and Bun/VPS/local deployment mappings.
- AC-MIM-011: frozen pilot protocol, metrics, and pre-production gate.
- AC-MIM-012: evidence report limitations and non-production recommendation.

## Security, migration, deployment, smoke, and rollback

This slice changes documentation only. It performs no migration, provider
configuration, deployment, or production activation. Live probes use synthetic
memory and an existing dedicated credential read only inside its server; the
credential is never printed or written to the repository. Rollback is a revert
of the documentation commit. Runtime implementation requires a new active spec,
migration plan, dual-runtime contract tests, and real Cloudflare/VPS/local smoke.
