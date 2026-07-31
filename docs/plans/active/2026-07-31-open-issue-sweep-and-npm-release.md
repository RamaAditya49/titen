---
work_id: open-issue-sweep-and-npm-release
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-07-31
updated: 2026-07-31
review_after: 2026-08-14
owner: CADIS
spec: docs/specs/active/2026-07-31-open-issue-sweep-and-npm-release.md
---
# Plan

The terminal `0.3.0` closure is withdrawn. Keep this pair active until the
reviewed `0.4.0` artifact has complete registry, tag, release, and issue
evidence.

- [x] Capture the immutable starting inventory: local WIP/stash, remote heads,
  open issues and pull requests, tags/releases, npm metadata, and Actions state.
- [x] Review and integrate or explicitly supersede every remote topic branch;
  validate its completed workflow artifacts and remove only a merged branch.
- [x] Build an issue resolution matrix, group shared root causes, and update this
  spec first if a verified issue requires scope outside its current boundaries.
- [x] Land focused fixes from isolated worktrees with the smallest failing tests;
  re-run affected dual-runtime, authorization, migration, and data-loss paths.
- [x] Reproduce issue #133, trace every typed SDK caller through
  `requestWithMeta()`, add table-driven envelope-shape regressions, and reject
  invalid successful JSON at that one shared boundary without retry machinery.
- [x] Trace every Bun HTTP and Cloudflare Workers AI embedding caller through a
  shared output validator; reject malformed shape, cardinality, indices,
  density, dimensions, and values before vector query/upsert, then prove outbox
  retryability and FTS degradation behavior in both runtimes.
- [x] Validate the normalized result at every shared-core `EmbeddingProvider`
  consumer so an injected provider cannot send missing, wrong-dimension, or
  non-finite vectors to query/upsert or mark index work done; cover manual drain,
  background maintenance, and lexical degradation without duplicating adapters.
- [x] Trace semantic configuration, vector initialization, index metadata,
  readiness, and maintenance through both runtime adapters; add migration 13
  for the minimal index fingerprint and fail configured semantic startup closed
  without adding provider probes or abstractions.
- [x] Extend semantic metadata with independent safe embedder/vector-store
  failure timestamps; increment attempts on affected pending work, make
  `/readyz` fail locally after an observed outage, and clear both markers only
  after a successful embed/upsert recovery on both SQL runtimes.
- [x] Bind Bun fingerprints to the normalized endpoint without storing topology,
  reject canonical/vector path aliasing before extension mutation, and fail
  readiness closed when historical indexable claims lack requeue work.
- [x] Require the existing `vec_claims` object to be a `vec0` virtual table with
  the configured dimensions and scope columns; reject plain or wrong-module
  lookalikes before reporting vector readiness.
- [x] Validate a supplied capability's fingerprint model/dimensions against its
  attached embedder before persisting metadata or reporting readiness.
- [x] Extend the explicit reindex commands to insert missing active/disputed
  claim work, then prove the guard and recovery through both runtime contracts.
- [x] Fail local readiness when restored canonical fingerprint metadata meets a
  newly created empty Bun vector projection; document and test the required
  projection reset/requeue after canonical-only restore.
- [x] Add focused FTS-only, clean-install, configured-error, healthy semantic,
  and fingerprint-mismatch regressions; document `sqlite-vec@0.1.9` and the
  versioned capability/readiness contract.
- [x] From the clean packed consumer used by the release verifier, install the
  exact documented `sqlite-vec@0.1.9` extra and prove `/readyz` changes from the
  missing-dependency failure to healthy vector/embedding capability state.
- [x] Declare `sqlite-vec@0.1.9` as an optional peer, then prove package-manager
  metadata does not pull it into the default production install.
- [x] Reproduce issue #141 across FTS and vector retrieval; change missing
  project scope to unscoped-only at the shared compiler boundary, capability-
  gate explicit cross-project mode, return effective scope/reason, and prove
  REST, SDK, MCP, OpenClaw guidance, and dual-runtime authorization parity.
