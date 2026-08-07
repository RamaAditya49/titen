---
work_id: evidence-aware-ranking
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-07
updated: 2026-08-07
owner: ramaaditya
review_after: 2026-08-20
---

# Rank on the evidence only Titen holds, and publish what that is worth

## Problem

The 2026-08-04/06 programme settled that generic retrieval accuracy is
saturated. Titen FTS+vector beats a hundred-line dense control (35/12/453,
p = 0.0011) and is indistinguishable from Mem0's LLM-free mode (3/4/53,
p = 1.0). Answer accuracy is a flat null across eight pre-registered
comparisons. Chasing retrieval further is refuted by our own data and is a
non-goal of the current strategy spec.

The structural reason we tie is that **we rank on the same information everyone
else has.** `src/core/rank.ts` scores BM25, optional vector cosine, recency and
confidence. A hundred-line cosine script has all four.

Titen also stores things a competitor's schema does not hold: declared trust,
preserved conflicts, server-issued `recalled` provenance, version history, and
feedback outcomes. This work asks whether ranking on those moves recall@1, and
publishes the answer either way.

A prior measurement bounds the prize: the oracle ceiling over Titen's own top-10
is **+10.2 points** (recall@1 0.880 → 0.982). Every lexical reranking signal
tested captured at most 0.6 of those points at p = 0.61, and two were
significantly worse.

## What the code already does, established before writing anything

The five candidate signals resolve against 0.7.0 as follows. This audit is part
of the deliverable, because three of the five are a request to build something
that already ships and one is a request to build something the write path makes
unreachable.

| Signal | Status at 0.7.0 |
| --- | --- |
| trust | already a ranked component, `RANK_WEIGHTS.trust = 0.20` |
| conflict (`disputed`) | already a ranked component, `RANK_WEIGHTS.conflict = 0.05` |
| feedback outcomes | already a ranked component, `RANK_WEIGHTS.utility = 0.10`, gated at three signals |
| provenance `recalled` | **unreachable at rank time.** `src/core/claims.ts` refuses a `recalled` observation as claim evidence at consolidation, and `src/core/context.ts` ranks claims only. No claim can carry recalled provenance, so a ranking penalty for one is dead code. |
| evidence depth | **not ranked, and derivable with no schema change** from `claim_sources`. |

Only evidence depth is new work.

## Approach, and what is deliberately refused

Evidence depth becomes a **tie-break key**, not a weighted score term.

A weighted term needs a weight. No corpus on this machine has both varying
evidence depth and gold labels, so a weight could only be fitted on the data it
would then be evaluated on. `AGENTS.md` forbids that shape of number and the
project has retracted two published claims for less. A tie-break needs no
weight, so nothing is fitted.

The key is placed **after** the weighted score and **after** vector similarity,
ahead of the existing statement-then-id fallback. That fallback is arbitrary by
construction — `rank.ts` documents it as picking "an arbitrary-but-stable winner
among genuinely tied items". Replacing arbitrary with corroborated is a strict
improvement at that position. Placing it *above* vector similarity would let an
unmeasured signal override a measured one, so it is not placed there.

Refused, with reasons:

- **Re-weighting the conflict component.** A disputed claim currently loses
  0.05. Hardening that is tempting and would trade a measured product contract
  for an unmeasured ranking guess: `docs/testing/EVALS.md` scores *conflict
  exposure* and requires unresolved conflicts to be surfaced, and
  `/v1/context/compile` reports them in `conflicts[]`. Demotion is not the same
  as suppression, but the margin between them is exactly what is unmeasured.
- **Any new dependency, abstraction, migration, or configuration flag.** The
  count is available from the join table that already exists, through the
  authorization helper that already exists.
- **Surfacing evidence depth as a new score component.** `score_components` is a
  shipped response shape and the pack already returns `evidence_ids` per item,
  so a caller can count them without a new field.

## EARS acceptance criteria

- **AC-EVR-001 — Event-driven:** When two authorized candidate claims tie on
  weighted score and on vector similarity, Titen shall rank the claim with more
  authorized supporting observations first.
- **AC-EVR-002 — Ubiquitous:** Titen shall count only supporting observations
  the requesting principal is authorized to read, so that a hidden observation
  shall not influence the returned order.
- **AC-EVR-003 — Unwanted behavior:** If a candidate set carries no variation in
  evidence depth, then Titen shall return exactly the order it returned before
  this change, and a runnable check shall fail if any such ordering moves.
- **AC-EVR-004 — Ubiquitous:** Titen shall produce identical rankings for
  identical corpus content across independent ingests that mint different record
  identifiers, preserving the determinism contract of #226.
- **AC-EVR-005 — Ubiquitous:** `src/core/**` shall retain zero external imports,
  and the change shall add no database migration and no configuration flag.
- **AC-EVR-006 — Event-driven:** When the evidence-ranking measurement is
  published, Titen shall state how much of the +10.2-point oracle ceiling it
  captured, including when that figure is zero, and shall state what the
  measurement does not establish.
- **AC-EVR-007 — Event-driven:** When a lane's ranked list is scored for
  tokens-to-answer, Titen shall report the instances with no gold session at any
  depth as their own count rather than dropping them from the denominator.

## Falsification

Fixed in
[the pre-registration](../../testing/2026-08-07-evidence-ranking-prereg.md),
committed before the first scored run. Restated here so the spec can be checked
without following a link:

1. If pass B is below pass A on recall@1 by any margin, the change is reverted.
2. If evidence depth is constant across the corpus and the ranking still moves,
   that is a determinism defect and it blocks the merge rather than being
   reported as a result.
3. If the signal costs measurable compile latency without a recall@1 gain at
   p ≤ 0.05, it does not ship.

A null result is a valid outcome. If the corpus carries no evidence variation,
the honest report is that LongMemEval-S cannot falsify this ranker in either
direction, that zero of the 10.2 points are captured, and that no retrieval
claim is made.

## Non-goals

Inherited from the
[substitution spec](./2026-08-06-substitution-and-write-hygiene.md) and extended:

- No answer-accuracy lane. Refuted as a null on 2026-08-06.
- No cross-encoder or LLM reranking stage. That is `PONYTAIL-DEBT.md` item 3 and
  needs a measured ceiling first; this work measures part of that ceiling and
  does not pre-empt the decision.
- No change to candidate generation. The oracle ceiling is defined over the
  existing top-10, so widening the pool is a different experiment.
- No public claim that Titen ranks better than any competitor as a result of
  this change.

## Evidence

Measured results in
[`docs/testing/2026-08-07-evidence-ranking.md`](../../testing/2026-08-07-evidence-ranking.md).
Corpus, scorer, and failure rules inherited from the 2026-08-04 benchmark
programme recorded in [`docs/testing/EVALS.md`](../../testing/EVALS.md).
