---
work_id: evidence-aware-ranking
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-07
updated: 2026-08-07
owner: ramaaditya
spec: docs/specs/done/2026-08-07-evidence-aware-ranking.md
---

# Plan — audit the signals, ship the one that is real, publish the number

Five items. The order matters more than usual: the pre-registration and the
baseline query pass both have to happen **before** the ranker exists, or the
result is unfalsifiable no matter what it says.

## Dependency spine

E1 gates everything — a protocol written after seeing a number is not a
protocol. E2 must run before E3 is written, because pass A is only a credible
baseline while the change does not exist yet. E4 depends on E3. E5 depends on
E2 and E4. E6 is independent and runs last, from ranked lists already on disk.

## Sequence

### E1 — Pre-registration, committed on its own (done first)

- [x] Fix metric, k, sample, design, statistics, and the kill criteria in
      `docs/testing/2026-08-07-evidence-ranking-prereg.md`.
- [x] Record the signal inventory — which of the five candidates already ship,
      which is unreachable — *before* measuring, so it cannot be edited to match
      a result.
- [x] Commit it in its own commit, ahead of any result, so the git history is
      the evidence rather than our word.

### E2 — Baseline pass, before the change is written

- [x] Copy the 2026-08-04 `fts-500.db` store rather than re-ingesting. The
      original is never opened.
- [x] Query all 500 instances with the branch at its base commit and store the
      ranked list.
- [x] Measure the actual distribution of every signal in the inventory directly
      from the store — distinct trust values, disputed count, recalled-evidence
      count, feedback totals, and the histogram of supporting observations per
      claim. Measured, not assumed.
- [x] Compare pass A against the published 0.6.0 ranked list and report any
      discrepancy rather than smoothing it.

### E3 — The change

- [x] `evidence_depth` on `RankInput`, optional, defaulting to zero so every
      existing caller and fixture keeps compiling.
- [x] Populate it in `src/core/context.ts` by hoisting the
      `loadAuthorizedEvidenceIds` call above `rankCandidates` and reusing its
      result for the pack. No new query, no new SQL, no migration: the call
      already ran, just later and over fewer rows.
- [x] One tie-break key in `rankCandidates`, after score and after vector
      similarity, ahead of the statement fallback.
- [x] No configuration flag. The A/B is achieved by running the passes from two
      commits, which is also a stronger control than a runtime switch.
- [x] The first design loaded evidence for every candidate on every compile and
      measured at roughly +1.4 ms p50 at `top_k=5`. That trips kill criterion 3,
      so it was rejected rather than argued down: `hasDeadHeat` now gates the
      lookup on whether the returned window is actually tied, which is decided
      with no database work. Re-measured flat, and the 500-instance ranked output
      is byte-identical between the two designs. The rejected numbers are kept.

### E4 — Runnable checks that fail without it

- [x] A contract case where two claims are identical in every ranked dimension
      except evidence depth, asserting the deeper one wins. Fails without E3.
      `corroboration breaks a ranking dead heat, and only support counts`.
