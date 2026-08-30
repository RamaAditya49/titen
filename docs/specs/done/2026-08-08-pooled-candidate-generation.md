---
work_id: pooled-candidate-generation
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-08
updated: 2026-08-08
owner: ramaaditya
---

# Attack the pooled recall loss below the re-ranking window

## Problem

At the pooled condition, Titen FTS-only holds recall@1 0.246 against
recall@10 0.508. The
[2026-08-08 improvement cycle](../../testing/2026-08-08-pooled-improvements.md)
closed the top-10 re-ranking half of that gap to cheap signals: all six
pre-registered variants failed their gates, and every one regressed the
scoped anchor condition (V6's +0.2 pooled is noise at p = 1.0). What nobody
has measured is the other half: in **49.2%** of pooled instances the gold
session is absent from the final ranked **top-10**. Whether those golds sit
at ranks 11–1000 (reachable by deeper re-ranking — a class the six losers
never tested, since they re-ranked strictly within the top-10) or outside
the 1,000-candidate pool entirely (a true candidate-generation failure) is
**unknown, and it decides what this cycle should build.** Measuring that
depth split is this cycle's first, gating deliverable.

Mechanism, corrected against source: the shipped candidate stage is BM25
over a **disjunction** ("OR") of ≤16 selected content terms under a
mandatory org/subject scope conjunction, capped by `LIMITS.queryTerms` term
selection and the candidate `LIMIT` (`planFtsQuery`,
`src/core/retrieval.ts`). The measured failure
([density audit](../../testing/2026-08-08-pooled-improvements-prereg.md):
366/500 questions have ≤1 pool session containing all question content
words) is therefore **not** missing disjunction — it is partial-overlap
distractors outscoring golds *inside* the disjunction, plus possible
eviction of discriminative terms by the 16-term selection cap.

## Approach — depth split first, then four pre-named experiments

The shipped ranker is frozen (ablation-backed). Two metrics, named
precisely:

- **recall@10** — gold in the final ranked top-10 (end-to-end; the
  shippable gate). De-saturated at the pooled condition (17.4-point
  cross-lane spread at k=10, 2026-08-07); the standing saturation rule
  applies to the per-instance condition, and recall@1/MRR@10 still gate
  end-to-end regression.
- **recall@pool** — gold present anywhere in the candidate set (diagnostic
  headroom, not a shippable gate).

| G | Experiment | Shape | Model calls |
| --- | --- | --- | ---: |
| G1 | rare-terms-only query **replacement**: the sub-query IS the query the frozen pipeline runs | query-side | 0 |
| G2 | per-term top-N **pool widening**: union per-rare-term BM25 candidates into the pool; primary metric recall@pool, with the prereg-pinned fusion rule deciding whether it can reach top-10 at all | query-side | 0 |
| G3 | pseudo-relevance feedback: expand the query with the most distinctive terms of the shipped top-3, one round | query-side | 0 |
| G4 | chunk-granularity ablation (e.g. 350 chars): **measurement-only** — an ingest-time variable whose winning outcome is a published chunk-size caveat and ingest guidance, never a ship in this cycle | ingest-side | 0 |

Cross-subquery BM25 scores are not comparable, so the **union/fusion rule
per experiment (min-rank, normalized score, dedup order) is the main free
parameter and must be pinned in the prereg before any scored run** — it
falls under AC-PCG-001's "protocol" and is named here so it cannot be tuned
post hoc. The prereg also pins each experiment's access path (served API
with crafted task text — which routes through `planFtsQuery`'s 16-term cap,
stopword list, and head/tail term ordering, disclosed as a limitation — or
read-only BM25 queries against a copy of the store).

Per-experiment latency budgets, stated up front from the measured FTS-stage
cost (~66 ms of ~420 ms p50): G1 and G3 run one FTS query and fit the
budget; G2 runs one sub-query per rare term (typically 3–8) and is expected
to exceed AC-PCG-004 unless the term count is capped — its likeliest useful
outcome is the recall@pool diagnostic, not a ship.

Experiments run harness-side first; only a winner gets a product
implementation, behind existing parameters, no new flag.

