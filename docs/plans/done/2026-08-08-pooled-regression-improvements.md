---
work_id: pooled-regression-improvements
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-08
updated: 2026-08-08
owner: ramaaditya
spec: docs/specs/done/2026-08-08-pooled-regression-improvements.md
---

# Plan — ablate the latency, measure the ranking ceiling, isolate the embedder

Execution order is a measurement constraint, not a preference: E-LAT owns a
quiet box first (its cells are latency), then E-RANK and E-VEC may share the
host (their primary metric is recall; wall clock is reported but not
load-bearing).

## Sequence

### I1 — Pre-registration (gates everything)

- [x] Distractor-density audit of the pooled store written before any
      prediction (AC-PRI-006): median 0 full-conjunction competitors,
      366/500 questions at <=1 — partial-overlap distractors are the failure.
- [x] Protocol, variants, gates, and predictions for E-LAT, E-RANK, E-VEC
      committed before the first scored run
      ([prereg](../../testing/2026-08-08-pooled-improvements-prereg.md)).

### I2 — E-LAT: latency ablation on the pooled store (quiet box)

- [x] `EXPLAIN QUERY PLAN` for the compile candidate query against the
      19,829-session store, committed as evidence.
- [x] Ablate `max_candidates` 1000 → 200 → 100 (budget packs ~10 items);
      recall@1 and p50/p95 per cell.
- [x] Ablate the scope conjunction: measure the same query with the
      single-valued scope term dropped (read-only experiment harness, not a
      product change), to price the scope doclists.
- [x] If a safe change clears the gate: implement in `src/core/retrieval.ts`
      behind the existing parameters (no new flag), with a dual-runtime
      contract case and EXPLAIN evidence (AC-PRI-004). **No change cleared
      the gate; nothing shipped, per AC-PRI-003.**

### I3 — E-RANK: ranking variants against the +26.2-point ceiling

- [x] Re-verify the oracle ceiling from the stored `.ranked.json` (no
      re-run needed).
- [x] Variants, each scored by the shared scorer on the same stores:
      BM25 k1/b sweep; length-normalization variant; same-session term
      proximity; local cross-encoder over top-10 (fastembed/onnx class, no
      provider). Cap: 6 variants, pre-named in the prereg.
- [x] Paired sign tests vs the 0.246 baseline; per-type breakdown.
- [x] Ship at most one winner per the E-RANK gate; record the losers.

### I4 — E-VEC: embedder isolation

- [x] Dense control lane on the pooled store with the second local embedder
      (fastembed bge-small already benchmarked per-instance) — already
      measured 0.124: cite, do not re-run.
- [x] One additional local embedder distinct from both (e.g. fastembed
      multilingual or MiniLM class), dense-control shape only, pooled store.
- [x] Verdict per the E-VEC falsifier; documentation update scoping the
      vector arm's claims.

### I5 — Publish and close

- [x] Report docs/testing/2026-08-08-pooled-improvements.md with every gate
      verdict, artifacts + SHA256SUMS.
- [x] EVALS.md / PONYTAIL-DEBT.md updated where results change what either
      may claim; release decision (patch vs none) per release.md.
- [x] titen-web benchmark page updated + redeployed: full-refresh merge
      1dbad59, Worker version 0ff77e4d-4f0b-4dc9-bd99-423ca6fa1aac, smoked on
      both hostnames (leaderboard, improvement-cycle block, build costs).
- [x] Spec/plan pair to done/ with per-AC acceptance evidence.

## Not in this plan

- LLM reranking, write-path changes, schema changes, new corpora (spec
  non-goals).
- Sharding-by-process implementation: remains the documented sizing rule
  unless E-LAT fails AND a measured requirement demands it (then its own
  spec).

## Acceptance evidence

- AC-PRI-001: prereg commit 207658d precedes every scored artifact; stores
  were the 2026-08-07 pooled artifacts' stores, never rebuilt.
- AC-PRI-002: E-LAT cells ran alone (1-min load 0.08), concurrency 1,
  loopback, p50/p95/p99 with store size named; baseline reproduced within
  0.2% of the published p95.
- AC-PRI-003: all six E-RANK variants and the candidate-cap change failed
  their gates and none shipped; every failure is recorded in the report.
- AC-PRI-004: no query-plan change shipped, so the clause binds nothing;
  the EXPLAIN evidence gathered is attached to #294 for any future change.
- AC-PRI-005: src/core/** untouched this cycle; no dependency, migration,
  or flag added.
- AC-PRI-006: the prereg carries the distractor-density audit, written
  before its predictions.

## Verification

Every headline number independently recomputed from artifacts by the
adversarial verification pass (common.score / common.sign_test), which also
surfaced and corrected the V5 null. `pnpm check:workflow` green. Artifacts +
SHA256SUMS committed under docs/testing/results/2026-08-08-pooled-improvements/.
