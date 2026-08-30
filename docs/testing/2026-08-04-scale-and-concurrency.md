# Scale and concurrency, FTS-only

Date: 2026-08-04

Verdict: **one Titen process is one core; the compile ceiling falls from about
1,700/s to about 90/s across two corpus decades, and recall@1 falls from 1.00
to 0.49 over the same two**

Every latency figure this repository had published before this run was
single-process, loopback, effectively single-client, against at most 10,000
statements. This run measures the four things that left open: ingest and
storage behaviour across three corpus decades, the compile throughput ceiling
under concurrent clients, the recall curve as the corpus grows, and which
resource binds first.

The lane is FTS-only. No embedding provider is contacted and none is
configured; the service process is started with every `TITEN_EMBED_*` and
`TITEN_EXTRACT_*` name removed from its environment, so the vector lane cannot
activate. No number here contains provider round-trip time, and none of it
should be read as a hybrid-retrieval result.

## Locked method

| Field | Value |
| --- | --- |
| runner as executed | `scripts/benchmark-scale.ts`, SHA-256 `5b2198baae7494fc365b929fc8d1712d1fe9e8e0d0c8a70b83a073462587f6dc` |
| runner as committed | SHA-256 `1d41ca9606780e0c5968c3b97c4e6a96ed3101b7b74ec9a85616504cc95ab6c0`; `diff` against the executed copy shows seven added header-comment lines recording the temporary-directory and `TMPDIR` behaviour and nothing else |
| system under test | `titen-memory` 0.5.7, tag `v0.5.7`, commit `f226df0f04b7480b8ebf99df34f6378e5a5dfa88`, clean at run start |
| runtime | Bun 1.3.14, `bun:sqlite`, `titen serve` on loopback |
| host | `benchmark-host`, AMD Ryzen 9 8945H, 8 cores / 16 threads, 32.9 GB RAM, Linux 7.0.12-201.fc44.x86_64 |
| lane | A — core: SQL + FTS5, no model and no vector backend |
| fixture | SHA-256 `53fe9244840e2e38e44232f11c53941cf6c3fa56417db5c702dacc1f95f4c8ca` |

The service runs as a separate operating-system process from the load
generator. That is load-bearing: `Bun.serve` and the client sharing one event
loop would turn every concurrency number into a measurement of the harness.
Service resident memory and CPU time are read from `/proc` for that child pid;
the harness reports its own CPU separately so a client-bound result cannot be
published as a service ceiling.

Corpus, deterministic from seed `20260804`: 400 topics, a 24-token pool per
topic, 8 to 20 distinct tokens per statement drawn without replacement from the
claim's own topic pool. Mean statement is 14.019 tokens and 111.15 bytes.
Topic of claim `i` is `i % 400`, so decade N is a strict prefix of decade 10N.
Query set is 100 queries, identical at every decade, each one six tokens of its
gold claim; every gold claim sits inside the first 1,000 records so the corpus
size is the only variable that moves.

Write path is the shipped one: `POST /v1/observations` for each record, then
`POST /v1/consolidations` in batches of 50 claims, each claim citing its own
observation, at client concurrency 8. Read path is `POST /v1/context/compile`
with `max_tokens` 2,000 and `max_candidates` 200, the shipped candidate
default. The 2,000-token budget, not a fixed top-k, is what bounds the returned
list: it held 10.05 items per compile at 100,000 claims and 10.01 at 10,000,
and 2.54 at 1,000 claims where fewer candidates existed at all. MRR@10
therefore sees the whole returned list.

Each concurrency level issues 3,000 requests, preceded once per decade by 50
untimed warmup compiles. Background maintenance is disabled
(`TITEN_MAINTENANCE_INTERVAL_MS=0`) so no indexing pass lands inside a latency
sample. The ceiling rule was declared before the run: the first level whose
throughput gain over the previous level falls under 10% makes the previous
level the ceiling, and a sweep that never plateaus reports no ceiling rather
than inventing one.

