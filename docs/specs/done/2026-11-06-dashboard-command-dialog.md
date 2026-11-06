---
work_id: dashboard-command-dialog
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-06
updated: 2026-11-06
owner: maintainers
---
# A working "Search or jump to" dialog

Issue #375. The topbar trigger read "Search or jump to… ⌘K", but its dialog
only searched memories. The header close button was the form's first submit
button, so Enter closed the dialog and dropped the query. Nothing could jump
to an area. The hint always said ⌘K, and at 320px the trigger covered the
breadcrumb.

Scope: dashboard only (`src/pages/dashboard/index.astro`,
`src/styles/dashboard.css`). No API change.

## Design

The dialog keeps the native `dialog` element. A combobox input controls a
listbox of options: one option per visible, authorized navigation destination
whose label or area id contains the typed text, then "Search memories for …"
when the Memories area is visible and the query is not empty. Nothing is
preselected. Arrow keys move the highlight, and Enter or the **Go** button runs
the highlighted option, or the first option when none is highlighted. Both close
controls are `type="button"`, so **Go** is the form's default button.

## Acceptance criteria

- **AC-UI-SEARCH-001 — Event-driven:** When the operator presses Enter in the search dialog input, Titen shall perform the dialog's primary action and shall not discard the typed query.
- **AC-UI-SEARCH-002 — Event-driven:** When the search dialog closes without navigating, Titen shall return keyboard focus to the element that opened it.
- **AC-UI-SEARCH-003 — Event-driven:** When the typed text matches a visible authorized destination, Titen shall offer that destination and shall activate it on selection.
- **AC-UI-SEARCH-004 — Ubiquitous:** Titen shall show the keyboard shortcut for the operator's platform (⌘K on Apple platforms, Ctrl K elsewhere) and expose it through `aria-keyshortcuts`.
- **AC-UI-SEARCH-005 — State-driven:** While the viewport is 620px wide or less, Titen shall render the search trigger without overlapping the breadcrumb or page title.
- **AC-UI-SEARCH-006 — State-driven:** While the Memories area is hidden for the principal, Titen shall not offer a memory search in the dialog.

## Done conditions

Browser tests cover Enter search, arrow-key jump, Escape and close-button focus
return, the shortcut hint, the authorized destination list, and the 320px
layout. The full browser suite passes.

## Completion evidence

All six acceptance criteria passed; the paired plan maps each to its check.
