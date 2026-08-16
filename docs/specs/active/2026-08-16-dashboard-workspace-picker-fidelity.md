---
work_id: dashboard-workspace-picker-fidelity-20260816
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-16
updated: 2026-08-16
review_after: 2026-08-23
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
