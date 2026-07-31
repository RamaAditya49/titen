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
---
# Open issue sweep and npm release

## Problem

The public repository has 44 open issues, one unmerged documentation branch,
and no open pull request. `main` is ahead of the published `titen-memory@0.2.1`
package and contains an unreleased agent-distribution batch. The original local
checkout also contains older dirty work that must not be reset, overwritten, or
mistaken for current release source.

After `titen-memory@0.3.0` was published, issue #133 demonstrated that a 2xx
response containing valid JSON with an array or primitive top-level value is
silently accepted as a successful SDK envelope. The correction requires the
smallest compatible patch release, `0.3.1`. Any terminal closure drafted for
the `0.3.0` sweep is withdrawn; this pair remains active until the patch has
verified publication evidence.

Issue #137 subsequently demonstrated that both embedding adapters trust
successful provider payloads too far: missing or extra outputs, invalid
provider indices, and sparse or non-finite vectors can reach the rebuildable
semantic-index path. Post-merge review also proved that the documented injected
`EmbeddingProvider` boundary can bypass adapter validation. The same patch
candidate must validate normalized provider results in shared core immediately
before query or mutation while retaining canonical SQL, FTS, and retryable index
work.

Issue #138 then demonstrated that a configured semantic deployment can report
ready while silently falling back to FTS because invalid embedding settings,
an unavailable vector backend, and an incompatible vector fingerprint are not
distinguished from an intentionally unconfigured FTS-only deployment. Review of
the merged local-readiness fix further proved that a scheduler-observed embedder
or vector-store failure is retained only as pending work and does not change
`/readyz`; readiness must project that safe durable failure evidence without
probing the provider.

Issue #140 requires the public npm path to prove both sides of that contract:
the default tarball must stay dependency-light, while following the documented
explicit `sqlite-vec@0.1.9` install must make the same packed artifact report a
healthy local vector capability.

Issue #141 demonstrated that omitting `project_id` from context compilation is
currently translated into a wildcard predicate. A caller intending unscoped
memory can therefore receive otherwise-visible claims from every project in the
authenticated organization. The patch must make omission unscoped-only and
reserve cross-project compilation for an explicit request backed by a separate
credential capability.

Issue #102 was reopened after one complete Cloudflare/D1 contract run returned
only ten successful updates from twelve concurrent checkpoint saves. Isolated
repetition did not reproduce the result, so the release gate must retain the
status and safe error envelope of every loser, distinguish a product race from
a Miniflare/runtime transient, and never hide an unexplained non-success behind
an aggregate count.

Issues #144 and #155 expose one retrieval-quality boundary. Titen currently
sends the same raw text for index documents and queries, then rescales the best
available vector candidate to `1` even when its absolute similarity is near
zero. The EmbeddingGemma challenger proved that its official asymmetric prompts
materially improve the locked fixture, but the inspected threshold is not a
portable default. The runtime therefore needs one explicit, fingerprinted
profile and revision plus an operator-calibrated absolute cosine floor before
relative ranking; no model-independent threshold may be invented.

Issue #157 separately records complete Cloudflare/D1 contract runs that receive
invalid synchronous Miniflare RPC text or hang only when exercised as part of
the aggregate lane. Some failures coincided with other worktree validations,
while named reruns passed. The manual gate must therefore reserve one host-wide
workerd lane, preserve bounded emulator diagnostics without retry, and prove
that an overlapping runner cannot disturb or terminate the owner. This harness
work does not classify or close the independent checkpoint race in #102. A
controlled isolated run subsequently reproduced the invalid RPC on the pinned
`miniflare@4.20260722.1`/`workerd@1.20260722.1`, ruling out overlap as the sole
trigger; the smallest emulator correction is verification against the current
official `miniflare@4.20260730.0`/`workerd@1.20260730.1` pair, not a product
retry.

Issue #166 then reproduced a deterministic Node 22 host defect in the updated
manual gate: the file-level `--test-timeout=20000` expires before the one
measured semantic-readiness case may use its 60-second child timeout. Node
cancels the parent, skips normal teardown, and leaves that run's persistence
directory behind. The gate must put the 20-second bound on ordinary cases and
hooks themselves, retain 60 seconds only for semantic readiness, and impose no
shorter parent timeout.

