---
work_id: pooled-recall-recovery
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-08
updated: 2026-08-08
owner: ramaaditya
spec: docs/specs/done/2026-08-08-pooled-recall-recovery.md
---

# Plan — measure the two reachable losses, ship at most what clears its gate

Harness-first throughout: nothing enters `src/core/**` until a variant has
cleared AC-PRR-003 on the bench. Execution runs on `benchmark-host`, where the
stores, venvs and lane runners already live.

## Sequence

### R1 — Pre-registration, committed before any scored cell

- [x] Variant definitions for E-DEEP (which signals, over which window),
      E-PACK (which allocation rules) and E-LAT2, with the fusion rule and
      access path pinned per variant.
- [x] Oracle re-verification from the stored artifacts: recall@1 if a perfect
      re-ranker acted over top-10, top-20, top-50, and over the pack as
      returned. This bounds E-DEEP before it runs.
- [x] Predictions, written before the first cell.

### R2 — E-DEEP: re-rank deeper, harness-side

- [x] Baseline re-verify: the shipped pooled order reproduces 0.246 exactly
      from the stored ranked lists.
- [x] Variants over the pack's top-50 (at minimum: the local cross-encoder that
      failed at top-10, and one lexical arm as its control, so the window is
      the only variable that moved).
- [x] Paired sign tests vs 0.246; per-question-type breakdown; anchor arm for
      every variant that clears the pooled gate.
- [x] Added latency per compile measured, not estimated.

### R3 — E-PACK: admit more of what was already retrieved

- [x] Instrument the current packer: how the 32,000-token budget is spent, how
      many sessions it admits, and what the per-item allocation is.
- [x] Variants that admit more sessions **within the same budget** (e.g. a
      per-item token cap so one long session cannot crowd out ten others).
- [x] Score recall@1 and recall@10; report how many of the 98 `in_pool_not_pack`
      golds each variant admits, separately from whether they then rank first.
- [x] Anchor arm: the same packer change on the scoped store, which is where a
      regression would actually hurt.

### R4 — Combined, and the ship decision

- [x] E-DEEP + E-PACK together, since a newly admitted gold is a ranking
      problem: the combined cell decides.
- [x] Apply AC-PRR-003 and AC-PRR-004 to the combined result. At most one
      configuration ships; anything that clears recall but breaches cost ships
      opt-in or not at all.
- [x] If something ships: implement behind existing parameters, dual-runtime
      contract case, `EXPLAIN` before/after where a query changes
      (AC-PRR-006), byte-level diff of the anchor ranked output explained.

### R5 — E-LAT2: the residual compile cost (#294)

- [x] Fresh pooled and anchor latency baselines on the shipped build.
- [x] Hoist the candidate CTE's per-row membership and retention predicates
      into per-request sets, generated from a helper beside `recordAccessSql`
      so the correlated and hoisted forms cannot drift.
- [x] `EXPLAIN` before/after from `bun:sqlite`; `query-plan.test.ts` green;
      ranked output byte-identical on both stores.
- [x] Update #294 with the measured outcome either way, and close it if the
      lever is exhausted.

### R6 — Publish and close

- [x] Report with every gate verdict, including all-fail, and a
      "what this does not show" section.
- [x] EVALS.md and PONYTAIL-DEBT.md updated where the result changes what
      either may claim.
- [x] CHANGELOG entry if code shipped; release and website handoff run from
      the maintainer's machine, not here.
- [x] Pair to done/ with per-AC acceptance evidence.

## Acceptance evidence

Per-AC evidence is tabulated in the
[spec](../../specs/done/2026-08-08-pooled-recall-recovery.md#acceptance-evidence):
AC-PRR-001, AC-PRR-002, AC-PRR-003, AC-PRR-004, AC-PRR-005, AC-PRR-006 and
AC-PRR-007 are all met. AC-PRR-002's shared-scorer and full-denominator
requirement held for every cell; AC-PRR-003 is met in the sense that the gate
was applied and **no configuration passed it**; and AC-PRR-005 held trivially,
because `src/core/**` is unchanged and no dependency, migration or
configuration flag was added.

Outcomes against the sequence above:

- **R1** delivered the pre-registration (`62f07f6`) and the oracle amendment
  (`3618d17`), both committed before the first scored cell.
- **R2** ran nine E-DEEP cells. D1 and D2 at `W = 10` reproduced the prior
  cycle's V5 and V1 to the instance, so the window was the only variable. Best
  cell +0.2 points against a +46.2-point oracle. Falsifier 1 fires.
- **R3** ran four packing rules against a simulator licensed by P0 reproducing
  the served pack byte for byte on 500/500. Recall@1 and recall@10 moved by
  exactly zero on both stores. Falsifier 2 fires.
- **R4** measured the combined cell: +0.8 points at p=0.7644, anchor −2.6.
  **Nothing ships**, so the conditional implementation work in R4's last bullet
  was correctly not done — there was no winner to implement.
- **R5** priced L1's ceiling before writing any authorization code and found it
  worth 1.4% of the candidate query against a 5% threshold. Falsifier 5 fires,
  no hoisting code was written, and #294 closes with the residual profile
  published and two of its premises corrected.
- **R6** published the report, updated EVALS.md, and moved this pair to `done/`.

## Verification

- `pnpm check:workflow` — passes.
- `pnpm test:api` — 122 node tests and 149 bun tests, 0 failures.
- `pnpm test:integration` — 218 tests across 28 files, 0 failures.
- `tests/integration/query-plan.test.ts` — 3/3, run standalone as well as in
  the suite.
- `src/core/**` unchanged; `git status` clean apart from documentation and
  committed artifacts.

## Not in this plan

Candidate generation (bounded at 37 instances by C1), embeddings, any LLM on
the default path, budget increases, and the release itself.
