---
work_id: atlas-admin-and-semantic-readiness
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-15
updated: 2026-08-15
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
- A patch release is published, the public release website and deployment-host are
  updated, production smoke passes or a verified rollback is completed, and
  GitHub issues #300, #301, and #302 are closed with evidence.
- The paired artifacts are moved to `done/` with no unchecked work.

## Verification evidence

- Commit `a9a1339` implements the shared authorization and readiness changes;
  tag `v0.8.3` and GitHub Release are public, and npm `latest` resolves to
  `titen-memory@0.8.3` (tarball shasum verified locally).
- `pnpm test:all` passed: D1 125, Bun/vector/SDK 153, integration 228,
  dashboard live verification, browser 8 passed with 2 expected screenshot
  skips, workflow self-test, and Ponytail debt checks. Route and workflow
  checks also passed; package pack/install/disclosure smoke passed with 70
  files and no credential, mockup, database, backup, or private-state paths.
- `pnpm typecheck` still reports the repository's pre-existing docs/test/Bun
  baseline errors; the changed core, Astro build, SDK build, and all required
  release gates passed.
- titen-web commit `fbc9919` synced the 0.8.3 release page and manifest;
  Cloudflare Worker version `6a6e349c-4806-4d09-8ccd-9b3641c181dc` serves
  `titen.dev` and `www.titen.dev` with HTTP 200, `/version.json` reports 0.8.3,
  and `/releases/0.8.3` contains the release highlights.
- deployment-host was backed up before upgrade, then installed from npm 0.8.3;
  both systemd units are active, `/healthz` and `/readyz` return 200 with
  revision `npm-0.8.3`, the packaged dashboard returns 200, and an unauthenticated
  dashboard session returns 401. The rollback backup remains under the
  versioned `/opt/titen/backups/npm-dashboard-0.8.3-*` directory.
- GitHub issues #300, #301, and #302 were commented with evidence and closed;
  the repository has no open issues or pull requests. No credential, private
  memory content, mockup source, or server secret entered source control,
  npm, the public website, or release notes.
