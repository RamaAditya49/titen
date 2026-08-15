---
work_id: atlas-admin-and-semantic-readiness
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-15
updated: 2026-08-15
review_after: 2026-08-29
owner: titen-maintainers
---

# Atlas administrator access and semantic readiness

## Problem

Three open reports describe two production contract gaps:

- #300: an organization owner has no explicit, audited way to inspect another
  same-organization principal's private memory in Memory Atlas;
- #301: an empty Atlas result does not identify the active principal or explain
  that the default projection is principal-scoped;
- #302: normal pending semantic projection work is reported as a vector
  configuration error and forces traffic readiness to HTTP 503.

The fixes must preserve authorization-before-traversal, non-disclosure across
organizations, canonical lifecycle/retention checks, and fail-closed dependency
readiness on both supported runtimes.

## In scope

- Add an explicit `views:compile:all` capability and an explicit administrator
  access mode for bounded Memory Atlas compilation.
- Require active root/owner organization authority and a bounded reason code,
  then append metadata-only audit evidence for every successful privileged
  compile.
- Add principal and access-mode metadata to every Atlas result and render that
  boundary in the dashboard without probing for hidden records.
- Treat ordinary pending semantic projection work as a usable but syncing
  semantic state while keeping actual dependency, fingerprint, migration,
  configuration, and terminal failures fail-closed.
- Update the API, architecture, product baseline, SDK types, dashboard adapter,
  tests, changelog, and release surfaces that expose these contracts.

## Out of scope

- Cross-organization inspection, impersonation, unrestricted graph traversal,
  hidden-count probes, or memory-content audit logging.
- A new role system, step-up authentication protocol, queue, cache, framework,
  provider, or database migration.
- Relaxing enrichment terminal-error handling or claiming model enrichment is
  production-activated.

## Constraints and risks

- Default compilation remains principal-scoped; owner role alone grants no
  additional record access.
- Privileged access is same-organization, read-only, bounded, explicitly
  requested, separately scoped, and auditable.
- Both endpoints of every returned Atlas edge must satisfy the selected access
  policy, and retention exclusions remain authoritative.
- Readiness must distinguish projection lag from dependency failure without
  hiding failed semantic work.
- Responses, audit rows, dashboard copy, logs, tests, docs, packages, and release
  notes must contain no credentials, private content, hidden IDs, or private
  topology.

## Acceptance criteria

- **AC-AVA-001 — Ubiquitous:** Titen shall keep ordinary `views:compile`
  requests principal-scoped and shall exclude another principal's private
  records without revealing their existence or count.
- **AC-AVA-002 — Event-driven:** When an active same-organization root or owner
  with `views:compile:all` explicitly requests administrator mode with an
  allowed reason code, Titen shall return only bounded, lifecycle-eligible
  records from that authenticated organization.
- **AC-AVA-003 — Unwanted behavior:** If administrator mode lacks the dedicated
  capability, root/owner authority, or a valid bounded reason, then Titen shall
  fail without disclosing whether hidden records exist.
- **AC-AVA-004 — Event-driven:** When administrator compilation succeeds, Titen
  shall append one metadata-only audit entry containing the actor, lens,
  subject/focus selectors, access mode, reason code, and timestamp, without
  returned memory content.
- **AC-AVA-005 — Ubiquitous:** Titen shall apply organization isolation,
  retention exclusions, lifecycle rules, evidence authorization, and response
  limits before returning every privileged Atlas node or edge.
- **AC-AVA-006 — Ubiquitous:** Every Atlas response shall identify the active
  principal and effective access mode without adding hidden-record counts,
  labels, actor IDs, or topology.
- **AC-AVA-007 — Event-driven:** When an Atlas result is empty, the dashboard
  shall state that no records are visible to the named active principal in the
  effective mode and shall not claim canonical memory is globally empty.
- **AC-AVA-008 — Optional feature:** Where the authenticated dashboard principal
  has administrator-view capability and root/owner authority, the dashboard
  shall expose the explicit reason-coded administrator mode; otherwise the
  control shall be absent.
- **AC-SRS-001 — State-driven:** While canonical SQL, migrations, signing
  secrets, and semantic dependencies are usable but active-claim projection
  work is pending, `/readyz` shall return HTTP 200 with `ready: true`, keep the
  semantic capability usable, and report `index_projection_pending` as a
  syncing diagnostic.
- **AC-SRS-002 — Unwanted behavior:** If the embedder or vector store has an
  observed failure, the fingerprint is incompatible, semantic metadata is
  unavailable, or canonical startup checks fail, then `/readyz` shall remain
  HTTP 503 with a non-secret typed diagnostic.
- **AC-SRS-003 — Event-driven:** When pending projection work drains or new
  writes enqueue more normal work, readiness shall move between `ok` and
  `index_projection_pending` without moving traffic readiness away from HTTP
  200.
- **AC-SRS-004 — Event-driven:** When the dashboard receives
  `index_projection_pending`, it shall describe semantic index synchronization
  without implying canonical product requests are unavailable.
- **AC-SRS-005 — Ubiquitous:** Bun/SQLite and Cloudflare/D1 contract evidence
  shall cover ordinary/privileged Atlas access, audit output,
  cross-organization denial, pending semantic work, dependency failure, and
  recovery with no secret or private-record disclosure.

## Done conditions

- Every acceptance criterion has reproducible evidence in the paired plan.
- Manual workflow, route, dual-runtime, SDK, integration, browser, package, and
  disclosure checks pass, with unrelated baseline failures identified rather
  than hidden.
- A patch release is published, the public release website and server-wulan are
  updated, production smoke passes or a verified rollback is completed, and
  GitHub issues #300, #301, and #302 are closed with evidence.
- The paired artifacts are moved to `done/` with no unchecked work.
