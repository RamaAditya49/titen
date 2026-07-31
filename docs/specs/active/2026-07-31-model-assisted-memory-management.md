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
---
# Model-assisted memory management documentation

## Problem

Titen stores and retrieves evidence and caller-supplied claims, but it does not
yet automatically classify observations, derive claims, reconcile related
memory, or run higher-order reflection. Existing documentation also uses
`model` for embedding capability, which can be mistaken for LLM extraction.

The project needs an evidence-backed target flow, a reproducible model and
embedding evaluation, and one portable contract for Cloudflare, VPS, and local
computers without presenting proposed behavior as shipped.

## In scope

- Research current evidence-linked memory systems and current platform limits.
- Probe the available OpenAI-compatible Luna, Terra, and Sol routes plus the
  available embedding endpoint without exposing credentials.
- Define separate derivation and reflection lanes, deterministic authority
  boundaries, durable background work, degradation, and recovery.
- Define role-based model selection and locked evaluation gates rather than
  hard-coding provider-specific model names into the product contract.
- Align the PRD, FRD, architecture, data model, API status, security, testing,
  deployment, roadmap, and onboarding documentation.

## Out of scope

- Runtime implementation, schema migration, provider configuration, production
  deployment, or activation of automatic extraction.
- A graph database, Redis, Cloudflare Queue, provider factory, model judge, or
  automatic deletion and conflict resolution.
- A claim that a synthetic pilot establishes a production default, provider
  pricing, or Cloudflare/VPS/local runtime parity.
- Rewriting terminal delivery evidence or historical blueprint material.

## Constraints and risks

- Canonical evidence remains append-only SQL; model and vector output is
  untrusted, derived data.
- Authentication-derived organization, scope, subject, trust ceiling, and
  visibility never enter the model's authority.
- Provider credentials, prompts, raw private memory, raw embeddings, and model
  responses must not enter source control or durable logs.
- Free-form semantic scoring can punish correct translation or paraphrase. The
  report must separate mechanically reliable metrics from pilot limitations.
- Cloudflare and Bun have different scheduling and provider primitives, but the
  core job and validation contract must stay equivalent.

## Acceptance criteria

- **AC-MIM-001 — Ubiquitous:** Titen documentation shall distinguish embedding
  retrieval from LLM derivation and reflection and shall state that neither
  model output nor vector similarity is canonical authority.
- **AC-MIM-002 — Event-driven:** When an authorized observation is committed in
  the target architecture, Titen documentation shall define an atomic,
  versioned enrichment job that does not delay or roll back the canonical write
  when a model is unavailable.
- **AC-MIM-003 — Optional feature:** Where automatic enrichment is unconfigured,
  Titen documentation shall preserve deterministic observation, direct-claim,
  FTS, and context behavior without a model call.
- **AC-MIM-004 — Unwanted behavior:** If a model proposes an unknown source,
  foreign scope, authority mutation, evidence deletion, or autonomous dispute
  resolution, then Titen documentation shall require deterministic rejection
  before any canonical commit.
- **AC-MIM-005 — State-driven:** While enrichment is pending or degraded, Titen
  documentation shall expose that state separately from embedding degradation
  and shall not describe the observation as claim-ready memory.
- **AC-MIM-006 — Event-driven:** When enrichment work is retried or concurrently
  drained, Titen documentation shall require a persistent lease, bounded
  backoff, pipeline fingerprint, and idempotent ADD-only commit.
- **AC-MIM-007 — Optional feature:** Where embeddings are enabled, Titen
  documentation shall limit them to retrieval, duplicate candidates, and
  related-claim selection and shall retain an authorized FTS degradation path.
- **AC-MIM-008 — Event-driven:** When derivation succeeds, Titen documentation
  shall require a bounded schema using the runtime claim kinds and evidence IDs,
  followed by local validation before claim and source-link creation.
- **AC-MIM-009 — Event-driven:** When reflection runs over a bounded claim
  cluster, Titen documentation shall permit only evidence-linked proposals for
  patterns, procedures, duplicates, conflicts, or supersession and shall forbid
  automatic evidence deletion or truth selection.
- **AC-MIM-010 — Optional feature:** Where Titen runs on Cloudflare, VPS, or a
  local computer, Titen documentation shall map the same SQL job contract to
  D1/Cron or Bun/SQLite timer draining and shall avoid requiring Cloudflare
  Queue or another broker without measured need.
- **AC-MIM-011 — Event-driven:** When model-selection evidence is published,
  Titen documentation shall report schema, safety, quality, stability, latency,
  and evaluation limitations separately and shall select the smallest role tier
  only after every hard gate passes.
- **AC-MIM-012 — Unwanted behavior:** If a pilot does not meet the locked
  production gates or uses a biased scorer, then Titen documentation shall not
  label its winner as a production default or infer provider pricing and model
  class from the model name alone.

## Done conditions

The live probes and primary-source research are recorded without secrets; every
authoritative document affected by the target flow distinguishes current from
proposed behavior; the paired plan has reproducible evidence for every
acceptance criterion; workflow, formatting, link, and diff checks pass; and the
spec/plan pair moves to `done` with no unchecked work.
