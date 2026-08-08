---
work_id: pooled-recall-recovery
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-08-08
updated: 2026-08-08
owner: ramaaditya
spec: docs/specs/active/2026-08-08-pooled-recall-recovery.md
review_after: 2026-08-21
---

# Plan — measure the two reachable losses, ship at most what clears its gate

Harness-first throughout: nothing enters `src/core/**` until a variant has
cleared AC-PRR-003 on the bench. Execution runs on `rama-tuf`, where the
stores, venvs and lane runners already live.

## Sequence

### R1 — Pre-registration, committed before any scored cell

- [ ] Variant definitions for E-DEEP (which signals, over which window),
      E-PACK (which allocation rules) and E-LAT2, with the fusion rule and
      access path pinned per variant.
- [ ] Oracle re-verification from the stored artifacts: recall@1 if a perfect
      re-ranker acted over top-10, top-20, top-50, and over the pack as
      returned. This bounds E-DEEP before it runs.
- [ ] Predictions, written before the first cell.

### R2 — E-DEEP: re-rank deeper, harness-side

- [ ] Baseline re-verify: the shipped pooled order reproduces 0.246 exactly
      from the stored ranked lists.
- [ ] Variants over the pack's top-50 (at minimum: the local cross-encoder that
      failed at top-10, and one lexical arm as its control, so the window is
      the only variable that moved).
- [ ] Paired sign tests vs 0.246; per-question-type breakdown; anchor arm for
      every variant that clears the pooled gate.
- [ ] Added latency per compile measured, not estimated.

### R3 — E-PACK: admit more of what was already retrieved

- [ ] Instrument the current packer: how the 32,000-token budget is spent, how
      many sessions it admits, and what the per-item allocation is.
- [ ] Variants that admit more sessions **within the same budget** (e.g. a
      per-item token cap so one long session cannot crowd out ten others).
- [ ] Score recall@1 and recall@10; report how many of the 98 `in_pool_not_pack`
      golds each variant admits, separately from whether they then rank first.
- [ ] Anchor arm: the same packer change on the scoped store, which is where a
      regression would actually hurt.

### R4 — Combined, and the ship decision

- [ ] E-DEEP + E-PACK together, since a newly admitted gold is a ranking
      problem: the combined cell decides.
- [ ] Apply AC-PRR-003 and AC-PRR-004 to the combined result. At most one
      configuration ships; anything that clears recall but breaches cost ships
      opt-in or not at all.
- [ ] If something ships: implement behind existing parameters, dual-runtime
      contract case, `EXPLAIN` before/after where a query changes
      (AC-PRR-006), byte-level diff of the anchor ranked output explained.

### R5 — E-LAT2: the residual compile cost (#294)

- [ ] Fresh pooled and anchor latency baselines on the shipped build.
- [ ] Hoist the candidate CTE's per-row membership and retention predicates
      into per-request sets, generated from a helper beside `recordAccessSql`
      so the correlated and hoisted forms cannot drift.
- [ ] `EXPLAIN` before/after from `bun:sqlite`; `query-plan.test.ts` green;
      ranked output byte-identical on both stores.
- [ ] Update #294 with the measured outcome either way, and close it if the
      lever is exhausted.

### R6 — Publish and close

- [ ] Report with every gate verdict, including all-fail, and a
      "what this does not show" section.
- [ ] EVALS.md and PONYTAIL-DEBT.md updated where the result changes what
      either may claim.
- [ ] CHANGELOG entry if code shipped; release and website handoff run from
      the maintainer's machine, not here.
- [ ] Pair to done/ with per-AC acceptance evidence.

## Not in this plan

Candidate generation (bounded at 37 instances by C1), embeddings, any LLM on
the default path, budget increases, and the release itself.