Three invocations are published. Runs 1 and 2 are independent repeats whose
databases were on `/tmp`, which is **tmpfs on this host**, so those figures are
RAM-backed and `PRAGMA synchronous = FULL` costs nothing. Run 3 repeats the
whole benchmark with `TMPDIR` pointed at the NVMe btrfs filesystem; it is what
an operator on a VPS actually gets, and section 5 reports it. Sections 1
through 4 are the RAM-backed pair, which isolates CPU from storage.

The host was not idle. Another agent's lifecycle soak service was resident
throughout. Measured foreign CPU during the run was 3.4% of one thread for an
idle `ollama` embedding server, 0.8% for the soak service and 0.7% for one
editor process; load average was 1.48 against 16 hardware threads while the
service under test held 104% of one thread.

## 1. Corpus decades

RAM-backed, runs 1 and 2. Canonical content bytes are the generated claim and
observation text; the amplification column divides the checkpointed database by
it.

| Claims | Ingest claims/s | Ingest cores | FTS rebuild | Database | Amplification | RSS after ingest | Peak RSS |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 2,365 / 2,623 | 1.28 / 1.31 | 11.7 / 12.6 ms | 5,685,248 / 5,697,536 B | 25.6x | 97.8 / 98.4 MiB | 130.1 / 130.4 MiB |
| 10,000 | 2,170 / 2,106 | 1.15 / 1.14 | 89.4 / 90.1 ms | 48,742,400 / 48,795,648 B | 21.9x | 96.4 / 97.8 MiB | 121.5 / 121.1 MiB |
| 100,000 | 1,850 / 1,798 | 1.08 / 1.09 | 966.8 / 948.3 ms | 480,628,736 / 480,829,440 B | 21.6x | 100.6 / 107.0 MiB | 149.7 / 150.8 MiB |

Ingest throughput falls 22% while the corpus grows 100-fold. FTS projection
rebuild — migration 11's own drop-and-repopulate of both FTS tables, executed
against the finished corpus — scales linearly, 7.7x then 10.8x per decade.
Database size is linear at about 4.8 KB per claim-and-observation pair for a
111-byte statement; the amplification is dominated by per-row fixed cost, not
by the text.

Service resident memory is flat in the corpus. A 100,000-claim store held
100.6 MiB after ingest against 97.8 MiB for a 1,000-claim store — a hundredfold
corpus for 3% more memory, because SQLite pages are not resident. Peak resident
memory tracks the query sweep rather than the corpus, reaching 149.7 MiB at
100,000 claims and 130.1 MiB at 1,000. The constraint at these decades is disk,
not memory.

Ingest consumes slightly more than one core (1.08 to 1.31), the only place in
this benchmark where the service exceeds a single thread at all; the excess is
runtime work outside the request loop. On durable storage the same phase drops
to about half a core, which section 5 explains.

Cold start does not grow with the corpus either: process launch to the first
successful `GET /healthz` was 58.4 / 52.7 / 53.5 ms across the three decades in
run 1 and 57.8 / 52.7 / 52.5 ms in run 2. A 100,000-claim store boots as fast
as an empty one.

The database column is the corpus alone, checkpointed before the sweep. It is
reported separately from the post-sweep file for a reason worth stating:
`POST /v1/context/compile` is a write. It persists a `context_runs` row and one
`context_run_items` row per selected claim, so 12,151 compiles per decade added
122,108 item rows and grew the 100,000-claim file from 480,628,736 to
524,644,352 bytes. Read traffic grows this database.

## 2. Concurrency

Run 1, 3,000 requests per level, zero failures at every level of every decade.
`Little` is `concurrency / throughput` in milliseconds — the latency a
saturated single-server queue must produce.

