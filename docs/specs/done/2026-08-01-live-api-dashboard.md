---
work_id: live-api-dashboard
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-01
owner: CADIS
---
# Live API dashboard

## Problem

The optional Astro dashboard still starts from a frozen synthetic fixture and
only overlays one live Atlas lens. Operators cannot use it as truthful service
evidence or inspect the current authorized Atlas projections end to end.

## Scope

- Replace fixture-backed records and counts with live health, readiness, and
  authorized Memory Atlas responses.
- Keep the browser on a same-origin adapter while accepting the upstream URL
  and API key only through server-side environment variables.
- Support the current evidence trace, neighborhood, conflict/freshness, and
  review queue lenses with bounded operator input.
- Represent disconnected, loading, empty, denial, upstream-error, and ready
  states without presenting fallback records as live.
- Preserve a responsive, keyboard-operable Astro interface and document local
  and VPS operation.

## Out of scope

New core enterprise or federation routes, write controls, credential storage,
browser-visible API keys, synthetic fallback data, a new frontend framework,
or a new dependency.

## Constraints and risks

Authorization remains authoritative in the Titen API. The adapter must use an
exact route/lens allowlist, bounded input, generic errors, no-store responses,
and server-only credentials. Health and readiness are observations, not proof
that an authenticated Atlas request is authorized. Browser state is memory-only
and must not write credentials or results to Web Storage.

## Acceptance criteria

- **AC-LIVE-001 — Optional feature:** Where the dashboard adapter is configured
  with a Titen API origin and scoped key, Titen shall fetch health, readiness,
  and Memory Atlas only through same-origin `/dashboard-api/*` routes without
  exposing the key in HTML, browser requests, responses, logs, or storage.
- **AC-LIVE-002 — Event-driven:** When an operator supplies a bounded subject or
  focus identifier and selects a supported lens, Titen shall render the
  authorized nodes, edges, metadata, and selected-record details returned by
  the current API without fixture substitution.
- **AC-LIVE-003 — Unwanted behavior:** If live integration is disabled,
  unreachable, malformed, unauthorized, forbidden, or not ready, then Titen
  shall display the corresponding disconnected or error state and shall not
  label any synthetic record as live.
- **AC-LIVE-004 — State-driven:** While a live request is pending or returns no
  authorized records, Titen shall expose distinct accessible loading or empty
  states and keep operator input available for retry.
- **AC-LIVE-005 — Ubiquitous:** Titen shall keep the dashboard usable by
  keyboard at 320 pixels and wider, shall preserve visible focus and reduced
  motion, and shall make unimplemented product areas non-interactive.
- **AC-LIVE-006 — Event-driven:** When the local live-dashboard verification is
  run, Titen shall prove Bun/SQLite data isolation, health/readiness forwarding,
  all supported Atlas request shapes, and absence of browser-visible secrets.

## Done conditions

Implementation, focused tests, real Bun/SQLite adapter smoke, Astro build,
browser checks, route/workflow checks, documentation, and diff validation pass;
the paired artifacts are moved to `done/` with reproducible evidence.

## Completion evidence

The paired done plan records the passing browser, adapter-boundary, real
Bun/SQLite, Astro build/bundle, workflow, route-documentation, diff, and visual
inspection gates.
