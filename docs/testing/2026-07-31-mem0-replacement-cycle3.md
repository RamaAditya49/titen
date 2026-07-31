# Titen 0.3.0 versus Mem0 replacement cycle 3

Date: 2026-07-31

Upstream/npm/GitHub/live snapshot: 2026-07-31T17:25:21+07:00.

Snapshot boundary: every package, deployment, branch, issue, pull-request, and
source-status statement below is historical at that timestamp. It does not
describe current `main`.

Verdict: **blocked; keep Mem0 active**

Cycle 3 adds a 10,000-statement embedding calibration, the documented
EmbeddingGemma retrieval profile, an audited enrichment-model gate, independent
validation of every embedding/readiness change merged after 0.3.0, and a fresh
Ponytail debt ledger. It is not a production cutover approval.

No production conversation, raw embedding, raw provider output, prompt,
credential, or endpoint entered a benchmark artifact. Mem0 remained the
production authority and neither production service was restarted or replaced.

## Bound package, source, and live state

The published and Wulan-tested artifact is still exact npm
`titen-memory@0.3.0`:

- SHA-1 `568d56175257f515ee3c79c7672d62bc39c07dda`;
- integrity
  `sha512-R49HwOllKtfn3psuNz4WBW0vVrqJteuGwjatH25djqh4RA5hqbyM5hbd+nlNFtkvlkhuAMmiXrARFodp/wTR/w==`;
- tag commit `9f10bfd625ba947897056f1dbc0ab7bfc4ce6304`;
- Wulan canary revision `npm-0.3.0`, schema 12/12, loopback only.

The final read-only Wulan smoke returned Titen `/readyz` 200 with `ready:true`,
revision `npm-0.3.0`, schema 12/12, and FTS/vector/model/background-repair/
export-import enabled. In 0.3.0 the `model` capability means the embedding
client was constructed; it does not mean an LLM enrichment worker exists.
Mem0 `/docs` returned 200 and unauthenticated `/memories` returned 401.
Container IDs remained `b3a867f9ee22` for the Titen canary and
`dc20d8cfdab4` for the healthy Mem0 API; no restart or write occurred.

Source advanced to `b9150efb4fa2e9fa3d71b9e26b387364703e8fdd`
and declares 0.3.1, but 0.3.1 is not published. Source-only fixes therefore do
not count as package or deployment evidence. In particular, Wulan 0.3.0 still
lacks the fixes for injected embedding providers, local install/vector
packaging, default project scope, truthful semantic dependency readiness, and
the role-aware calibrated retrieval contract merged in PR #163.

## Embedding scale-S calibration

The deterministic `s-calibration-v1` lane generated exactly 10,000 synthetic
statements and 600 stratified queries. A stable-hash 300-query calibration split
selected the highest-recall threshold with zero calibration no-result false
positives; the untouched 300-query holdout then evaluated that threshold. The
same fixture, split, provider route, disposable sqlite-vec database, and scoring
code were used in both profiles.

| Holdout metric | Raw input baseline | Documented retrieval profile |
| --- | ---: | ---: |
| threshold | 0.765014377 | 0.737307171 |
| Recall@1 | 79.58% | 85.83% |
| Recall@5 | 82.08% | 91.67% |
| MRR | 0.808390 | 0.881736 |
| nDCG | 0.818005 | 0.890558 |
| no-result false positives | 0/60 | 0/60 |
| answerable abstention | 6.67% | 0% |
| cross-language Recall@5 | 55.00% | 66.67% |
| English-query Recall@5 | 65.00% | 75.00% |
| English query to Javanese-in-Indonesian statement | 1/20 | 0/20 |

