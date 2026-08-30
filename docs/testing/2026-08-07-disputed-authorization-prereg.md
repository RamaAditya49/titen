# Pre-registration — authorization on the `disputed` flag (#291)

Written **before the first scored run**, 2026-08-07, on host `benchmark-host`. It
inherits the corpus, the scorer, and the failure rules from
`~/titen-bench-20260804/harness/PREREGISTRATION.md` (2026-08-04) and from
[`EVALS.md`](./EVALS.md).

Committed in its own commit, ahead of the commit that carries any result, so the
git history rather than our word is what shows the protocol was fixed in
advance.

## What changed, and why it needs measuring at all

[#291](https://github.com/RamaAditya49/titen/issues/291): `disputed` was computed
from a bare `EXISTS` over `claim_sources` with no join to `observations` and no
`recordAccessSql`, so a contradicting source the caller could not read still set
the flag. `disputed` carries a weighted rank term of 0.05 and populates
`conflicts[]`, so the leak was also a rank effect. The fix routes all four query
sites through `contradictedSql`, which joins `observations` and applies the
caller's own access predicate.

The security argument is settled by a contract case, not by a benchmark. What a
benchmark can settle is the thing a contract case cannot: whether adding a join
and a correlated subquery to the hot candidate query **cost** anything — in
answer quality or in latency — on a real corpus.

## Corpus fact established before the design, not after

Read out of the frozen store before this document was written, and the reason
the design below looks the way it does:

| Property of `bench/lane/fts-500.db` | Value |
| --- | ---: |
| claims | 424,168 |
| observations | 25,112 |
| `claim_sources` rows | 424,168 |
| rows with `relation = 'contradicts'` | **0** |
| claims with `status = 'disputed'` | **0** |
| distinct `actor_id` over observations | **1** |
| rows in `retention_exclusions` | **0** |

**This corpus cannot exercise the fix.** With zero contradicting sources, both
the old query and the new one return `disputed = 0` for every claim, and with a
single principal there is no cross-scope boundary to cross. The predicted result
is therefore not "probably no change" but **exactly no change**, and that is a
falsifiable prediction rather than a hedge.

That is stated here, in advance, so that a null cannot later be presented as
evidence *for* anything. Per `EVALS.md`, no synthetic corpus will be built to
manufacture a number: a synthetic figure may not be quoted as a product claim,
and the honest instrument for the behaviour change is the contract case that
fails without the fix.

## Primary metric

**recall@1**, computed by `~/titen-bench-20260804/harness/common.py::score`,
unmodified. **MRR@10** secondary. recall@5 and recall@10 reported and marked
saturated, per the standing rule.

Secondary, and the arm with real information in it: **compile latency**, p50 and
p95, from `latency.py`.

## Sample

All **500** LongMemEval-S instances (MIT). No subsample. This lane makes no LLM
and no embedding call, so nothing forces a smaller sample and shrinking it after
seeing a result is disallowed.

## Seed

None, and none is needed: the lane is FTS-only, there is no sampling step, and
retrieval is deterministic given a fixed store. Two passes of the same build
over the same store must produce byte-identical ranked output; the 2026-08-07
evidence-ranking run already demonstrated that (passes A and B share a SHA256).

## Failure handling

A request that errors, times out, or returns an empty pack scores **incorrect**
and stays in the denominator. `query_pass.py` records every instance including
empty ones, and aborts the run if every instance comes back empty, which is what
an authentication or routing mistake looks like. n stays 500 in every reported
figure.

## Design

Paired A/B over one frozen store, each arm a separate server process:

1. **Copy** of `~/titen-bench-20260804/lanes/titen/fts-500.db`, already present
   at `~/titen-evidence-rank/bench/lane/fts-500.db` and reused. Ingest is not
   repeated, so ingest variance is removed rather than controlled for.
2. **Arm BASE** — `main` at `d5a06d9`, the parent commit of the fix, served from
   a separate worktree at `~/titen-evidence-rank/base`.
3. **Arm FIX** — `fix/291-disputed-authorization` at `bff0d44`.

The two arms differ in exactly one commit, and that commit touches only the four
`disputed` queries, `contradictedSql`, and one contract case. Note that neither
arm carries the #288 tie-break: the baseline for this measurement is `main`, not
PR #288, so the two changes are not confounded.

Quality arm: one `query_pass.py` run per build, compared with
`common.py::sign_test` (paired, two-sided) on per-instance recall@1.

Latency arm: `latency.py` alternating **BASE, FIX, BASE, FIX** to keep a warming
page cache or a drifting machine from loading onto one arm, at two operating
points:

- `top_k=5, max_candidates=200` — the shape #288 already measured, so the two
  runs are comparable;
- `top_k=5, max_candidates=1000` — the worst case for this change specifically,
  because the added join and subquery are evaluated **per candidate**.

## Kill criteria, fixed in advance

The fix is a security fix and ships regardless of the numbers; these criteria
decide whether it ships **quietly** or with an open issue attached.

1. **Any** per-instance difference in ranked output between BASE and FIX is a
   defect, not noise. On a corpus with zero contradicting sources the arms must
   agree on 500 of 500. One disagreement means the new predicate changed a
   result it had no business touching, and blocks the PR pending diagnosis.
2. A recall@1 loss significant at **p < 0.05** on the paired two-sided sign test
   blocks the PR. Given criterion 1 this cannot fire without criterion 1 firing
   first; it is stated so the threshold is on record rather than chosen later.
3. A p50 latency regression above **10%** at either operating point, reproducing
   across both alternating repeats of the arm, does not block the fix but must
   be published and filed as its own issue. The candidate query is the hottest
   statement in the product and a per-candidate join is exactly where a
   regression would appear.

## What this run cannot establish, stated before it is run

- **Nothing about a store that actually holds cross-scope contradictions.** The
  corpus has none. The measurement can show the fix costs nothing here; it
  cannot show what the fix does where it fires. That evidence is the contract
  case `an unreadable contradicting source moves neither the rank nor conflicts
  (#291)`, which fails on both runtimes without the fix.
- **Nothing about ranking quality in general.** Every weighted signal is
  constant on this corpus, as measured on 2026-08-07 and recorded in `EVALS.md`.
- **Nothing about Cloudflare D1.** The lane is Bun and SQLite. D1 executes the
  same statements through the same contract suite, but no D1 latency is measured
  here and none will be quoted.
- **Nothing about corpora at other scales.** One store, 424,168 claims, one
  shape.

A null on the quality arm is the predicted pass, not a disappointment. Nothing
will be tuned to move it.
