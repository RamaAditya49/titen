---
work_id: pooled-candidate-generation
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-08
updated: 2026-08-08
owner: ramaaditya
spec: docs/specs/done/2026-08-08-pooled-candidate-generation.md
---

# Plan — depth split first, prereg, four experiments, ship at most one

C1's depth split gates the whole cycle (spec falsifier 0): if the misses
live at ranks 11–1000, this cycle closes as redirected and a deep-re-ranking
spec inherits the evidence.

## Sequence

### C1 — Depth split + miss-class audit (no product change)

- [x] From the 2026-08-07 pooled artifacts plus read-only BM25 queries
      against a copy of `pooled-19829.db`: for each of the 246 top-10-miss
      instances, find the gold's exact rank at full depth. Deliverable:
      the split "in-pool (11–1000) vs outside-pool", per question type,
      with rare-term counts. This is falsifier 0's input and the prereg's
      prediction basis.
- [x] Decision point: if the split redirects (most misses in-pool), publish
      it, close this pair as redirected (`outcome: completed`), and stop.
      **It redirected: 209 of 246 misses (85%) are in-pool. C2-C5 are not
      run, by the rule written before the measurement.**

### C2–C5 — not run, by the rule written before the measurement

C1 fired falsifier 0, so the prereg (C2), the four experiments (C3), the
ship decision (C4) and their publication (C5) were **cancelled rather than
executed**. Their checkboxes are deliberately removed rather than ticked:
none of that work happened, and a ticked box would say it did.

What the cancellation rests on: G1–G4 all manipulate which sessions enter the
candidate pool, and 209 of 246 misses are already in it. The largest of them
could address 37 instances; two were already predicted to fail their latency
and shippability gates. AC-PCG-001 through AC-PCG-006 therefore never bound
anything — no cell was scored, so no gate applied.

The evidence is handed forward, not discarded: the successor levers are a
deep re-ranker over the top-50 (measured ceiling: 100 of 111 in-pack misses)
and packing/budget allocation (98 misses), each of which needs its own spec.

## Not in this plan

Top-10 re-ranking (spent), deep re-ranking (falsifier 0's possible
successor spec, not this one), embeddings, LLM anything, corpus changes,
the latency work (`pooled-compile-latency` pair — run that first if both
are scheduled, so AC-PCG-004 measures against the improved baseline).

## Acceptance evidence

The cycle closed at its gating deliverable, so most criteria never bound
anything. Recording that honestly is the evidence.

- **AC-PCG-001 — never triggered.** No experiment was scored, so no prereg was
  owed. C1 is an accounting of an existing artifact plus a read-only query
  pass, not a scored cell.
- **AC-PCG-002 — not applicable, and the reason is recorded.** No cell was
  scored by the shared scorer in this cycle: C1 reports classification counts
  (in-pack / in-pool / outside-pool), not recall. The store construction it
  read is the pinned `pooled_common.pooled_sessions()` one, unchanged, and its
  denominator is all 500 instances with none dropped.
- **AC-PCG-003 — never triggered.** Nothing shipped, so no ≥5-point gate was
  applied. G1–G4 were cancelled by falsifier 0 before any variant existed.
- **AC-PCG-004 — never triggered.** No variant reached a latency check.
- **AC-PCG-005 — vacuously held.** `src/core/**` is untouched by this cycle;
  no dependency, migration or flag was added, because no product change was
  made at all.
- **AC-PCG-006 — PASS.** [The report](../../testing/2026-08-08-pooled-candidate-generation.md)
  states the redirect, the counts behind it, the per-type breakdown, and a
  "what this does not show" section naming the omitted authorization/temporal
  predicates and the `pool_limit` dependence.

## Verification

`c1-depth.json` and its harness are committed under
`docs/testing/results/2026-08-08-pooled-candidate-generation/` with
`SHA256SUMS` verified. `pnpm check:workflow` green.
