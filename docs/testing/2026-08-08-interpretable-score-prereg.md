# Pre-registration — make `score` interpretable across queries (#227)

Written 2026-08-08, **before any scored cell**, against `main` at `65075ec`.
Closes the loop on [#227](https://github.com/RamaAditya49/titen/issues/227),
which has been open since 2026-08-04 and describes a live defect.

## What is wrong today

`normalizeRelevance` is min-max over the candidate set, so the best candidate
scores exactly `1` on the 0.40-weight relevance term by construction, and
`span === 0` short-circuits to `1` as well. Every other component is constant
on a uniformly ingested corpus. Measured at HEAD by calling `rankCandidates`
directly:

| candidate set | `bm25` | rank-1 `score` |
| --- | --- | ---: |
| strong lexical match | −18.0, −2.0 | **0.796667** |
| weak lexical match | −0.4, −0.1 | **0.796667** |
| single candidate | −0.02 | **0.796667** |

The issue's two stated consequences follow: threshold abstention is
arithmetically impossible, and two poorly-matching results tie at the ceiling.

## The change under test

Relevance stops being set-relative and becomes a saturating function of the
absolute match strength, **per query term**:

```
strength = (-bm25) / termsUsed
relevance = strength / (strength + RELEVANCE_HALF_STRENGTH)
```

`termsUsed` already exists on `FtsQueryPlan` and is threaded from
`planFtsQuery` through `rankCandidates`. Dividing by it is not cosmetic: BM25
magnitude scales with the number of matched terms, so without it the score
would partly measure *query length*, which is the opposite of comparable
across queries.

The vector arm stops being min-max normalized too, and uses raw cosine, which
is already an absolute 0..1. Leaving it set-relative while the lexical arm
became absolute would make `max(lexical, vector)` a comparison between two
different scales, and the vector arm — whose best is always 1 under min-max —
would win almost every time.

### Calibration, measured before the change was written

`RELEVANCE_HALF_STRENGTH = 3.7`, from the anchor store
(`titen-bench-20260804/lanes/titen/fts-500.db`, 424,168 claims) over the first
300 LongMemEval-S questions, 300/300 matched:

| | p10 | p25 | median | p75 | p90 | max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| rank-1 `\|bm25\|` | 17.09 | 20.62 | **25.73** | 31.94 | 38.35 | 69.26 |
| terms per query | 4 | — | **7** | — | 11 | 17 |

25.73 / 7 = **3.68 per term**, so a median-quality rank-1 lands at 0.50, p10 at
0.40, p90 at 0.60, and the best observed query at 0.73.

**This constant is corpus-calibrated and that is a real limitation, stated
here rather than discovered later.** BM25 is not portable across corpora — that
is precisely why the current code normalizes within the set. The claim being
made is not that 3.7 is universal; it is that a documented, overridable
constant calibrated on a public benchmark is more useful than a value that is
constant by construction on every corpus.

## Gates

- **AC-INT-001.** Rank-1 `score` differs by ≥ 0.05 between a strong-match and a
  weak-match query on the anchor store. Today it differs by exactly 0.
- **AC-INT-002.** Two poorly-matching results do not tie at the ceiling: on the
  anchor store, the rate of exact rank-1 score ties across the 500 questions
  falls below the current rate.
- **AC-INT-003 — the one that decides shipping.** Retrieval quality does not
  regress. On **both** conditions, against the published baselines:
  - anchor recall@1 ≥ **0.875** (baseline 0.880, so at most −0.5 points)
  - pooled recall@1 ≥ **0.241** (baseline 0.246, at most −0.5 points)
  - neither recall@10 falls by more than 1.0 point
  - the paired sign test against the baseline is **not** significant at
    p < 0.05 in the losing direction
- **AC-INT-004.** Compile p95 does not rise. The transform is arithmetic on
  values already loaded; anything above +5% means something else changed.

## Falsifiers — written now, kept whatever they say

1. **The blend reorders and recall drops.** Min-max always stretches the set
   across the full [0,1]; saturation compresses it, so the other five
   components carry relatively more weight. This is the single most likely
   outcome and it would fail AC-INT-003.
2. **The vector-arm change dominates.** Removing min-max from cosine may move
   the hybrid lanes more than the lexical change moves the FTS lanes.
3. **The constant is wrong for the pooled store.** It was calibrated on the
   anchor. Pooled density changes the BM25 distribution, and 3.7 may sit in
   the wrong part of the curve there.
4. **Nothing regresses and nothing improves** — the change is then correct but
   unexciting, and ships on AC-INT-001/002 alone.

## What happens on failure

If AC-INT-003 fails, **the ranking change does not ship.** The fallback is not
"tune the constant until it passes" — that is fitting to the benchmark. The
fallback is to leave `score` as it is and publish the absolute strength as a
separate reported field, which satisfies the issue's *abstention* consequence
without touching ranking, and to say plainly in #227 that the rest was measured
and rejected.

No cell has been scored at the time of writing.
