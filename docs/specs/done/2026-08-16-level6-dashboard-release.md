---
work_id: level6-dashboard-release-20260816
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-16
updated: 2026-08-16
owner: CADIS
---

# Level 6 dashboard release

Source of truth: `Titen Dashboard Final v2.dc.html` from the approved mockup bundle

## Problem

The shipped Astro dashboard exposes only part of Titen's operator surface. The
approved dashboard defines fifteen connected areas, a responsive interaction
model, and four missing contracts: directory reads, an Atlas workspace graph,
safe model diagnostics, and scoped grants. Publishing the UI without those
contracts would create synthetic or misleading controls.

## Scope and constraints

In scope are the complete fifteen-area live Astro surface, the missing shared
REST/storage contracts required by it, package/install correctness, both runtime
adapters, documentation, npm publication, `titen-web` synchronization, and
production smoke or verified rollback. Existing Web/Cloudflare/Bun APIs,
canonical SQL, the same-origin adapter, local fonts, native browser controls,
and the existing package remain the implementation boundary; no new dependency
or framework is permitted.

Primary risks are cross-scope disclosure, grant/key escalation, partial model
configuration, stale browser state after identity changes, migration widening,
package/source drift, and deploying an artifact other than the published
candidate. Each must fail closed or retain a verified rollback path.

## Requirements

### Product shell and live state

- **AC-TITEN-DASH-001 — Ubiquitous:** The Astro dashboard shall expose Atlas,
  Memories, Context, Subjects, Work, Audit & Events, System, Models,
  Federation, Access, API & Keys, Projects, Approvals, Releases, and Profile
  through the approved grouped rail and warm-paper visual system.
- **AC-TITEN-DASH-002 — Event-driven:** When an operator changes area, lens,
  workspace, filter, page, or selected record, the dashboard shall update the
  URL and visible live state without a full-page navigation.
- **AC-TITEN-DASH-003 — State-driven:** While live data is loading, unavailable,
  denied, empty, or truncated, the dashboard shall show the corresponding
  bounded state and shall clear stale content from the prior request.
- **AC-TITEN-DASH-004 — Ubiquitous:** The dashboard shall have no fixture-data or
  browser-secret fallback, shall use the loopback same-origin adapter, and
  shall render only routes authorized by the current principal.
- **AC-TITEN-DASH-005 — Ubiquitous:** The shell and every area shall remain usable
  at 320 CSS pixels, with visible focus, semantic controls, reduced-motion
  support, and keyboard access to navigation, dialogs, tables, and graph nodes.
- **AC-TITEN-DASH-006 — Optional feature:** Where a control mutates state, the dashboard
  shall require explicit confirmation for destructive actions and shall render
  the resulting server state rather than optimistic fixture state.

### Existing operational areas

- **AC-TITEN-DASH-010 — Ubiquitous:** Memories shall provide exact query
  highlighting, status and kind filters with authorized counts, workspace
  filtering, keyset pagination, and an empty-state reset.
- **AC-TITEN-DASH-011 — Event-driven:** When an operator compiles context, the
  dashboard shall show the token budget, inclusion reason and source evidence
  for each item, plus bounded exclusions returned by the live contract.
- **AC-TITEN-DASH-012 — Ubiquitous:** Work shall expose leases, handoffs, and
  checkpoints; Audit & Events shall expose metadata-only history; System shall
  expose readiness checks; Federation shall expose peers and its event log;
  Approvals and Releases shall expose their existing lifecycle operations.
- **AC-TITEN-DASH-013 — Ubiquitous:** API & Keys shall expose the route inventory,
  current keys, once-only key creation, and revocation. Profile shall expose
  the authenticated identity and password-change flow.

### Missing read surfaces and Atlas graph

- **AC-TITEN-DASH-020 — Ubiquitous:** Titen shall expose authorized, keyset-bounded
  listings for principals, projects, and subjects, plus bounded project and
  subject reference summaries. Unscoped memory shall be represented explicitly
  as `project:null`.
- **AC-TITEN-DASH-021 — Event-driven:** When `workspace_graph` is compiled, the
  shared Atlas compiler shall return deterministic authorized subject and claim
  nodes, canonical relation edges, truncation, and withheld-edge counts with a
  caller-controlled maximum of 25 through 300 nodes.
- **AC-TITEN-DASH-022 — Unwanted behavior:** If a graph node or edge is outside the caller's
  authorization, then Titen shall omit it and shall not disclose its identifier or
  change an authorized node's visible metadata.

### Model diagnostics

- **AC-TITEN-DASH-030 — Ubiquitous:** `GET /v1/models/config` shall return the
  effective non-secret startup snapshot and capability diagnostics for
  extraction and embedding, masking every configured secret as `set`.
