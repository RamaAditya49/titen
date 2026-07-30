---
work_id: titen-core-ranking-dependency-failures
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: wulan
---

# Core ranking and dependency-failure semantics

## Problem

Hybrid ranking compares candidate-set-normalized lexical relevance with absolute vector similarity, so a narrow band of strong semantic matches can be buried. Confidence is applied as an undocumented multiplier rather than an auditable weighted factor. During index drain, embedder or vector-store failures escape as generic internal errors even though pending outbox rows remain retryable.

## Scope

- Normalize vector similarity within the retrieved candidate set before blending with normalized lexical relevance.
- Make confidence an explicit score component and documented weight, with one transparent additive formula.
- Translate embedder and vector-store failures during index drain into safe retryable `503 UNAVAILABLE` errors.
- Preserve pending outbox rows on either dependency failure and expose bounded pending/retryability metadata.
- Add regression and outage tests against the shared core contract where applicable.

## Out of scope

- Changes to vector adapters, storage schema, authentication, migrations, or Shinta-owned issues.
- Learned ranking weights, remote provider retries, automatic backoff, or a new dependency.
- Changing context compilation's existing lexical degradation behavior during vector outages.

## Constraints and risks

- Ranking must remain deterministic and all public score components must agree with constants and documentation.
- Outage responses must not expose provider messages, embeddings, claim content, or infrastructure detail.
- Outbox rows may be marked done only after successful embedding and store upsert.
- The ranking change intentionally changes public ordering and scores; rollback is a source-only revert with no data migration.

## EARS acceptance criteria

- **AC-CORE-001 — Event-driven:** When at least two candidates carry positive vector similarities, Titen shall min-max normalize those similarities within that candidate set before taking the maximum of lexical and vector relevance, with a zero span assigning relevance `1` to every positively matched candidate and similarity `0` contributing no vector signal.
- **AC-CORE-002 — State-driven:** While vector similarities occupy a narrow non-zero band, Titen shall preserve their relative ordering after normalization so the strongest exact semantic match can contribute relevance `1` rather than its provider's uncalibrated absolute score.
- **AC-CORE-003 — Ubiquitous:** Titen shall calculate rank as the documented additive weighted sum of relevance, trust, recency, utility, conflict, and confidence, and shall expose every factor in `score_components` using constants whose weights sum to `1`.
- **AC-CORE-004 — Event-driven:** When otherwise comparable candidates have different confidence values, Titen shall rank the higher-confidence candidate above the lower-confidence candidate and expose the confidence contribution for audit.
- **AC-CORE-005 — Unwanted behavior:** If the embedding dependency fails during index drain, then Titen shall return `503 UNAVAILABLE` with safe metadata identifying `dependency=embedder`, `retryable=true`, and the bounded pending count, while leaving selected outbox rows pending.
- **AC-CORE-006 — Unwanted behavior:** If the vector-store dependency fails during index drain, then Titen shall return `503 UNAVAILABLE` with safe metadata identifying `dependency=vector_store`, `retryable=true`, and the bounded pending count, while leaving selected outbox rows pending.
- **AC-CORE-007 — Event-driven:** When a previously failed index drain is retried after dependency recovery, Titen shall index the pending claims and mark their outbox rows done without duplicate canonical writes.
- **AC-CORE-008 — Ubiquitous:** Titen shall implement this slice without a new dependency, migration, or runtime-specific public behavior.

## Completion evidence

- `src/core/rank.ts` normalizes vector scores per candidate set and exposes the six-factor additive formula; `tests/contract/vectors.test.ts` covers narrow-band, zero-span, and confidence ordering regressions.
- `src/core/indexing.ts` maps embedder/store failures to safe retryable 503 metadata before any outbox state update; shared-core tests cover both failures and recovery.
- `docs/reference/api.md` documents formula, weights, score components, and index-drain retry semantics.
- Workflow checker and self-test passed; Worker dry-run and the 133-test shared contract/SDK suite passed; all 28 integration tests passed.
- Astro production build and bundle budget passed; all 8 browser tests passed on an alternate local port because port 4399 was occupied by an unrelated checkout. Repository configuration was unchanged.
- `git diff --check` passed.
- No dependency, migration, deployment, or runtime-specific behavior was added.

## Done conditions

- Ranking formula, constants, public components, and docs agree.
- Regression tests cover narrow-band vector scores and varying confidence.
- Shared-core tests cover embedder and store outage metadata, pending preservation, and recovery.
- Workflow checker and self-test, Worker dry-run, dual-runtime contracts, integration tests, dashboard build/browser tests, and `git diff --check` are recorded.
- This spec and its paired plan move to matching `done/` paths with complete evidence and no unchecked work.
