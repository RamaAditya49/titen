---
work_id: bounded-and-discriminating-retrieval
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
spec: docs/specs/done/2026-08-04-bounded-and-discriminating-retrieval.md
---

# Plan: a bounded, polarity-aware, configurable retrieval surface

## Approach

Three independent edits, each in the one file every caller routes through. No
new dependency, no new abstraction, no new weight, no new limit constant.

### 229 — `top_k`

Two additions to `src/core/context.ts`. Validation reuses `requireInteger` with
`LIMITS.maxCandidates` as the ceiling, matching `max_candidates`, so no new entry
in `src/core/validate.ts` was needed. The bound itself is
`rankCandidates(...).slice(0, topK)`: `slice(0, undefined)` is the entire
unchanged-default path, so there is no branch.

Placing the slice between ranking and packing is the load-bearing choice.
Downstream of it, evidence hydration, the token budget, the run rows, and every
`budget.*` count all describe the same bounded set. Slicing after packing would
have let the caller pay tokens for items that were then thrown away, and would
have made `used_tokens` describe a pack nobody received.

Surfaces: `CompileOptions` in `src/sdk.ts` (the client passes the body through,
so the type is the whole change), `titen_compile` and `ARG_DESCRIPTIONS` in
`src/core/mcp.ts`, `compile_context` in `clients/python/titen.py`.

### 228 — temporal polarity

Both halves of the defect are in `planFtsQuery`, so both fixes are there.

1. `TEMPORAL_POLARITY`, four closed groups: start-of-window and end-of-window,
   once per language. Grouping across languages was shipped first and is the
   defect this revision removes — see "Revision" below.
2. The stopword filter is untouched. `dari` and `from` stay in `STOPWORDS`, so
   they are neither kept nor expanded.
3. The match string maps each selected term through its group. The MATCH was
   already a disjunction, so a synonym is one more `OR` branch and needs no other
   machinery. `termsUsed`/`termsDropped` deliberately keep counting the caller's
   own terms: the expansion is an internal recall device and reporting it would
   make `query_terms_used` disagree with the task text.

`enrichment.ts` calls `planFtsQuery` too and inherits the fix; that is why the
edit is there and not in `compileContext`.