Treating every report as a feature request would add speculative machinery;
closing every report without checking it would hide real defects. The release
needs an issue-by-issue resolution, current branch integration, accurate public
documentation, and an install smoke against the immutable npm artifact.

## In scope

- Reproduce and classify every issue open at the start of the sweep against the
  current `origin/main` source.
- Fix current correctness, security, data-integrity, portability, validation,
  and bounded performance defects at their shared root with focused regression
  evidence.
- Resolve post-release P0 replacement blocker #136 with the accepted ADR-0004
  background-enrichment design: optional derivation/reflection jobs, local
  fail-closed validation, and no model dependency on canonical writes or recall.
- Resolve #148–#150 within #136 through compatible leasing, hashed output
  provenance, an explicit Cloudflare query budget, and a versioned atomic
  enrichment export/import contract.
- Close exact duplicates against their surviving issue and close unsupported or
  speculative work as not planned only with a concrete current ceiling,
  conflict, or missing requirement.
- Review the unique commits on every remote topic branch; integrate valid work
  through a reviewed pull request or document why it is superseded before
  removing the remote branch.
- Rewrite the public README for an international open-source audience, link
  `https://titen.dev` prominently, preserve shipped-package link constraints,
  and run the `seng-jelas` prose checker.
- Select the smallest SemVer release justified by the merged batch, publish the
  exact verified candidate to npm, create the matching annotated tag and GitHub
  release, and smoke the registry artifact.
- Reject non-object successful SDK envelopes at the shared response boundary,
  preserve diagnostic status, request ID, and safe response metadata in the
  resulting `TitenError`, and publish the verified correction as `0.3.1`.
- Validate Bun HTTP, Cloudflare Workers AI, and injected embedding-provider
  output through shared adapter parsing plus one normalized core boundary before
  any vector query or mutation can consume it.
- Make semantic readiness fail closed when embedding or vector operation is
  requested but cannot be initialized safely; persist and compare the minimum
  compatible index fingerprint while preserving intentional FTS-only startup.
- Persist only the dependency kind and time after an indexing failure, project
  it into local readiness, and clear it only after a later complete embed/upsert
  succeeds; never store provider output or require a readiness network call.
- Bind the Bun fingerprint to a credential-free digest of the normalized
  embedding endpoint, refuse a vector file that aliases the canonical database,
  and require explicit requeue before historical FTS-only claims can be called
  semantically ready.
- Expose separate versioned `embedding`, `extraction`, and
  `background_enrichment` readiness fields, retain the ambiguous `model` field
  only as a deprecated compatibility alias, and document the explicit Bun
  vector dependency.
- Exercise the packed npm artifact first without and then with the documented
  vector dependency so the public quick start proves fail-closed and healthy
  semantic initialization from a clean consumer tree.
- Make missing `project_id` compile only records whose canonical project is
  absent; require explicit cross-project mode plus separate authority for a
  broader compile, and report the effective project mode and grant reason.
- Keep REST, SDK, MCP, and the portable OpenClaw-compatible skill aligned so a
  repository task resolves and supplies its canonical project by default.
- Diagnose the reopened D1 checkpoint contention result from complete-suite
  evidence; keep the one-head invariant and make expected concurrent outcomes
  explicit without weakening the canonical integrity assertion.
- Apply one shared role-aware embedding profile before every query/document
  provider call, normalize validated vectors to unit length, and fingerprint
  the exact versioned transform with the immutable model revision.
- Require an explicit calibrated cosine floor, fingerprint it with the profile,
  discard sub-threshold semantic hits before hydration/ranking, and keep
  authorized lexical recall and successful empty packs unchanged.
- Isolate the complete local D1 contract behind a host-wide owner lock, retain
  unique temporary persistence and kernel-assigned ports, capture bounded safe
  workerd diagnostics with run/case identity, and remove the existing hidden
  provisioning retry; pin the verified current Miniflare/workerd patch pair if
  the old emulator reproduces invalid RPC while isolated.
- Make the same manual D1 gate portable across every supported Node 22-or-newer
  host by bounding ordinary cases and hooks at 20 seconds, retaining the
  measured 60-second semantic-readiness bound, and always disposing the owning
  runtime and persistence after a controlled child failure.
- Preserve the user's dirty original checkout and existing stash byte-for-byte.

## Out of scope

