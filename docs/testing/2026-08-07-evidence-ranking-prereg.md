# Pre-registration — evidence-aware ranking

Written **before the first scored run**, 2026-08-07, on host `rama-tuf`, in the
shape of `~/titen-bench-20260804/harness/PREREGISTRATION.md` (2026-08-04), which
governs the corpus, the scorer, and the failure rules this run inherits.

Committed to the repository in its own commit, before the commit that adds any
result, so that the git history — not our word — is what proves the protocol was
fixed in advance.

## What is being tested

`src/core/rank.ts` currently scores candidates on BM25, optional vector cosine,
recency, trust, feedback utility, conflict, and confidence. Everything in that
list except trust and conflict is information a hundred-line cosine script also
has, which is consistent with the 2026-08-06 finding that Titen is
indistinguishable from Mem0 `infer=False` (3/4/53, p = 1.0).

The hypothesis under test: **ranking on evidence structure that only Titen
stores moves recall@1 on an externally authored corpus.**

## Signal inventory, fixed before the run

Five candidate signals were named. Each was resolved against the shipped code
before any measurement, and the resolution is recorded here so that a signal
cannot be quietly added or dropped after seeing a number.

| Signal | Status at 0.7.0 | In this run |
| --- | --- | --- |
| trust (`verified` / `asserted` / …) | already a ranked component, weight 0.20 | not new; unchanged |
| conflict (`disputed`) | already a ranked component, weight 0.05 | not new; unchanged |
| feedback outcomes | already a ranked component (utility), weight 0.10 | not new; unchanged |
| provenance `recalled` | unreachable: `src/core/claims.ts` rejects a recalled observation as claim evidence at consolidation, and only claims are ranked | **not built** |
| evidence depth | not ranked; derivable from `claim_sources` with no schema change | **the change under test** |

Only the last row is new work. Any post-hoc addition to this table invalidates
the run.

## Change under test

Evidence depth — the count of supporting observations behind a claim that the
requesting principal is authorized to read — becomes a **tie-break key** in
`rankCandidates`, placed after the weighted score and after vector similarity,
ahead of the existing content-hash-then-id fallback.

It is deliberately **not** a weighted score term. There is no corpus on this
machine in which evidence depth varies and gold labels exist, so a weight could
only be fitted on the data it is then evaluated on. A tie-break needs no weight,
so nothing is fitted.

## Primary metric

**recall@1**, computed by `~/titen-bench-20260804/harness/common.py::score`,
unmodified. **MRR@10** secondary. recall@5 and recall@10 are reported and
marked saturated, per the standing rule in `docs/testing/EVALS.md`.

## Sample

All **500** LongMemEval-S instances. No subsample: this lane makes no LLM call,
so the 60-instance stratified subsample (`seed = 20260804`) is not needed and is
not used. Shrinking the sample after seeing a result is disallowed.

## Design

Paired A/B over one frozen store, with the passes run in an order that makes
the baseline impossible to tune after the fact:

1. **Copy** `~/titen-bench-20260804/lanes/titen/fts-500.db` — the exact store
   that produced the published `titen-fts-500.ranked.json` — into a working
   directory. The original is opened by nothing in this run; ingest is not
   repeated, so ingest variance is removed rather than controlled for.
2. **Pass A** runs *before the change is written*, from the branch at its base
   commit, which is byte-identical to `main` at 0.7.0.
3. The change is implemented.
4. **Pass B** runs against the same store file.

Same store, same corpus, same query text, same 500 instances. The only
difference between the passes is the ranker. Paired two-sided sign test on
recall@1 between A and B using `common.py::sign_test`.

Pass A is the paired baseline. The on-disk 0.6.0 `titen-fts-500.ranked.json` is
reported next to it as a **cross-build reference only** — it came from a
different build, and treating it as the baseline would attribute unrelated
0.6.0→0.7.0 differences to this change. A discrepancy between pass A and that
file is itself reported, not smoothed over.

The store is opened read-mostly: `POST /v1/context/compile` writes a
`context_runs` row, which no ranking input reads. No feedback is submitted in
either pass, so the utility component is identical across them by construction.

### Lane scope, and the conditional rule for the vector arm

