# Titen 0.3.0 versus Mem0 replacement cycle 4

Date: 2026-07-31

Upstream/npm/live snapshot: 2026-07-31T18:15:37+07:00.

Final GitHub snapshot: 2026-07-31T18:23:11+07:00.

Snapshot boundary: every package, deployment, branch, issue, pull-request, and
source-status statement below is historical at the timestamps above. It does
not describe current `main`.

Verdict: **blocked; keep Mem0 active**

Cycle 4 adds a full Luna absolute model gate and independent adversarial QA of
the moving D1-redaction and semantic-index candidates. It is not a cutover
approval and does not rank models tested in different time windows.

No production conversation, embedding, provider body, prompt, credential, or
endpoint entered an artifact. The Wulan checks were read-only; no container,
service, database, route, or deployment was changed.

## Bound release and live state

The published package remains exact `titen-memory@0.3.0`, npm SHA-1
`568d56175257f515ee3c79c7672d62bc39c07dda`. `origin/main` remains
`b9150efb4fa2e9fa3d71b9e26b387364703e8fdd`; source-only fixes are not package
or deployment evidence.

The Wulan Titen canary remained container `b3a867f9ee22`, image
`titen-canary:0.3.0`, loopback-only, and up without restart. Its read-only
`/readyz` returned 200 with `ready:true`, runtime `bun-sqlite`, revision
`npm-0.3.0`, schema 12/12 verified, and the recorded FTS/vector/model/
background-repair/export-import capabilities enabled. In this package,
`model:enabled` means an embedding client exists; it does not establish an LLM
memory-management worker.

The existing production API container remained `dc20d8cfdab4`, healthy and up
without restart. Its host-local `/docs` returned 200 and unauthenticated
`/memories` returned 401.

## Luna absolute enrichment gate

The later Luna lane reused the frozen runner, fixture, prompt, schema, timeout,
retry policy, and lexical scorer from cycle 3:

- source `b69a1505b214f28786efee491d9e7b18faf5cca3`;
- contract snapshot `03a77a9`;
- runner SHA-256
  `7e91f3ec9576c0ee09f31ad77bdb97a66c672797ad7dca6a829dd792eb42faac`;
- fixture SHA-256
  `3fb615773a792519ad2bb15562f20b593fd60527571a6625b96d438d1c12cb42`;
- 72 cases x five repeats, 360 calls, seed `20260731`, concurrency 6,
  30-second timeout, no retry.

| Absolute metric | Luna | Required gate |
| --- | ---: | ---: |
| completed provider/schema responses | 347/360 (96.39%) | 360/360 |
| validator-accepted responses | 325/360 (90.28%) | descriptive; invalid-commit gate unmeasured |
| lexical-contract pass | 62.22% | >= 90% |
| lexical claim F1 | 55.98% | >= 95% |
| exact cited-source F1 | 48.84% | >= 95% |
| minimum kind/language lexical recall | 0% | >= 85% |
| no-memory safety | 99.05% | 100% |
| temporal accuracy | 61.04% | >= 90% |
| reflection lexical accuracy | 25.83% | >= 90% |
| mean modal-decision share | 82.78% | >= 90% |
| successful-call p50 / p95 | 4.612 / 17.575 s | descriptive only |

Thirteen reflection calls timed out. Twenty-two unsafe outputs were rejected.
One schema-valid third-party Javanese-in-Indonesian case proposed `add` instead
of the required `abstain`, so the 100% no-memory safety gate failed.
Javanese-in-Indonesian preference and procedural lexical recall were both 0%.

Every measured lexical-output gate is false. Semantic precision was not
adjudicated, invalid persistence was not replayed through both SQL adapters,
and stable model revision attestation remains unmeasured. Luna is therefore
not eligible for activation. Its later, non-interleaved window cannot establish
a latency, quality, or non-inferiority comparison with Sol or Terra. Reported
p50/p95 cover only the 347 successful calls and exclude 13 timeouts.

The full result and interpretation boundary are in the
[Luna gate report](./2026-07-31-enrichment-model-gate-luna-full.md). At
generation and audit time, all six artifact files are mode 0600 under a
mode-0700 directory; Git does not preserve those restrictive modes after
clone. The 360-record allowlist, all checksums, and the independent
forbidden-content scan pass.

## Moving source-candidate QA

### D1 diagnostics and release lane

