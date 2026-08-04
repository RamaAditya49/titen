---
work_id: comparable-retrieval-score
status: done
stage: done
outcome: cancelled
complexity: complex
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
---

# A compiled score that carries cross-query signal

## Outcome

**Cancelled on measurement.** Nothing from this work ships. `src/core/rank.ts`
keeps within-set min-max normalization of both relevance arms, exactly as at
`HEAD`.

Issues 226 and 227 remain **open**. They are not quietly fixed elsewhere and
they are not reclassified as won't-fix; the design proposed here was measured,
did not pay for itself, and no replacement design has been measured yet.

The one defect this work correctly identified — that a manufactured exact tie at
rank 1 was resolved by a freshly minted uuid — is addressed separately and much
more narrowly in `2026-08-04-tied-rank-decided-by-evidence`, which changes the
tie-break only and leaves every returned score untouched.

## Why it was cancelled

Three measurements, each 10 repeats per lane on the pinned release fixture, each
isolating one source change on top of `HEAD`. Full tables are in the paired plan.

1. **The bm25 squash earns nothing that a tie-break does not.** Squash alone:
   FTS-only identical to `HEAD` on every primary metric, vector lane
   0.8571/1/0.9048/0.9286 flat. A four-line cosine tie-break with no formula
   change and no constant: the same four numbers, flat. The squash's entire
   measured contribution is breaking a tie.

2. **Raw cosine measurably switches semantic retrieval off.** Raw cosine with the
   lexical arm still min-max normalized drops the vector lane to recall@3 0.8571
   from 1 and to recall@1 0.7143 [0.5714, 0.7143]: cosines around 0.70 cannot
   beat a within-set-normalized lexical 1.0, so the vector lane degrades to the
   FTS-only answer.

3. **The constant is load-bearing and coupled to one provider's cosine range.**
   The shipped pair only works because `BM25_HALF_SCORE_MAGNITUDE = 12` puts the
   squashed lexical maximum (0.494 on this fixture) below this model's cosines
   (0.65–0.75). Changing that one number and nothing else, on the same corpus and
   the same model: `k = 4` gives vector recall@1 0.7143 and recall@3 0.8571;
   `k = 2` gives 0.5714 and 0.8571, below `HEAD`'s median. An embedding model
   returning cosines in a lower band is arithmetically indistinguishable from
   lowering `k`, so the constant would have to be re-derived per model and
   carried in the index fingerprint — and it would still be a source constant
   deciding which retrieval arm a deployment listens to.

The stated derivation of `k = 12` was also not reproducible. On the vector lane
the metric is identical for every `k` in {2, 4, 8, 12, 24, 50, 200} once raw
cosine is removed, and on the FTS-only lane `k = 2` measures **better** than
`k = 12` (recall@1 median 0.7143 against 0.5714). "Measured against the release
retrieval harness" was not a property the harness could confirm or refute.

## What was learned and is worth keeping

- The compiled score is comparable **within one response only**. That is now
  stated in `docs/reference/api.md` as a limitation with issue 227 named, instead
  of being left for a caller to discover.
- Closing 227 fully requires **both** arms absolute, not one. Squashing bm25
  alone leaves rank 1 pinned at `0.816667` on any query where the vector store
  answers, because the vector arm still normalizes its own best to 1.
- The recency tie-break is not a quality improvement. Measured alone, it removes
  `HEAD`'s across-repeat variance by pinning the coin flip to the ingest-order
  loser: FTS-only recall@1 0.5714 flat and vector recall@1 0.5714 flat, both at
  the bottom of `HEAD`'s range.

## Acceptance criteria

Retained verbatim as the record of what was attempted. None of them is satisfied
by shipped code, and none should be treated as a live requirement.

**AC-SCORE-1 — Ubiquitous:** The lexical relevance component shall be a
bounded, strictly increasing function of the BM25 magnitude that returns `0`
for an unmatched candidate and never returns `1`. *(Not shipped.)*

**AC-SCORE-2 — Event-driven:** When the vector store returns a similarity for a
candidate, the ranker shall use that cosine value unchanged, without rescaling
it against the other candidates in the set. *(Not shipped: measured as a
regression, see item 2 above.)*

**AC-SCORE-3 — Ubiquitous:** Any constant introduced by the squash shall be
derived from a recorded measurement of the release retrieval harness and
documented at its definition with that derivation. *(Could not be satisfied: the
harness cannot distinguish candidate values of the constant, see item 3.)*

**AC-SCORE-4 — Event-driven:** When two candidates receive the same weighted
score, the ranker shall order them by relevance, then by the newer `created_at`,
then by `claim_id`. *(Superseded by
`2026-08-04-tied-rank-decided-by-evidence`, which orders by semantic similarity
then `claim_id` and drops the recency term on measurement.)*

**AC-SCORE-5 — State-driven:** While no embedding capability is configured, the
compile path shall keep returning lexical results and shall not regress on the
release retrieval harness FTS-only lane. *(This was the criterion that failed
first: the shipped tree measured FTS-only recall@1 0.5714 flat against `HEAD`'s
0.5714 [0.5714, 0.7143].)*

**AC-SCORE-6 — Ubiquitous:** Hybrid relevance shall remain the stronger of the
lexical and semantic signals, and `src/core/` shall remain free of external
imports. *(Still true of shipped code, and true at `HEAD` too.)*

**AC-SCORE-7 — Unwanted behavior:** If a candidate carries a cosine at or below
zero, then the relevance component shall be no lower than the lexical component
for that candidate. *(Moot: `normalizeVectorSimilarity` never admits a
non-positive cosine.)*

## Superseded-supersession note

The earlier spec `docs/specs/done/2026-07-30-core-ranking-dependency-failures.md`
and its AC-CORE-001 were declared superseded by this work. That declaration is
withdrawn: AC-CORE-001 requires the within-set min-max normalization of vector
similarity, and shipped code still does exactly that.
