---
work_id: bounded-and-discriminating-retrieval
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
---

# A bounded, polarity-aware, configurable retrieval surface

## Outcome

Completed. `POST /v1/context/compile` accepts a hard `top_k` result bound and
reports what that bound discarded, the lexical query plan carries temporal
polarity into FTS instead of discarding it, and an operator can deliberately run
raw embedding input on a model whose id claims a prompt convention without being
able to do so by accident. Closes issues 229, 228 and 250.

Revised 2026-08-04 after review. Two acceptance criteria changed and two were
added. The first shipped expansion put every surface form of a boundary in one
group regardless of language, which deterministically injected an unrelated
English claim at rank 2 of an Indonesian query through nothing but a shared
function word. Groups are now per language. The stoplist exemption for `dari`
and `from` was removed with it: it earned nothing measurable and would have
expanded every ordinary Indonesian `dari` into four extra OR branches.

## Problem

Three defects filed on 2026-08-04, all on the retrieval surface, none sharing a
root cause.

### 229 — no result-count bound

`compile` had `max_tokens` and `max_candidates`. Neither bounds how many items
come back: `max_tokens` bounds bytes, `max_candidates` bounds what retrieval
considers before ranking. A caller comparing Titen against another system had to
request a large pack, pay for every item's tokens, and truncate client-side —
which also makes the reported `used_tokens` describe a pack the caller never
used.

### 228 — temporal polarity never reached the ranker

"Mulai Juli 2026, endpoint aktif adalah api-v3.internal" and "Sebelum Juli 2026,
endpoint aktif adalah api-v2.internal" scored identically for the query "Endpoint
mana yang aktif sejak Juli 2026?" — measured on the pinned release fixture at
`bm25 = -9.0816` for both, to the last digit.

The investigation the issue asked for produced a two-part answer, and the
distinction matters because only one part was the suspected one.

1. `STOPWORDS` in `src/core/retrieval.ts` was asymmetric across the polarity it
   was deciding. The start-of-window markers that are also ordinary function
   words — `from`, `dari` — were in the set and were deleted before FTS5 saw
   them. Their end-of-window opposites — `before`, `sebelum`, and also `after`,
   `setelah`, `since`, `sejak`, `until`, `mulai` — were not. Whether polarity
   reached the index therefore depended on which half of the pair the caller
   happened to say. Measured: "Which endpoint is active from July 2026?" tied the
   two claims at `-6.515`, while "…before July 2026?" also tied at `-6.515`
   because `before` matched only the claim wording it repeats.
2. A marker that did survive was matched as a literal token. The fixture query
   says `sejak`; the correct claim says `Mulai`. Both name the same boundary and
   neither reaches the other, which is why the fixture case tied exactly.

Nothing here is a missing ranking signal. `valid_from`/`valid_to` already decide
eligibility, and a seventh weighted term could not have helped a query whose only
discriminating token was already deleted or orphaned.

### 250 — no way to opt out of the forced embedding profile

`embeddingProfileMatchesModel()` accepts only `embeddinggemma-retrieval-v1` for
any model id containing `embeddinggemma`, and rejects `raw-unit-v1` as
`configured_error`. The intent is correct and must be preserved: mixing prefixed
and unprefixed vectors in one index corrupts retrieval silently. But there was no
deliberate way past it, so a model whose id says `embeddinggemma` yet was served
without the prompts could not be configured at all, and a head-to-head against a
system that embeds raw text could not be run fairly — the release harness even
recorded the impossibility in a comment.

## Acceptance criteria

- **AC-TOPK-001 — Optional feature:** Where a compile request supplies `top_k`,
  Titen shall validate it as an integer from 1 through 1,000 and shall return at
  most that many items.
- **AC-TOPK-002 — Ubiquitous:** A compile request that omits `top_k` shall
  behave exactly as before, bounded only by `max_tokens`.
- **AC-TOPK-003 — Event-driven:** When `top_k` bounds a pack, the token budget
  shall be spent on the bounded set only, so `used_tokens` describes what the
  caller received.
- **AC-TOPK-004 — Unwanted behavior:** If `top_k` is not an integer within its
  bounds, then Titen shall reject the request with `VALIDATION_ERROR` and shall
  compile nothing.
- **AC-TOPK-005 — Event-driven:** When `top_k` discards ranked candidates,
  `budget.omitted_items` shall count them, so that a caller can distinguish a
  truncated pack from a complete one.
- **AC-POL-001 — Ubiquitous:** The function-word stoplist shall be unchanged by
  this work; a polarity marker that is also a function word (`dari`, `from`)
  shall stay removed and shall not be expanded.
- **AC-POL-002 — Event-driven:** When a task names one boundary of a temporal
  window, the lexical plan shall also match the other surface forms of that same
  boundary in the same language.
- **AC-POL-005 — Unwanted behavior:** If a task contains a temporal polarity
  marker, then the expansion shall introduce no term of another language.
- **AC-POL-003 — Ubiquitous:** `query_terms_used` and `dropped_query_terms`
  shall continue to count only the terms the caller supplied.
- **AC-POL-004 — Unwanted behavior:** If two claims differ only in their
  temporal polarity marker, then a query naming one boundary shall rank the
  claim naming that same boundary above the other.
- **AC-PROF-001 — Ubiquitous:** A configured `raw-unit-v1` profile on an
  EmbeddingGemma model shall remain a fail-closed configuration error.
- **AC-PROF-002 — Optional feature:** Where an operator configures
  `raw-unit-v1-model-mismatch-acknowledged`, Titen shall send raw embedding
  input on any model.
- **AC-PROF-003 — State-driven:** While the persisted index fingerprint records
  a different profile from the configured one, readiness shall answer
  `index_fingerprint_mismatch` and shall not serve vector retrieval.
- **AC-PROF-004 — Unwanted behavior:** If a profile value is a near-miss of the
  opt-out — a truncation, a different version, or a different case — then Titen
  shall reject it rather than infer the opt-out.

## Out of scope

- A temporal ranking term or any use of `valid_from`/`valid_to` in scoring.
  Filtering already covers eligibility and the issue asked for the smallest true
  cause.
- Synonym expansion for anything other than temporal polarity. The class is
  closed and small; a general thesaurus is a different, unmeasured change.
- Cross-language expansion of any kind. Reaching an English claim from an
  Indonesian query is the vector lane's job, not the lexical planner's.
- Applying EmbeddingGemma prompts to a non-EmbeddingGemma model. Nothing asked
  for it and it has the same corruption risk in the other direction.
