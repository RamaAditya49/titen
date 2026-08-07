---
work_id: pooled-regression-improvements
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-08
updated: 2026-08-08
owner: ramaaditya
spec: docs/specs/active/2026-08-08-pooled-regression-improvements.md
review_after: 2026-08-22
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

- [ ] `EXPLAIN QUERY PLAN` for the compile candidate query against the
      19,829-session store, committed as evidence.
- [ ] Ablate `max_candidates` 1000 → 200 → 100 (budget packs ~10 items);
      recall@1 and p50/p95 per cell.
- [ ] Ablate the scope conjunction: measure the same query with the
      single-valued scope term dropped (read-only experiment harness, not a
      product change), to price the scope doclists.
- [ ] If a safe change clears the gate: implement in `src/core/retrieval.ts`
      behind the existing parameters (no new flag), with a dual-runtime
      contract case and EXPLAIN evidence (AC-PRI-004).

### I3 — E-RANK: ranking variants against the +26.2-point ceiling

- [ ] Re-verify the oracle ceiling from the stored `.ranked.json` (no
      re-run needed).
- [ ] Variants, each scored by the shared scorer on the same stores:
      BM25 k1/b sweep; length-normalization variant; same-session term
      proximity; local cross-encoder over top-10 (fastembed/onnx class, no
      provider). Cap: 6 variants, pre-named in the prereg.
- [ ] Paired sign tests vs the 0.246 baseline; per-type breakdown.
- [ ] Ship at most one winner per the E-RANK gate; record the losers.

### I4 — E-VEC: embedder isolation

- [ ] Dense control lane on the pooled store with the second local embedder
      (fastembed bge-small already benchmarked per-instance) — already
      measured 0.124: cite, do not re-run.
- [ ] One additional local embedder distinct from both (e.g. fastembed
      multilingual or MiniLM class), dense-control shape only, pooled store.
- [ ] Verdict per the E-VEC falsifier; documentation update scoping the
      vector arm's claims.

### I5 — Publish and close

- [ ] Report docs/testing/2026-08-08-pooled-improvements.md with every gate
      verdict, artifacts + SHA256SUMS.
- [ ] EVALS.md / PONYTAIL-DEBT.md updated where results change what either
      may claim; release decision (patch vs none) per release.md.
- [ ] titen-web benchmark page updated + redeployed if any published number
      changes.
- [ ] Spec/plan pair to done/ with per-AC acceptance evidence.

## Not in this plan

- LLM reranking, write-path changes, schema changes, new corpora (spec
  non-goals).
- Sharding-by-process implementation: remains the documented sizing rule
  unless E-LAT fails AND a measured requirement demands it (then its own
  spec).