PR [#170](https://github.com/RamaAditya49/titen/pull/170) advanced during QA.
The final frozen head for this cycle is
`cad754671930c7669e92f6894bdc6449aeb31432`.

Its focused harness passes 3/3, including the new quoted and unterminated
structured-value cases. The independent 81,243-probe matrix nevertheless
returns the same result on Bun 1.3.13, Node 22.23.1, and Node 24.18.0:

```json
{
  "passed": 81052,
  "failed": 191,
  "folded_crlf_lf_failures": 163,
  "unicode_utf8_split_failures": 7,
  "strict_byte_ceiling_failures": 21,
  "maximum_byte_overage": 1,
  "useful_context_controls_preserved": "0/4"
}
```

The remaining failures share the same decode/redact/truncate/fan-out boundary,
so [#171](https://github.com/RamaAditya49/titen/issues/171) remains open and no
duplicate issue was created. Exact current-head evidence was added to that
issue after a pre-write and post-write competitor-name scan.

At earlier exact head `b83f086`, Bun's focused harness passed 3/3; the full D1
lane passed 94/94 on minimum-supported Node 22 and 94/94 on Node 24. Its
controlled startup-failure probe left owned Miniflare persistence behind. The
ordinary parent-timeout probe retained its acquisition line and run ID but
lacked phase-bound `D1RunDiagnostics` context and bounded stderr. Redaction
commits through `cad7546` did not change those cleanup/timeout paths, but the
startup probe was not rerun on `cad7546`; this is source inference, not new
runtime evidence. [#166](https://github.com/RamaAditya49/titen/issues/166)
remains open.

### Semantic-index ownership candidate

Agent1's clean semantic-index candidate remains exact detached commit
`92740eead2b5d707b1dc100400edeb50d69db6e1`; public PR
[#165](https://github.com/RamaAditya49/titen/pull/165) still points to the older
`3658e5d`. Bun's full contract passes 91/91 and the focused stale-write test
passes 20 repeated built-in runs, but independent adversarial sequences still
block the candidate:

- an old external upsert can apply after takeover, report failure, leave zero
  repair rows, and preserve visible generation 1 after generation 2 completed
  ([#167](https://github.com/RamaAditya49/titen/issues/167));
- a one-day wall-clock jump lets a fresh contender treat a just-created
  five-minute lease as expired and issue a second provider write
  ([#169](https://github.com/RamaAditya49/titen/issues/169));
- one 100-row manual drain executes 418 statement queries, while three
  100-row background drains execute 1,254, despite staying under the 90-value
  parameter/batch ceiling
  ([#149](https://github.com/RamaAditya49/titen/issues/149)).

Those findings were reproduced independently and appended only to their
existing issues. The clean commit cannot close #167, #169, or #149.

At the frozen npm/live snapshot, the enrichment implementation was still dirty
at `a1402df` with 41 changed paths, so QA did not test or modify it. After that
freeze, Agent1 created clean local commit
`2854b7e176e6fe676ec9a21d9ec84db78d8d4628` at 18:21:57+07:00. It had no
matching pushed branch or PR at the final GitHub snapshot and is outside this
cycle's source verdict. It becomes the next immutable target for independent
#136/#149/#150/#172 regression and broader runtime QA.

## Issue-language guardrail

Every open issue title, body, and comment was scanned at the final snapshot for
named competing memory products: **zero matches**. The same scan passed before
and after the new #171 comment. Benchmark protocols and reports may identify a
comparison target; GitHub defect text remains entirely Titen-intrinsic.

## Fresh Ponytail debt

The evaluation branch has 20 source markers and zero without a concrete
ceiling plus upgrade trigger. The immutable provider-run runner contributes one
marker for replacing lexical aliases with blinded adjudication when semantic
precision becomes a release gate.

The exact PR #170 candidate has 18 source markers. Two lack a source-level
upgrade trigger/path: `src/core/vectors.ts:8` and
`src/core/vectors.ts:490`. Its checked-in ledger also retains one removed
marker, omits the live `vectors.ts:490` marker, and has missing/stale location
identities. [#173](https://github.com/RamaAditya49/titen/issues/173) records the
documentation defect. Redaction-only commits after the audited base did not
change the marker inventory.

## Deployment-target verdict

- **VPS:** the isolated 0.3.0 canary remains healthy with real embeddings, but
  product-native LLM management, clean enrichment source, published fixes,
  sustained soak, and production-shaped migration remain absent.
- **Cloudflare:** shared D1 contracts exist, but cleanup/diagnostic release
  failures, query-budget excess, semantic-index races, and the absence of a
  real D1/Vectorize/Workers AI/Cron smoke still block support.
- **Local computer:** package and sqlite-vec consumer checks exist, but no
  installed automatic-management worker has passed semantic adjudication,
  dual-adapter replay, recovery, and migration.

None of the three deployment targets supports a Level-6 automatic-management
claim.

## Replacement decision

Do not replace Mem0. No tested LLM route passes the hard management gate, the
embedding holdout retains a zero-recall cross-language direction, and current
source candidates retain security, race, query-budget, package, deployment,
migration, and soak blockers.

The next useful work is narrow: wait for each Agent1 lane to produce a clean
immutable commit, rerun only the owning adversarial regressions, then broaden
to dual-runtime and real deployment smokes. Two consecutive production-shaped
full gates are still required before any migration or cutover plan can start.
