---
work_id: memories-validity-facets
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-03
updated: 2026-11-03
owner: maintainers
---
# Per-row validity window and consistent facets for the memories list

Issue #347. `listMemories` applied the validity window only when every
requested status was `active` or `disputed`, so `status=active,superseded`
re-admitted expired and future active claims. The facet query dropped the window
entirely, so `facets.status.active` counted rows the list never showed.

Decision: option (a) from the issue. `active` and `disputed` mean currently
valid, evaluated per row. No `validity=all` flag is added; that can follow as a
separate additive change if operators need to list out-of-window active claims.
Scope: `src/core/memories.ts`, API reference, CHANGELOG, contract tests.

## Acceptance criteria

- **AC-MEM-001 — Event-driven:** When `GET /v1/memories` returns `facets.status.active = N` for a filter set, Titen shall return exactly N items across all pages of `GET /v1/memories?status=active` with the same other filters.
- **AC-MEM-002 — Event-driven:** When an `active` claim's `valid_to` is in the past or its `valid_from` is in the future, Titen shall exclude it for `status=active` and for `status=active,superseded` alike.
- **AC-MEM-003 — Ubiquitous:** Titen shall compute item filters and facets from one shared scope predicate that includes the per-row validity rule.
- **AC-MEM-004 — Event-driven:** When a request includes `after`, Titen shall return facet values computed from the same predicate as the first page.
- **AC-MEM-005 — Ubiquitous:** Titen shall keep authorization, workspace, visibility, and lexical search filters applied to facets exactly as before.

## Done conditions

The new contract case passes on bun-sqlite and the D1 harness and fails on main.
The existing memories cases pass unchanged. The API reference documents facets
and the validity rule.

## Completion evidence

All five acceptance criteria passed; the paired plan maps each to its check.
