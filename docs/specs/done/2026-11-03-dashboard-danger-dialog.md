---
work_id: dashboard-danger-dialog
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-03
updated: 2026-11-03
owner: maintainers
---
# Named targets and one confirmation dialog for destructive dashboard actions

Issue #356. Every dashboard sign-in mints a "Dashboard session" key, and the API
keys table showed only label, principal, scopes, trust, and status. Ten rows
and ten "Revoke Dashboard session" buttons looked identical, nothing marked the
operator's own session, and native `confirm()`/`prompt()` named neither target
nor impact. Release activation had no confirmation at all.

Scope: dashboard only (`src/pages/dashboard/index.astro`,
`src/lib/dashboard-view.ts`, `src/styles/dashboard.css`). One native dialog element
replaces every `confirm()`/`prompt()`: lease release, handoff resolve, approval
decisions, release approve/activate/revoke, grant revoke, key revoke, and
recovery-code regeneration. No API change.

## Acceptance criteria

- **AC-UI-KEYS-002 — State-driven:** While the API keys collection is shown, Titen shall show each key's created time, last-used time, and key-id suffix, and shall mark the key whose `key_id` equals the current dashboard session's `key_id` with the visible text "This session".
- **AC-UI-KEYS-003 — Ubiquitous:** Titen shall give every row-level revoke button in the API keys collection an accessible name that is unique within the collection.
- **AC-UI-DANGER-001 — Event-driven:** When an operator starts a revoke, release, reject, approve, regenerate, or release-activation action, Titen shall open a modal dialog that names the target record, states the impact and whether it can be undone, focuses Cancel by default, and performs the action only after an explicit confirm.
- **AC-UI-DANGER-002 — Event-driven:** When the target of a key revocation is the current dashboard session, Titen shall state in the dialog that the operator will be signed out, and after the revocation shall show "You revoked this session. Sign in again."
- **AC-UI-DANGER-003 — Optional feature:** Where an action requires a reason, Titen shall collect it in a labelled multi-line field inside the same dialog and shall keep the confirm button disabled until the reason is non-empty.
- **AC-UI-DANGER-004 — Ubiquitous:** Titen shall not open a native `confirm()` or `prompt()` dialog for any dashboard action.

## Done conditions

Browser tests cover the keys collection, self-revoke, release activation, and a
required reason; the existing end-to-end dashboard test drives the dialog for
handoff and approval flows. The full browser suite passes.

## Completion evidence

All six acceptance criteria passed; the paired plan maps each to its check.
