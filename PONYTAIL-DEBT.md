# Ponytail debt ledger

Re-audited on 2026-08-04. This ledger is generated from tracked `ponytail:`
comment markers.

Run `pnpm check:ponytail` after moving, adding, or removing a marker. The check
is local and requires no hosted automation.

## Summary

- Markers: 1.
- Markers without a source trigger: 0.

## Tracked markers

- `src/runtime/bun/server.ts:262` — in-process mode still binds a listening
  socket. `serve()` now returns the handler it serves so an embedded consumer
  can call the kernel directly (#230), but the port is opened and then never
  connected to. Removing it means splitting the app, maintenance timer, and
  shutdown wiring out of `serve()` into their own factory — a ~75-line move for
  a listener nobody uses. Upgrade when an embedded consumer objects to the bound
  port; until then the unused socket is cheaper than the refactor.

## Closure evidence

- Public Cloudflare logins combine account throttling with the native Rate
  Limiting binding; password changes reject common and contextual values.
- Context compilation supports bounded point-in-time recall and per-request
  candidate limits, while portable UTF-8 budget units cover non-Latin text.
- Stable source observations and canonical claims converge independently of the
  24-hour request-key window.
- Confirmed statement hashes prevent duplicate embedding calls, and the bounded
  index verifier queues repairs for partial provider loss.
- Existing cursor, migration dry-run, organization fairness, webhook delivery,
  benchmark, vector-boundary, and Bun deployment behavior are now explicit
  tested product contracts rather than temporary shortcuts.
- Dashboard sessions use sealed Web Crypto cookies and can cross replicas when
  operators share one 32-byte key.
- Current OpenClaw bundles import remote HTTP MCP configuration directly; agent
  lifecycle capture remains an intentional explicit-invocation privacy boundary.

The zero-marker release is public as
[`titen-memory@0.5.5`](https://www.npmjs.com/package/titen-memory/v/0.5.5) and
[GitHub release v0.5.5](https://github.com/RamaAditya49/titen/releases/tag/v0.5.5).
Exact Cloudflare, `rama-tuf`, registry, and rollback identifiers live in the
[terminal delivery evidence](./docs/specs/done/2026-08-01-ponytail-zero.md#delivery-evidence).

## The measured position, LongMemEval-S, 2026-08-04

Supersedes the Mr.TyDi section below as the primary evidence, because it is a
larger externally authored corpus (MIT, 500 instances, 246,930 turns) and it is
the corpus an independent audit already published controls for. Session
retrieval, ground truth `answer_session_ids`, our own scorer, failures kept in
the denominator. Full protocol was pre-registered before the first run.

| Lane, n=500 | recall@1 | MRR@10 | LLM calls | embed calls | ingest |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Titen FTS-only** | **0.880** | **0.915** | 0 | 0 | 816 s |
| verbatim-RAG control, router embeddings | 0.854 | 0.907 | 0 | 877 | 2,378 s |
| MemPalace 3.6.0, MiniLM | 0.804 | 0.872 | 0 | 0 | 486 s |
| verbatim-RAG control, fastembed | 0.772 | 0.843 | 0 | 0 | 1,989 s |
| MCP reference server (substring) | 0.050 | 0.151 | 0 | 0 | 13 s |

Read the sign tests, not the ordering. Against the dense control on the same 500
instances: **44 wins, 31 losses, 425 ties, p = 0.165**. Titen is *not* measurably
better than roughly a hundred lines of cosine-over-sessions. The wins that do
reach significance are against lanes carrying a weaker embedder, so they are
partly a context-length artifact (#268) rather than clean retrieval wins.

Three things this changes.

1. **The cost axis is the defensible claim, not the accuracy axis.** Mem0 OSS
   2.0.15, in-process, embedder pinned to the same model, on the 60-instance
   subsample: recall@1 **0.833** from **2,981 LLM calls** and **288,021 s** of
   ingest — about 80 hours. Titen scored higher with zero LLM calls, and the
   paired test says the difference is not significant either way (2 wins, 5
   losses, 53 ties, p = 0.45). Extraction-based memory bought no measurable
   retrieval advantage over embedding the raw sessions, at roughly 350x the
   ingest time. That independently reproduces MemDelta (arXiv:2606.29914) on a
   different subsample, and it is the strongest honest statement we can make.
2. **The FTS-only lane is the product, not the fallback.** It is our best
   measured configuration on this corpus and it needs no provider at all. The
   deployment story should lead with the zero-dependency operating point rather
   than treating it as degraded.
3. **The reranker case is real but bounded, and not automatic.** recall@10 is
   0.982 against recall@1 0.880, so ten points are retrieved and mis-ranked —
   that is the entire addressable gain. MemPalace ships a reranked mode and it
   scored *worse* than its own plain vector mode in both embedding
   configurations (0.733 vs 0.867, and 0.800 vs 0.850). Measure the ceiling
   before building the stage (#269).

Standing limitation: the strongest Titen configuration, FTS+vector, has no
500-instance run (#266), and recall@10 is saturated on this corpus so only k=1
and MRR discriminate (#267).

## Strategic debt beyond the issue tracker

Recorded 2026-08-04 from a release-bound benchmark of the published
`titen-memory@0.5.7` tarball on `rama-tuf` (seven lanes, adversarial
verification of every reported failure) and a same-date survey of Mem0, Honcho,
Zep/Graphiti, Letta, Cognee and Supermemory.

Issues #220-#256 track defects. This section tracks what closing every one of
them would still leave undone. None of these are `ponytail:` markers; they are
independent of the generated ledger above and `pnpm check:ponytail` is
unaffected by them.

Measured baseline this section argues from. Externally authored corpus
(Mr.TyDi Indonesian, 25 queries, 100 documents), five independent repeats per
lane, both systems on one 9router endpoint with `tuf/embeddinggemma` at 768
dimensions, top-k 10:

| Lane | recall@1 | recall@3 | MRR@10 | nDCG@10 | query p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Titen FTS-only | 0.440 | 0.840 | 0.630 | 0.712 | 0.83 ms |
| Titen FTS+vector | 0.680 | 1.000 | 0.807 | 0.856 | 170 ms |
| Mem0 2.0.13, stock input | 0.640 | 0.920 | 0.778 | 0.834 | 355 ms |
| Mem0 2.0.13, matched input | 0.720 | 0.920 | 0.818 | 0.863 | 360 ms |

Mem0 ran in library mode with reranking, its reranker and its graph store all
disabled, because Titen has no equivalent of any of them. That is Mem0's
weakest configuration. A fairer rematch is expected to raise Mem0's numbers,
not lower them, and every item below is written on that assumption.

### 1. Automatic derivation is the category gate, and Titen has not passed it

Titen requires the caller to author claims. Mem0, Honcho and Letta ingest raw
conversation and derive memory themselves. Every standard long-horizon memory
benchmark feeds raw dialogue, so Titen cannot enter one without a harness that
performs the extraction — and that harness would be doing the hard part.

The frozen activation gate has never been passed. Best result on 2026-08-04 was
`cx/gpt-5.6-luna` in JSON-object mode at 65.56% lexical-contract pass against a
90% threshold. The 2026-07-31 full lane recorded claim F1 55.98%, exact
cited-source F1 48.84%, minimum kind/language lexical recall 0%, temporal
accuracy 61.04% and reflection accuracy 25.83% — all far below their gates.

Debt:

- Decide whether the gate is measuring the right thing. Scoring free-form model
  output against a frozen lexical fixture punishes correct paraphrase; a
  semantic or entailment-based contract check may be the honest instrument.
- Obtain a provider that actually honours `response_format`. Strict JSON-schema
  requests are currently unenforceable through 9router (#255), so schema mode
  has never been tested against a conforming provider.
- Ship the revision attestation and three-target runtime smoke the roadmap
  still lists as absent.
- Until this closes, state plainly that Titen competes on caller-authored
  memory, and stop comparing recall against systems that derive their own.

### 2. Retrieval scores carry no cross-query signal

The relevance term is min-max normalised inside the candidate set, and trust,
recency, utility, conflict and confidence contributed a constant 0.416667 on
every fixture record. Rank 1 therefore scores exactly 0.816667 on every query
regardless of how good the match is.

Three consequences, only the first of which #226 and #227 cover:

- Ties are broken by a fresh per-run claim identifier, so 12 of 25 neutral-corpus
  top-1 answers were decided by a coin flip and five identical repeats produced
  five different rankings. Narrowed 2026-08-04: a tied score now breaks on the
  stronger vector similarity first, which removes the flip wherever a vector
  store answers. A dead heat with no vector signal is still decided by the
  identifier, and the score itself is unchanged.
- Threshold abstention is impossible. Titen cannot say "nothing here is good
  enough", which is the behaviour the `no_result` fixture category exists to
  test and which stayed at zero for every lane.
- No score is comparable between two queries, so no caller can build a
  confidence gate on top of Titen's output.

Debt: emit a calibrated absolute score. `TITEN_EMBED_MIN_COSINE` has no shipped
default and vectors fail closed without it, so every operator currently
calibrates alone.

### 3. There is no reranking stage at all

Titen fuses lexical and vector retrieval and stops. Mem0 ships a reranker,
Zep ships Graphiti, Honcho ships a tool-using recall agent. On the neutral
corpus Titen already reaches recall@3 of 1.000 — the correct answer is
essentially always inside the top three — while recall@1 is 0.680. That gap is
exactly what a reranker closes, and it is the single largest quality lever not
represented in the issue tracker.

Debt: a cross-encoder or LLM rerank stage over the top-k, opt-in and degrading
cleanly when absent, in the same shape as the existing optional vector path.

### 4. Temporal modelling is behind Graphiti, not ahead of it

Graphiti models transaction time and valid time as separate interval pairs on
every edge. Titen has validity windows but ranking does not distinguish
temporal polarity: statements meaning "from July 2026" and "before July 2026"
score identically (#228). No public claim of temporal leadership survives
contact with Graphiti; the defensible narrower claim is against Mem0 and
Honcho, neither of which models validity intervals at all.

Debt: bitemporal intervals, and a temporal signal that actually reaches the
ranker rather than only the filter.

### 5. No Python client

Mem0 does 3,833,479 PyPI downloads per month, graphiti-core 1,548,307,
honcho-ai 746,380. Titen ships a TypeScript SDK and a Bun CLI. This single gap
excludes most of the addressable market regardless of kernel quality.

Debt: a thin Python client over the REST contract, or an explicit README line
saying Python is unsupported and when that changes. Silence reads as oversight.

**Closed 0.6.0.** `clients/python/` ships a standard-library-only client over the
REST contract, installed from a checkout and not published to PyPI. The README
states that surface exactly. Publishing it to PyPI remains open.

### 6. No published, reproducible retrieval evidence

`docs/testing/EVALS.md` declines to publish results before a harness exists. A
harness now exists — the 2026-08-04 head-to-head built a shared fixture, a
symmetric scorer, and independent runners for both systems — but it lives
outside the repository and nothing in the release process runs it.

Debt: commit a release-bound retrieval harness, pin the package version it
measures, run it on every release, and publish the numbers including the
losses. Do not chase LOCOMO: independent audits put its answer key at 6.4%
wrong and its LLM judge at a 62.81% false-accept rate.

**Closed 0.6.0.** `pnpm benchmark:retrieval` runs a release-bound harness over a
SHA256-pinned fixture, refuses to name a winner when across-repeat ranges
overlap, and carries its own scorer self-test. The first results are published in
[the neutral head-to-head](./docs/testing/2026-08-04-neutral-head-to-head.md),
losses and null results included. LOCOMO was not attempted.

### 7. Scale and concurrency are unmeasured

Largest corpus exercised was 10,000 statements against 600 queries. Every
latency figure in this repository is single-process, loopback, effectively
single-client. There is no concurrency test, no throughput ceiling, no index
build time at scale, and no recall degradation curve as a corpus grows.

Debt: a concurrent-client load profile, and a corpus decade above 10^4 before
any performance claim is made in public.

**Closed 0.6.0, and the answer is uncomfortable.**
[Measured](./docs/testing/2026-08-04-scale-and-concurrency.md) to 10^5 claims and
64 concurrent clients. The service uses **one core** at every concurrency level
of every decade — 0.98 to 1.11 of 16 hardware threads — so at and above 10,000
claims a single client already saturates it; at 10^5, going 1 to 8 clients
multiplies p95 by 12.9 for 2.2% more throughput. Little's Law matches measured
p50 within a few percent everywhere, which is what a saturated single-server
queue does. Compile throughput plateaus at 1,705 / 718 / 90 rps across the
decades. Recall is **not** flat: recall@1 1.00 / 0.81 / 0.49 on an identical
query set, though the corpus is synthetic so only the shape transfers. Cold start
stays at ~53 ms and resident memory grows 2.9% across a hundredfold corpus.
Tracked as #259 and #260. The ceiling is now published as an operator sizing
rule in [VPS
deployment](./docs/deployment/vps.md#capacity-rate-limiting-and-telemetry) and
in `deploy/README.md`, so remaining debt is no longer measurement or disclosure
— it is deciding whether to shard across processes or to parallelise within
one.

### 8. Operational lifecycle is unexercised

Longest observed uptime during the benchmark was about five minutes. No
0.4.1-to-0.5.7 data migration has been tested; every store measured was
freshly bootstrapped and every migration observed applied to an empty database.
`export_import` reports as enabled and has never been exercised end to end.
Every D1 result came from local miniflare, which CONTRIBUTING.md itself states
is not a substitute for real Cloudflare D1.

Debt: an hour-scale soak with leak and WAL-growth detection, a real upgrade
rehearsal across a minor version, a backup and restore drill, and one authorised
real-D1 smoke.

**Mostly closed 0.6.0.**
[Rehearsed](./docs/testing/2026-08-04-operational-lifecycle.md) across nine
published releases with `scripts/rehearse-upgrade.ts`: zero canonical rows lost
or mutated on any in-place upgrade, a real backup-destroy-restore drill, and a
JSONL export/import round trip. Two product facts fell out: the **data-usable
upgrade floor is 0.2.0** — a 0.1.x store migrates without error and then answers
404 on every claim (#257) — and its export is rejected by its own importer
(#258). The drill also found a latent `deploy/backup.sh` defect where a relative
backup directory recorded a relative checksum path; no shipped invocation was
affected. Still open: the authorised real Cloudflare D1 smoke, and a soak longer
than the ~35 minutes observed.

### 9. The distribution floor is narrower than the pitch

The self-host floor is the strongest verified advantage in the product: zero
transitive dependencies, a 193,555-byte tarball, 51 ms median boot to a healthy
readiness probe, and 65.2 MiB idle resident memory, with the complete
observe-consolidate-compile loop working with no model or vector configured.
Nothing surveyed comes close. The packaging around it does not match:

- No published container image. A Dockerfile exists; Docker Hub and ghcr do not
  serve an image.
- Bun is required, and the advertised installer pipes a second installer.
- The vector path is scoped to glibc Linux x64 with an exact `sqlite-vec` pin
  and fails readiness on fingerprint mismatch.
- The tarball has no provenance attestation binding it to a commit (#242).

Debt: publish an image, and either widen platform coverage for the vector path
or scope the claim to what is smoke-tested.

**Partly closed 0.6.0.** The image exists and was built and run before anything
was claimed: 217 MB, non-root, `/readyz` healthy on a fresh volume with all 21
migrations applied, `sqlite-vec` loading inside the image, 34.8 MiB idle resident
memory. The image is **not published**: this repository runs no GitHub Actions, so it is
pushed to ghcr by hand from a maintainer's machine like every other release
artifact, and that push has not happened yet. The local proof used podman rather
than docker. Bun-required, the vector path's platform scope, and
npm provenance (#242) all remain open.

### 10. Deepen the moats instead of chasing recall

Three advantages are verified and unmatched by every system surveyed: the
self-host floor above; work coordination — leases, handoffs, checkpoints —
inside the same authorization and audit boundary as the memory; and Cloudflare
Workers with D1 as a first-class runtime running the same kernel and the same
export format as the local deployment.

Coordination is the one nobody else has any answer to. Mem0 has no lease or
lock API; Honcho's queue exists only to schedule its own background reasoning;
Zep and Letta have nothing at the memory layer. Multi-agent work is where the
category is heading, and this is the only place Titen is already ahead rather
than catching up.

Debt: make coordination the headline product with its own benchmark, its own
failure-mode documentation and its own worked example, rather than a section
below memory. Publish the FTS-only operating point as a first-class product
mode — 0.83 ms p50 with recall@3 of 0.840 and no model dependency at all is a
position no competitor offers and none of them can reach.

### 11. Bus factor of one

155 of 159 commits come from a single contributor. There is no second
maintainer, no company and no funding. Every technical item above is gated on
one person's availability, and adopters evaluating a memory system for
production will price that in before they price in recall.

Debt: this is the constraint that decides how many of the items above can
credibly be attempted at all. Sequence accordingly, and prefer the two items
that widen the moat (3 and 10) over the eight that chase parity.
