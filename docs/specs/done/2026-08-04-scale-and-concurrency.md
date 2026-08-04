---
work_id: scale-and-concurrency
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
---

# Scale and concurrency are measured, not assumed

## Outcome

Completed. `scripts/benchmark-scale.ts` measures three corpus decades, a
four-level concurrency sweep, and a recall curve on one fixed query set, all on
the FTS-only lane with no embedding provider. Three invocations are published:
two RAM-backed repeats that isolate CPU, and one on the NVMe filesystem that
shows what durability costs. The result is published as
[`docs/testing/2026-08-04-scale-and-concurrency.md`](../../testing/2026-08-04-scale-and-concurrency.md)
with checksummed artifacts under
[`docs/testing/results/2026-08-04-scale-and-concurrency/`](../../testing/results/2026-08-04-scale-and-concurrency/).
Closes strategic debt item 7 in `PONYTAIL-DEBT.md`.

## Problem

Every latency figure this repository had published before this work was
single-process, loopback, effectively single-client, against at most 10,000
statements. `docs/testing/EVALS.md` already defines the vocabulary for the
missing numbers — dataset tiers XS through L, saturation point, throughput,
peak memory, index build time — and none of them had a measured value.

Four questions were open, and the product was making public performance claims
without an answer to any of them:

1. what ingest throughput, FTS projection rebuild time, database size and
   service resident memory look like as the corpus grows by decades;
2. where compile throughput stops improving as concurrent clients rise, which
   `EVALS.md` calls the saturation point;
3. whether retrieval quality is flat as the corpus grows, which the repository
   had assumed rather than measured;
4. which resource binds first, so an operator knows what to buy.

The 2026-07-31 Mem0 cycle-2 report ran concurrency 1, 8 and 32, but against
eight facts. Eight records do not exercise an index, so that lane measured
transport and process overhead, not scale.

## Scope

In scope: the Bun/SQLite runtime on one host, the FTS-only lane, one subject
namespace, and the shipped `POST /v1/context/compile` write path.

Out of scope, deliberately:

- the vector lane. It needs an operator embedding profile, and folding provider
  round-trip time into Titen's number would make the ceiling unreadable. A
  vector-lane scale run is separate work and must report provider latency as
  its own term.
- Cloudflare/D1. Its concurrency model is the platform's, not this adapter's.
- the 10^6 tier. Nothing in the product yet justifies the run time, and the
  10^5 result already answers what binds first.
- multi-subject sharding. Every claim lives in one subject here, which is the
  worst case for the scope terms in the FTS MATCH expression and therefore the
  honest one to publish.

## Acceptance criteria

**AC-SCALE-1 — Ubiquitous:** The harness shall report ingest throughput in
claims per second, FTS projection rebuild time, database file size, and service
process resident memory at each of 10^3, 10^4 and 10^5 claims.

**AC-SCALE-2 — Ubiquitous:** The harness shall report compile throughput and
p50, p95 and p99 compile latency at concurrent client levels 1, 8, 32 and 64
against a fixed corpus.

**AC-SCALE-3 — Event-driven:** When throughput gain from one concurrency level
to the next falls below a threshold declared before the run, the harness shall
name the previous level as the throughput ceiling; when throughput never stops
improving, it shall report no ceiling rather than name one.

**AC-SCALE-4 — Ubiquitous:** The harness shall report recall@1 and MRR@10 on
one query set that is identical at every decade, so the corpus size is the only
variable that moves between decade measurements.

**AC-SCALE-5 — State-driven:** While the sweep is running, the harness shall
record the service process CPU time and its own client CPU time separately, so
a client-bound result cannot be published as a service ceiling.

**AC-SCALE-6 — Ubiquitous:** The service under test shall run as a separate
operating-system process from the load generator, and the harness shall read
that process's resident memory and CPU time from the kernel rather than from
its own runtime.

**AC-SCALE-7 — Unwanted behavior:** If any embedding or extraction provider
variable is present in the harness environment, then the spawned service shall
not receive it, so the FTS-only lane cannot silently become a hybrid lane.

**AC-SCALE-8 — Unwanted behavior:** If a generated credential or a generated
corpus statement would appear in an artifact, then the run shall fail before
that artifact is written.

**AC-SCALE-9 — Ubiquitous:** The published evidence document shall name the
resource that binds first and shall state which of its numbers are properties
of the synthetic corpus rather than of Titen.

## Non-goals

The absolute recall numbers are not a retrieval quality claim. The corpus is
generated, its competitor density is a chosen constant, and the externally
authored Mr. TyDi lane in
`docs/testing/results/2026-08-01-titen-041-replacement-gate/` remains the only
quality evidence. The curve across decades is the result here; its intercept is
not comparable to anything.