- [x] Retain safe diagnostics for every unexpected non-200/201 response from the
  reopened #102 D1 concurrency contract while preserving exact aggregate and
  one-head/one-winner assertions. Instrumentation is ready; the checkpoint
  recurrence remains unclassified, while only emulator transport instability
  is separately tracked in #157.
- [x] Add one shared embedding-policy helper for role-specific text transforms,
  validation, and unit normalization; require explicit revision/profile/cosine
  floor in Bun and Cloudflare configuration, with EmbeddingGemma bound to its
  official query/document profile.
- [x] Gate vector hits by the configured absolute cosine floor before hydration
  and relative ranking; fingerprint the exact profile/threshold in existing
  semantic metadata and prove mismatch requires the documented explicit
  projection reset/requeue rather than a new schema or provider abstraction.
- [x] Add dual-runtime hard-negative/empty-pack, role parity, sub-threshold
  non-hydration, scope/provenance, malformed/zero-vector, configuration, and
  reindex regressions; integrate the immutable calibration evidence branch and
  run a second untouched holdout before publishing any bundled threshold.
- [x] Acquire one atomic host-wide D1 lane before Miniflare starts, record safe
  owner identity, retain unique temporary persistence and port-zero sockets,
  await disposal of only the owning runtimes, and make an overlapping process
  fail fast without signalling or deleting the owner.
- [x] Remove the Miniflare provisioning retry, attach bounded redacted workerd
  stderr plus run/case identity to harness failures, keep the 20-second case
  bound except for the measured 60-second semantic-readiness case, and keep
  every existing checkpoint, lease, migration, and contract assertion
  unchanged.
- [x] Reproduce the invalid RPC once in the isolated old emulator lane, then
  update only the pinned Miniflare/Wrangler/workerd patch set to the current
  official compatible release and keep pnpm's minimum-age exception exact.
- [x] Prove the lane with an overlap regression and a controlled owner/contender
  experiment, then run five predeclared complete isolated D1 files with no
  retry.
- [ ] Keep the real Cloudflare D1 smoke separate. Create uniquely named
  disposable D1 and Worker resources, apply the release schema, exercise only
  synthetic authenticated health/readiness/write/read and checkpoint/handoff
  concurrency, enumerate the exact targets, then delete both without adding a
  route or retaining a deployment.
- [x] Remove the D1 file-level parent timeout, apply 20-second bounds directly
  to every ordinary case plus setup and teardown, and retain 60 seconds only
  for the measured semantic-readiness case without changing any assertion or
  adding a retry.
- [x] Prove issue #166 on Node 22 and the default supported Node runtime, then
  inject one controlled child failure and verify nonzero exit plus removal of
  only that child's Miniflare persistence and workerd process.
- [x] Add migration 16 with only nullable `index_outbox` owner and expiry
  columns; claim due rows by conditional SQL before provider I/O and require the
  owner token for completion, failure attempts, and dependency markers in both
  manual and background drains.
- [x] Add deterministic dual-runtime barriers for manual/manual and
  manual/background overlap, stale-owner failure after takeover, genuine
  failure/retry, delete-only work, and cross-organization non-recovery; retain
  sanitized local readiness and run migration/schema gates.
- [x] Fix #167 at the shared index-outbox boundary: preserve canonical
  reconciliation before every external upsert and removal, leave fresh repair
  independent of an expired token after stale or apply-then-throw results, and
  return only ownership-confirmed index/remove/remaining counts.
- [x] Add deterministic Bun/SQLite and Cloudflare/D1 purge barriers covering
  post-embed/pre-upsert invalidation, manual/manual and manual/background
  ordering, upsert/remove stale success/apply-then-throw/process-stop, lease
  takeover, and restart convergence.
- [x] Fix #169 by deriving due-row eligibility and each conditional claim's
  full expiry from the database clock; do not use a request, process, or caller
  wall clock as lease authority.
- [x] Prove later manual and background claims receive a full lease after a
  blocked delete/organization, including two independent forward/backward
  caller epochs and zero contender provider calls on Bun/SQLite and
  Cloudflare/D1.
- [x] Convert all owned work for one record into one canonical reconcile row
  before vector-store I/O; prove six repeated manual and background failures
  retain one pending row and only one provider attempt per retry.
