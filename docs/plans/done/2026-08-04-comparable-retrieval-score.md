---
work_id: comparable-retrieval-score
status: done
stage: done
outcome: cancelled
complexity: complex
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
spec: docs/specs/done/2026-08-04-comparable-retrieval-score.md
---

# Plan: a compiled score that carries cross-query signal

## Closure reason

Cancelled on measurement, not abandoned. Ten repeats per lane, each source change
isolated on top of `HEAD`, showed that the risky half of the design (raw cosine)
measurably switches semantic retrieval off, that the safe half (the bm25 squash)
earns nothing a four-line tie-break does not, and that the constant holding the
two together is set by one embedding model's cosine range. Issues 226 and 227
stay open and are recorded as open in `docs/reference/api.md`.

## Result

Cancelled. `src/core/rank.ts` is reverted to `HEAD` apart from the tie-break
covered by `2026-08-04-tied-rank-decided-by-evidence`. This file is kept as the
measurement record, because the numbers that cancelled the work are more useful
than the work was.

## Measurement environment

`pnpm benchmark:retrieval`, harness `titen-retrieval-h2h-v1`, fixture
`titen-057-h2h-v2` content sha256 `d7e2785158e659aef5ae192e1f74d4a9d1b693f6ef9ffe84ee507bf13bed92a5`,
38 documents, 8 queries of which 7 discriminate, `--repeats 10`, `--warmup 2`,
fresh database, server and subject namespace per repeat. Vector lane:
`tuf/embeddinggemma` 768d over the local `model-eval` profile, minimum cosine 0.
Every row below is one source change applied alone on top of `HEAD` by file
swap; `git` was not written to.

Median [min, max] across 10 repeats.

## FTS-only lane

| variant | recall@1 | recall@3 | MRR@10 | nDCG@3 |
| --- | --- | --- | --- | --- |
| HEAD | 0.5714 [0.5714, 0.7143] | 0.8571 flat | 0.7381 [0.7347, 0.8095] | 0.7517 [0.7517, 0.8044] |
| bm25 squash only | 0.5714 [0.5714, 0.7143] | 0.8571 flat | 0.7381 [0.7347, 0.8095] | 0.7517 [0.7517, 0.8044] |
| raw cosine only | 0.5714 [0.5714, 0.7143] | 0.8571 flat | 0.7364 [0.7347, 0.8095] | 0.7517 [0.7517, 0.8044] |
| recency tie-break only | 0.5714 flat | 0.8571 flat | 0.7347 flat | 0.7517 flat |
| all three, as shipped | 0.5714 flat | 0.8571 flat | 0.7347 flat | 0.7517 flat |

Raw cosine is inert on this lane, which is the sanity check that the isolation
works: no candidate carries `vector_boost`.

The review said the score rewrite was "strictly worse than HEAD on every primary
metric" here. At 10 repeats that is not what it is. Two of the three primary
medians are **equal** to `HEAD` and MRR@10 is lower by 0.0034; the shipped
range sits inside `HEAD`'s range on every metric. The earlier reading compared a
candidate against `HEAD`'s **maximum**, 0.7143, which `HEAD` reaches in 4 of 10
repeats.

What is true, and is attributable to the recency tie-break rather than to the
squash, is that the shipped tree is deterministically wrong on
`id_temporal_endpoint`: the tie survives, and recency resolves it toward the
newer claim, which on a fixture that writes core facts before distractors is the
distractor.

## Vector lane

| variant | recall@1 | recall@3 | MRR@10 | nDCG@3 |
| --- | --- | --- | --- | --- |
| HEAD | 0.7143 [0.5714, 0.8571] | 1 flat | 0.8333 [0.7619, 0.9048] | 0.8758 [0.8231, 0.9286] |
| bm25 squash only | 0.8571 flat | 1 flat | 0.9048 flat | 0.9286 flat |
| raw cosine only | 0.7143 [0.5714, 0.7143] | 0.8571 flat | 0.8143 [0.7429, 0.8143] | 0.8044 [0.7517, 0.8044] |
| recency tie-break only | 0.5714 flat | 1 flat | 0.7619 flat | 0.8231 flat |
| all three, as shipped | 0.8571 flat | 1 flat | 0.9048 flat | 0.9286 flat |
| **cosine tie-break only** | **0.8571 flat** | **1 flat** | **0.9048 flat** | **0.9286 flat** |

