---
work_id: pooled-store-benchmark
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-07
updated: 2026-08-08
owner: ramaaditya
spec: docs/specs/done/2026-08-07-pooled-store-benchmark.md
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
- [x] MCP reference pooled at n=60 questions (per-query cost is the result if
      it is infeasible at 500).
- [x] Artifacts + SHA256SUMS under results/ before any summary is written.

### P4 — Phase-2 lanes (as compute allows, same prereg)

- [x] Titen FTS+vector (router embeddinggemma, drain before query):
      0.212 pooled, 9,054 s drain, 342,129 vectors, outbox zero.
- [x] Control router arm: 0.174 pooled, the largest tax (68.0).
- [x] Mem0 OSS 2.0.15 infer=False pooled: 0.182, 3,953 s wall,
      205,641 embed calls, zero add errors; sharded exact-scan adapter.

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

- [x] CHANGELOG Unreleased -> 0.7.1; verify-pack on rama-tuf ("titen-memory
      -0.7.1.tgz is publishable"); npm publish (registry date 2026-08-07
      matches the heading); tag v0.7.1 -> e8ca89e; GitHub Release live.
- [x] titen-web: release:sync 0.7.1, benchmark page section 06b from the
      committed records only, deployed as Worker version
      2e7b44cb-29f9-4f63-9eb7-320744c8bf96, smoked /version.json (0.7.1),
      /releases/0.7.1 (200), homepage badge, and /benchmark on both hostnames.

## Not in this plan

- The closed-loop write-back (echo) experiment. Its design and prereg live in
  the performance-axis answer (docs/research/2026-08-07-performance-axis.md);
  it runs as its own spec/plan pair when scheduled.
- Any change to Titen source. This work measures the shipped artifact.

## Acceptance evidence

- AC-PSB-001: prereg commit `11518ce` precedes every scored artifact; the
  git history is the ordering evidence.
- AC-PSB-002: every lane scored by `harness/common.py`; the MCP reference
  lane's 60/60 connection failures scored 0.0 and stayed in the denominator.
- AC-PSB-003: every published cell names package, arm, store size, and
  concurrency; Mem0's default mode has a labelled cost extrapolation and no
  scored cell.
- AC-PSB-004: falsifiers 2 (prediction wrong by 45+ points) and 5 (p95
  864.9 ms > 250 ms) fired against Titen and lead the report's verdict
  paragraph and the titen.dev section.
- AC-PSB-005: every Titen lane ran the registry tarball
  (dist.shasum 620af9a392b13c9bef91a215cf96eee2569e8f3e), vector arm plus
  explicitly installed sqlite-vec@0.1.9.
- AC-PSB-006: all lanes consumed `pooled_common.pooled_sessions()`; no
  divergence occurred, so no lane was discarded.

## Verification

Anchor gate reproduced 0.880/0.9147 exactly, four independent invocations.
`pnpm check:workflow` green. Artifacts + SHA256SUMS committed under
`docs/testing/results/2026-08-07-pooled-store/artifacts/` and verified with
`sha256sum -c` on the bench host.
