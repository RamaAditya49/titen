---
work_id: tied-rank-decided-by-evidence
status: done
stage: done
outcome: completed
complexity: simple
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
spec: docs/specs/done/2026-08-04-tied-rank-decided-by-evidence.md
---

# Plan: a tied rank decided by evidence, not by a uuid

## Approach

One comparator in `src/core/rank.ts`:

```
right.score - left.score ||
(right.candidate.vector_boost ?? 0) - (left.candidate.vector_boost ?? 0) ||
left.candidate.id.localeCompare(right.candidate.id)
```

`vector_boost` is already carried on every `RankInput` and already flows through
`compileContext`, so there is nothing to plumb. Nothing else in the file changes.

This is the smallest change that removes the defect at its root: the tie is
manufactured inside `scoreCandidate` by two independent normalizations, and every
caller reaches ranking through `rankCandidates`, so one comparator covers all of
them.

Alternatives measured and rejected, with the numbers in
`docs/plans/done/2026-08-04-comparable-retrieval-score.md`:

- squashing bm25 so the lexical arm cannot reach 1 — same four vector-lane
  numbers, but it changes every returned score and needs a constant the harness
  cannot distinguish;
- passing raw cosine — drops vector recall@3 from 1 to 0.8571;
- adding a recency term to the comparator — 0.5714 flat recall@1 on both lanes.

## Tasks

- [x] Measure `HEAD` on both lanes at 10 repeats.
- [x] Locate the source of `HEAD`'s across-repeat variance per case.
- [x] Measure the comparator alone on top of `HEAD` on both lanes at 10 repeats.
- [x] Prove the new unit case fails with `src/core/rank.ts` restored from `HEAD`.
- [x] Tighten the existing hybrid-position contract case, whose comment said an
      outright win could not be asserted.
- [x] Update `docs/reference/api.md` in the same change as the behaviour.

## Acceptance evidence

**AC-TIE-001** — the comparator above. `tests/contract/vectors.test.ts`, "a score
tie between the lexical best and the semantic best breaks on cosine": a candidate
with `bm25 = -9.082` and no vector hit against one with cosine `0.7207` and no
lexical hit. Both normalize to relevance 1, the scores are asserted equal, and
the semantic candidate must come first even though its id sorts last. Restoring
`src/core/rank.ts` from `HEAD` fails it on that assertion.

**AC-TIE-002** — the term is a subtraction of two `vector_boost` values. The same
test asserts the larger of two cosines (0.7207 against 0.7026) wins a tied score,
which is a comparison inside one scale.

**AC-TIE-003** — `vector_boost` is `undefined` for every candidate without a
vector hit, so the term is `0 - 0` and the comparator falls through to `claim_id`
exactly as before. Asserted in the same test with two lexical-only candidates,
and measured: the FTS-only lane is bit-identical to `HEAD` in isolation.

**AC-TIE-004** — asserted with two candidates equal on score and on the absent
cosine; the order is `["aaa", "zzz"]`.

**AC-TIE-005** — `scoreCandidate` is untouched. `tests/contract/vectors.test.ts`
keeps "narrow-band vector similarity is normalized before ranking" unchanged from
`HEAD`, including `normalizeVectorSimilarity` returning 0 and 1 for cosines 0.991
and 0.993.

Additionally, `tests/contract/vectors.test.ts` line "Position must improve" was
tightened. Its comment previously read "ties break on id — so the guarantee under
test is movement, not an outright win"; that is now false, and the case asserts
the boosted claim reaches rank 1. Against `HEAD` that assertion fails on roughly
half of runs, which is the defect made visible in the suite.

## Verification

- `pnpm test:api` — Bun/SQLite contract, Cloudflare D1 contract, SDK.
- `pnpm test:integration`.
- `pnpm check:workflow`.
- `pnpm benchmark:retrieval --self-test`, then both lanes at 10 repeats.

## Measurement

