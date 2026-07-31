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
semantic-index path. The same patch candidate must reject malformed embedding
output at one shared boundary while retaining canonical SQL, FTS, and retryable
index work.

Issue #138 then demonstrated that a configured semantic deployment can report
ready while silently falling back to FTS because invalid embedding settings,
an unavailable vector backend, and an incompatible vector fingerprint are not
distinguished from an intentionally unconfigured FTS-only deployment.

Issue #140 requires the public npm path to prove both sides of that contract:
the default tarball must stay dependency-light, while following the documented
explicit `sqlite-vec@0.1.9` install must make the same packed artifact report a
healthy local vector capability.

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
- Validate Bun HTTP and Cloudflare Workers AI embedding output through one
  shared boundary before any vector query or mutation can consume it.
- Make semantic readiness fail closed when embedding or vector operation is
  requested but cannot be initialized safely; persist and compare the minimum
  compatible index fingerprint while preserving intentional FTS-only startup.
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
- Publishing the externally blocked ClawHub bundle unless the upstream
  inspector accepts the already validated package during this work.
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
  contiguous, and in input order, then the shared Bun/Cloudflare validator shall
  reject the output as a sanitized retryable embedder dependency failure, write
  no vector, leave selected index work pending, and keep authorized FTS recall
  available.
- **AC-SWP-014 — Optional feature:** Where no embedding or vector capability is
  configured, Titen shall keep `/readyz` ready with FTS `enabled` and semantic
  capabilities explicitly `disabled`.
- **AC-SWP-015 — Unwanted behavior:** If embedding configuration is partial or
  invalid, a configured vector backend cannot initialize its extension,
  database, or schema, the vector path aliases canonical SQL, historical active
  claims lack reindex work, restored canonical metadata points at a newly
  created empty vector projection, or the active index fingerprint is
  incompatible with stored metadata, then Titen shall return `ready: false`,
  mark the affected semantic capability `configured_error`, and expose only a
  sanitized local diagnostic.
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
readiness closed while intentional FTS-only operation remains ready.