- [x] Let a confirmed removal-only retry clear vector-store failure evidence
  under the existing global unresolved-work guard without clearing embedder
  evidence; make the focused repair fixture initialize its own metadata.
- [x] Rewrite and human-review README.md, verify `titen.dev`, run `seng-jelas`
  strictly, and prove the packaged README contains only stable external links.
- [x] Run focused checks after each integration, then the complete local manual
  gate: route/workflow checks, API/integration/browser tests, package smoke,
  production dependency audit, secret scan, and `git diff --check`.
- [ ] Resolve every starting GitHub issue with its merged evidence, exact
  duplicate, or concrete Ponytail not-planned reason; verify zero accidental
  closures and no open pull request.
- [ ] Finalize the changelog and smallest valid SemVer version, close this
  spec/plan pair with exact evidence, merge the reviewed release pull request,
  and verify the exact merge source before publication.
- [ ] From a clean detached checkout of the release commit, run the irreversible
  prepublish gate, publish npm manually, push the annotated tag, generate the
  GitHub release from the changelog, and smoke a clean registry install.
- [x] After the issue #133 fix passes focused and package gates, record it in the
  changelog, prepare the original `0.3.1` candidate, and verify the pnpm lockfile
  remains valid and unchanged because it does not store the root package version;
  the later breaking semantic configuration batch raises the final release to
  `0.4.0` under AC-SWP-007.
- [ ] Remove only merged temporary branches/worktrees, re-audit GitHub/npm and
  the preserved original checkout, then record the durable non-secret handoff.

## Issue disposition

This matrix fixes shared root causes once. Final GitHub comments link each issue
to its merged evidence or to the concrete decision recorded here.

