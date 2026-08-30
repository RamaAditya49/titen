# The pooled misses are not a candidate-generation problem

Date: 2026-08-08. This is the C1 deliverable of
[`2026-08-08-pooled-candidate-generation`](../specs/done/2026-08-08-pooled-candidate-generation.md),
and it fires that spec's **falsifier 0** before any experiment ran, which is
what falsifier 0 is for.

Verdict up front: **85% of the pooled top-10 misses are already inside the
candidate pool.** Widening candidate generation cannot reach them. The cycle is
redirected rather than executed, and the four pre-named experiments (G1–G4) are
**not run**.

## What was measured

The published pooled figure — gold absent from the top-10 in 246 of 500
instances (49.2%) — counts misses from the *returned pack*, which is bounded by
the token budget. That number does not say where the gold actually was. This
run finds each miss's true position using the shipped query builder against a
read-only copy of the pooled store (19,829 sessions, 342,129 claims), ranking by
the same BM25 over the same `planFtsQuery` match expression the product issues.

| Class | Count | Share of misses | What it means |
| --- | ---: | ---: | --- |
| gold in the top-10 | 254 | — | not a miss |
| **`in_pack_below_10`** | **111** | 45% | gold was returned, ranked 11+ |
| **`in_pool_not_pack`** | **98** | 40% | gold was in the 1,000-candidate pool, cut by the token budget |
| **`outside_pool`** | **37** | 15% | gold never entered the candidate pool |

209 of 246 misses — **85%** — are reachable without touching candidate
generation at all. The median pool holds 570 distinct sessions per query.

### Where the reachable ones sit

- `in_pack_below_10`: median rank **21**, p75 38, max 74. A re-ranker over the
  top-20 could reach **53 of 111**; over the top-50, **100 of 111**.
- `in_pool_not_pack`: median session rank **106**, p75 196, max 742. Only 22 sit
  within the pool's top-50; 47 within the top-100. These are a *packing and
  budget* question, not a ranking one — the pack stops long before them.

### By question type

| Type | hit@10 | in pack, 11+ | in pool, unpacked | outside pool |
| --- | ---: | ---: | ---: | ---: |
| knowledge-update | 61 | 13 | 4 | 0 |
| single-session-assistant | 52 | 1 | 3 | 0 |
| temporal-reasoning | 58 | 34 | 26 | 15 |
| multi-session | 53 | 41 | 34 | 5 |
| single-session-user | 27 | 17 | 22 | 4 |
| **single-session-preference** | **3** | 5 | 9 | **13** |

`single-session-preference` is the one type where candidate generation really
fails: 13 of 30 golds never enter the pool, and only 3 reach the top-10. It is
also the type the 2026-08-04 reranking work already identified as the weakest
(recall@1 0.400 per-instance). Everywhere else, the pool already holds the
answer.

## Consequences

1. **Falsifier 0 fires; the spec's four experiments do not run.** G1 (rare-term
   query replacement), G2 (per-term pool widening), G3 (pseudo-relevance
   feedback) and G4 (chunk granularity) all address the 15% slice at best. Two
   of them (G2, G4) were already expected to fail their latency and
   shippability gates. Running them would spend days to address the smallest of
   three problems.
2. **The successor is deep re-ranking — a class never tested.** The 2026-08-08
   improvement cycle's six losing variants all re-ranked strictly *within the
   top-10*, so they could not move a gold sitting at rank 21. The measured
   ceiling for a top-50 re-ranker is +100 instances of 500, which is **+20
   points of recall@1** if every one were placed first — far above the +26.2
   oracle over the top-10 window quoted before, because the window itself was
   the limit.
3. **Packing is its own lever, worth 98 instances.** A gold at pool rank 106
   with a 32,000-token budget is a budget-allocation outcome, not a retrieval
   one. Nothing in this programme has ever measured whether the packer's
   ordering and truncation are the binding constraint.
4. **`single-session-preference` is the only candidate-generation case**, and it
   is small (30 instances). Any future candidate work should be justified
   against that type alone, not against the 49.2% headline.

## What this does not show

- **No experiment was run and nothing was tuned.** This is an accounting of an
  existing artifact plus one read-only query pass; no lane was re-scored, no
  variant was tried, and no recall number changes.
- **The pool probe omits the authorization and temporal predicates** that the
  served query applies. On this store they cannot change which sessions are
  reachable — one org, one subject, one principal, zero retention exclusions,
  every claim `private` and active — but on a store where they can, the
  `outside_pool` count would be a lower bound.
- **`pool_limit` is 1,000**, the value the published runs used. A different
  candidate cap moves the boundary between `in_pool_not_pack` and
  `outside_pool`; it does not move the 254 hits or the 111 in-pack misses.
- **No claim that a deep re-ranker would work.** The ceiling is arithmetic. The
  six cheap-lexical losers of 2026-08-08 are evidence that reaching a ceiling is
  the hard part, and nothing here contradicts them.

## Evidence

`~/titen-bench-20260808/c1-depth.json` on `benchmark-host` (per-instance class, pack
rank, pool rank, pool size), produced by
[`c1_depth.ts`](./results/2026-08-08-pooled-candidate-generation/harness/c1_depth.ts).
Checksummed copy under
[`results/2026-08-08-pooled-candidate-generation/`](./results/2026-08-08-pooled-candidate-generation/).
