---
work_id: ponytail-zero-20260801
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-02
owner: maintainer
---

# Ponytail zero-debt release

## Problem

Titen 0.5.4 contains 22 deliberate `ponytail:` markers. Some identify real
public-runtime ceilings, while others describe work already implemented or a
boundary that should be an explicit product constraint. Leaving either kind in
the live ledger makes readiness ambiguous.

## Scope

Resolve every live marker through the smallest observable implementation,
test-backed product boundary, or current public distribution action. Preserve
the shared SQL-first core and thin Bun/Cloudflare adapters. Publish and smoke a
stable package and the supported public agent bundle when all local and live
gates pass. Rewrite the README's opening product story so an international open
source audience can understand Titen's Level 6 advantage before the install
details, without inflated or unsupported claims.

## Out of scope

- GitHub Actions or any other repository-cost automation.
- A provider factory, queue, ORM, graph database, Redis, or new framework.
- Automatic transcript capture, ambient lifecycle recall, or agent-loop
  execution.
- A Pi process extension without a supported remote MCP contract.
- Marketplace submissions where the vendor exposes no official self-service
  submission path.

## Constraints

- Authentication and organization scope precede retrieval or mutation.
- SQL remains canonical; vector data and compiled views remain rebuildable.
- Cloudflare uses native D1, Vectorize, Workers AI, and Rate Limiting bindings.
- Bun remains the single-process SQLite deployment profile until measurements
  require another documented topology.
- No secret, password, prompt, memory content, or embedding enters logs or Git.
- The release remains manually verified and published.

## Acceptance criteria

- **AC-PZ-001 — Ubiquitous:** Titen shall contain zero live `ponytail:` comments, and the debt checker shall accept and report an empty live ledger.
- **AC-PZ-002 — Event-driven:** When a public Cloudflare login fails, Titen shall consume both the account throttle and a native Rate Limiting binding keyed without a raw password or IP address.
- **AC-PZ-003 — Unwanted behavior:** If an owner or admin submits a common, contextual, or compromised-style password, then Titen shall reject it before storing a verifier while preserving the existing minimum length and forced-change rules.
- **AC-PZ-004 — Optional feature:** Where an authorized context request supplies an ISO-8601 `at` value, Titen shall compile only evidence valid at that instant on Bun and Cloudflare; otherwise it shall use the current instant.
- **AC-PZ-005 — Ubiquitous:** Titen shall keep every generated SQL statement within the tested D1 parameter ceiling using existing call-site chunk headroom and shall require no configurable SQL policy abstraction.
- **AC-PZ-006 — Event-driven:** When more enrichment anchors exist than one maintenance batch can process, Titen shall persist the cursor and eventually schedule anchors beyond the first batch on both runtimes.
- **AC-PZ-007 — Event-driven:** When an exact source observation or canonical claim is re-ingested after the 24-hour request-id window, Titen shall converge on its existing canonical record without suppressing a distinct event.
- **AC-PZ-008 — Event-driven:** When semantic indexing sees a canonical statement whose recorded index hash is current, Titen shall avoid regenerating its embedding.
- **AC-PZ-009 — Event-driven:** When multiple organizations have pending maintenance work, Titen shall select organizations by the oldest pending work and shall not strand a later organization behind a busy first organization.
- **AC-PZ-010 — Unwanted behavior:** If a migration cannot pass validation or dry-run checks, then Titen shall stop before destructive application on Bun and Cloudflare.
- **AC-PZ-011 — Ubiquitous:** Titen shall enforce portable deterministic context budget units using UTF-8 bytes and shall test non-ASCII text without adding a provider tokenizer.
- **AC-PZ-012 — Optional feature:** Where a context request supplies `max_candidates`, Titen shall validate a bounded per-request value and preserve the native Vectorize query cap.
- **AC-PZ-013 — Ubiquitous:** Titen shall retain one shared vector-store boundary with native runtime implementations and shall not introduce an unmeasured provider factory or network readiness probe.
- **AC-PZ-014 — Event-driven:** When an authorized operator requests semantic index verification, Titen shall detect missing active vector records in a bounded batch and enqueue deterministic repair without reading embedding values.
- **AC-PZ-015 — Event-driven:** When webhook deliveries span more than one bounded pass or organization, Titen shall advance persisted cursors and eventually process later eligible deliveries.
- **AC-PZ-016 — Ubiquitous:** Titen shall document Bun/SQLite as a one-process deployment profile and direct measured horizontal or read-scaling requirements to the Cloudflare runtime rather than speculative Bun coordination code.
- **AC-PZ-017 — Ubiquitous:** Titen shall label the bundled retrieval benchmark as a deterministic lexical fixture and shall not present it as external semantic-quality adjudication.
- **AC-PZ-018 — Optional feature:** Where dashboard replicas share a valid 32-byte session key, Titen shall accept authenticated opaque sessions across processes and restarts; if a cookie is forged, expired, or undecryptable, then Titen shall fail closed.
- **AC-PZ-019 — Event-driven:** When the OpenClaw bundle is packaged, Titen shall include its remote streamable-HTTP MCP configuration, pass the current bundle validator, and publish through the manual supported registry path.
- **AC-PZ-020 — Ubiquitous:** Titen agent distributions shall remain explicit-invocation clients without automatic lifecycle capture or a Pi runtime extension, and integration tests shall enforce that privacy boundary.
- **AC-PZ-021 — Event-driven:** When an official public self-service catalog accepts Titen's plugin format, the maintainer shall submit the smallest validated package and record the public submission URL; unsupported catalogs shall be documented as direct-install surfaces, not pending product code.
- **AC-PZ-022 — Event-driven:** When every local gate passes, the maintainer shall publish a stable npm version, smoke the exact package on Bun, Cloudflare, and the operator dashboard, verify rollback artifacts, and record immutable release evidence.
- **AC-PZ-023 — Ubiquitous:** The README shall lead with the Level 6 collaborative-memory distinction, explain it against storage-only and retrieval-only memory in concrete terms, preserve the website and C.A.D.I.S Agent attribution, and pass an anti-AI-slop editorial review.

