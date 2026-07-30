---
work_id: all-open-issues-release-hardening
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-07-30
updated: 2026-07-30
review_after: 2026-08-13
owner: CADIS
---
# All-open-issues release hardening

## Problem

The public `0.1.2` surface has 34 open issues covering authorization, data
integrity, runtime recovery, adapters, operator workflow, client safety,
packaging, and deployment truth. Several features are advertised beyond their
verified security boundary. The next release must resolve the open set from one
fixed cutoff without hiding incomplete work behind issue closure.

## Issue cutoff and classification

The release cutoff is every issue open immediately before the release tag,
starting with #9, #11, #13, #15-#18, #20-#24, #31-#41, #48, #54-#56,
#59-#60, and #63-#67. New issues opened before tagging enter this spec through
an updated issue matrix and acceptance mapping.

The current batch groups the root causes as follows:

- storage and recovery: #9, #11, #33, #40, #66;
- authorization and integrity: #20-#22, #24, #35, #37-#39;
- delivery security and durability: #23, #32, #41, #48;
- retrieval and adapter parity: #31, #34, #36, #65;
- CLI, SDK, and package safety: #54-#56, #59-#60, #63-#64, #67;
- deployment evidence and test reliability: #13, #15-#18.

## Scope

- Make canonical migrations, imports, lifecycle changes, leases, idempotency,
  checkpoints, retrieval, projections, webhook work, and secret storage
  fail-closed at their actual trust and transaction boundaries.
- Bind team data to workspaces and active membership before candidate selection.
- Withdraw incomplete v0.3 policy/channel routes and capability claims rather
  than ship inert policy rows or caller-selected customer identity.
- Use read-only canonical projections for operator review; do not add a generic
  work-item database or a second orchestration system.
- Make MCP delegate to shared application operations and keep vector scope
  filtering equivalent across runtimes.
- Harden the existing CLI, thin SDK, README, and installed-tarball verifier
  without a parser framework, generated SDK, or npm-private API.
- Check in and document the verified rootless deployment path, keep loopback as
  the default, and record current live image/WAL/restart evidence honestly.
- Reconcile every cutoff issue with a specific closure comment containing the
  root cause, fix or disposition, merged commit, and reproducible evidence.
- Remove merged or explicitly obsolete branches after enumerating them; retain
  any branch or worktree with unique unabsorbed work.
- Cut version `0.2.0`, publish the exact verified commit to npm and GitHub, and
  keep GitHub Actions disabled.

## Out of scope

- A complete enterprise retention/legal-hold/approval policy engine.
- A customer-channel gateway before signed identity, immutable releases, and
  independent approval have an accepted future spec.
- A generic task queue, agent-loop runner, workflow engine, or dashboard as
  proof of canonical service behavior.
- Exactly-once outbound HTTP delivery; receivers get stable idempotency IDs and
  documented at-least-once delivery.
- A new ORM, queue, cache, database, dependency injection layer, CLI parser,
  SDK generator, KMS vendor, or GitHub Actions workflow.
- Publicly opening a host firewall without an explicit operator choice.

## Constraints and risks

- SQL remains canonical and portable across D1 and SQLite; projections are
  rebuildable and may be requeued after additive migration.
- Authorization must execute before count, ordering, limiting, hydration, and
  serialization. Unauthorized existence is not reported as a count or ID.
- Migration, import, lease, lifecycle, and delivery state transitions require
  atomic winner semantics and fail-closed recovery tests.
- External signing keys stay outside canonical SQL and exports. Missing keys
  disable the affected operation without exposing ciphertext or plaintext.
- The existing dirty deployment worktree and unique live branch are user work
  and must not be overwritten or deleted.
- Rebooting `rama-tuf` is destructive to an in-use session and requires an
  explicit operator window. The release cannot claim #15 complete without it.
- npm publication is effectively permanent. A failed gate stops publication;
  a post-publication defect requires a newer release.

## Acceptance criteria

- **AC-RH-001 — Unwanted behavior:** If a required migration statement fails or
  concurrent startup loses migration ownership, then Titen shall leave a
  recoverable schema state, shall serve only health/readiness diagnostics, and
  shall not serve authenticated API traffic until schema verification succeeds.
- **AC-RH-002 — State-driven:** While a configured maintenance scheduler has a
  recent successful canonical pass, Titen shall report background repair as
  enabled; while evidence is absent, failed, or stale, it shall report a bounded
  stale or disabled state without a health-path network call.
- **AC-RH-003 — State-driven:** While Bun performs a bounded write loop, Titen
  shall keep the SQLite WAL within the documented explicit checkpoint policy and
  shall preserve canonical data across restart.
- **AC-RH-004 — Event-driven:** When a same-organization nonmember requests a
  team record, Titen shall return no record, identifier, evidence identifier,
  count, cursor effect, topology, event, or webhook delivery; removing membership
  shall deny access starting with the next request.
- **AC-RH-005 — State-driven:** While governed policy and channel acceptance
  gates are incomplete, Titen shall expose no shipped route, scope, or maturity
  claim implying those controls authorize production behavior.
- **AC-RH-006 — Event-driven:** When 20 principals concurrently acquire one
  resource lease, Titen shall persist exactly one active lease, return exactly
  one winner, preserve same-holder renewal, and deny non-holder release.