| Issues | Resolution |
| --- | --- |
| #83, #84, #85, #120, #122 | One FTS v11 migration and retrieval/packing batch; merged into this release branch. |
| #101 | Prevent duplicate statements inside one context pack and document deterministic import for re-sync; automatic write-time convergence remains outside the evidence-preserving contract. |
| #88, #91, #93, #95, #97, #98 | One SDK/MCP batch: project resolution, evidence-to-claim recall, timeout/signal composition, misuse guard, typed results/error metadata, and truthful schemas/envelopes. |
| #94, #108 | Runnable README flow, accurate injection language, packaged security guidance, input hardening, and security-file packaging. |
| #92, #99, #118, #119 | One validation/erasure batch for audited tombstoning, field paths/depth, timestamp ordering, and foreign references. |
| #102, #103, #104, #106 | One collaboration-integrity batch for atomic checkpoints/handoffs, handoff readability, principal idempotency, and monotonic event cursors. |
| #110, #111, #112, part of #116 | One bounded portability/backup batch; portable canonical dependencies only, byte-safe pages, explicit authority, and atomic verified backup. |
| #100, #105, #107, remainder of #116 | One operational batch for actionable CLI errors, maintenance of ephemeral bookkeeping, high-value audit coverage, quiet/dry-run/export operations, and native operator guidance. |
| #114, #121 | One portable SQL-shape batch that bounds candidates before correlated hydration; no scheduler or provider abstraction. |
| #79, #82 | Close as umbrella issues after every referenced focused issue has its own resolution; no second competitive or HA framework. |
| #86 | Close after #84/#85: score components are relative candidate signals, while zero-result noise and fixed packing were the current defects. |
| #89 | Close after #88/#91: authorized compile already covers search without duplicating the retrieval API or removing required subject scope. |
| #96 | Close as duplicate of #80. |
| #80, #81, #87, #90 | Close not planned: explicit conflict evidence, the current remote MCP boundary, full explainability, and host support remain deliberate until their recorded triggers occur. |
| #115 | Close the in-core token-bucket proposal not planned; rate limits stay at authenticated ingress where Cloudflare and VPS controls are authoritative. |
| #117 | Close not planned because Actions are intentionally disabled to keep the repository free of hosted automation cost; publication remains manual. |
| #123 | Record and retain the single-process ceiling, then close worker pools/sharding until measured small-team demand breaches it. |
| #124 | Make FULL durability explicit and retain synchronous context-run evidence; close NORMAL/async persistence as incompatible with acknowledged-write and feedback provenance requirements. |
| #133 | Reject non-object 2xx JSON envelopes once in `requestWithMeta()`; cover every JSON top-level shape and typed callers, then include the compatible correction in the combined `0.4.0` release. |
| #137 | Validate all untrusted embedding output once in shared code; require exact cardinality, ordered unique contiguous provider indices when present, dense configured dimensions, and finite numeric coordinates before either runtime can query or mutate a vector index. |
| #138 | Distinguish intentional FTS-only operation from configured semantic failure; persist/compare the migration-13 index fingerprint, fail local readiness closed on incompatible or unavailable vector state, and expose separate embedding/extraction/background capability fields without implementing planned enrichment. |
| #140 | Keep the default package dependency-free, publish one explicit `sqlite-vec@0.1.9` install command, and exercise both missing-dependency failure and vector-ready success from the clean packed consumer. |
| #141 | Make omitted project scope select only unscoped claims; add explicit `cross_project` mode guarded by `context:compile:all`, report `project_mode` and the capability-backed broad reason, and make every distributed agent skill resolve a repository project before compile. |
| #142 | Close not planned: bounded operator inspection/lifecycle/purge already use Atlas and privileged REST/audit surfaces, while ADR-0003 explicitly rejects widening ordinary-agent MCP with operator projections. Reopen only for a concrete missing operator workflow with exact scope and authority. |
| #102 recurrence | Keep the atomic UPSERT and handoff fence; retain safe diagnostics for each unexpected D1 contention response, keep the issue open until isolated repeated evidence classifies the recurrence, and add no product retry without a reproducible database failure. |
| #144, #155 | Use one explicit fingerprinted role-aware embedding policy and absolute cosine gate before the existing relative ranker; require operator calibration and never ship the inspected threshold as a universal default. |
| #157 | Serialize the manual local D1 lane with a host-wide owner lock, remove the hidden provisioning retry, preserve bounded run/case/workerd diagnostics, and keep the still-required real D1 smoke distinct from emulator evidence and #102. |
| #166 | Remove the Node 22 file-parent timeout conflict; retain 20-second ordinary case/hook bounds and only the measured 60-second semantic-readiness exception, then prove controlled-failure cleanup without changing product behavior. |
| #162 | Fence `index_outbox` work with one expiring SQL owner shared by manual and background drains; stale completion/failure becomes a no-op and no queue framework or dependency is added. |
| #167 | Reduce owned work to one canonical repair before each external upsert/removal, retain it across stale or ambiguous outcomes without retry amplification, and count only ownership-confirmed work. |
| #169 | Use database-authoritative eligibility and expiry at every conditional claim so earlier work or caller skew cannot create an expired or stranded owner. |

## Acceptance evidence mapping

- AC-SWP-001: issue resolution matrix plus final GitHub issue audit and linked
  commits, duplicate targets, or not-planned comments.
- AC-SWP-002: focused regression tests and shared dual-runtime/security gates for
  every qualifying defect.
- AC-SWP-003: branch divergence review, pull-request review/merge records, and
  final remote branch list.
- AC-SWP-004: README diff, direct website smoke, packaged README inspection, and
  clean npm-page-compatible link audit.
- AC-SWP-005: strict `seng-jelas` output, package verification, and capability
  claim review against the roadmap maturity matrix.
- AC-SWP-006: repository Actions permission, absence of workflow files, and
  manual command evidence.
- AC-SWP-007: changelog diff, package version, annotated tag peel, GitHub release,
  npm registry metadata, and exact source commit.
- AC-SWP-008: focused/full command transcript with all exit statuses recorded in
  the terminal plan evidence.
- AC-SWP-009: clean registry install, SDK import, installed CLI/bootstrap/readyz,
  MCP negotiation, npm version, and digest evidence.
- AC-SWP-010: before/after status, branch pointer, diff hashes, untracked hashes,
  and stash object IDs for the original checkout.