## Risks and rollback

- New replay keys must converge only exact canonical input; differing evidence
  must remain distinct.
- Sealed dashboard cookies must never expose the API session credential and must
  reject tampering.
- Vector index manifests can lag an external write; bounded verification and the
  existing outbox remain the repair authority.
- Cloudflare and public registry changes are rolled back by the prior immutable
  Worker version/package version; SQL changes remain forward-only and additive.

## Delivery evidence

- Release source `35ea5552095cd6509f412266fc4c5458cc7c8b10` merged to
  `main` as `83adb1496c0c4addbfa80a737ffd6037e76038be` in
  [PR #213](https://github.com/RamaAditya49/titen/pull/213).
- `titen-memory@0.5.5` is npm `latest`; a clean registry install exposed CLI
  `0.5.5` and `TitenClient`. The registry SHA-1 is
  `46bd52e9e8a63f0c19acc71a61c96cff630747ae`.
- [GitHub release v0.5.5](https://github.com/RamaAditya49/titen/releases/tag/v0.5.5)
  is public and targets the merge commit above.
- [titen-web PR #11](https://github.com/RamaAditya49/titen-web/pull/11)
  synchronized the stable discovery manifest and release page, documented all
  84 routes, and deployed Cloudflare version
  `9d8bdc91-1119-477b-83eb-e441e723f979`. Both `titen.dev` hostnames report
  CLI `0.5.5`, and a clean installed CLI reports itself up to date.
- The isolated `titen-test-*` Worker runs schema 21 with D1, BGE-M3 through
  Workers AI, Vectorize metadata filtering, Cron repair, replay convergence,
  historical recall, bounded index verification, scope denial, and rollback
  recovery. Final Worker version:
  `dcbcc314-311a-47e5-8da9-08c98c0db081`.
- `rama-tuf` runs exact rootless image `localhost/titen:0.5.5-35ea555` for the
  API and dashboard. Schema 21 readiness, restored-data canary, Add User, all
  six product areas, service restart, backup/restore rollback, and loopback-only
  listeners passed. Pre-deploy backup SHA-256:
  `d988fe0bc9c2650f0e22ea80cc995c3534e7646a881b6f889c0d67442cfd2e3f`.
- The public [OpenClaw bundle 0.2.0](https://clawhub.ai/packages/@ramaaditya49/titen-memory)
  passed the current registry scan and remained downloadable. Artifact SHA-256:
  `ca3966b4e93b9cf1c777a55f189ad06dbf5352fb0822deb39f64c1fdcf073870`.
- The smallest validated Cursor package was submitted upstream in
  [cursor/plugins#184](https://github.com/cursor/plugins/pull/184). Vendor
  review is external distribution state, not unfinished Titen product code.
- `pnpm test:all`, both runtime contract suites, integration and browser checks,
  package verification, `pnpm audit --prod`, workflow validation, route checks,
  and the zero-marker ledger passed manually. GitHub Actions remains disabled
  to keep the repository free of hosted automation cost.

## Done conditions

- Every acceptance criterion has reproducible evidence mapped in the paired
  plan.
- Dual-runtime contract, security, migration, dashboard, packaging, workflow,
  and zero-ledger checks pass.
- The exact stable package is published, deployed to the isolated Cloudflare and
  rama-tuf verification targets, smoke-tested, and linked from release evidence.
- The spec and plan move together to `done/` with no unchecked work.
