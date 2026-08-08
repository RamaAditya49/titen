---
work_id: pooled-candidate-generation
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-08-08
updated: 2026-08-08
owner: ramaaditya
spec: docs/specs/active/2026-08-08-pooled-candidate-generation.md
review_after: 2026-08-21
---

# Plan — depth split first, prereg, four experiments, ship at most one

C1's depth split gates the whole cycle (spec falsifier 0): if the misses
live at ranks 11–1000, this cycle closes as redirected and a deep-re-ranking
spec inherits the evidence.

## Sequence

### C1 — Depth split + miss-class audit (no product change)

- [ ] From the 2026-08-07 pooled artifacts plus read-only BM25 queries
      against a copy of `pooled-19829.db`: for each of the 246 top-10-miss
      instances, find the gold's exact rank at full depth. Deliverable:
      the split "in-pool (11–1000) vs outside-pool", per question type,
      with rare-term counts. This is falsifier 0's input and the prereg's
      prediction basis.
- [ ] Decision point: if the split redirects (most misses in-pool), publish
      it, close this pair as redirected (`outcome: completed`), and stop.

### C2 — Prereg, committed before any scored run (AC-PCG-001)

- [ ] Protocol per experiment with the **fusion rule and access path
      pinned** (served API with crafted task text vs read-only BM25 on a
      store copy; `planFtsQuery`'s 16-term cap, stopword list, and
      head/tail ordering disclosed as API-path distortions).
- [ ] The spec's gates verbatim; predictions with the C1 audit attached;
      store construction pinned to `pooled_common.pooled_sessions()`.

### C3 — Harness-side experiments (rama-tuf, no product change)

All cells scored per AC-PCG-002: shared scorer, full 500, failures in the
denominator, scorer/artifact provenance recorded per cell.

- [ ] G1 rare-terms-only query replacement — recall@10/@1, MRR, sign tests.
- [ ] G2 per-term top-N pool widening — **recall@pool primary
      (diagnostic)**; end-to-end recall@10 only under the prereg-pinned
      fusion rule; expected to exceed the latency budget (one FTS query per
      rare term) and land as diagnostic, not ship.
- [ ] G3 pseudo-relevance feedback, one round, expansion terms logged.
- [ ] G4 chunk-350 store rebuild (fresh store, same session order), full
      500-question pass — measurement-only; latency noted as not comparable
      while other work shares the box.
- [ ] Artifacts + SHA256SUMS before any summary.

### C4 — Ship at most one winner (G1 or G3 only; G2/G4 are diagnostics)

- [ ] Gate check per AC-PCG-003 (≥ +5.0 recall@10 at p < 0.05; recall@1 and
      anchor within their strict 0.5-point bands) and AC-PCG-004 (p95
      within 10% of the same-cycle baseline re-run, measured on this box).
- [ ] If clear: implement in `src/core/retrieval.ts` behind existing
      parameters; AC-PCG-005 evidence (zero new imports in `src/core/**`,
      no dependency/migration/flag — grep + diff review); dual-runtime
      contract case; EXPLAIN + latency cells per the standing rules;
      ranked-output diff on the anchor store explained.
- [ ] If none clears: the all-fail report per AC-PCG-006, and cheap lexical
      candidate manipulation is recorded closed alongside cheap lexical
      re-ranking, with the narrowed conclusion the spec's falsifier 1
      words.

### C5 — Publish and close

- [ ] Report, EVALS.md + PONYTAIL-DEBT.md consequences, CHANGELOG entry if
      code shipped, titen-web refresh + redeploy if any published number
      changed, pair to done/ with per-AC acceptance evidence.

## Not in this plan

Top-10 re-ranking (spent), deep re-ranking (falsifier 0's possible
successor spec, not this one), embeddings, LLM anything, corpus changes,
the latency work (`pooled-compile-latency` pair — run that first if both
are scheduled, so AC-PCG-004 measures against the improved baseline).
