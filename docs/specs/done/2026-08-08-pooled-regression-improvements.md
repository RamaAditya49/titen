---
work_id: pooled-regression-improvements
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-08
updated: 2026-08-08
owner: ramaaditya
---

# Improve what the pooled-store measurement broke: latency, ranking, and the vector arm

## Problem

The [pooled-store measurement](../../testing/2026-08-07-pooled-store.md)
fired two pre-registered falsifiers against Titen and exposed a third
regression, and for the first time provides a corpus on which fixes are
measurable:

1. **Latency.** Compile p95 at the 19,829-session pool is 864.9 ms against
   the 250 ms line. The suspected mechanism is measured-adjacent but never
   ablated: the FTS `MATCH` conjoins `org_scope`/`subject_scope` terms whose
   doclists cover the whole corpus when one subject holds every claim
   (2026-08-04 scale report §3 names this and marks it unablated), and every
   compile writes `context_runs` rows.
2. **Ranking headroom.** Pooled recall@1 0.246 against recall@10 0.508 puts
   **+26.2 points** inside Titen's own top-10 — 2.6x the per-instance
   ceiling, on a corpus where k finally discriminates (17.4-point k=10
   spread). Every prior reranking attempt died on a saturated corpus;
   PONYTAIL-DEBT item 3's precondition ("justify against a corpus where
   signals vary") is now met.
3. **The vector arm hurts pooled.** FTS+vector 0.212 against FTS-only 0.246
   at 2.8x latency. The same embedder's dense control collapsed harder
   (0.174), implicating the embedding space rather than the fusion — but
   that attribution is an inference, not yet an ablation.
4. **Prediction discipline.** The prereg's 0.70–0.85 prediction missed by
   45+ points because corpus distractor density was assumed, not audited.

## EARS acceptance criteria

- **AC-PRI-001 — Event-driven:** When any scored improvement run is
  published, its protocol, metrics, and falsifiers shall have been committed
  before the run, and its store shall be byte-identical to (a copy of) the
  2026-08-07 pooled artifacts' store or rebuilt from the same pinned order.
- **AC-PRI-002 — Ubiquitous:** Latency cells shall be measured with no other
  benchmark workload on the host, at concurrency 1, loopback, and shall
  publish p50/p95/p99 with the store size named.
- **AC-PRI-003 — Event-driven:** When a candidate ranking or query change
  fails its pre-registered gate, it shall not ship, and the failure shall be
  recorded in the measurement report.
- **AC-PRI-004 — Ubiquitous:** Any shipped query-plan change shall carry
  `EXPLAIN QUERY PLAN` evidence against a realistic-row-count store and a
  dual-runtime contract case, per the standing 2026-08-07 rule.
- **AC-PRI-005 — Ubiquitous:** `src/core/**` shall retain zero external
  imports; no new dependency, migration, or configuration flag without a
  measured requirement recorded in the report.
- **AC-PRI-006 — Event-driven:** When a future measurement pre-registers a
  prediction, the prereg shall include a distractor-density audit of the
  corpus, written before the prediction.

## Falsification

Per-experiment falsifiers live in the paired pre-registration
(docs/testing/2026-08-08-pooled-improvements-prereg.md), committed before
any scored run. Headline gates, restated:

- **E-LAT:** if no safe query/parameter change reaches compile p95 ≤ 250 ms
  at the full pool with recall@1 within 0.5 points of 0.246, the latency
  falsifier stands and the sizing guidance ("shard by process / scope by
  subject") remains the only answer. Published either way.
- **E-RANK:** a ranking variant ships only if it gains ≥2.0 points of pooled
  recall@1 at p < 0.05 (paired sign test) AND does not lose ≥0.5 points on
  the per-instance anchor condition. Anything weaker is recorded and dropped.
- **E-VEC:** if a second embedder's dense lane also lands below FTS-only on
  the pooled store, the failure is the embedding-space class, and the vector
  arm's documentation is scoped to per-instance/scoped stores; if it lands
  above, the fault is the profile/fusion and a fusion fix becomes a follow-up
  spec. Either verdict is publishable.

## Non-goals

- No LLM reranking stage in this cycle (cost class is different; needs its
  own spec if E-RANK's cheap variants fail).
- No change to the write path or the schema.
- No re-run of answer accuracy.
- No new external corpus.

## Evidence

Measured results in docs/testing/2026-08-08-pooled-improvements.md; raw
artifacts under ~/titen-bench-20260804/results/ on rama-tuf, checksummed
summaries under docs/testing/results/2026-08-08-pooled-improvements/.
