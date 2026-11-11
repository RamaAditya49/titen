---
work_id: readiness-operator-failures
status: active
stage: implement
outcome: pending
review_after: 2026-11-18
complexity: complex
created: 2026-11-11
updated: 2026-11-11
owner: maintainers
spec: docs/specs/active/2026-11-11-readiness-operator-failures.md
---
# Readiness operator failures plan

Goal: readiness shows `terminal_error` only for failures that an operator can fix, and a rejected output gets one automatic second run.

- [ ] Add failing contract cases for the readiness state with content failures and with provider failures.
- [ ] Limit the readiness check in `src/core/app.ts` to the operator failure classes.
- [ ] Add failing contract cases for the automatic second run after `unsafe_output`.
- [ ] Make `unsafe_output` on attempt 1 return the job to `pending` without an output hash.
- [ ] Update existing cases that pin a terminal failure on the first `unsafe_output`.
- [ ] Update `docs/reference/`, `docs/dashboard.md`, and CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-RDY-001 | pending |
| AC-RDY-002 | pending |
| AC-RDY-003 | pending |
| AC-RDY-004 | pending |
| AC-RDY-005 | pending |
| AC-RDY-006 | pending |
| AC-RDY-007 | pending |