Harness `titen-retrieval-h2h-v1`, fixture `titen-057-h2h-v2`, 38 documents, 7
discriminating queries, 10 repeats, fresh database, server and subject namespace
per repeat, `tuf/embeddinggemma` 768d on the vector lane. Median [min, max].
The comparator is measured **alone on top of `HEAD`**, with
`src/core/retrieval.ts` at `HEAD`.

FTS-only lane — no candidate carries a cosine, so this must not move, and it
does not:

| metric | HEAD | this change alone |
| --- | --- | --- |
| recall@1 | 0.5714 [0.5714, 0.7143] | 0.5714 [0.5714, 0.7143] |
| recall@3 | 0.8571 [0.8571, 0.8571] | 0.8571 [0.8571, 0.8571] |
| MRR@10 | 0.7381 [0.7347, 0.8095] | 0.7381 [0.7347, 0.8095] |
| nDCG@3 | 0.7517 [0.7517, 0.8044] | 0.7517 [0.7517, 0.8044] |

Vector lane:

| metric | HEAD | this change alone |
| --- | --- | --- |
| recall@1 | 0.7143 [0.5714, 0.8571] | 0.8571 [0.8571, 0.8571] |
| recall@3 | 1 [1, 1] | 1 [1, 1] |
| MRR@10 | 0.8333 [0.7619, 0.9048] | 0.9048 [0.9048, 0.9048] |
| nDCG@3 | 0.8758 [0.8231, 0.9286] | 0.9286 [0.9286, 0.9286] |

The claim is **a higher median with variance eliminated, not a higher ceiling**.
`HEAD`'s maximum is unchanged on every metric; the new value equals it. The
ranges therefore touch at that maximum and the harness's own rule refuses to name
a winner, which is the correct verdict for a ceiling claim and the wrong frame
for what actually happened: `HEAD` reached that ceiling when a uuid comparison
fell its way, and reaching it on every run is a real improvement in expected
quality.

Attribution is exact rather than inferred. Per case across 10 repeats, `HEAD`'s
vector lane gets `id_temporal_endpoint` right 4 times and `jv_in_id_preference`
right 7 times; every other case is constant. Those two are the only queries whose
top two candidates tie at `0.816667`. After the change both are right on every
repeat and every case in the lane is deterministic.

## Combined with the query-plan change

Both changes together, 10 repeats per lane, which is the tree that ships:

| lane | metric | HEAD | shipped |
| --- | --- | --- | --- |
| FTS | recall@1 | 0.5714 [0.5714, 0.7143] | 0.7143 [0.7143, 0.7143] |
| FTS | recall@3 | 0.8571 [0.8571, 0.8571] | 0.8571 [0.8571, 0.8571] |
| FTS | MRR@10 | 0.7381 [0.7347, 0.8095] | 0.8061 [0.8061, 0.8095] |
| FTS | nDCG@3 | 0.7517 [0.7517, 0.8044] | 0.8044 [0.8044, 0.8044] |
| vector | recall@1 | 0.7143 [0.5714, 0.8571] | 0.8571 [0.8571, 0.8571] |
| vector | recall@3 | 1 [1, 1] | 1 [1, 1] |
| vector | MRR@10 | 0.8333 [0.7619, 0.9048] | 0.9048 [0.9048, 0.9048] |
| vector | nDCG@3 | 0.8758 [0.8231, 0.9286] | 0.9286 [0.9286, 0.9286] |

No combined number exceeds what its component reaches alone, so nothing here is
an interaction effect. The vector lane is fully deterministic. The FTS-only lane
retains one residual flip worth 0.0034 MRR@10: on `id_semantic_rollback` the gold
claim sits at rank 6 or 7 depending on a uuid comparison between two distractors
that tie on score, and it is out of the top 3 either way. Two independent
10-repeat runs of this tree returned FTS MRR@10 medians of 0.8061 and 0.8078 with
the identical range [0.8061, 0.8095]; that 0.0017 is the flip, not a result, and
it is the reason the range is reported next to every median here.
