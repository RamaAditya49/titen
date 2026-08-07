---
work_id: pooled-store-benchmark
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-07
updated: 2026-08-08
owner: ramaaditya
---

# Measure the pooled-store condition: quality, latency, and cost at production store shape

## Problem

Every published LongMemEval-S number — Titen's, MemPalace's, Mem0's, the
controls' — gives each question its own ~50-session haystack. A real memory
store is one shared, cumulative corpus. The 2026-08-07 landscape survey
(docs/research) verified that:

- BEAM (arXiv:2510.27246) publishes accuracy-vs-token-scale, but only for
  managed stacks and paper configurations, end-to-end with an LLM reader, on a
  fully synthetic corpus; no self-hosted OSS configuration has a published
  quality-vs-store-size curve on real conversational data;
- zero memory systems publish tail latency at 10^5+ stored items;
- Titen's own synthetic curve (recall@1 1.00 -> 0.49 across two decades) has
  never been tested on externally authored data, and the 2026-08-07 #291 run
  proved the contract suite cannot see a plan that collapses at that scale.

This work measures the pooled condition — all 19,829 distinct LongMemEval-S
sessions in ONE single-subject store per lane, all 500 questions against it —
publishing recall@1/MRR@10, compile latency p50/p95/p99 at four store sizes,
and the cost to build each lane's store. A subject-scoped anchor arm re-queries
a copy of the published per-instance store so "just scope by user_id" becomes a
measured row, and doubles as the harness anchor gate.

The axis selection behind this work — four candidate axes adversarially killed,
one surviving with repairs, and the honest meta-conclusion that no axis was
found on which Titen is structurally favoured to win a new quality number — is
recorded in
[the performance-axis answer](../../research/2026-08-07-performance-axis.md).

## EARS acceptance criteria

- **AC-PSB-001 — Event-driven:** When the pooled measurement is published,
  Titen shall have committed its pre-registration (protocol, metrics,
  falsifiers, prediction) in a commit that precedes every scored artifact.
- **AC-PSB-002 — Ubiquitous:** Every lane shall be scored by the one shared
  scorer with failed or missing instances kept in the denominator.
- **AC-PSB-003 — Ubiquitous:** Every published cell shall name the exact
  configuration measured (package version, arm, store size, concurrency), and
  absent cells shall be em dashes, never extrapolations.
- **AC-PSB-004 — Event-driven:** When a falsifier fires, the result shall be
  published with the same prominence a positive result would have received.
- **AC-PSB-005 — Ubiquitous:** The system under test shall be the public npm
  artifact (titen-memory@0.7.0, dist.shasum
  620af9a392b13c9bef91a215cf96eee2569e8f3e), not a repository checkout.
- **AC-PSB-006 — Unwanted behavior:** If any lane's store construction
  diverges from the shared gold-first deterministic order, then that lane's
  results shall be discarded and the divergence reported.

## Falsification

Fixed in the pre-registration
(docs/testing/2026-08-07-pooled-store-prereg.md), committed before the first
scored run. A null or negative on any falsifier is a publishable outcome.

## Non-goals

- No answer-accuracy lane (nulled 2026-08-06; not re-run).
- No concurrency sweep (covered 2026-08-04 on the synthetic corpus).
- No claim about any competitor's managed product.
- No reranking or ranking change to Titen itself in this work.

## Evidence

Measured results in docs/testing/2026-08-07-pooled-store.md; artifacts under
~/titen-bench-20260804/results/ on rama-tuf with checksummed summaries in
docs/testing/results/2026-08-07-pooled-store/.