- **AC-TITEN-DASH-031 — Event-driven:** When an authorized operator posts a model
  group to `/v1/models/probe`, Titen shall execute one bounded provider probe,
  return validation and latency metadata, write no canonical memory, and append
  a metadata-only audit event.
- **AC-TITEN-DASH-032 — Unwanted behavior:** If model configuration or diagnostics are requested, then the dashboard and API shall not mutate runtime
  model configuration or reveal a secret, raw provider response, prompt, or
  embedding, or describe a partially configured tuple as usable.

### Scoped access and delegation

- **AC-TITEN-DASH-040 — Ubiquitous:** A canonical record read shall require both
  the existing visibility predicate and an active additive grant covering its
  organization, project including `project:null`, or subject; a missing grant
  shall fail closed and leave no count, rank, cursor, dispute, citation, or
  placeholder signal.
- **AC-TITEN-DASH-041 — Event-driven:** When an owner or admin creates a grant,
  Titen shall require that the grant target and permission are within the
  granter's current authority; grants shall be append-and-revoke rows and shall
  emit metadata-only audit events.
- **AC-TITEN-DASH-042 — State-driven:** While a key is used, its effective data
  target shall be the intersection of its declared target and its issuer's
  current grants, so revocation narrows access on the next request without a
  sweep or restart.
- **AC-TITEN-DASH-043 — Event-driven:** When an authorized operator simulates
  access, Titen shall return visibility and grant gate outcomes without
  revealing a record the operator cannot read.
- **AC-TITEN-DASH-044 — State-driven:** While migrating an existing store, Titen
  shall backfill organization grants for active principals so existing
  observable access remains unchanged until explicitly narrowed.

### Packaging and release

- **AC-TITEN-DASH-050 — Ubiquitous:** The npm package shall include the root
  redirect and the complete built dashboard, and package smoke shall verify
  both `/` and `/dashboard/` after install from the packed tarball.
- **AC-TITEN-DASH-051 — Ubiquitous:** Cloudflare and Bun shall pass the same core
  contract, including explicit Atlas administrator mode; the release shall not
  be declared complete until npm provenance, `titen-web` deployment, and live
  production smokes are recorded.

## Acceptance evidence

- Astro build, dashboard unit/integration tests, Playwright desktop and mobile
  screenshots, accessibility checks, and the gzip budget pass.
- Dual-runtime contract, migration verification, package tarball smoke,
  production-source typecheck, workflow-doc check, and repository release check
  pass; unrelated historical test-fixture diagnostics are recorded explicitly.
- An adversarial fixture proves project/subject grant isolation and immediate
  key clamp after revocation under REST and MCP projections.
- Model probes prove secrets and provider payloads never appear and canonical
  row counts do not change.
- Published npm metadata and tarball contents match the release commit.
- `titen-web` reports the release commit and its public dashboard/landing smoke
  passes, or the verified rollback is restored and reported.

## Non-goals

Runtime model editing, a model router, provider factory, deny rules, ABAC,
groups distinct from workspaces, cross-organization grants, graph similarity
edges, server-side graph coordinates, pan/zoom, or a new dashboard framework.

## Done conditions

Every requirement above has reproducible evidence, all fifteen areas use live
authorized state, both runtimes and the installed tarball pass, repository
issues have a verified terminal disposition, the paired plan has no unchecked
item, the exact release is published and deployed, and this pair is moved to
`done/` with the final production evidence.

## Delivery evidence

- Release commit `261919af3129b011d1f771ab6e722ec3c48a861b`, tag `v0.8.6`,
  and npm `gitHead` are identical. The published registry tarball has SHA-1
  `ec64df80d4ab252f7ec16561a598ed7ee480fab3` and is byte-identical to the
  nine-gate package candidate.
- `pnpm test:all` passed D1 128/128, Bun/vector/SDK 156/156, integration
  230/230, all nine active browser cases, the 15-destination live-adapter
  smoke, and workflow/debt checks. Desktop and 320 px screenshot references
  passed with a 22.9 KiB gzip dashboard bundle against the 80 KiB budget.
- Cloudflare Worker version `cc41813e-0ce3-40fb-ae97-50ffcb959dae` serves
  release revision `261919af3129b011d1f771ab6e722ec3c48a861b`; production
  health/readiness return 200 with schema 23/23 and automatic migration locked
  off. The isolated administrator-mode smoke exposed two nodes only in explicit
  administrator mode, appended one metadata-only audit entry, and its fixture
  rows were removed afterward.
- `titen-web` commit `214c76cc49cf4a924a765840cb2540641c073537`
  deployed as Cloudflare version `e3ac2760-59fb-4a01-94bd-8e2ede08b4b5`.
  Both `titen.dev` hostnames serve the 0.8.6 version metadata, release page,
  homepage badge, and current 96-route/54-scope documentation with HTTP 200.
- Issues #303 and #304 are closed with package and live-runtime evidence;
  the repository has zero open issues at completion.