- [x] A contract case proving a hidden observation does not change the order
      (AC-EVR-002), which is the one place this signal could leak a count.
      `a hidden supporting observation changes neither depth nor order
      (AC-EVR-002)`: two principals, one private supporting observation linked
      to the shallow claim of the tied pair, asserting the compiling principal's
      items are unchanged and that the principal who *may* read it gets the
      inverted order. Verified to fail with the `EXISTS` removed from
      `loadAuthorizedSources`.

      **This tick was false until 2026-08-07 and the review of #288 caught it.**
      The box was checked against an intention, not a test. The cross-scope case
      added for [#291](https://github.com/RamaAditya49/titen/issues/291) does
      *not* satisfy it: that one covers the `disputed` flag, a different signal
      computed by a different query on a different branch. Two criteria, two
      cases.
- [x] A contract case proving that a promotion across the `top_k` boundary still
      carries its citations. `a tie promoted across the top_k boundary still
      returns its citations`. Verified to fail with the contested lookup narrowed
      back to the `top_k` slice.
- [x] Uniform evidence depth returns the pre-change order (AC-EVR-003). Covered
      by an assertion inside the `rankCandidates` unit test, not by a dual-runtime
      contract case — the property is in a pure function with no SQL under it.
- [x] Determinism: identical corpus content, fresh identifiers, identical ranking
      (AC-EVR-004). Same, a unit test over `rankCandidates`.
- [x] Both runtimes, through the existing dual-runtime contract suite. The three
      cases named above run on `bun-sqlite` and D1; the two unit tests do not,
      and do not need to.

### E5 — Measure, and publish whatever it says

- [x] Pass B over the same store; paired two-sided sign test against pass A.
- [x] recall@1 and MRR@10 before and after; recall@5/@10 marked saturated.
- [x] The fraction of the +10.2-point oracle ceiling captured, published even
      when it is zero.
- [x] Comparison against the lexical signals that already failed at p = 0.61.
- [x] Per-question-type breakdown, since a signal that helps one type and hurts
      another is a different finding from one that helps uniformly.
- [x] Write-up in `docs/testing/2026-08-07-evidence-ranking.md`, including what
      the measurement does not establish, and update `docs/testing/EVALS.md` and
      `PONYTAIL-DEBT.md` if the result changes what either may claim.

### E6 — Tokens-to-answer, from lists already on disk

- [x] Score the existing `results/*.ranked.json` for the token cost of the
      smallest pack containing the gold. No new run.
- [x] Report per lane, alongside recall@1 rather than replacing it, with the
      no-gold-at-any-depth instances counted explicitly.

## Not in this plan

- Re-weighting the conflict component. Refused in the spec, with the reason.
- A `recalled` ranking penalty. The write path makes it unreachable; building it
  would be dead code with a good story attached.
- Any reranking stage over the top-k. That is debt item 3 and needs the ceiling
  this work measures part of.
- The router/vector arm at n=500, unless pass B differs from pass A on at least
  one instance. The rule and its reason are pre-registered, not chosen after the
  fact.

## Honest odds

Written before the run. The signal is very likely degenerate on LongMemEval-S:
the lane ingests one observation per session and one claim per chunk, so every
claim has exactly one supporting observation, and there is no second actor to
create a conflict or a feedback signal. If that holds, the expected outcome is a
byte-identical ranking, zero of the oracle ceiling captured, and a report that
says the corpus cannot measure this.

That is a worse headline and a better piece of evidence than a tuned win, and it
is the reason the kill criteria are written down before the numbers exist.

## Acceptance evidence

- AC-EVR-001: the tie-break key lands in `rankCandidates` after weighted score
  and vector similarity; the dual-runtime contract case `corroboration breaks a
  ranking dead heat, and only support counts` fails without it (E4).
- AC-EVR-002: the dual-runtime contract case `a hidden supporting observation
  changes neither depth nor order (AC-EVR-002)` — two principals, one private
  supporting observation, order unchanged for the excluded principal and
  inverted for the authorized one; verified to fail with the `EXISTS` removed
  from `loadAuthorizedSources` (E4).
- AC-EVR-003: uniform-depth assertion inside the `rankCandidates` unit test
  returns the pre-change order byte-for-byte (E4).
- AC-EVR-004: determinism unit test — identical corpus content under fresh
  identifiers ranks identically (E4).
- AC-EVR-005: `src/core/**` gained no import, no migration, and no
  configuration flag; the A/B ran from two commits rather than a switch (E3),
  reconfirmed in the #288 review.
- AC-EVR-006: the published measurement states that 0.0 of the +10.2-point
  oracle ceiling was captured, that the ranked lists were byte-identical on
  500/500 instances, and what the measurement does not establish
  ([2026-08-07-evidence-ranking.md](../../testing/2026-08-07-evidence-ranking.md), E5).
- AC-EVR-007: tokens-to-answer reports the 259/500 no-gold-at-any-depth MCP
  reference instances as their own count in the denominator, never dropped (E6).

## Verification

`pnpm check:workflow` green; dual-runtime contract suite green on bun-sqlite
and D1 for the three E4 contract cases; the E5/E6 artifacts recomputed from raw
`.ranked.json` reproduce the stored scores exactly.
