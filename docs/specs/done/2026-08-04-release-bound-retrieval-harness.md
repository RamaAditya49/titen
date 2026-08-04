---
work_id: release-bound-retrieval-harness
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
---

# Release-bound retrieval harness

## Outcome

Completed. The Titen side of the 2026-08-04 head-to-head now lives in this
repository as `scripts/benchmark-retrieval-h2h.ts` with its fixture pinned at
`tests/fixtures/retrieval-h2h.json`. The harness boots this repository's own
Bun/SQLite runtime, ingests the fixture through the shipped write path, scores
retrieval with one system-neutral scorer, reports a median and the full
across-repeat range for every metric, and refuses to name a winner when two
runs' ranges overlap. The competitor's runner was not vendored; the header
documents the external comparison instead.

## Problem

`docs/testing/EVALS.md` states that it does not publish results before the
harness exists. Strategic debt item 6 in `PONYTAIL-DEBT.md` records the
consequence: a harness did exist, but it lived on one machine outside version
control, nothing in the release process ran it, and the numbers it produced
could not be reproduced from a commit. An evaluation that only its author can
run is not evidence.

Three properties made the external run trustworthy and all three were
un-owned by this repository:

1. the fixture was fixed, so a number could be traced to the corpus behind it;
2. every metric carried a range across independent repeats, not a single value;
3. the comparison refused to name a winner when those ranges overlapped.

Anything that recovers those properties must survive being handed to somebody
else, which means it belongs next to the code it measures.

## Scope

In scope: the Titen side of the harness, the fixture it measures, the shared
scorer, the comparison rule, and the artifact-redaction boundary.

Out of scope: the competing system's runner, the externally authored neutral
corpus, LOCOMO, concurrency and scale profiles, and any published number. Titen
does not vendor a competitor's benchmark runner, and a comparison whose two
runners share an author measures the author.

## EARS acceptance criteria

- **AC-RBRH-001 — Ubiquitous:** The harness shall score every run through one
  scorer that reads only `case_id`, `status`, `latency_ms`, `ranked` and
  `scores`, so that no signal produced by a single system can reach a metric.

- **AC-RBRH-002 — Ubiquitous:** The fixture shall carry a version string, and
  the harness shall assert a pinned sha256 taken over the fixture fields that
  can change a number: `fixture_version`, `top_k`, `core_facts`,
  `distractor_facts`, `cases` and `ground_truth_variants`.

- **AC-RBRH-003 — Unwanted behavior:** If the fixture content hash differs from
  its pin, or the fixture version carries no pin at all, then the harness shall
  refuse to run and shall write no artifact.

- **AC-RBRH-004 — Ubiquitous:** The harness shall report recall@1, recall@3,
  recall@10, MRR@10, nDCG@3, nDCG@10 and a no-result correctness term, and
  shall exclude precision@k with a stated reason, because one gold per case at
  k=10 pins precision@10 at recall@10 divided by ten.

- **AC-RBRH-005 — Ubiquitous:** The harness shall run at least five repeats,
  each against a fresh database, a fresh server and a fresh subject namespace,
  shall discard at least two untimed warm-up queries per repeat, and shall
  report every metric as a median and the full across-repeat range.

- **AC-RBRH-006 — Unwanted behavior:** If the leading run's across-repeat range
  for a primary metric overlaps the runner-up's range, or the primary metrics
  disagree on the leader, then the harness shall decline to declare a winner
  and shall state the reason for the refusal.

- **AC-RBRH-007 — Ubiquitous:** Harness artifacts shall contain fixture
  identifiers, ranks, scores, metrics, latencies, counts and hashes only, and
  shall be checked against every credential, provider origin, fixture statement
  and fixture query before they are written.

- **AC-RBRH-008 — Optional feature:** Where a result file for another system in
  the documented neutral contract is supplied, the harness shall score it with
  the same scorer and shall reject it before measuring when its corpus size or
  fixture hash disagrees with this fixture.

- **AC-RBRH-009 — Event-driven:** When a repeat ingests fewer facts than the
  fixture holds, or fewer repeats than the floor are present, the harness shall
  mark the run unscoreable, report the blocking reason, and exit non-zero.

- **AC-RBRH-010 — Ubiquitous:** The scorer arithmetic shall carry an
  assert-based self-check that runs from the harness itself and fails when the
  metric definitions, the missing-case accounting, the abstention rule or the
  overlap rule change.

## Non-goals

- Publishing a number. This work commits the instrument, not a result.
- Claiming neutrality. The shipped fixture is Titen's own corpus and its
  distractors were written after reading Titen's ranker; the harness states
  this in the artifact rather than implying otherwise.
- Cloudflare coverage. The harness exercises Bun/SQLite only and says so.
