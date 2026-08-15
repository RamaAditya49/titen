---
work_id: dashboard-memories-list-and-atlas
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-08-15
updated: 2026-08-15
review_after: 2026-08-29
owner: titen-maintainers
---

# Dashboard Memories list and Atlas boundary

## Problem

The current dashboard presents the compile-driven Memory Atlas as both
“Memories” and “Atlas”. A user cannot see authorized memories without first
compiling a graph, several visible destinations appear empty or duplicate, and
the visual relationship graph is confused with the primary memory inventory.
The supplied final mockup makes the distinction explicit: Memories is the
actionable record surface; Atlas is a read-only visual explanation surface.

## Scope

In scope:

- add an authenticated `GET /v1/memories` endpoint backed by canonical claims,
  authorization, retention, lifecycle, optional lexical FTS, and keyset cursors;
- expose that endpoint through the same-origin dashboard adapter;
- make Memories the default searchable/paginated list with loading, empty,
  error, row selection, and “Open in Atlas” states;
- make Atlas a separate graph/inspector surface opened from a selected memory;
- keep the existing compile API and administrator authorization boundaries;
- update dashboard, API, architecture, release, and changelog documentation;
- publish the npm package and deploy/smoke the web and configured server.

Out of scope: semantic/vector search, new storage tables or dependencies,
destructive consolidation, a global hidden count, raster Atlas imagery, and
unsupported placeholder routes.

## Acceptance criteria

- **AC-MA-001 — Ubiquitous:** Titen shall return only claims authorized for the
  authenticated principal and not excluded by retention from `GET /v1/memories`.
- **AC-MA-002 — Event-driven:** When an authorized caller supplies `q`, Titen
  shall filter the same authorized claim set with bounded quoted FTS terms and
  shall not require compilation, vectors, or an embedding provider.
- **AC-MA-003 — Event-driven:** When a caller supplies `limit` or `after`, Titen
  shall return at most 100 records in stable `(created_at,id)` keyset order and
  a cursor that traverses every record once without offset drift.
- **AC-MA-004 — Unwanted behavior:** If a cursor, limit, filter, or scope is
  malformed, then Titen shall return a bounded validation error without a SQL
  write or an authorization bypass.
- **AC-MA-005 — Event-driven:** When the dashboard session is authorized, the
  Memories area shall load the first page on entry and render real rows, search,
  filters, selection, pagination, and an explicit empty/error state.
- **AC-MA-006 — Event-driven:** When a user activates “Open in Atlas” for a
  selected memory, the dashboard shall activate only Atlas, compile the
  authorized graph, and show its inspector/trace without duplicating the
  Memories active state.
- **AC-MA-007 — Unwanted behavior:** If the API or readiness is unavailable,
  then the dashboard shall show the live error/degraded state and shall not
  fabricate memory rows, counts, graph nodes, or readiness claims.
- **AC-MA-008 — Ubiquitous:** Titen shall preserve the same route and
  authorization behavior across the shared core, Bun/SQLite, Cloudflare/D1,
  dashboard adapter, and packaged Astro dashboard.
- **AC-MA-009 — Event-driven:** When the release is published, the npm package,
  changelog, web version manifest, deployed dashboard, and configured server
  shall identify the same version and pass authenticated smoke checks.

## Done conditions

- focused API, dual-runtime, adapter, and browser tests pass;
- build, package inspection, route/workflow checks, and `git diff --check` pass;
- changelog and API/dashboard/architecture docs describe only shipped behavior;
- npm latest, web deployment, and configured server are smoke-verified;
- this spec and its paired plan move to `docs/specs/done/` and `docs/plans/done/`.
