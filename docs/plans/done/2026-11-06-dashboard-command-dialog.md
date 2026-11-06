---
work_id: dashboard-command-dialog
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-06
updated: 2026-11-06
owner: maintainers
spec: docs/specs/done/2026-11-06-dashboard-command-dialog.md
---
# Dashboard command dialog plan

Goal: the topbar trigger searches and jumps the way its label says.

- [x] Add failing browser tests for Enter search, arrow-key jump, focus return, the shortcut hint, authorized destinations, and the 320px layout.
- [x] Make both close controls `type="button"` and put **Go** first among submit buttons.
- [x] Add a combobox input and a listbox of visible nav destinations plus "Search memories for …".
- [x] Return focus to the trigger on close; focus the main region after a jump and the memory search field after a search.
- [x] Show ⌘K or Ctrl K by platform, with `aria-keyshortcuts` and an accessible name.
- [x] Collapse the trigger to an icon at 620px and below.
- [x] Update docs and CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-UI-SEARCH-001 | Browser test "the command dialog searches on Enter…": Ctrl+K, type `rollback`, Enter → Memories is current, the search field holds `rollback`, and a `q=rollback` request is sent |
| AC-UI-SEARCH-002 | Same test: Escape and the "Close search" button both leave focus on `[data-search-open]` |
| AC-UI-SEARCH-003 | Same test: `Releases` offers "Go to Release policy"; ArrowDown highlights it and Enter makes `releases` current |
| AC-UI-SEARCH-004 | Same test: the hint reads "Ctrl K" on the Linux runner, `aria-keyshortcuts="Meta+K Control+K"`, and the accessible name is "Search or jump to (Ctrl K)" |
| AC-UI-SEARCH-005 | Browser test "…fits beside a 320px breadcrumb": the trigger and breadcrumb bounding boxes do not intersect |
| AC-UI-SEARCH-006 | Same test: an `audit:read` principal sees "Go to Audit & Events", no "Release policy", and no memory search option |

## Rollback

Revert the commit. Dashboard only; no API or data change.

## Verification

Full Playwright suite in the pre-installed Chromium, `pnpm build` bundle budget,
`pnpm test:api`, and `pnpm check:workflow`. The ⌘K hint on Apple platforms and
real screen readers were not exercised.
