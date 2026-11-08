---
work_id: dashboard-audit-recent
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-05
updated: 2026-11-05
owner: maintainers
spec: docs/specs/done/2026-11-05-dashboard-audit-recent.md
---
# Dashboard audit recent-activity plan

Goal: the Audit & Events area opens on what happened most recently and never
implies a partial list is complete.

- [x] Add a failing browser test with 450 cursor-chained audit entries, an endless log, and a filtered reload.
- [x] Walk `audit/log` and `audit/events` by cursor, 200 rows per request and at most 10 requests per walk, and render rows newest first.
- [x] Add a footer per list with a status line and Newer, Older, and "Load more recent …" controls.
- [x] Load on area activation; make the filter form submit on Enter and through "Apply filters".
- [x] Add `datalist` suggestions for audit actions and event kinds.
- [x] Update docs and CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-UI-AUDIT-001 | Browser test "audit activity opens on the newest entries…": without a click, the first row is `aud_449` after exactly three cursor requests |
| AC-UI-AUDIT-002 | Same test: Newer starts disabled; Older shows `aud_399` and "Showing 51–100 of 450"; the endless log offers "Load more recent audit entries", which issues ten more cursor requests |
| AC-UI-AUDIT-003 | Same test: after ten full pages the status reads "Partial view: showing 1–50 of the first 2,000 audit entries." |
| AC-UI-AUDIT-004 | Same test: Enter in Audit action reloads with `action=key.revoke` (225 rows); "Apply filters" reloads unfiltered |
| AC-UI-AUDIT-005 | Inputs carry `list="audit-actions"` and `list="event-kinds"`; free text still submits (the filter in the test is typed) |

## Rollback

Revert the commit. Dashboard only; no API or data change.

## Verification

Full Playwright suite in the pre-installed Chromium, `pnpm build` bundle budget,
`pnpm test:api`, and `pnpm check:workflow`. No real screen reader or Safari run.