- GitHub Actions, automated deployment, or automated npm publication.
- A graph database, queue service, ORM, provider factory, dependency-injection
  container, or new framework.
- Multi-process SQLite, native host memory providers, automatic model-driven
  contradiction inference, or other architecture whose issue provides no
  accepted throughput, adopter, quality, or lifecycle requirement.
- Network provider probes on `/readyz`, automatic reindex after an embedding
  fingerprint change, or implementation of planned extraction/enrichment.
- A universal vector threshold, an implicit raw-text EmbeddingGemma profile, or
  publication of the already inspected challenger threshold as a safe default.
- Publishing the externally blocked ClawHub bundle unless the upstream
  inspector accepts the already validated package during this work.
- Retrying a failed D1 assertion, changing product checkpoint/lease behavior,
  closing #102 through harness evidence, or creating, deleting, migrating, or
  deploying a Cloudflare resource for the local isolation fix.
- Raising the timeout of ordinary D1 cases or adding a file-level parent
  timeout.
- Changing or cleaning the original dirty checkout.

## Constraints and risks

- Repository source and current runtime evidence override issue wording and old
  memories. Issue labels alone do not prove a defect.
- Authorization, validation, durability, and data-loss safeguards cannot be
  removed to make a benchmark pass.
- npm publication is effectively irreversible after 72 hours. The candidate
  must be packed, installed, and exercised before publication.
- Parallel agents work in isolated worktrees and commit with the repository's
  required attribution. Integration happens once on the release branch.
- Titen does not use GitHub Actions so the repository incurs no hosted
  automation cost; issue #117 cannot override that project decision without a
  new direct maintainer decision and budget.
- The dashboard remains synthetic where current docs say it is synthetic. A
  polished website is not runtime evidence for the memory API.
- Readiness must remain a bounded local check. Configuration and stored index
  metadata may be inspected, but `/readyz` must not call a model provider.

## Acceptance criteria

- **AC-SWP-001 — Event-driven:** When an issue that was open at sweep start is
  evaluated against current `main`, Titen shall record one public resolution:
  a merged root-cause fix with reproducible evidence, an exact duplicate target,
  or a concrete not-planned reason tied to a current product decision or
  unobserved upgrade trigger.
- **AC-SWP-002 — Unwanted behavior:** If a current report can produce
  unauthorized access, data loss, invalid canonical state, a wrong successful
  result, or a server error from bounded client input, then Titen shall fail
  closed at the shared boundary and a focused test shall fail without the fix.
- **AC-SWP-003 — Event-driven:** When a remote topic branch contains unique
  valid work, Titen shall integrate it through a reviewed pull request and
  verify the merged result before deleting only that merged branch; superseded
  branches shall be removed only after their unique commits are accounted for.
- **AC-SWP-004 — Event-driven:** When a reader opens the repository or the npm
  package README, Titen shall present a concise English open-source entrypoint,
  a working `https://titen.dev` link, runnable installation and first-use steps,
  truthful runtime and maturity boundaries, and absolute links for files omitted
  from the npm tarball.
- **AC-SWP-005 — Unwanted behavior:** If the README contains a `seng-jelas`
  strict finding, a repository-relative packaged link, or an unsupported live
  capability claim, then the release candidate shall fail its documentation or
  package gate.
- **AC-SWP-006 — Ubiquitous:** Titen shall keep GitHub Actions disabled and
  shall perform verification, integration, publication, and release evidence
  through the documented manual workflow so the repository has no hosted
  automation cost.
- **AC-SWP-007 — Event-driven:** When the merged batch is ready to release,
  Titen shall choose the smallest SemVer bump allowed by the highest public API
  impact, move the exact `Unreleased` entries under that version, and make
  `package.json`, the annotated tag, GitHub release, and npm version identify the
  same source.
- **AC-SWP-008 — Unwanted behavior:** If any focused test, dual-runtime
  contract, integration test, dashboard check, workflow check, package smoke,
  production dependency audit, or diff check fails, then Titen shall not publish
  the npm candidate.
- **AC-SWP-009 — Event-driven:** When npm accepts the candidate, a clean
  registry install shall import both SDK exports, run the installed CLI,
  bootstrap and serve schema-ready storage, negotiate MCP, and report the
  expected public version and digest.