The last row is the whole argument. A four-line change to the sort comparator,
introducing no constant, changing no returned score and leaving both normalizers
alone, reproduces the shipped tree's entire vector-lane result exactly.

`HEAD`'s variance on this lane is two coin flips and nothing else.
`id_temporal_endpoint` and `jv_in_id_preference` each put two claims at score
`0.816667` to the last digit — each arm's own best normalizes to relevance 1, so
the lexical best and the semantic best tie — and `id.localeCompare` over
per-ingest uuids decided both.

## Why raw cosine was dropped

Raw cosine alone drops recall@3 from 1 to 0.8571 and turns the vector lane's
ranked lists into the FTS-only lists. The mechanism is arithmetic: a cosine of
0.70 cannot beat a within-set-normalized lexical 1.0 under `max()`, so the
semantic arm stops contributing.

It survived in the shipped combination only because the squash pushed the
lexical arm's maximum on this fixture to 0.494, below this model's cosine band.
That crossover is set by one source constant against one provider's cosine
distribution. Holding the corpus, the model and everything else fixed and
changing only `BM25_HALF_SCORE_MAGNITUDE`:

| k | vector recall@1 | recall@3 | MRR@10 | nDCG@3 |
| --- | --- | --- | --- | --- |
| 12 (shipped) | 0.8571 flat | 1 flat | 0.9048 flat | 0.9286 flat |
| 4 | 0.7143 flat | 0.8571 flat | 0.8214 flat | 0.8044 flat |
| 2 | 0.5714 flat | 0.8571 flat | 0.7347 flat | 0.7517 flat |

At `k = 2` the design measures below `HEAD`'s median. A model whose cosines run
lower is indistinguishable from this, and nothing in the code or the fingerprint
would catch it.

## Why the constant could not be defended

With raw cosine removed, the vector lane is identical for `k` in
{2, 4, 8, 12, 24, 50, 200} — squashed lexical is below 1 for any positive `k`, so
the semantic best always wins the relevance comparison. The harness cannot
distinguish the values, so no value of `k` can be said to be measured against it.

On the FTS-only lane `k` does move the result, and it moves it the wrong way for
the shipped value: `k = 2` measures recall@1 0.7143 [0.5714, 0.7143] and MRR@10
0.8061 [0.7347, 0.8095], both better than `k = 12`'s 0.5714 and 0.7381.

The doc comment additionally claimed that the fixture's largest bm25 magnitude is
11.71 so no candidate reaches 0.5. That is true for the queries in the fixture
and false as a general statement about the corpus, which is what the review
found; it is also irrelevant to the ordering, since the squash is monotone.

## Why #227 is not closed by half of this

Squashing bm25 makes rank 1 vary with match quality **only when no vector store
answers**. Measured top-1 scores per query, one repeat, FTS-only lane: `HEAD`
returns `0.816667` on all eight; squash-only returns eight distinct values from
0.4921 to 0.6143. On the vector lane, squash-only returns `0.816667` on all
eight again, because the vector arm still normalizes its own best to 1.

Closing 227 therefore needs both arms absolute, which is the combination
measured above as provider-coupled. Issue 227 stays open and
`docs/reference/api.md` now says so where a caller will read it.

## Verification

`pnpm test:api`, `pnpm test:integration`, `pnpm check:workflow` all pass with
`src/core/rank.ts` at `HEAD` plus the tie-break. Every file swap was restored
from a `/tmp` copy and verified by `sha256sum` against the copy before the next
measurement.
