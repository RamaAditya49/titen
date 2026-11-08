---
work_id: dashboard-danger-dialog
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-03
updated: 2026-11-03
owner: maintainers
spec: docs/specs/done/2026-11-03-dashboard-danger-dialog.md
---
# Dashboard danger dialog plan

Goal: every destructive or release-changing dashboard action names what it
changes before it changes it.

- [x] Add failing browser tests for the keys collection, self-revoke, release activation, and a required reason.
- [x] Add one a `dialog[data-danger-dialog]` element and a `confirmDanger` helper (target list, impact, recovery, optional reason, Cancel autofocus).
- [x] Replace every `confirm()`/`prompt()` call and add a confirmation to release activation.
- [x] Add Created, Last used, key-id suffix, and "This session" to the keys collection; make revoke names unique.
- [x] Sign out with "You revoked this session. Sign in again." after a self-revoke.
- [x] Update the existing end-to-end test to drive the dialog; update docs and CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-UI-KEYS-002 | Browser test "key revocation names its target…": exactly one row contains "This session" with its `…rver` suffix; header shows "Last used" |
| AC-UI-KEYS-003 | Same test: three revoke buttons with three distinct names |
| AC-UI-DANGER-001 | Same test: dialog opens with suffix, "401", and "cannot be undone"; Cancel focused; Escape revokes nothing. Release test: Activate opens the dialog and posts only after confirm |
| AC-UI-DANGER-002 | Same test: own-session dialog says "signed out"; after confirm the sign-in screen shows "You revoked this session. Sign in again." |
| AC-UI-DANGER-003 | Release test: "Revoke release" stays disabled until "Reason (required)" is filled; the posted reason matches |
| AC-UI-DANGER-004 | Both new tests record zero native dialogs; `grep` finds no `confirm(`/`prompt(` in the dashboard |

## Rollback

Revert the commit. Dashboard only; no API or data change.

## Verification

Full Playwright suite in the pre-installed Chromium, `pnpm build` bundle budget,
and `pnpm test:api`. No real screen reader or Safari run.
