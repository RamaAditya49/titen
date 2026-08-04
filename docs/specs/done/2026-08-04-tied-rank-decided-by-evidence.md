---
work_id: tied-rank-decided-by-evidence
status: done
stage: done
outcome: completed
complexity: simple
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
---

# A tied rank decided by evidence, not by a uuid

## Outcome

Completed. When two candidates receive the same weighted score,
`rankCandidates` orders them by the stronger vector similarity before falling
back to `claim_id`. No score changes, no constant is introduced, no normalizer
moves, and a lexical-only deployment is unaffected.

This is the narrow part of issues 226 and 227 that could be paid for. The rest of
226 (a re-ingest under fresh identifiers may still reorder a genuine dead heat)
and all of 227 (the score is not comparable across queries) remain open; see
`docs/specs/done/2026-08-04-comparable-retrieval-score.md` for the measurement
that cancelled the larger design.

## Problem

`scoreCandidate` takes `max(lexical, semantic)` after min-max normalizing each
arm inside the authorized candidate set. Each arm's own best therefore scores
relevance exactly `1`. When the best lexical match and the best semantic match
are different claims — the ordinary hybrid case, not a corner — both reach
relevance `1`, and on a uniformly ingested corpus the other five components are
constant, so the two tie on the whole score to the last digit.

`rankCandidates` resolved that with `left.candidate.id.localeCompare(...)` over
identifiers minted at ingest. The answer was therefore a coin flip.

Measured on the pinned release fixture, 10 repeats, vector lane: two of seven
discriminating queries — `id_temporal_endpoint` and `jv_in_id_preference` — tie
at `0.816667` and flip between repeats. They are the entire source of the
lane's across-repeat variance: recall@1 0.7143 [0.5714, 0.8571].

Cosine is the one signal still able to separate those claims, and it survives
normalization: two cosines from one query are on one scale by construction.

## Scope

In scope: the comparator in `rankCandidates`.

Out of scope, deliberately:

- the relevance components themselves, the six weights, and any constant;
- a recency term in the comparator. Measured alone it removes variance by pinning
  the tie to the ingest-order loser and scores at the bottom of `HEAD`'s range on
  both lanes;
- server-side abstention and any cross-query score guarantee.

## Acceptance criteria

**AC-TIE-001 — Event-driven:** When two candidates receive the same weighted
score and carry different vector similarities, the ranker shall place the
candidate with the greater similarity first.

**AC-TIE-002 — Ubiquitous:** The ranker shall compare vector similarities only
with one another, so no constant and no comparison between two different scales
enters the ordering.

**AC-TIE-003 — State-driven:** While no vector similarity is available for any
candidate, the ranking shall be identical to the previous behaviour.

**AC-TIE-004 — Unwanted behavior:** If two candidates tie on both score and
vector similarity, then the ranker shall order them by `claim_id`, so that the
ordering stays total and repeatable.

**AC-TIE-005 — Ubiquitous:** No value returned in `score` or `score_components`
shall change.
