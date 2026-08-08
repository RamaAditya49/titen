---
work_id: pooled-recall-recovery
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-08-08
updated: 2026-08-08
owner: ramaaditya
review_after: 2026-08-21
---

# Recover the pooled recall that is already inside the pool

## Problem

Pooled recall@1 is 0.246 against a recall@10 of 0.508, and the
[C1 depth split](../../testing/2026-08-08-pooled-candidate-generation.md)
located every one of the 246 misses:

| Class | n | Where the gold actually is |
| --- | ---: | --- |
| `in_pack_below_10` | 111 | in the returned pack, ranked 11+ (median rank 21, 100 of them ≤ 50) |
| `in_pool_not_pack` | 98 | in the 1,000-candidate pool, cut by the 32,000-token budget (median session rank 106) |
| `outside_pool` | 37 | never entered the pool; 13 of them `single-session-preference` |

**209 of 246 are already retrieved and then lost** — by ranking, or by packing.
Neither loss has ever been attacked at the right depth:

- The six variants that failed on 2026-08-08 re-ranked **strictly inside the
  top-10**, so none of them could reach a gold at rank 21. That is a property
  of the window, not evidence that re-ranking fails.
- Packing has **never been measured at all**. The pack holds a median of 62
  sessions in a 32,000-token budget; whether that allocation is the binding
  constraint is unknown.

Arithmetic ceilings, stated so they can be checked rather than believed. A
perfect re-ranker over the returned pack's top-50 would put recall@1 at
**(254 + 100) / 500 = 0.708**. Adding a packer that admits every in-pool gold
would raise the reachable set to **(254 + 100 + 98) / 500 = 0.904**. These are
oracle bounds on *reachability*, not predictions: six cheap signals have
already failed to capture a smaller ceiling, and the honest prior is that most
of this is unreachable.

## Approach — three experiments, gates before any of them

Everything runs against the preserved pooled store (19,829 sessions, 342,129
claims) on `rama-tuf`, scored by the shared scorer, 500 instances, failures in
the denominator. The anchor (per-instance scoped) condition is the
no-regression control throughout: it is the shape a product actually serves,
and nothing may ship that damages it.

| E | Experiment | What changes | Model calls |
| --- | --- | --- | ---: |
| **E-DEEP** | re-rank the returned pack's top-50 instead of its top-10 | query-side only, harness first | local ONNX cross-encoder, or 0 for the lexical arms |
| **E-PACK** | per-item token allocation inside the existing budget | `src/core/context.ts` packing, no budget increase | 0 |
| **E-LAT2** | the residual compile cost after 0.7.2 ([#294](https://github.com/RamaAditya49/titen/issues/294)) | hoist the CTE's per-row authorization into per-request sets | 0 |

E-DEEP and E-PACK interact: a gold admitted to the pack by E-PACK is then a
ranking problem for E-DEEP. They are therefore measured **separately and then
together**, and the combined cell is the one that decides what ships.

E-LAT2 is included because E-PACK and E-DEEP both add work to the compile
path, and AC-PRR-004 below prices them against a baseline that must not
already be failing for an unrelated reason.

## EARS acceptance criteria

- **AC-PRR-001 — Event-driven:** When any cell is scored, Titen's repository
  shall already contain a committed pre-registration naming that cell's
  variant definitions, fusion rules, gates and prediction.
- **AC-PRR-002 — Ubiquitous:** Titen shall score every cell with the shared
  scorer over all 500 instances, failures kept in the denominator, against the
  pinned pooled store construction.
- **AC-PRR-003 — Event-driven:** When a change ships, it shall have gained
  **≥ 5.0 points of pooled recall@1 at p < 0.05** (paired sign test) and shall
  not have lost more than 0.5 points of anchor recall@1 against 0.880.
- **AC-PRR-004 — Ubiquitous:** A shipped change shall not raise pooled compile
  p95 above the same-cycle measured baseline by more than 10%, and shall not
  raise anchor p95 at all beyond its measured repeat spread.
- **AC-PRR-005 — Ubiquitous:** Titen shall keep `src/core/**` free of new
  external imports and shall add no dependency, migration, or configuration
  flag to the default path. A local reranker model, if one ships, shall be an
  **opt-in** projection in the shape the vector path already uses — absent by
  default, degrading to today's behaviour when unconfigured.
- **AC-PRR-006 — Event-driven:** When a plan-affecting query changes, its
  `EXPLAIN QUERY PLAN` from `bun:sqlite` shall be captured before and after
  against a realistic-row-count store, and
  `tests/integration/query-plan.test.ts` shall still pass.
- **AC-PRR-007 — Event-driven:** When the cycle publishes, Titen's report
  shall state every gate verdict including all-fail, name what it does not
  establish, and record any correction made mid-run.

## Falsification

Written before any run.

1. **E-DEEP dead:** if no top-50 re-ranking variant gains ≥ 5.0 points at
   p < 0.05, deep re-ranking joins shallow re-ranking as measured-closed, and
   the published conclusion is that the 111 in-pack misses are not reachable by
   any signal tried at either depth.
2. **E-PACK dead:** if admitting more sessions to the pack does not raise
   recall@1 — because the newly admitted golds still rank below 1 — then
   packing is not a lever on its own, and it may only be re-tried *combined*
   with a re-ranker that has already passed its own gate.
3. **Anchor guard:** any variant that damages the scoped condition by more than
   0.5 points does not ship whatever it does to the pooled number. The scoped
   store is the shipped product; the pooled store is an instrument.
4. **Cost guard:** a variant that clears the recall gate but breaches
   AC-PRR-004 is recorded as a measured trade, not shipped by default. It may
   ship opt-in only.
5. **E-LAT2 dead:** if hoisting the authorization sets does not reduce pooled
   compile p95 measurably, #294's remaining lever is exhausted and the issue
   closes with the residual profile published.

## Non-goals

- No budget increase. Raising `max_tokens` buys recall by spending the caller's
  context, which is not an improvement — it is a different trade the caller
  already controls.
- No LLM in the default path, no new provider dependency, no embedding work
  (three families measured below FTS at pooled density).
- No candidate-generation work. C1 bounded it at 37 instances, concentrated in
  one question type.
- No change to the scorer, the gold labels, or the corpus.

## Evidence

Results in `docs/testing/2026-08-08-pooled-recall-recovery.md`; artifacts and
checksums under `results/2026-08-08-pooled-recall-recovery/`. The stores,
harness and lane runners are preserved on `rama-tuf` as recorded in the
[compile-latency spec](./2026-08-08-pooled-compile-latency.md)'s Evidence
section.