- **AC-SWP-010 — Ubiquitous:** Titen shall leave the original checkout's tracked
  modifications, untracked files, branch pointer, and stash unchanged throughout
  the sweep.
- **AC-SWP-011 — Unwanted behavior:** If a 2xx SDK response contains valid JSON
  whose top-level value is an array, `null`, string, number, or boolean, then
  `requestWithMeta()` and typed convenience methods shall reject it with a
  `TitenError` whose code is `INVALID_RESPONSE` and which preserves the HTTP
  status, request ID, and any safe response metadata available at that boundary.
- **AC-SWP-012 — Event-driven:** When the issue #133 regression evidence passes,
  Titen shall publish the same verified source as the backward-compatible
  `0.3.1` npm patch, annotated tag, and GitHub release; valid object envelopes
  shall retain their current behavior.
- **AC-SWP-013 — Unwanted behavior:** If an embedding provider returns anything
  other than exactly one dense configured-dimension vector per input containing
  only finite JavaScript numbers, or supplies indices that are not unique,
  contiguous, and in input order, then shared adapter parsing and the normalized
  core consumer boundary shall reject the output as a sanitized retryable
  embedder dependency failure, write or query no vector, leave selected index
  work pending, and keep authorized FTS recall available. The rule shall also
  hold for a caller-supplied `EmbeddingProvider` that bypasses built-in adapters.
- **AC-SWP-014 — Optional feature:** Where no embedding or vector capability is
  configured, Titen shall keep `/readyz` ready with FTS `enabled` and semantic
  capabilities explicitly `disabled`.
- **AC-SWP-015 — Unwanted behavior:** If embedding configuration is partial or
  invalid, a configured vector backend cannot initialize its extension,
  database, or schema, the vector path aliases canonical SQL, historical active
  claims lack reindex work, restored canonical metadata points at a newly
  created empty vector projection, or the active index fingerprint is
  incompatible with stored metadata, or indexing has durably observed an
  embedder/vector-store failure not followed by a successful embed/upsert, then
  Titen shall return `ready: false`, mark the affected semantic capability
  `configured_error`, and expose only a sanitized local diagnostic.
- **AC-SWP-016 — Event-driven:** When a semantic index is first initialized,
  Titen shall persist a fingerprint containing credential-free provider
  endpoint identity, model, revision, dimensions, metric, preprocessing
  version, and index-schema version; when a later configuration differs, Titen
  shall require an explicit reindex before semantic readiness can recover.
- **AC-SWP-017 — Ubiquitous:** Titen shall expose independently versioned
  `embedding`, `extraction`, and `background_enrichment` capability fields,
  shall retain `model` as a deprecated embedding compatibility alias for the
  `0.3.x` contract, and shall not present planned extraction or enrichment as
  enabled.
- **AC-SWP-018 — Ubiquitous:** Titen shall determine `/readyz` from bounded
  local configuration, path, schema, extension, fingerprint, and missing-work
  existence checks without a provider network request or unbounded backfill.
- **AC-SWP-019 — Event-driven:** When an operator configures Bun vector
  retrieval for `0.3.x`, the deployment documentation shall require an
  explicit optional peer `sqlite-vec@0.1.9` install and the packed-artifact
  regression shall cover a clean FTS-only install, the configured
  missing-dependency error, and healthy semantic initialization after following
  that exact install command; focused tests shall also cover fingerprint
  mismatch.
- **AC-SWP-020 — Unwanted behavior:** If context compilation omits `project_id`,
  then Titen shall compile only canonical unscoped claims; it shall never treat
  omission as permission to retrieve project-scoped candidates through FTS,
  vector query, or vector hydration.
- **AC-SWP-021 — Event-driven:** When a caller explicitly requests
  cross-project compilation, Titen shall require both ordinary compile authority
  and a separate broad-compile capability, reject a simultaneous project ID,
  retain organization, subject, visibility, membership, lifecycle, and temporal
  policy, and return the effective project mode plus the capability-backed broad
  access reason through REST, SDK, and MCP parity.
- **AC-SWP-022 — Ubiquitous:** Titen's portable agent guidance, including the
  OpenClaw distribution, shall resolve the active canonical project and pass its
  opaque ID for repository work; it shall use unscoped compilation only outside
  a project and shall not request cross-project mode by default.
