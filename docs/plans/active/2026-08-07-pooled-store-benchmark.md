---
work_id: pooled-store-benchmark
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-07
updated: 2026-08-07
owner: ramaaditya
spec: docs/specs/active/2026-08-07-pooled-store-benchmark.md
review_after: 2026-08-21
---

# Plan — pre-register, run the pooled lanes, publish whatever the store says

## Dependency spine

P1 (pre-registration) gates every scored run. P2 (harness) may be built before
P1 is committed but may not produce a scored artifact until it is. P3 day-1
lanes precede P4 phase-2 lanes. P5 publishes; P6 is the website handoff.

## Sequence

### P1 — Pre-registration, committed on its own

- [x] Fixture accounting (distinct sessions, sid-text uniqueness, gold
      coverage, bytes/tokens) verified and recorded before any run.
- [x] Protocol, store construction, lanes, metrics, falsifiers, and the
      prediction committed ahead of every scored artifact.
- [x] Harness-validation smoke disclosed (940-session gold-only store, run
      before this document was finalized, never quoted as a result).

### P2 — Harness

- [x] `pooled_common.py` — one shared gold-first deterministic store order.
- [x] `pooled_run.py` — Titen lane: tarball serve, per-compile latency.
- [x] `control_pooled.py` — verbatim-RAG control over the full pool matrix.
- [x] `prep_pooled.py` + `run_pooled.js` — MCP reference floor lane.
- [x] Import checks green in each lane's venv on rama-tuf.

### P3 — Day-1 scored lanes (rama-tuf, never the laptop)

- [x] Subject-scoped anchor: copy of the 2026-08-04 `fts-500.db` served by the
      0.7.0 tarball, all 500 questions; the anchor gate (falsifier 1) fires
      before anything else is reported.
- [x] Titen FTS-only at 1,000 / 5,000 / 10,000 / 19,829 sessions, fresh store
      per size, 500 queries each, concurrency 1, latency per compile.
- [x] Control fastembed at the same four sizes from one embedding cache.
- [x] MemPalace 3.6.0 published-benchmark shape (user-only, MiniLM) pooled.
- [ ] MCP reference pooled at n=60 questions (per-query cost is the result if
      it is infeasible at 500).
- [x] Artifacts + SHA256SUMS under results/ before any summary is written.

### P4 — Phase-2 lanes (as compute allows, same prereg)

- [ ] Titen FTS+vector (router embeddinggemma, drain before query).
- [ ] Control router arm.
- [ ] Mem0 OSS 2.0.15 infer=False pooled.

### P5 — Analysis and publication

- [x] Sign tests: each lane full-pool vs its published per-instance ranked
      lists, identical instances; lane-vs-lane at full pool.
- [x] recall@1/MRR@10 primary; recall@5/@10 saturation status re-evaluated at
      the pooled condition and reported explicitly.
- [x] Latency-vs-store-size table with client location and concurrency stated.
- [x] Report in docs/testing/2026-08-07-pooled-store.md: what it establishes,
      what it does not, failures included.
- [x] EVALS.md and PONYTAIL-DEBT.md updated where the result changes what
      either may claim.

### P6 — Release and website handoff

- [ ] CHANGELOG Unreleased -> 0.7.1; verify-pack; npm publish; tag; GitHub
      Release.
- [ ] titen-web: release:sync 0.7.1, benchmark page updated from the committed
      records only, deploy, smoke /version.json and /benchmark.

## Not in this plan

- The closed-loop write-back (echo) experiment. Its design and prereg live in
  the performance-axis answer (docs/research/2026-08-07-performance-axis.md);
  it runs as its own spec/plan pair when scheduled.
- Any change to Titen source. This work measures the shipped artifact.
