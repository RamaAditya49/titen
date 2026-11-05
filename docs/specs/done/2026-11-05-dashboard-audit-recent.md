---
work_id: dashboard-audit-recent
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-05
updated: 2026-11-05
owner: maintainers
---
# Recent activity first in the dashboard Audit & Events area

Issue #367. `GET /v1/audit` and `GET /v1/events` page oldest first with an
`after` cursor. The dashboard asked for one page, never followed the cursor, and
loaded nothing until Refresh was pressed. Once an organization had more audit
entries than the page limit, the newest activity could not be reached, and the
heading "N authorized records" read like the full set. Enter in a filter field
did nothing because the form had no submit control.

Scope: dashboard only (`src/pages/dashboard/index.astro`). No API, SDK, or data
change.

## Design choice

The issue offers two routes: walk the existing cursor on the client, or add
`order=desc` / `before` to two public endpoints. This change takes the client
route. It needs no new public parameter on either runtime, no SDK or contract
change, and it keeps the simplicity budget. The cost is up to ten requests of
200 rows per list, and on very large logs a partial view. That view says it is
partial and offers to continue the walk. A server-side newest-first order stays
open as a later API change if logs routinely exceed the bound.

## Acceptance criteria

- **AC-UI-AUDIT-001 — Event-driven:** When an operator with `audit:read` opens Audit & Events, Titen shall request and display the most recent authorized audit entries, newest first, without requiring a manual refresh.
- **AC-UI-AUDIT-002 — State-driven:** While more authorized audit or event records exist beyond the displayed page, Titen shall indicate that more records exist and offer a control that shows the next page, loading further records through the API cursor when they have not been loaded.
- **AC-UI-AUDIT-003 — Unwanted behavior:** If the dashboard cannot reach the newest entries within its request bound, then Titen shall state that the view is partial and shall not present the shown count as the complete total.
- **AC-UI-AUDIT-004 — Event-driven:** When the operator presses Enter in an Audit filter field or activates the in-form submit button, Titen shall reload the audit and event lists with those filters applied.
- **AC-UI-AUDIT-005 — Ubiquitous:** Titen shall offer known audit action names and event kinds as suggestions in the filter fields without restricting what may be typed.

## Done conditions

A browser test covers load on open, the bounded walk, newest-first order, Newer
and Older paging, the partial message with its continue control, and Enter and
"Apply filters" submission. The existing audit tests still pass. The full browser
suite passes.

## Completion evidence

All five acceptance criteria passed; the paired plan maps each to its check.