- **AC-SWP-023 — Event-driven:** When concurrent checkpoint saves are exercised
  through the Cloudflare/D1 contract, every unexpected non-200/201 response
  shall be retained in assertion-failure evidence, exact aggregate status
  counts shall remain asserted, exactly one durable head shall remain, and no
  unexplained non-success shall be hidden behind an aggregate count.
- **AC-SWP-040 — Event-driven:** When a local Cloudflare/D1 contract process
  starts, Titen shall acquire one host-wide owner lock before starting
  Miniflare, use process-owned temporary persistence and kernel-assigned
  loopback ports, and release the lock only after its own runtimes are disposed;
  an overlapping process shall fail fast with safe owner/run/worktree identity
  without signalling, disposing, or deleting any sibling resource.
- **AC-SWP-041 — Unwanted behavior:** If a local Miniflare/workerd operation
  returns invalid RPC data, exits, or exceeds its bounded case limit of 20
  seconds (60 seconds only for the measured multi-phase semantic-readiness
  case), then the D1 contract shall fail that run without retry and preserve
  its run, phase or case, original error, and bounded redacted workerd stderr;
  the gate shall use the exact verified Miniflare/workerd patch pair, product
  assertions shall remain unchanged, five predeclared complete isolated runs
  shall pass before release, and this local evidence shall not be presented as
  a real Cloudflare D1 smoke.
- **AC-SWP-042 — Ubiquitous:** The manual Cloudflare/D1 gate shall run under
  every supported Node 22-or-newer host without a file-level timeout shorter
  than a child case; every ordinary case plus setup and teardown shall retain a
  20-second ceiling, only semantic readiness shall receive 60 seconds, all 94
  product assertions shall remain unchanged, and a controlled failing child
  shall exit nonzero after removing its owned persistence and workerd runtime.
- **AC-SWP-050 — Unwanted behavior:** If semantic retrieval is configured, then
  Titen shall require an immutable model revision, a supported named/versioned
  role-aware preprocessing profile, and an explicit finite cosine floor; the
  shared core shall apply the document/query transforms exactly once, reject
  zero/non-finite vectors, normalize them to unit length, and fingerprint the
  profile plus threshold so a change requires explicit reindexing. An
  EmbeddingGemma model shall not run under the raw profile.
- **AC-SWP-051 — Unwanted behavior:** If every authorized vector hit is below
  the configured absolute cosine floor, then Titen shall hydrate none of those
  hits and shall never turn the best bad neighbor into positive relevance by
  relative normalization. FTS-only behavior, lexical candidates, authorization,
  provenance, and the successful empty-pack contract shall remain unchanged,
  and public responses shall not expose the threshold or raw provider scores.

## Done conditions

Every issue open at sweep start has one evidenced public resolution; no pull
request remains open; only branches with explicitly unresolved unique work may
remain; all merged temporary branches are removed; the README and release docs
match the shipped artifact; every mapped gate passes; npm `latest`, the
annotated tag, the GitHub release, and the release commit agree; a clean install
smoke passes; the original dirty checkout is unchanged; and this spec and its
paired plan move to `done` with terminal evidence. The post-release issue #133
is resolved by the verified `0.3.1` patch rather than by altering the immutable
`0.3.0` artifact. Issue #137 is resolved only after malformed-output regressions
pass against the shared validator and both runtime paths. Issue #138 is resolved
only after configured semantic failures and fingerprint mismatches fail local
readiness closed while intentional FTS-only operation remains ready. Issue #141
is resolved only after both runtimes prove default unscoped-only retrieval,
explicit capability-gated broad retrieval, and denial of foreign project,
subject, principal, membership, and visibility substitutions across REST and
MCP. Issue #157 is resolved only after the overlap regression, five predeclared
complete isolated D1 runs without retry, owned-runtime teardown evidence, and a
separately authorized read-only real D1 smoke; none of that evidence resolves
the still-independent #102 product assertion. Issue #166 is resolved only after
the complete lane passes on Node 22 and the default supported Node runtime and a
controlled failure proves owned-resource cleanup; that compatibility evidence
does not replace #157's real D1 smoke.
Issues #144 and #155 are resolved only after both runtime adapters share the
same role-aware profile and absolute-gate contract, fingerprint changes fail
readiness until explicit reindex, deterministic hard-negative regressions pass,
and any published calibrated default has separate untouched-holdout evidence.
