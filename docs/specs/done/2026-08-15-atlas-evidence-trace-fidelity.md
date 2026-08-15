---
work_id: atlas-evidence-trace-fidelity
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-15
updated: 2026-08-15
owner: titen-maintainers
---

# Atlas Evidence Trace fidelity

## Problem

The supplied final mockup's Atlas is a readable Evidence Trace: one centered
focus claim, labeled relationship paths, and authorized observation, context,
and release nodes around it. The live dashboard currently renders a generic
three-column card grid only after a manual compile and the core evidence trace
returns observations alone. The result is truthful but materially different
from the approved visual contract and cannot explain how a claim was used or
released.

## Scope

In scope:

- extend the authorized `evidence_trace` projection with context-run and active
  release nodes when the caller may read those records;
- preserve SQL authorization, retention, lifecycle, and whole-context
  non-disclosure before adding graph relationships;
- render a responsive mockup-like Evidence Trace with a centered claim,
  positioned nodes, labeled relation paths, and accessible record buttons;
- make Atlas handoff from Memories reliably submit the selected claim and show
  the live graph, with honest loading, empty, and error states;
- add dual-runtime/API and browser coverage and update API/architecture/release
  documentation if the response contract changes.

Out of scope: synthetic graph nodes, new tables, a graph database, arbitrary
dragging/layout state, semantic retrieval, or exposing hidden context/release
counts.

## Acceptance criteria

- **AC-AT-001 — Ubiquitous:** Titen shall return Evidence Trace nodes and edges
  only when the claim, source observations, complete linked context run, and
  active release each satisfy the caller's existing organization, visibility,
  retention, and lifecycle boundaries.
- **AC-AT-002 — Event-driven:** When an authorized claim has readable evidence,
  Titen shall return a claim-centered trace with `supports`, `contradicts`, or
  `qualifies` edges plus any authorized context and active release edges.
- **AC-AT-003 — Unwanted behavior:** If a linked context contains an unreadable
  item, then Titen shall omit the context node and its edges rather than reveal
  a partial pack or hidden shape.
- **AC-AT-004 — Event-driven:** When a user selects “Open in Atlas” from
  Memories, the dashboard shall submit the selected claim to Evidence Trace
  and render the returned graph without requiring an unrelated subject value.
- **AC-AT-005 — Event-driven:** When the trace has multiple node types, the
  dashboard shall place the focus claim centrally, label each relationship,
  and keep node text and inspector controls accessible at desktop and mobile
  widths.
- **AC-AT-006 — Unwanted behavior:** If the trace request is pending, empty, or
  fails, then the dashboard shall show the corresponding truthful state and
  shall not fabricate graph cards, edges, or counts.
- **AC-AT-007 — Ubiquitous:** Bun/SQLite, Cloudflare/D1, the dashboard adapter,
  and the packaged Astro dashboard shall preserve the same Evidence Trace
  response and authorization behavior.

## Done conditions

- focused core/dual-runtime, adapter, and browser tests pass;
- route/API, dashboard, architecture, changelog, build, and package checks pass;
- live web and server smoke show the updated graph surface without secrets;
- this spec and paired plan move to matching `done/` paths with evidence.

## Delivery evidence

- Commit `96cec54` and tag `v0.8.5` add the claim-centered renderer and
  authorized context/release projection.
- Bun/D1 contracts, integration, dashboard browser tests, package build, route
  docs, workflow checks, and ponytail debt checks pass; browser result is 9
  passed and 2 skipped.
- npm `titen-memory@0.8.5` is published; server-wulan reports health 200,
  readiness 200 with schema 22/22, dashboard 200, and unauthenticated memory
  access 401.
- `titen.dev` deployment `d6dbbfba-21d4-4820-afde-1551462c7598` serves
  version `0.8.5`, the release page, and the updated Atlas API documentation.
