---
work_id: dashboard-workspace-picker-fidelity-20260816
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-16
updated: 2026-08-17
owner: CADIS
---

# Dashboard workspace picker fidelity

Source of truth: the workspace picker in `Titen Dashboard Final v2.dc.html`
from the approved Level 6 mockup bundle.

## Problem

The 0.8.6 Astro dashboard reduced the approved sidebar workspace picker to an
unstyled native select. The control remains functional, but it loses the
mockup's hierarchy, active-scope context, open menu, selection marker, and
scope explanation.

## Requirements

- **AC-TITEN-WS-001 — Ubiquitous:** The sidebar shall render the active workspace
  as the approved icon, two-line label, border, and chevron trigger rather than
  an exposed native select.
- **AC-TITEN-WS-002 — Event-driven:** When the operator opens the trigger, the
  dashboard shall show every authorized live workspace plus explicit unscoped
  memory, mark the current selection, explain workspace visibility, and close
  after selection or outside dismissal.
- **AC-TITEN-WS-003 — Event-driven:** When the operator changes workspace, every
  existing Memories and Atlas request shall continue using the selected live
  `workspace_id`, clear stale results, and preserve the current authorization
  boundary.
- **AC-TITEN-WS-004 — Ubiquitous:** The picker shall remain keyboard accessible,
  visibly focused, usable at 320 CSS pixels, and contain no synthetic workspace
  data or browser-held credential.
- **AC-TITEN-WS-005 — Ubiquitous:** The corrective patch shall pass focused
  browser behavior and desktop/mobile visual checks, package smoke, workflow
  checks, npm publication, website synchronization, and production smoke or a
  verified rollback.

## Non-goals

Changing workspace APIs, adding counts absent from the live contract, storing a
selection in browser storage, or adding a component framework.

## Done conditions

All acceptance criteria have reproducible evidence, the package and website
release identify the same patch version, production smokes pass, and this spec
and its paired plan are moved to `done/` with no unchecked work.

## Delivery evidence

- Commit `ff419db329c4b40c4aaa0bfd3e197cb6cce1d630` and tag `v0.8.7`
  contain the mockup-aligned selector, live scope behavior, accessibility
  coverage, and reviewed desktop/320 px references.
- `titen-memory@0.8.7` is npm `latest` with SHA-1
  `527d1eae721a88994ff8913b5efb5a3cd055f7cf` and the same `gitHead`.
- Production deployment-host runs package/revision `0.8.7`/`npm-0.8.7` with
  health and readiness `200`, schema `23/23`, dashboard `200`, and an
  unauthenticated protected request rejected with `401`. Rollback backup:
  `/opt/titen/backups/npm-0.8.7-20260817-080321`.
- `titen-web` commit `0354a7d` is deployed as Cloudflare version
  `0838c332-9c8a-4a70-aeec-96f5679f473d`; both public hostnames, release
  metadata/page/OG, and the live dashboard passed HTTP and browser smoke.