| Claims | Clients | Throughput | Gain | p50 | p95 | p99 | Little | Service cores | Client cores |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1 | 1,304.8/s | — | 0.70 ms | 1.16 ms | 1.48 ms | 0.77 ms | 0.98 | 0.18 |
| 1,000 | 8 | 1,503.8/s | +15.2% | 4.67 ms | 9.45 ms | 10.57 ms | 5.32 ms | 1.11 | 0.19 |
| 1,000 | 32 | 1,669.8/s | +11.0% | 18.40 ms | 21.63 ms | 38.32 ms | 19.16 ms | 1.09 | 0.20 |
| 1,000 | 64 | 1,704.8/s | +2.1% | 36.67 ms | 40.44 ms | 72.88 ms | 37.54 ms | 1.03 | 0.18 |
| 10,000 | 1 | 616.0/s | — | 1.55 ms | 2.11 ms | 2.46 ms | 1.62 ms | 1.01 | 0.16 |
| 10,000 | 8 | 679.7/s | +10.3% | 10.29 ms | 20.63 ms | 22.16 ms | 11.77 ms | 1.05 | 0.17 |
| 10,000 | 32 | 696.2/s | +2.4% | 43.80 ms | 57.75 ms | 89.53 ms | 45.97 ms | 1.03 | 0.15 |
| 10,000 | 64 | 718.4/s | +3.2% | 85.59 ms | 107.02 ms | 169.21 ms | 89.09 ms | 1.02 | 0.11 |
| 100,000 | 1 | 87.8/s | — | 11.34 ms | 11.99 ms | 12.53 ms | 11.39 ms | 1.03 | 0.12 |
| 100,000 | 8 | 89.8/s | +2.2% | 77.25 ms | 154.38 ms | 161.34 ms | 89.10 ms | 1.02 | 0.06 |
| 100,000 | 32 | 88.1/s | -1.9% | 354.61 ms | 372.71 ms | 710.98 ms | 363.14 ms | 1.03 | 0.04 |
| 100,000 | 64 | 89.9/s | +2.0% | 702.68 ms | 734.44 ms | 1,381.37 ms | 712.22 ms | 1.04 | 0.03 |

Run 2 reproduces this within a few percent at every cell; both runs and every
level are in the raw artifact.

Three things are visible and none of them is subtle.

**Throughput is set by the corpus, not by the client count.** The plateau is
about 1,700 compiles per second at 1,000 claims, about 700 at 10,000 and about
89 at 100,000. The first decade costs a factor of 2.4 and the second a factor
of 7.9, so cost per query is sub-linear in corpus size at first and close to
linear once fixed per-request work stops dominating.

**The service never leaves one thread.** Service CPU is 0.98 to 1.11 cores at
every level of every decade while 15 hardware threads sit idle, and the client
never exceeds 0.21 cores. `Bun.serve` is one event loop and `bun:sqlite` calls
are synchronous on it, so a single Titen process cannot use a second core no
matter how many clients arrive.

**Past saturation, added concurrency buys latency, not throughput.** `Little`
tracks measured p50 within a few percent at every point, which is what a
saturated single-server queue does: latency becomes `concurrency / throughput`
and nothing else. At 100,000 claims, going from 1 client to 8 multiplied p95 by
12.9 and bought 2.2% more throughput.

The declared 10% rule places the ceiling at 32 clients for 1,000 claims in
run 1 and 8 in run 2, at 8 clients for 10,000 claims in both runs, and at 1
client for 100,000 claims in both. The 1,000-claim disagreement is real and is
why the gain column is published: run 1's step to 32 clients gained 11.0% and
run 2's gained 2.2%, straddling the threshold. **The stable statement is the
throughput plateau in requests per second, not the client count at which a
threshold fires.** At and above 10,000 claims, a single concurrent client
already saturates the service.

The non-linear knee in p95 is between 1 and 8 clients, not higher up. At
100,000 claims, p95 relative to the single-client value is 12.9x at 8 clients,
31.1x at 32 and 61.3x at 64: linear in client count above 8, and steeper than
linear across the first step. Queueing starts immediately because the service
is already busy with one client in flight.

## 3. Recall degradation