**Done when:** the depth split and all four experiments are published with
gate verdicts (including all-fail), and at most one winner has shipped with
its evidence — or the depth split itself redirects the cycle (falsifier 0)
and the redirect is published.

## EARS acceptance criteria

- **AC-PCG-001 — Event-driven:** When a candidate-generation experiment is
  scored, Titen's repository shall already contain a committed prereg with
  the protocol (including per-experiment fusion rule and access path),
  prediction, and these gates verbatim.
- **AC-PCG-002 — Ubiquitous:** Titen's harness shall score every cell with
  the shared scorer on the full 500 instances, failures kept in the
  denominator, on the pinned `pooled_common.pooled_sessions()` store
  construction (G4's rebuilt store excepted and disclosed).
- **AC-PCG-003 — Event-driven:** When a variant ships, it shall have gained
  ≥ 5.0 points of pooled recall@10 at p < 0.05 (paired sign test at k=10),
  with pooled recall@1 not more than 0.5 points below 0.246 and anchor
  recall@1 not more than 0.5 points below 0.880 (one boundary convention,
  strict <, matching the E-RANK gate).
- **AC-PCG-004 — Ubiquitous:** A shipped variant shall not raise compile
  p95 by more than 10% over the same-cycle baseline re-run on the same box
  (published references: 864.9 ms pooled / 138.1 ms anchor on 0.7.0, or
  their successors if `pooled-compile-latency` ships first).
- **AC-PCG-005 — Ubiquitous:** Titen shall ship any winner with zero new
  external imports in `src/core/**`, no dependency, no migration (G4
  changes an ingest parameter, not the schema), and no configuration flag
  without a measured requirement.
- **AC-PCG-006 — Event-driven:** When the cycle publishes, Titen's report
  shall state every gate verdict, including all-fail, and what the
  measurement does not establish.

## Falsification

Written before any run.

0. **Depth-split redirect:** if most of the 49.2% top-10 misses sit at
   ranks 11–1000 rather than outside the pool, candidate generation is the
   wrong lever; the honest move is to publish the split, close this cycle
   as redirected, and let a deep-re-ranking spec (a class the six losers
   never tested) be written against that evidence instead.
1. If no experiment gains ≥ 5.0 points of pooled recall@10 at p < 0.05,
   cheap lexical candidate manipulation joins cheap lexical re-ranking as
   measured-closed; reaching the ceiling then needs a signal that is
   neither question-term overlap nor the measured whole-session embedding
   families, and the report says exactly that — no stronger claim.
2. If a variant gains recall@10 but pooled recall@1 drops below its band,
   the gain is one the ranker cannot use; it does not ship and the
   divergence is published.
3. If G4's smaller chunks move recall materially in either direction, every
   published pooled number gains a chunk-size caveat — including the
   favourable ones.

## Non-goals

No re-ranking work within the top-10 (spent, six recorded losers) — though
falsifier 0 may hand the evidence to a future *deep* re-ranking spec. No
embedding/vector work (three families measured below FTS at pooled
density). No LLM anywhere. No change to scoring, gold labels, or the
corpus. G4 never ships in this cycle regardless of outcome.

## Outcome — falsifier 0 fired, 2026-08-08

C1 ran and **redirected the cycle before any experiment**: 85% of the pooled
top-10 misses are already inside the candidate pool (111 in the returned pack
at rank 11+, 98 in the 1,000-candidate pool but cut by the token budget, only
37 outside the pool). G1-G4 were not run; each addresses at best the 15%
slice. The measured successors are a **deep re-ranker over the top-50** (a
class the six 2026-08-08 losers never tested, since all re-ranked inside the
top-10) and **packing/budget allocation**. `single-session-preference` is the
only type where candidate generation genuinely fails, and it is 30 instances.

Full accounting in
[the report](../../testing/2026-08-08-pooled-candidate-generation.md).

## Evidence

Stores and harness preserved on `benchmark-host` (see the latency spec's Evidence
section). Results land in
`docs/testing/2026-08-XX-pooled-candidate-generation.md` with artifacts +
SHA256SUMS; prereg first, per AC-PCG-001.
