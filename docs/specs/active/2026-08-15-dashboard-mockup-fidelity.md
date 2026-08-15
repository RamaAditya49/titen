---
work_id: dashboard-mockup-fidelity-live
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-15
updated: 2026-08-15
review_after: 2026-08-29
owner: titen-maintainers
---

# Live dashboard mockup fidelity

## Problem

The current authenticated dashboard has the right live REST boundary but its
visual hierarchy is materially different from the approved `Titen Dashboard
Final` reference: the rail lacks grouped icon navigation, the header and lens
controls are oversized forms, and Memory Atlas has no topology/trace surface.

## In scope

- Recompose `/dashboard/` around the mockup's 236px grouped rail, patterned
  header, compact lens/focus/status rails, graph/table workspace, compile trace,
  and inspector hierarchy.
- Use the existing local mark/fonts and inline SVG primitives only.
- Render live Atlas nodes/edges returned by the existing adapter, with an
  accessible textual record list and canonical inspector fallback.
- Keep all six authorized product areas, session/authentication flow, loading,
  empty, error, responsive, reduced-motion, and forced-colors behavior.
- Make every visible rail item actionable: Memories aliases Atlas, System opens
  live service status, Access opens the authorized principal policy view, and
  Releases opens the live release-policy view.
- Keep one selected rail control at a time, and expose the authenticated
  principal's Profile and password-change flow from the private shell.
- Add private local visual comparison evidence; no mockup source or secrets
  enter the public artifact.

## Out of scope

- New API routes, schema, storage, provider, or UI dependency.
- Synthetic data presented as production data or browser-held credentials.
- Public documentation of private mockup contents or operator credentials.

## Acceptance criteria

- **AC-DMF-001 — Ubiquitous:** Titen shall render the authenticated dashboard
  with grouped icon navigation, a compact patterned header, lens controls,
  focus/status metadata, and a two-column Atlas workspace at desktop widths.
- **AC-DMF-002 — Event-driven:** When a live Atlas view returns nodes and
  edges, Titen shall render a bounded SVG topology plus a synchronized textual
  record list and inspector using only returned canonical records.
- **AC-DMF-003 — Ubiquitous:** Titen shall preserve the existing same-origin
  authentication, authorization, endpoint allowlist, and all six product-area
  contracts without introducing browser credentials or synthetic fallback.
- **AC-DMF-004 — Optional feature:** Where viewport width is below 900px,
  Titen shall keep a single-column reading path with no page-level horizontal
  overflow and shall confine Atlas topology to an internal scroll region.
- **AC-DMF-005 — Unwanted behavior:** If the adapter is unavailable, the view
  is empty, or a request fails, then Titen shall show an honest disconnected,
  empty, or error state and shall not display stale private records.
- **AC-DMF-006 — Ubiquitous:** Titen shall serve icons, mark, and fonts locally,
  keep the dashboard bundle under the existing 80 KiB gzip budget, and emit no
  third-party runtime request.
- **AC-DMF-007 — Event-driven:** When a lens, navigation area, or record is
  activated, Titen shall update the selected state and heading while preserving
  keyboard focus semantics and the existing API request behavior.
- **AC-DMF-008 — Event-driven:** When an authenticated operator activates a
  visible rail item, Titen shall open an authorized destination or live status
  view; no visible item shall be a dead navigation affordance.
- **AC-DMF-009 — Event-driven:** When an authenticated operator opens Profile,
  Titen shall show the current principal and allow a deliberate password update
  through the existing same-origin password endpoint; activating an alias shall
  not mark another alias active.

## Done conditions

- Mockup comparison and current dashboard audit are recorded privately in the
  session workspace only.
- Build, browser/API tests, workflow checks, package verification, and a live
  dashboard smoke pass.
- npm release and server-wulan update complete with rollback evidence.
- This spec and its paired plan move to `docs/specs/done/` and
  `docs/plans/done/` with all evidence recorded.