- AC-SWP-011: table-driven SDK tests for array, `null`, string, number, boolean,
  and valid object responses through both `requestWithMeta()` and a typed
  convenience method, including `TitenError` status/request-ID/metadata checks.
- AC-SWP-012: changelog and package version diff, frozen-lockfile verification,
  focused SDK and package gates, annotated-tag peel, npm/GitHub metadata, and
  clean `0.4.0` registry smoke against the exact reviewed source.
- AC-SWP-013: table-driven adapter and normalized-core validator cases plus Bun
  HTTP, Cloudflare Workers AI, and injected-provider regressions for missing/
  extra/index/sparse/type/finite/dimension failures, no vector query or write,
  pending state/count preserved while only safe attempt/failure evidence changes,
  sanitized `503` metadata, and successful authorized FTS-only compile.
- AC-SWP-014: dual-runtime FTS-only readiness tests plus a clean production
  install without `sqlite-vec` or semantic configuration.
- AC-SWP-015: table-driven partial/invalid configuration, missing
  extension/backend/schema, fingerprint mismatch, independent and combined
  observed dependency markers, cross-organization non-clear, delete-only
  non-recovery, pre-v14 sanitized readiness, and manual/background recovery;
  the marker lifecycle runs through the shared Bun/D1 contract without provider
  I/O or sensitive diagnostics.
- AC-SWP-016: migration-13 schema inspection, first-initialization persistence,
  exact fingerprint comparison, mismatch recovery only after an explicit
  reindex, and dual-runtime contract evidence.
- AC-SWP-017: API/reference schema assertions for independently versioned
  embedding, extraction, and background-enrichment fields plus the deprecated
  `model` compatibility alias.
- AC-SWP-018: readiness-path inspection and tests proving no embedder/provider
  call occurs while local configuration, migration, vector, and fingerprint
  state are checked.
- AC-SWP-019: README/VPS instructions naming `sqlite-vec@0.1.9`, clean packed
  consumer smokes before and after installing it, and the focused semantic
  readiness matrix.
- AC-SWP-020: dual-runtime contract fixtures with unscoped and two project-
  scoped claims plus vector metadata proving omitted `project_id` cannot nominate
  or hydrate either project.
- AC-SWP-021: dual-runtime REST/MCP fixtures for explicit capability denial and
  grant, mutual-exclusion validation, two organizations/subjects/principals/
  projects, private/team/organization visibility, membership removal, foreign
  project substitution, and exact effective-scope response metadata; SDK shape
  and request tests cover the additive public contract.
- AC-SWP-022: portable-skill copy parity and OpenClaw host-kit integration test
  proving repository scope is resolved before compile and cross-project mode is
  never the default.
- AC-SWP-023: exact aggregate concurrent checkpoint assertions plus safe
  status/error diagnostics for each unexpected response and one durable head;
  the unclassified #102 recurrence remains distinct from #157 emulator
  transport failures.
- AC-SWP-040: atomic owner-lock regression plus a controlled overlapping process
  showing safe owner metadata, immediate contender rejection, unchanged owner,
  unique process persistence/port-zero configuration, and release only after
  awaited Miniflare disposal with no owned workerd child remaining.
- AC-SWP-041: direct inspection proving the retry is removed, injected harness-
  failure coverage for bounded redacted stderr and run/case identity, the
  20-second default plus the measured 60-second semantic-readiness bound,
  old-versus-current pinned emulator evidence, unchanged product assertions,
  five predeclared complete isolated D1 runs, and the separate disposable real
  D1/Worker smoke with exact cleanup.
- AC-SWP-042: manifest inspection proving no file-level timeout, direct source
  inspection of 20-second ordinary case/setup/teardown bounds and the sole
  60-second semantic-readiness exception, complete Node 22 and default-runtime
  transcripts, and a controlled failing-child transcript proving nonzero exit,
  persistence removal, and no owned workerd residue.
- AC-SWP-043: remote inventory plus exact disposable resource names, schema and
  synthetic authenticated smoke results, one checkpoint head and one handoff
  winner under concurrency, followed by inventory proving both exact resources
  were deleted and no route or persistent deployment remains.