The documented profile uses `title: none | text:` for documents and
`task: search result | query:` for queries, as prescribed by the
[EmbeddingGemma model card](https://huggingface.co/google/embeddinggemma-300m/blob/main/README.md).
On paired holdout queries it won 24 cases that raw input missed and lost one
case raw input found; the exact McNemar p-value was `0.00000155`.

The profile is the correct default challenger, not an activation pass. One
locked cross-language direction remains 0/20 and the provider revision is not
attested. Current source PR
[#163](https://github.com/RamaAditya49/titen/pull/163) now implements distinct
query/document transforms, unit normalization, a fingerprinted operator floor,
and pre-hydration filtering for Bun and Cloudflare, but it is not published or
installed. A second untouched holdout, exact-revision product/reindex replay,
and live deployment evidence remain incomplete; #144 and
[#155](https://github.com/RamaAditya49/titen/issues/155) remain open.

Evidence:

- [raw-input full report](./2026-07-31-embedding-s-calibration-v1-full.md);
- [documented-profile challenger](./2026-07-31-embeddinggemma-retrieval-profile-challenger.md);
- checksummed results under
  `results/2026-07-31-embedding-s-calibration-v1-full/` and
  `results/2026-07-31-embedding-s-calibration-v1-embeddinggemma-retrieval-full/`.

## Enrichment-model gate

The gate was frozen before its scored provider run:

- source commit `80ad4b42e51009ccac6ad5cd530de4f661b37105`;
- unmerged candidate contract snapshot `03a77a9`, which supplied the exact
  prompt/schema but is not current-main product code;
- runner SHA-256
  `7e91f3ec9576c0ee09f31ad77bdb97a66c672797ad7dca6a829dd792eb42faac`;
- fixture SHA-256
  `3fb615773a792519ad2bb15562f20b593fd60527571a6625b96d438d1c12cb42`;
- 72 cases: 48 derivation, 24 reflection, 24 each in Indonesian,
  English, and Javanese-in-Indonesian;
- 24 concept families, five raw repeats for a full model, deterministic
  interleaving, concurrency 6, 30-second product-default timeout, no semantic
  retries, and provider-default/omitted reasoning effort;
- deterministic opaque provider-visible IDs, exact local schema/validator,
  explicit temporal defaults, polarity/identifier/time mutation checks, and
  source bytes verified against the clean commit both before and after calls.

The scorer is intentionally labeled **lexical contract**, not adjudicated
semantic precision. Alias slots cannot reject every appended hallucination.
Model quality and activation therefore remain false even if a model passes
every lexical threshold; a production semantic claim still requires blinded
independent or human adjudication plus identical D1/SQLite persistence replay.

### Response-mode smoke

All smoke calls used the same three synthetic preference, injection, and
conflict cases from the frozen fixture.

| Mode/model | Provider parsed | Local schema | Validator | Lexical contract |
| --- | ---: | ---: | ---: | ---: |
| `json_schema` / Sol | 3/3 | 0/3 | 0/3 | 0/3 |
| `json_schema` / Terra | 3/3 | 0/3 | 0/3 | 0/3 |
| `json_schema` / Luna | 3/3 | 0/3 | 0/3 | 0/3 |
| `json_object` / Sol | 3/3 | 3/3 | 3/3 | 2/3 |
| `json_object` / Terra | 3/3 | 3/3 | 3/3 | 2/3 |
| `json_object` / Luna | 3/3 | 3/3 | 3/3 | 3/3 |

All three tested Wulan routes are incompatible with the candidate adapter's
exact `json_schema` request: HTTP/provider parsing succeeds, but the response
has the wrong top-level/action shape and fails closed locally. The
`json_object` mode works only after the exact schema is embedded in the user
message; it is a separately fingerprinted compatibility diagnostic, not the
current product request path. Luna's 3/3 smoke is insufficient to establish
quality on the v2 corpus; Luna was outside the predeclared full Sol/Terra
candidate set and therefore remains unmeasured beyond this compatibility smoke.

### Full Sol/Terra compatibility diagnostic

Because both Sol and Terra passed `json_object` schema plus validator
compatibility, one combined/interleaved full run executed 720 calls: 360 per
model. All 720 provider bodies parsed, no call timed out, token usage coverage
was 100%, and each model had two locally rejected unsafe outputs. The run took
622.7 seconds wall-clock.

| Frozen lexical/output metric | Sol | Terra | Required gate |
| --- | ---: | ---: | ---: |
| local schema precheck | 100% | 100% | 100% |
| validator conformance | 99.44% | 99.44% | malformed output cannot commit |
| lexical-contract pass | 65.28% | 66.11% | >= 90% |
| lexical claim F1 | 56.91% | 54.75% | >= 95% |
| exact cited-source F1 | 46.64% | 45.81% | >= 95% |
| minimum kind/language lexical recall | 0% | 0% | >= 85% |
| no-memory safety | 100% | 100% | 100% |
| temporal accuracy | 60.12% | 56.10% | >= 90% |
| reflection lexical accuracy | 32.50% | 36.67% | >= 90% |
| repeat decision stability | 85.56% | 83.89% | >= 90% |
| completed-call p50 / p95 | 4.73 / 11.82 s | 3.85 / 9.73 s | report only |
| observed total tokens | 204,088 | 205,277 | 100% coverage |

Sol rejected two Indonesian procedure-reflection outputs for foreign citations.
Terra rejected one Indonesian/Javanese procedure citation and one disjoint-time
response with a non-null inactive field. Both models otherwise produced
schema-valid proposals that would still require the real persistence fence and
semantic adjudication.

Terra's paired lexical-contract point estimate was 0.83 percentage points above
Sol, but the deterministic concept-cluster bootstrap one-sided 95% lower bound
was **-4.44 points**, below the predeclared **-2-point** margin. This run did
not establish Terra's non-inferiority; it does not prove Terra is inferior.
Both absolute lexical gates fail, so that comparison cannot select or activate
either model. Luna was outside the predeclared full candidate set, and its
three-case smoke cannot establish v2 full-corpus quality.

The model answer is therefore: **none is sufficient**. Sol remains only the
flagship reference/canary for future work. Terra remains a challenger whose
completed-call p50/p95 was lower in this non-quality-equivalent diagnostic but
whose non-inferiority was not established. Luna remains unmeasured on the v2
full corpus with only a compatibility smoke. Do not install any of them as
Titen's automatic memory authority.

Checksummed artifacts:

- [`json_schema` smoke](./results/2026-07-31-enrichment-model-gate-v2-json-schema-smoke/);
- [`json_object` smoke](./results/2026-07-31-enrichment-model-gate-v2-json-object-smoke/);
- [full Sol/Terra `json_object` diagnostic](./results/2026-07-31-enrichment-model-gate-v2-json-object-full/).

All three artifact directories passed checksums and a pre-write artifact safety
check; their manifest, report, summary, and trial records contain no raw
provider body, fixture text, prompt, proposal, credential, or endpoint.

OpenAI's current model guidance classifies
[Sol as flagship, Terra as the intelligence/cost balance, and Luna as the
efficient high-volume tier](https://developers.openai.com/api/docs/guides/latest-model.md).
The Wulan routes are nevertheless treated as opaque mutable aliases: their
reported model-name hashes were stable within the smoke, but no system
fingerprint or independently attested revision was available.

## Independent post-0.3.0 source validation

### Injected embedding-provider boundary

PR [#154](https://github.com/RamaAditya49/titen/pull/154) merged as
`75c86a0`. Its shared validator now covers indexing, context query, and
maintenance. Seven malformed custom-provider cases—missing, extra, sparse,
plain-array, wrong-dimension, NaN, and infinity—were rejected before vector
query/upsert. The outbox remained pending/retryable, FTS stayed authorized, and
59 focused validation tests passed.

This closes [#137](https://github.com/RamaAditya49/titen/issues/137) in source,
not in npm/Wulan. PR #147 later added contention diagnostics and PR #164 merged
a Node-hosted D1 release gate. Exact `6060d606` passed that gate 5/5 on Node
24.18.0: 94/94 each, 470/470 total, with no retry. The same command fails
deterministically on minimum-supported Node 22.23.1 at the 20-second parent
timeout before the one 60-second child can finish; exact current `b9150ef`
reproduced it. Cancellation also bypasses cleanup and left the run's unique
Miniflare persistence directory after its owned process exited. This is
[#166](https://github.com/RamaAditya49/titen/issues/166), so
[#157](https://github.com/RamaAditya49/titen/issues/157) remains open together
with the missing disposable real Cloudflare D1 smoke.

### Role-aware calibrated retrieval source

PR [#163](https://github.com/RamaAditya49/titen/pull/163) merged as
`b9150ef`. The exact merge independently passed:

- 90 focused vector, adapter, validation, and configuration tests;
- 152 full integration tests;
- 117 Bun contract/vector/SDK tests;
- the Worker dry-run build, route-doc check, workflow-doc check and self-test,
  and `git diff --check`.

The source change applies the official EmbeddingGemma query/document prompts in
shared core, unit-normalizes both roles, converts Bun L2 distance back to
cosine, filters below an operator-supplied fingerprinted floor before hydration,
and carries the same contract through the Cloudflare adapter. It adds no
dependency or SQL schema.

This is a real source fix, not a release pass. The configured revision is an
operator assertion rather than provider attestation, the inspected
`0.737307171` threshold is deliberately not bundled, and the second untouched
holdout, explicit reindex/requeue replay, real Vectorize smoke, npm artifact,
and Wulan install are still missing. #144 and #155 therefore remain open.

### Truthful semantic dependency readiness

PR [#158](https://github.com/RamaAditya49/titen/pull/158), merge `93ff9b2`,
correctly persists local failure timestamps. Bun and D1 both passed the
sequential contract:

- provider failure makes readiness 503;
- delete-only work does not claim recovery;
- another tenant's success does not clear genuine pending failed work;
- successful retry clears the marker and returns readiness 200;
- migration 13 to 14 preserves the vector fingerprint and initializes both
  failure fields to null.

An independent two-drain barrier found a new race on `2ad2b98`; subsequent
`6060d606` changes are release diagnostics rather than a product-code fix. Drain
B can complete a row, then drain A's late provider failure writes a stale
outage marker even though its pending-row update matched zero rows. The outbox
is `done`, an idle drain processes zero work, and readiness remains 503 until a
future successful upsert. Bun and D1 reproduce identically. This is
[#162](https://github.com/RamaAditya49/titen/issues/162).

The source needs the minimum database ownership/CAS fence; it does not need a
queue framework or new dependency.

Open PR [#165](https://github.com/RamaAditya49/titen/pull/165) adds that owner
token and fixes the original late-failure race in focused Bun/D1 barriers, but
independent QA blocks exact head `3658e5d`:

- [#167](https://github.com/RamaAditya49/titen/issues/167): on both Bun/SQLite
  and Miniflare D1, purge/delete can finish before an older external upsert,
  which then resurrects the purged vector while every outbox row remains
  `done`;
- [#168](https://github.com/RamaAditya49/titen/issues/168): migration 15 can
  clear a genuine dependency marker and change readiness to 200 without any
  successful embed/upsert recovery;
- [#169](https://github.com/RamaAditya49/titen/issues/169): a timestamp captured
  before earlier provider work can create a later lease already expired, so two
  drains both call the provider and report success;
- the required Bun runtime-hardening file is 7/8 because one rollback assertion
  incorrectly expects schema-14 failure columns to be absent.

The same head also fails the minimum-Node gate in #166. PR #165 is therefore
neither merge nor release evidence.

## Automatic memory-management implementation audit

The #136 worktree is not merged or installed. Its SQL-ledger/local-validator
direction remains appropriate, but the following independent blockers were
reproduced before activation:

- [#148](https://github.com/RamaAditya49/titen/issues/148): rolling pipeline
  changes can terminal-fail already leased work as `source_changed`;
- [#149](https://github.com/RamaAditya49/titen/issues/149): reflection
  scheduling/commit exceeds realistic Cloudflare D1 query budgets;
- [#150](https://github.com/RamaAditya49/titen/issues/150): logical
  export/import drops enrichment provenance;
- [#151](https://github.com/RamaAditya49/titen/issues/151): serial batches
  pre-lease jobs until later jobs lose their leases;
- [#152](https://github.com/RamaAditya49/titen/issues/152): reflection outside
  the newest 100 eligible claims can starve permanently;
- [#159](https://github.com/RamaAditya49/titen/issues/159): separate
  observations can create identical active derived claims;
- [#160](https://github.com/RamaAditya49/titen/issues/160): evidence dated 2026
  can commit an unsupported generated `valid_from` in 2099;
- [#161](https://github.com/RamaAditya49/titen/issues/161): an invalid optional
  extraction capability can turn a valid canonical observation write into 500
  with zero evidence rows.

Other hard gaps remain on the parent
[#136](https://github.com/RamaAditya49/titen/issues/136): recent-only rather
than related candidate selection, absent output hash and exact policy-snapshot
commit fence, incomplete readiness/backlog state, and no stable product-native
Cloudflare/VPS/local execution.

## Deployment-target verdict

- **VPS:** Wulan 0.3.0 direct retrieval, real embedding, restart/restore,
  concurrency, dependency recovery, and a small disposable migration have
  evidence. Product-native LLM management, published post-0.3.0 fixes, exact
  RSS/storage/cost, and sustained soak do not.
- **Cloudflare:** shared Miniflare/D1 contracts exist and the Node 24 lane passed
  5/5, but minimum-supported Node 22 fails deterministically and bypasses
  persistence cleanup. Enrichment exceeds query budgets, the outbox ownership
  fix is still an open PR, and no real D1/Vectorize/Workers AI/Cron smoke exists.
- **Local computer:** clean npm/package and sqlite-vec consumer checks exist,
  but no installed enrichment service with the frozen model contract,
  recovery, migration, and semantic adjudication has passed.

None of the three targets supports a Level-6 automatic-management claim yet.

## Cycle-3 issue ledger

Opened in this cycle:

- [#151](https://github.com/RamaAditya49/titen/issues/151): serial enrichment
  lease loss;
- [#152](https://github.com/RamaAditya49/titen/issues/152): reflection
  starvation;
- [#155](https://github.com/RamaAditya49/titen/issues/155): missing asymmetric
  EmbeddingGemma preprocessing;
- [#157](https://github.com/RamaAditya49/titen/issues/157): intermittent full
  D1/Miniflare timeout/RPC failure;
- [#159](https://github.com/RamaAditya49/titen/issues/159): exact derived
  duplicates;
- [#160](https://github.com/RamaAditya49/titen/issues/160): unsupported future
  validity;
- [#161](https://github.com/RamaAditya49/titen/issues/161): optional extraction
  configuration blocks canonical writes;
- [#162](https://github.com/RamaAditya49/titen/issues/162): late index-drain
  failure leaves phantom outage readiness;
- [#166](https://github.com/RamaAditya49/titen/issues/166): Node 22 cancels the
  D1 release gate before its 60-second case and bypasses persistence cleanup;
- [#167](https://github.com/RamaAditya49/titen/issues/167): a stale index owner
  can resurrect a purged vector after delete completion;
- [#168](https://github.com/RamaAditya49/titen/issues/168): migration 15 clears
  genuine semantic outage evidence without recovery;
- [#169](https://github.com/RamaAditya49/titen/issues/169): index leases can be
  created already expired from a stale drain timestamp.

Also updated issues #102, #136, #137, #138, #144, #148, and #149 plus PRs #147
and #154 with independent evidence. #137, #140, #141, and #138 are fixed/closed
in current source, but require a published-package and Wulan retest.

At the final upstream snapshot there were 19 open issues and one open PR. PR
[#163](https://github.com/RamaAditya49/titen/pull/163) had merged the calibrated
retrieval source change, while #144/#155 remained open. The merge requires a
non-empty configured revision identifier; it does not attest Wulan's provider
revision or make the inspected threshold a universal default. Open PR
[#165](https://github.com/RamaAditya49/titen/pull/165) is a source candidate for
#162's ownership fence, but independent QA blocks it on #166–#169 and one red
required migration test; it is not merged, published, or live evidence. Neither
change counts as a shipped package fix until a new artifact passes the
corresponding runtime, deployment, and Wulan retests.

## Fresh Ponytail debt

The final read-only scan found 20 marked shortcuts on the evaluation branch.
The 19 baseline markers remain described in
[`PONYTAIL-DEBT.md`](../../PONYTAIL-DEBT.md), and the frozen benchmark runner
adds one lexical-scoring marker. Every marker has a concrete upgrade trigger:

| Location | Ceiling / trigger |
| --- | --- |
| `docs/agent-plugins.md:106` | replace the temporary standalone install path when the blocked ClawHub bundle can publish |
| `docs/architecture/agent-integration.md:128` | add lifecycle hooks only when a measured workflow and parity fixture require them |
| `docs/architecture/agent-integration.md:129` | add a Pi MCP extension only after an adapter gap and process-authority review |
| `docs/architecture/agent-integration.md:130` | add vendor catalog assets only when a maintainer schedules that review |
| `plugins/claude/titen-memory/.clawhubignore:1` | remove the filter when bundles natively import Streamable HTTP MCP configuration |
| `scripts/benchmark-enrichment-model.ts:720` | replace lexical aliases with blinded independent adjudication when semantic precision becomes a release gate |
| `src/core/context.ts:55` | thread a caller-selected time through retrieval when historical recall is required (#118) |
| `src/core/db.ts:41` | tune SQL chunking only after bounded queries are measured as round-trip dominated |
| `src/core/idempotency.ts:21` | add content convergence when retry or resync must exceed 24 hours (#101) |
| `src/core/indexing.ts:16` | persist an indexed statement hash when repeated embeddings become material |
| `src/core/maintenance.ts:18` | add per-organization cursors when maintenance freshness is breached |
| `src/core/migrations.ts:10` | add migration dry-run when deployment review requires preview (#116) |
| `src/core/migrations.ts:267` | implement table-specific retention/legal hold only with accepted erasure and recovery semantics (#105) |
| `src/core/tokens.ts:4` | use a configured model tokenizer when one is available, retaining the heuristic fallback |
| `src/core/validate.ts:43` | scale the lexical candidate ceiling only after measured recall loss |
| `src/core/vectors.ts:8` | add dimension readiness checks when multiple embedding dimensions/providers are supported |
| `src/core/webhooks.ts:460` | add per-organization cursors when event backlog misses freshness |
| `src/runtime/bun/server.ts:86` | add workers or replicas only after equivalent-quality throughput misses (#123) |
| `src/runtime/bun/vectors.ts:17` | normalize and use cosine distance when product behavior needs cross-query score comparison |
| `tests/contract/cloudflare-d1.test.ts:77` | remove the one-shot shim retry when Miniflare handles its non-JSON fault itself |

**Evaluation branch: 20 markers, 0 without a trigger.** The checked-in runner
is byte-identical to the immutable provider-run source at `80ad4b42` and SHA-256
`7e91f3ec9576c0ee09f31ad77bdb97a66c672797ad7dca6a829dd792eb42faac`.

Current `origin/main` has 18 markers. Its main-only marker at
`src/core/vectors.ts:490` detects canonical-only restore but does not name when
or how partial external-index loss should earn a stronger protocol.
**Current main: 18 markers, 1 without a trigger.**

## Replacement decision

Do not replace Mem0. Direct retrieval latency and resource use favor Titen in
the small Wulan lanes, and documented EmbeddingGemma preprocessing materially
improves retrieval. Those are component wins, not a memory-system win. The
published runtime still lacks automatic LLM memory management, has unsafe
abstention/ranking behavior, and has not passed the Cloudflare, VPS, local,
semantic-quality, migration, soak, or rollback gates.

The next package must first include and independently retest the source fixes,
then close the remaining P0/P1 blockers. A replacement can be considered only
after two consecutive production-shaped cycles pass equivalent quality and
safety, bulk plus delta migration, seven-day shadow soak, and a rollback drill.