Same 100 queries at every decade, concurrency 1, compile returning about ten
items inside its 2,000-token budget.

| Claims | Same-topic competitors | recall@1 | MRR@10 | Compile p50 |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 2.5 | 1.00 / 1.00 | 1.000 / 1.000 | 0.71 / 0.70 ms |
| 10,000 | 25 | 0.81 / 0.80 | 0.897 / 0.892 | 1.61 / 1.54 ms |
| 100,000 | 250 | 0.49 / 0.48 | 0.609 / 0.597 | 11.44 / 11.57 ms |

Recall is not flat as the corpus grows, and the repository should stop assuming
it is. Lexical BM25 loses half its top-1 accuracy over two decades on this
corpus while MRR@10 falls by 0.39, because the number of documents sharing the
query's vocabulary grows with the corpus and BM25 has only document length and
term rarity left to separate them.

The absolute values are a property of the generator, not of Titen. Competitor
density here is a chosen constant, and at 1,000 claims a query has on average
2.5 same-topic candidates, so recall 1.00 there records an uncontested corpus
rather than ranking skill. The externally authored Mr. TyDi lane in
[`results/2026-08-01-titen-041-replacement-gate/`](./results/2026-08-01-titen-041-replacement-gate/)
remains the only retrieval quality evidence. What transfers from this table is
the shape: a monotone decline that a reranking or vector stage would have to
arrest, which is strategic debt item 3 in `PONYTAIL-DEBT.md` with a measured
slope attached to it for the first time.

Compile p50 also grows with the corpus, 0.71 ms to 11.44 ms over two decades:
2.3x across the first decade and 7.1x across the second, sub-linear in corpus
size at both steps and approaching linear at the larger one. The
FTS `MATCH` expression conjoins `org_scope`, `subject_scope` and the statement
terms, and every claim in this benchmark shares one organization and one
subject, so the scope doclists cover the whole corpus. That reading is taken
from the query in `src/core/retrieval.ts`; **it is not isolated by an
ablation** and the next run should split the corpus across subjects to confirm
or refute it.

## 4. What binds first

One thread, always. Whether that thread is spending its time computing or
waiting depends on the storage and the corpus size, and section 5 measures
both; this section is the RAM-backed case, where it is CPU.

The evidence is direct rather than inferred. Service CPU time from `/proc` is
1.02 to 1.11 cores at every concurrency level of every decade; a thread blocked
on a lock or on `fsync` would not accumulate that CPU time. The client stays
under 0.21 cores and falls to 0.03 at the highest level, so the load generator
is not the limit. There were zero request failures in 36,000 measured compiles
per run, so nothing was shed. The SQLite write lock is not the constraint on
the RAM-backed runs: writes do serialise, but the single event loop already
serialises them before the lock is reached. The embedding round trip is not a
term at all — no provider is configured, and none should be read into any
number in this document.

The operational consequence is that Titen's Bun/SQLite deployment scales by
process, not by thread. `src/runtime/bun/server.ts` says so in a comment
already; this run puts a number on it. Sixteen hardware threads deliver the
throughput of one until an operator runs more processes, and more processes
against one SQLite file is a different design question than this benchmark
answers.

The second consequence is for the numbers this repository publishes. A p50 in
milliseconds from a single client is not a capacity statement: at 100,000
claims the same service at eight clients returns a p50 seven times larger for
2.2% more throughput. **The publishable figure is throughput per process at a
stated corpus size**, with latency reported at a stated client count beside it.

## 5. Durable storage

Run 3 repeats the whole benchmark with the database on the NVMe btrfs
filesystem instead of tmpfs. Nothing else changes: same runner, same seed, same
query set, same declared rule. This is the configuration an operator deploys.

| Claims | Ingest claims/s | Ingest cores | Compile plateau | Service cores at plateau | recall@1 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 355 (was 2,365) | 0.48 | 439/s (was 1,705/s) | 0.44 | 1.00 |
| 10,000 | 309 (was 2,170) | 0.50 | 307/s (was 718/s) | 0.59 | 0.79 |
| 100,000 | 311 (was 1,850) | 0.58 | 78/s (was 90/s) | 0.95 | 0.49 |