Primary lane is **FTS-only**, which is the lane `PONYTAIL-DEBT.md` calls the
operational story rather than the fallback, and the one that needs no provider.

The router/vector arm runs **only if pass B differs from pass A on at least one
instance.** Stated here, in advance, with its reason: if the evidence signal is
degenerate across the corpus the two passes are byte-identical, and a vector arm
that costs ~13,700 s of index drain cannot turn an identity into a difference.
If B and A differ anywhere, the vector arm is run and reported.

## Signal-degeneracy check, run before scoring

Before the A/B is scored, the ingested store is queried directly for the
distribution of every signal in the inventory: distinct `trust` values, count of
`disputed` claims, count of claims whose evidence includes a `recalled`
observation, the `feedback_total` distribution, and the histogram of supporting
observations per claim.

This is measured, not assumed. If any signal turns out to vary on this corpus,
that is reported as a finding and the A/B result is interpreted against it.

## Failure handling

Inherited unchanged from the 2026-08-04 pre-registration: a crash, an empty
response, or a timeout scores as **incorrect** and stays in the denominator.
Failure count and rate are published per pass. No instance is ever dropped to
improve a number.

## Statistics

Two-sided paired sign test, wins/losses/ties reported with every p-value. Point
estimates alone are not a result. Both systems are deterministic, so
across-repeat ranges are not evidence and are not reported as such.

## Secondary metric, pre-registered here so it is not a post-hoc addition

**Tokens-to-answer**: for each instance, the token count of the smallest pack of
whole ranked sessions that contains a gold session — i.e. the summed tokens of
the sessions at ranks 1..r, where r is the rank of the first gold session.

- Tokenizer: `onnx-community/embeddinggemma-300m-ONNX` `tokenizer.json`, already
  on disk at `~/titen-bench-20260804/tokenizers/`. One tokenizer for every lane,
  for the same reason there is one scorer.
- Instances whose ranked list contains **no** gold session have no finite value.
  They are reported as an explicit separate count, never dropped and never
  imputed. The median is reported over instances with a finite value, with that
  count stated next to it; no mean is published, because a mean over a truncated
  set is the exact shape of the flaw this project has retracted twice.
- It is an **addition**. recall@1 and MRR@10 remain primary.

## What would make us not ship the evidence ranker

Fixed in advance so it cannot be rationalised afterwards. Any one of these is
sufficient.

1. **It loses.** If pass B is below pass A on recall@1 by any margin, the change
   is reverted. A tie-break that ranks worse than an arbitrary one is strictly
   worse than doing nothing, because it also costs a query.
2. **It moves rankings where the signal is constant.** If the degeneracy check
   shows evidence depth takes one value across the corpus and pass B still
   differs from pass A anywhere, that is a correctness or determinism defect
   (#226 is a shipped contract), and it blocks the merge rather than being
   reported as a result.
3. **It costs measurably more than it returns.** If enabling the signal
   increases compile latency and the recall@1 gain is not significant at
   p ≤ 0.05, we do not ship it.

## What a null result means, stated in advance

If pass B equals pass A because the corpus carries no evidence variation, the
honest report is:

- LongMemEval-S **cannot falsify this ranker in either direction**;
- **0 of the 10.2-point oracle ceiling is captured**, and that number is
  published as zero rather than omitted;
- no retrieval claim is made for evidence-aware ranking, in this repository or
  anywhere else;
- the change ships only if its unit-level contract is proven and criterion 2
  above passes, and the write-up says plainly that its benefit on a real store
  is **unmeasured**, not demonstrated.

A null is a valid deliverable here. It is also the outcome we expect, for the
structural reason recorded in the signal inventory above, and saying so before
the run is the point of writing this down.

## What this measurement cannot establish

- Nothing about stores where trust, conflict, provenance, or corroboration
  actually vary. LongMemEval-S is a single-actor, single-trust, no-feedback,
  no-conflict corpus by construction.
- Nothing about answer accuracy. That was a flat null across eight
  pre-registered comparisons on 2026-08-06 and is not re-run here.
- Nothing about Cloudflare D1 retrieval quality. The dual-runtime contract suite
  proves equivalence of the ranking code, not of a benchmark score.
