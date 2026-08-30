# Authorization on the `disputed` flag — what it cost

Measured 2026-08-07 on host `benchmark-host`. Protocol
[pre-registered](./2026-08-07-disputed-authorization-prereg.md) before the first
scored run; every number below comes from that protocol and nothing in it was
chosen afterwards.

**Headline:** retrieval quality did not move, and the measurement found a
latency defect the contract suite could not see.

## 1. What changed

[#291](https://github.com/RamaAditya49/titen/issues/291). `disputed` was computed
from a bare `EXISTS` over `claim_sources`, with no join to `observations` and no
`recordAccessSql`, so a contradicting source the caller could not read still set
the flag — worth 0.05 of weighted score and an entry in `conflicts[]`. All four
sites now route through `contradictedSql`, which applies the caller's own access
predicate.

The security behaviour is established by a contract case that fails on both
runtimes without the fix, not by anything here. This document answers the other
question: **what did the extra predicate cost?**

## 2. Provenance

| | |
| --- | --- |
| Corpus | LongMemEval-S, 500 instances, MIT, `~/titen-bench-20260804/fixtures/longmemeval_s` |
| Store | one frozen copy of `lanes/titen/fts-500.db`, 424,168 claims, ingest not repeated |
| Scorer | `~/titen-bench-20260804/harness/common.py`, unmodified |
| Lane | Bun + SQLite, FTS-only. No model or vector store is configured, so nothing external varies between the arms |
| BASE arm | `main` at `d5a06d9` — the fix's parent commit |
| FIX arm | `fix/291-disputed-authorization` |
| Failures | score incorrect and stay in the denominator; n is 500 in every row |

The pre-registration commit precedes the commit carrying any result. It does
**not** precede the fix commit, and cannot: unlike the #288 A/B, the change here
is the object of measurement rather than a design the measurement chose. What
the ordering shows is that the protocol, the kill criteria, and the "cannot
establish" list were fixed before any number existed.

Neither arm carries the #288 tie-break. The baseline is `main`, so the two
changes are not confounded.

## 3. The corpus cannot exercise the fix, and that was stated first

Read out of the store before the pre-registration was written:

| Property | Value |
| --- | ---: |
| rows with `relation = 'contradicts'` | **0** |
| claims with `status = 'disputed'` | **0** |
| distinct `actor_id` over 25,112 observations | **1** |
| rows in `retention_exclusions` | **0** |

No contradicting evidence and one principal. Both the old query and the new one
therefore return `disputed = 0` for every one of 424,168 claims, and there is no
scope boundary to cross. The registered prediction was not "probably no change"
but **exactly no change** — a claim that one differing instance would have
falsified.

So this run cannot say the fix is good. It can say the fix is free, and it can
say so precisely, because the prediction was exact.

## 4. Quality — the registered null, confirmed

Ready to publish. Not a benchmark result: a no-regression check for one commit.

| Metric, n=500 | BASE (`d5a06d9`) | FIX (#291) | Paired two-sided sign test |
| --- | ---: | ---: | --- |
| recall@1 | 0.8800 | 0.8800 | 0 wins / 0 losses / 500 ties, **p = 1.0** |
| MRR@10 | 0.9147 | 0.9147 | — |
| recall@5 *(saturated)* | 0.9600 | 0.9600 | — |
| recall@10 *(saturated)* | 0.9820 | 0.9820 | — |
| failures | 0 | 0 | — |
| instances with a different ranked list | — | **0 of 500** | — |

recall@5 and recall@10 are marked saturated and are not primary metrics on this
corpus, per the standing rule in [`EVALS.md`](./EVALS.md).

The two ranked outputs are **byte-identical**, SHA256
`bb7dfb8b39182ed243e577cf9693c0651d0db5028652a07ba55e09973daf68e4` — the same
digest as the published `titen-fts-500-passA.ranked.json` from the #288 run. Five
independent passes across three builds now produce one digest, which is a
reproducibility result in its own right.

Per-type recall@1 is identical in all six categories and is in
[`analysis-291.json`](./results/2026-08-07-disputed-authorization/analysis-291.json).

A null was the prediction and the null is a pass. Nothing was tuned to reach it.

## 5. Latency — and the defect this measurement caught

**This is the part that justifies running the benchmark at all.** The contract
suite passed on both runtimes, on both query shapes, at every stage. Its stores
hold tens of rows, so a query plan that collapses at 10^5 claims is invisible to
it.

The first implementation of `contradictedSql` expressed the predicate as a join,
copying the shape already in `atlas.ts`:

```sql
EXISTS (SELECT 1 FROM claim_sources s
        JOIN observations o ON o.id = s.observation_id
        WHERE s.claim_id = c.id AND s.relation = 'contradicts'
          AND o.org_id = c.org_id AND <recordAccessSql("o")>)
```

`EXPLAIN QUERY PLAN` on the real store shows SQLite driving from the wrong side:

```
SEARCH o USING INDEX observations_workspace_scope (org_id=?)
SEARCH s USING COVERING INDEX sqlite_autoindex_claim_sources_1 (claim_id=? AND observation_id=? AND relation=?)
```

It scans **every observation in the organization** — 25,112 of them — evaluating
the membership and retention-exclusion subqueries for each, and does it once per
candidate. Rewritten so `claim_sources` drives on its own primary key, which is
the shape `loadAuthorizedSources` already used:

```
SEARCH s USING COVERING INDEX sqlite_autoindex_claim_sources_1 (claim_id=?)
SEARCH o EXISTS USING INDEX sqlite_autoindex_observations_1 (id=?)
```

A claim with no contradicting source now costs one index seek, which is what the
unfiltered query cost.

Measured, `top_k=5`, 100 instances, 3 repeats, arms alternated BASE/FIX/BASE/FIX
so a warming page cache cannot load onto one of them:

| Build | `max_candidates` | p50 ms (r1, r2) | p95 ms (r1, r2) | p50 vs BASE |
| --- | ---: | ---: | ---: | ---: |
| BASE `d5a06d9` | 200 | 17.79, 17.38 | 24.85, 23.36 | — |
| FIX, nested `EXISTS` | 200 | 17.62, 17.24 | 23.60, 23.58 | **−1.0%** |
| BASE `d5a06d9` | 1000 | 17.23, 17.30 | 25.10, 26.64 | — |
| FIX, nested `EXISTS` | 1000 | 17.28, 17.06 | 25.16, 25.40 | **−0.6%** |
| *rejected, join shape* | 200 | ~79,000 (spot) | not sampled | **~4,400x** |

The shipped shape is flat: both deltas are negative and smaller than the spread
between the two repeats of a single arm, so the honest reading is *no measurable
change*, not *faster*. Kill criterion 3 — a p50 regression above 10% reproducing
across both repeats — does not fire.

The rejected shape is kept rather than deleted, as the #288 run kept its own
rejected design, but it carries **one spot measurement rather than a percentile
sweep**, and that is a deliberate stop rather than an omission. At roughly 79
seconds per compile a sampled run costs most of an hour per arm and could only
refine the precision of a number whose magnitude — three orders of magnitude —
already decided the question. No decision in this document turns on whether that
figure is 74 s or 84 s, so it was not spent.

What the spot measurement does establish is the only thing needed: the join
shape is not a slightly slower alternative. Three orders of magnitude is a
different plan, not a slower one.

One caveat on how that is stated, because it was nearly stated wrongly here.
`EXPLAIN QUERY PLAN` on a *simplified* pair of the two shapes — the same
`EXISTS` structures without the real `recordAccessSql` predicate — reports
`SEARCH` on every table for both, showing no difference at all. The
divergence is a property of the full authorization predicate, not of the
join versus the nested `EXISTS` in isolation, so a reader reproducing this
must use the real fragment. The measured latency, not a query plan read from
a reduced query, is the evidence for this row.

### A pre-existing defect this exposes

`atlas.ts` used the join shape for the governance review queue's
`has_contradiction` before any of this work, and that lens is served to
operators. Routing it through `contradictedSql` moves it onto the fast plan as a
side effect. No separate measurement of the review queue was made, so this is
reported as a plan change with an explanation, not as a measured speedup.

## 6. What this does not establish

Stated in the pre-registration before the run, and unchanged by it:

- **Nothing about a store that holds cross-scope contradictions.** This corpus
  has none, so the measurement cannot show what the fix does where it fires. The
  evidence for that is the contract case `an unreadable contradicting source
  moves neither the rank nor conflicts (#291)`, which fails on `bun-sqlite` and
  on D1 without the fix.
- **Nothing about ranking quality in general.** Every weighted ranking signal is
  constant on this corpus, measured 2026-08-07 and recorded in `EVALS.md`.
- **Nothing about Cloudflare D1.** The lane is Bun and SQLite. D1 runs the same
  statements through the same contract suite, but D1 has its own planner and no
  D1 latency was measured. The join-shape defect above is a SQLite plan; whether
  D1 chose the same one is unknown and untested.
- **Nothing about other corpus shapes or sizes.** One store, one shape, 424,168
  claims. The join-shape blowup scales with observations per organization, so a
  larger store would have been worse, and every store the contract suite uses is
  small enough to show nothing at all.
- **No synthetic corpus was built.** `EVALS.md` forbids quoting a synthetic
  figure as a product claim, and a corpus constructed to make this fix fire would
  produce exactly that.

## 7. Reproduce

Artifacts and checksums:
[`results/2026-08-07-disputed-authorization/`](./results/2026-08-07-disputed-authorization/).

```bash
# one server per arm, same store file, never bootstrapped
bash serve_base.sh  ~/titen-evidence-rank/bench/lane/fts-500.db "$PORT" base.log   # d5a06d9
bash serve_lane.sh  ~/titen-evidence-rank/bench/lane/fts-500.db "$PORT" fix.log    # the fix

python3 query_pass.py --port "$PORT" --key-file "$KEY" --out titen-291-base
python3 latency.py    --port "$PORT" --key-file "$KEY" --top-k 5 --max-candidates 200 --repeats 3 --n 100
python3 analyze291.py
```

`$KEY` is the lane's bootstrap log, the only copy of the key. The runners read it
and never echo it.