Ingest is 6 to 7 times slower and consumes about half a core. `PRAGMA
synchronous = FULL` is a deliberate durability choice in
`src/runtime/bun/sqlite.ts` — a successful response means the transaction
survived power loss — and this is its price. The write path on durable storage
is not CPU-bound; it waits.

The compile penalty shrinks as the corpus grows, and that is the interesting
part. At 1,000 claims durable storage costs 74% of compile throughput and the
service holds 0.44 cores, because the `context_runs` write that every compile
performs dominates the query. At 100,000 claims it costs 13% and the service is
back to 0.95 cores, because the FTS work has grown until it dominates the
`fsync` again. **What binds first is not one answer: it is `fsync` on small
corpora and CPU on large ones.**

Concurrency therefore helps more on durable storage than in RAM, for the
uninteresting reason that overlapping clients let one request compute while
another waits on the disk: the step from 1 to 8 clients gained 53% at 1,000
claims and 48% at 10,000, against 15% and 10% on tmpfs. The 10% rule places the
ceiling at 32, 8 and 8 clients. Service CPU still never exceeded 0.95 cores at
any level: waiting on the disk does not buy a second thread either.

recall@1 lands within two points of the RAM-backed pair at every decade — 1.00,
0.79 and 0.49 against 1.00/1.00, 0.81/0.80 and 0.49/0.48 — which is the check
that the configurations differ only in storage. The residual wobble is not
noise in the corpus, which is deterministic: it is the fresh-identifier
tie-break described in strategic debt item 2, measured here at one to two
points out of 100 queries.

FTS projection rebuild is 1.4 to 1.7 times slower on disk: 19.7 ms, 137.9 ms
and 1,345.8 ms across the decades.

## What this run does not show

- **No vector lane.** Adding it needs an operator embedding profile, and
  provider round-trip time must be reported as its own term rather than folded
  into these numbers. Nothing here supports a hybrid-retrieval claim.
- **No Cloudflare/D1.** Its concurrency model is the platform's, and the local
  miniflare path is not a substitute for real D1.
- **One host, one process, one subject, loopback.** No network path, no
  multi-process deployment, no sharding across subjects.
- **No 10^6 tier.** `EVALS.md` defines tier L; it was not run.
- **No ablation for the scope-term cost.** The mechanism named in section 3 is
  read from the SQL, not isolated by an experiment.
- **Synthetic corpus.** The recall intercept is not comparable to any external
  benchmark, and this lane measures no evidence, authorization, lifecycle,
  conflict or enrichment behaviour.
- **Minutes, not hours.** Each invocation runs a few minutes. Soak, leak and
  WAL-growth behaviour is strategic debt item 8 and is not touched here.

## Evidence

Checksummed artifacts are under
[`results/2026-08-04-scale-and-concurrency/`](./results/2026-08-04-scale-and-concurrency/),
one directory per invocation: `run1` and `run2` RAM-backed, `run3-nvme` on
disk. Each contains `manifest.json` with the host, version and configuration,
`summary.json`, `raw.jsonl` with every decade record including all four sweep
levels, and `SHA256SUMS`. `sha256sum -c SHA256SUMS` passes in all three.

Reproduce with, from a v0.5.7 checkout:

```sh
bun scripts/benchmark-scale.ts --self-test
bun scripts/benchmark-scale.ts --out results-dir --sweep-requests 3000
TMPDIR=/path/on/disk bun scripts/benchmark-scale.ts --out results-dir-nvme --sweep-requests 3000
```

Artifacts hold ids, counts, timings, metrics and hashes only. They were scanned
for every generated API key and for a sample of generated statements before
being written, and re-scanned afterwards for credential markers, corpus tokens,
endpoints and paths with no match. Each invocation removed its temporary
database directory on success.