Group membership was measured, not assumed. `starting` was in the first draft
and was removed: Porter stems it to `start`, which then matches every claim
containing "starts", and it pulled `dis_deploy_freeze` ("The deployment freeze
starts every Friday") into the temporal case at rank 4 for no benefit. `till` was
removed as a rare marker whose stem collides with a common noun. `from` and
`dari` were kept in the first draft on the argument that BM25's IDF already
discounts a term appearing everywhere; the revision removed them, because no
fixture query uses either, so the argument was never tested and every ordinary
Indonesian `dari` would have paid four extra OR branches for it.

Bounded by construction: the four groups hold 12 terms total and the expansion is
deduplicated, so a 16-term query can grow by at most 12 branches, and never
beyond the language of the marker the caller typed.

### 250 — the deliberate profile opt-out

The smallest opt-out that cannot happen by accident is a third value of the
profile enum that already exists, `raw-unit-v1-model-mismatch-acknowledged`.
Three lines in `src/core/vectors.ts`:

- add it to `EMBEDDING_PROFILES`;
- `embeddingInput` inverts its test to `profile !== "embeddinggemma-retrieval-v1"`,
  so both raw profiles send raw text;
- `embeddingProfileMatchesModel` returns `true` for it before the model check.

Both runtimes need **zero** changes. `tryCreateVectors` and `tryCreateVectorize`
already pass `TITEN_EMBED_PROFILE` through as an `EmbeddingProfile` and already
validate it against `EMBEDDING_PROFILES` via `embeddingPolicyFingerprint` and
`parseEmbeddingPolicy`. A misspelling still fails closed.

The fingerprint requirement in the issue was confirmed already satisfied rather
than rebuilt: `embeddingPolicyFingerprint` writes the profile name followed by
`;min_cosine=` and the floor
into `semantic_index_metadata.preprocessing`, and `sameFingerprint` compares that
column exactly, so any profile switch already yields `index_fingerprint_mismatch`.
Choosing a distinct profile value rather than a side-channel flag is what keeps
that true for the opt-out with no new code. The contract test asserts it instead
of trusting the reading.

`scripts/benchmark-retrieval-h2h.ts` reads `TITEN_EVAL_EMBED_PROFILE` to override
its derived profile, which is what makes the fair head-to-head the issue names
actually runnable. Default behaviour is unchanged, and the core still validates
whatever is passed.

## Acceptance evidence

**AC-TOPK-001** — `requireInteger(body, "top_k", 1, LIMITS.maxCandidates)` in
`compileContext`, then `.slice(0, topK)` on the ranked list. Asserted by the
`top_k` contract case on both runtimes.

**AC-TOPK-002** — `topK` is `undefined` when the field is absent and
`slice(0, undefined)` copies the whole list. The same case asserts three items
back from a three-claim corpus with no `top_k`.

**AC-TOPK-003** — the slice precedes `packUnderBudget`, so the case asserts
`used_tokens` strictly falls for the bounded request.

**AC-TOPK-004** — the case sends `0`, `1001`, `1.5`, `"2"`, and `null` and
requires `400 VALIDATION_ERROR` for each.

**AC-TOPK-005** — `omittedByTopK` is `allRanked.length - ranked.length` and is
added into `budget.omitted_items`. The `top_k` case asserts `omitted_items` is
`1` for a `top_k: 2` request over three claims while `budget_exhausted` stays
`false`, which is the pair a caller reads to tell a count-bounded pack from a
budget-bounded one.

**AC-POL-001** — `planFtsQuery` filters on `!STOPWORDS.has(term)`, byte-identical
to `HEAD`, and `TEMPORAL_POLARITY` contains no member of `STOPWORDS`.

**AC-POL-002** — the match string maps each selected term through
`TEMPORAL_MARKERS`, deduplicated, within its own language group.

**AC-POL-005** — every group in `TEMPORAL_POLARITY` is single-language, and the
polarity contract case seeds an English claim ("The import job retries for 21
days before alerting.") that shares nothing with either Indonesian query except
the English member of the `sebelum`/`hingga` boundary, then asserts it is never
returned. It fails against the first shipped grouping.

**AC-POL-003** — `termsUsed`/`termsDropped` are computed from `selected` and
`terms`, never from the expansion. `tests/integration/retrieval-correctness.test.ts`
continues to assert `termsUsed <= 16` on a long query.

**AC-POL-004** — the polarity contract case on both runtimes: two claims of
identical token length differing in one marker, two queries using neither marker
verbatim, opposite correct answers, each with a strictly higher score.

**AC-PROF-001** — `embeddingProfileMatchesModel("raw-unit-v1", model)` still
returns `false` for an EmbeddingGemma id; asserted in
`tests/integration/embedding-validation.test.ts` and, end to end through
`/readyz`, in the `semantic-readiness` contract on both runtimes.

**AC-PROF-002** — `embeddingInput` returns the content unchanged for every
profile except `embeddinggemma-retrieval-v1`, asserted for both roles.

**AC-PROF-003** — the `semantic-readiness` contract switches only
`preprocessing` against a stored fingerprint and requires
`index_fingerprint_mismatch` with `503`.

**AC-PROF-004** — `parseEmbeddingPolicy` is asserted to reject
`raw-unit-v1-model-mismatch`, `raw-unit-v2-model-mismatch-acknowledged`, and the
uppercase spelling.

## Verification

Every case is the smallest one that fails without its change, and each was proven
load-bearing by restoring the pre-change file from `HEAD` through a scratch copy
and re-running.

- `tests/contract/cases.ts` — "top_k hard-caps the returned pack and leaves the
  default unbounded". Dual runtime. Reverting `src/core/context.ts` fails it at
  the item count.
- `tests/contract/cases.ts` — "temporal polarity separates two claims that differ
  only in its marker". Dual runtime. Two claims of identical token length
  differing in one marker, two queries using neither marker verbatim, opposite
  correct answers. Reverting `src/core/retrieval.ts` fails it: both queries
  return the newer claim, because the two tie exactly on BM25.
- `tests/contract/semantic-readiness.ts` — the `#250` block, run against both
  bun:sqlite and D1. Proves the EmbeddingGemma guard still refuses `raw-unit-v1`,
  that the opt-out clears the model check, and that with every other fingerprint
  field byte-identical the profile alone still forces
  `index_fingerprint_mismatch`.
- `tests/integration/embedding-validation.test.ts` — near-miss spellings of the
  opt-out are rejected, and it round-trips as a distinct profile.

## Measurement

`pnpm benchmark:retrieval`, harness `titen-retrieval-h2h-v1`, fixture
`titen-057-h2h-v2` (content sha256 `d7e2785…92a5`), 38 documents, 7
discriminating queries, **10 repeats**, fresh database, server and subject
namespace per repeat, `tuf/embeddinggemma` 768d on the vector lane. Median
[min, max] across repeats. The query-plan change is measured **alone on top of
`HEAD`**, with `src/core/rank.ts` at `HEAD`.

FTS-only lane:

| metric | HEAD | this change alone |
| --- | --- | --- |
| recall@1 | 0.5714 [0.5714, 0.7143] | 0.7143 [0.7143, 0.7143] |
| recall@3 | 0.8571 [0.8571, 0.8571] | 0.8571 [0.8571, 0.8571] |
| MRR@10 | 0.7381 [0.7347, 0.8095] | 0.8095 [0.8061, 0.8095] |
| nDCG@3 | 0.7517 [0.7517, 0.8044] | 0.8044 [0.8044, 0.8044] |

Vector lane:

| metric | HEAD | this change alone |
| --- | --- | --- |
| recall@1 | 0.7143 [0.5714, 0.8571] | 0.7143 [0.7143, 0.8571] |
| recall@3 | 1 [1, 1] | 1 [1, 1] |
| MRR@10 | 0.8333 [0.7619, 0.9048] | 0.8333 [0.8333, 0.9048] |
| nDCG@3 | 0.8758 [0.8231, 0.9286] | 0.8758 [0.8758, 0.9286] |

The honest claim is **a higher median with variance eliminated, not a higher
ceiling**. `HEAD`'s maximum is unchanged on every metric on both lanes, and the
ranges therefore overlap at that maximum; the harness would refuse to name a
winner and so do we. What moved is the floor: `HEAD` reaches its best only when
a coin flip falls its way.

The coin flip is literal and fully accounts for `HEAD`'s across-repeat variance.
On `id_temporal_endpoint` the gold claim and its distractor tie at bm25
`-9.0816` to the last digit, score `0.816667` to the last digit, and
`rankCandidates` resolved that with `id.localeCompare` over per-ingest uuids:
gold won 4 of 10 repeats. Expanding `sejak` to `mulai` gives the gold claim one
more matching term, so the tie no longer exists and the case is right on every
repeat.

The vector-lane median does not move because that lane has a second coin flip,
`jv_in_id_preference`, that the query plan cannot reach. That one is addressed
separately in `2026-08-04-tied-rank-decided-by-evidence`, and the two changes
were measured apart before they were measured together.

A start-of-window-only variant was measured to check whether the end-of-window
group earns its place: FTS-only MRR@10 0.8061 [0.8061, 0.8095] against 0.8095
[0.8061, 0.8095] with it. The ranges are identical, so the group is kept for
symmetry and for the documented `hingga` behaviour, not on a measured gain.

The `#250` opt-out was smoke-tested through the real Bun runtime rather than
only through the contract stub: `TITEN_EVAL_EMBED_PROFILE=raw-unit-v1-model-mismatch-acknowledged`
with `tuf/embeddinggemma`, five repeats, 38/38 documents indexed and zero errors
on every repeat, so configuration, readiness, embedding, indexing and query all
accept it end to end. It scores recall@1 0.7143, MRR@10 0.8571, nDCG@3 0.8946 —
measurably worse than the prompted profile's 0.8571/0.9048/0.9286 on the same
corpus, which is exactly why the guard is the default and this is an opt-out.
This is a local Bun process on `127.0.0.1`; it is not a Cloudflare or deployed
VPS support claim.

## Revision, 2026-08-04

Review found a deterministic regression in the first shipped grouping and it is
reproduced here rather than paraphrased. With one group per boundary spanning
both languages, the Indonesian query `id_semantic_rollback` returned
`dis_atlas_import_retry` — "The Atlas import job retries for 21 days before
alerting." — at **rank 2**, on every repeat, reached only by `sebelum` expanding
to `before`. `HEAD` returned `dis_bluegreen_doc` there. Splitting the groups by
language removes it and costs nothing: the FTS-only table above is measured with
the split in place.

Removed in the same revision: the `|| TEMPORAL_MARKERS.has(term)` stoplist
exemption. No fixture query uses `dari` or `from`, so it earned nothing
measurable, while every ordinary Indonesian `dari` would have expanded into four
extra OR branches. Deleting it also makes the stoplist byte-identical to `HEAD`.