- **AC-RH-007 — Unwanted behavior:** If any import row is invalid, colliding,
  orphaned, unresolved, or outside the destination scope/trust contract, then
  Titen shall commit none of that import and shall leave canonical, FTS,
  history, source, event, audit, and vector-outbox state unchanged.
- **AC-RH-008 — Unwanted behavior:** If claim evidence or a replacement crosses
  an authorized workspace, subject, project, kind, visibility, or lifecycle
  boundary, then Titen shall reject it without side effects; lifecycle winners
  shall be fenced by expected version and cycles shall be rejected.
- **AC-RH-009 — Ubiquitous:** Titen shall scope idempotency to the authenticated
  credential and canonical method, concrete path, normalized query, and body;
  an ambiguous legacy record shall never replay another principal's response.
- **AC-RH-010 — Unwanted behavior:** If an agent addresses another agent's
  checkpoint without delegated authority, then REST and MCP shall return a
  non-disclosing response and shall write nothing.
- **AC-RH-011 — Event-driven:** When the same unique lexical term moves within a
  long bounded query, Titen shall select the same position-independent term set,
  retrieve the same exact claim, and report bounded truncation diagnostics.
- **AC-RH-012 — Unwanted behavior:** If a webhook destination is not an
  allowlisted HTTPS hostname or resolves/redirects to a prohibited address, then
  Titen shall reject it before outbound I/O on both runtimes.
- **AC-RH-013 — State-driven:** While webhook work is pending or leased, Titen
  shall atomically claim due attempts, bound outbound duration, recover expired
  claims, use a stable delivery idempotency ID, and reach success, retry, or
  terminal failure under documented at-least-once semantics.
- **AC-RH-014 — State-driven:** While a webhook or federation secret is enabled,
  Titen shall store only versioned authenticated ciphertext produced with an
  external runtime key; missing or wrong key material shall fail closed and no
  export, log, error, or audit detail shall reveal secret material.
- **AC-RH-015 — Optional feature:** Where vector retrieval is enabled, Titen
  shall index and prefilter by canonical organization, subject, and requested
  project before top-K on both runtimes, so closer foreign vectors cannot consume
  the authorized candidate window or appear in response metadata.
- **AC-RH-016 — Event-driven:** When equivalent supported operations run through
  REST and MCP, Titen shall use the same application commands and produce
  equivalent authorization, canonical state, events, audit, errors, and degraded
  capability metadata.
- **AC-RH-017 — Event-driven:** When an authorized operator compiles reviewer
  work, Titen shall return a stable authorized read projection over canonical
  claims, evidence, feedback, and audit without creating generic queue state;
  hidden records shall not affect items, counts, or cursors.
- **AC-RH-018 — Unwanted behavior:** If a CLI invocation requests help or
  contains an unknown flag, missing value, invalid integer, or out-of-range port,
  then Titen shall exit before opening a database/listener or generating state or
  credentials; documented help shall exit successfully and remain side-effect
  free.
- **AC-RH-019 — Unwanted behavior:** If SDK configuration or an HTTP response is
  invalid, empty, text, HTML, or malformed JSON, then the SDK shall return the
  documented field-specific configuration error or status-preserving
  `TitenError`, never a private implementation error or raw gateway body.
- **AC-RH-020 — Optional feature:** Where an SDK mutation accepts an idempotency
  option or no typed route wrapper exists, the SDK shall send the key exactly
  once and provide authenticated generic JSON/raw access without allowing
  authorization override.
- **AC-RH-021 — Event-driven:** When the candidate tarball is packed and installed
  with normal npm or a custom global prefix, every published README reference
  shall resolve, the installed `titen` binary shall execute, and verification
  shall not import npm private transitive modules.
- **AC-RH-022 — Ubiquitous:** Titen shall ship installable system and verified
  rootless deployment artifacts, use loopback-only publication by default,
  document SSH-tunnel and explicit firewall choices, and distinguish verified
  behavior from untested helpers or guessed limits.
- **AC-RH-023 — Event-driven:** When the operator approves a `rama-tuf` reboot,
  Titen shall return without manual service start, preserve the recorded event,
  report healthy schema and background repair, and pass the full live verifier;
  the measured image and vector behavior shall remain documented and verified.
- **AC-RH-024 — Ubiquitous:** Titen shall provide a deterministic local test
  command whose clean checkout completes every Bun and workerd contract without
  a disposed Miniflare cascade.
- **AC-RH-025 — Event-driven:** When implementation and all required evidence are
  complete, maintainers shall merge the reviewed change, comment on and close
  every cutoff issue with its specific reason and evidence, remove only
  enumerated merged/obsolete branches, and publish the exact verified `0.2.0`
  commit to npm and a matching GitHub release while Actions remains disabled.

## Done conditions

Every acceptance criterion has reproducible evidence; dual-runtime, integration,
browser, workflow, package-install, migration/import fault, and applicable live
smokes pass; all cutoff issues have explicit closure comments; no PR remains
open; branch cleanup preserves unique work; the version/tag/GitHub/npm artifacts
identify one commit; and this spec/plan pair moves to `done` with no unchecked
work.