- AC-SWP-050: shared policy unit tests plus Bun HTTP, Workers AI, injected-
  provider, fingerprint-mismatch, explicit-reindex, zero/non-finite-vector, and
  configuration regressions proving exact query/document transforms and unit
  normalization on both runtimes.
- AC-SWP-051: dual-runtime hard-negative fixtures proving sub-threshold IDs are
  not hydrated or exposed, above-threshold vector recall still works, FTS-only
  and lexical recall remain unchanged, scope/provenance hold, and public output
  contains no raw score or calibration setting; immutable calibration reports
  distinguish inspected evidence from any untouched holdout.
- AC-SWP-070: migration-16 schema inspection plus owner-token conditional claim,
  completion, and failure assertions through the shared Bun/D1 contract.
- AC-SWP-071: deterministic expired-owner takeover barrier proving the late
  loser leaves row attempts and safe dependency timestamps unchanged, followed
  by an idle local readiness check with zero provider calls.
- AC-SWP-072: genuine owned embedder/vector failure and retry evidence plus
  delete-only and cross-organization non-clear regressions.
- AC-SWP-073: Bun/SQLite and Miniflare/D1 manual/manual and manual/background
  overlap runs, sanitized persistence inspection, and bounded `/readyz`
  assertions.
- AC-SWP-074: shared post-embed/pre-upsert purge barrier proving the stale owner
  reports zero indexed records, the revoked vector remains absent, and durable
  delete work survives process restart until confirmed.
- AC-SWP-075: Bun/SQLite and Miniflare/D1 upsert/remove stale-success,
  apply-then-throw, process-stop, and manual/background takeover matrices,
  ownership-confirmed response counts, cross-organization SQL inspection, and
  secret/raw-data scans.
- AC-SWP-076: dual-runtime blocked-delete and earlier-organization barriers,
  exact lease-duration inspection, and zero contender provider calls.
- AC-SWP-077: table-driven independent forward/backward caller epochs at manual
  and background claim boundaries, database-clock expiry assertions, and
  empty-ID no-op.
- AC-SWP-078: six-failure manual and background probes with exact pending-row
  counts and vector-store call counts, plus a focused isolated test run.
- AC-SWP-079: dual-runtime removal-only failure/retry inspection proving the
  queue drains, only vector-store evidence clears, and `/readyz` returns healthy.

## Security, migration, deployment, smoke, and rollback

Issue fixes may cross authentication, migrations, Cloudflare D1, Bun/SQLite,
and canonical export/import boundaries. Each such fix must fail closed and run
the same shared contract where applicable. No production service deploy is part
of this release; npm and GitHub are the publication surfaces.

Migration 13 adds only semantic index metadata; SQL remains canonical and
vectors remain rebuildable. A semantic fingerprint mismatch is not repaired
implicitly: rollback is disabling semantic configuration for explicit FTS-only
operation or running the documented reindex path with the intended fingerprint.
Migration 14 adds only two nullable dependency-failure timestamps to the
singleton semantic metadata row. Delete-only completion or retirement cannot
clear them; disabling semantic configuration remains the fail-closed rollback.
Retrieval profile and cosine-floor changes reuse the existing preprocessing
fingerprint field, add no canonical schema, and require the same explicit
rebuild/requeue path before readiness can recover.
Migration 16 adds only nullable owner-token and lease-expiry columns to the
rebuildable `index_outbox` and does not infer recovery or clear durable
dependency markers. Rollback before publication is a reviewed revert;
after migration, stop all index drains before starting an older binary, which
ignores the additive columns. The pending rows remain canonical-SQL-derived and
retryable, but mixed old/new index consumers are not a supported rollback mode.

Before merge, rollback is branch deletion. After merge and before npm publish,
rollback is a reviewed revert. After npm publish, a bad immutable artifact must
be deprecated and replaced by a corrected patch; unpublish is not the rollback
plan. The user's original dirty checkout is never a release source or rollback
mechanism. The D1 lane lock owns only its tokenized temporary directory and
Miniflare instances; rollback removes the harness change, never a sibling lock,
process, database, or remote Cloudflare resource.
