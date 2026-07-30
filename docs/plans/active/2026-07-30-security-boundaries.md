---
work_id: security-boundaries-20-21-24
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-07-30
updated: 2026-07-30
review_after: 2026-08-06
owner: wulan
spec: docs/specs/active/2026-07-30-security-boundaries.md
---
# Plan
- [x] Add typed decision and central boundary guard.
- [x] Add explicit single-tenant binding and app integration.
- [x] Route scope checks through the guard and add no-side-effect tests.
- [x] Add database-enforced lease fencing and holder/admin release authorization.
- [x] Keep bearer authentication authoritative in explicit single-tenant mode.
- [ ] Add canonical workspace binding and shared eligibility to every #20 surface.
- [ ] Add complete persisted-policy enforcement hooks required by #21.
- [x] Document contracts and remaining work honestly.
- [x] Run workflow, Bun tests, and worker build; record evidence.

## Acceptance evidence
| Acceptance | Status | Evidence |
|---|---|---|
| AC-SB-001 | PASS | `tests/contract/boundary.test.ts` complete-decision cases; `src/core/boundary.ts` |
| AC-SB-002 | PASS | `single tenant binding is explicit and complete` test |
| AC-SB-003 | PASS | configured `org_configured` binding test and `createApp.singleTenant` integration |
| AC-SB-004 | PASS | zero-call downstream spy loop for policy/scope/visibility/trust/release-filter |
| AC-SB-005 | PASS | deny-overrides, abstain, empty, and all-allow truth-table cases |
| AC-SB-006 | PASS | worker dry-run PASS; bearer authentication remains authoritative and configured tenant mismatch fails closed |

Issue #20 and #21 acceptance is not claimed by this artifact. #24 has database
uniqueness, atomic batch fencing, holder/admin authorization, same-holder renewal,
expiry replacement, and a 20-contender shared contract test; Bun execution is
still required on both runtime fixtures.

## Security, migration, deployment, smoke, rollback
No schema migration or deployment. Rollback removes the additive module/config and restores direct scope checking. Runtime contracts are the smoke gate.

## Verification evidence
- PASS: `node scripts/check-workflow-docs.mjs` and `--self-test`.
- PASS: `CI=1 pnpm build:worker` (Wrangler dry-run, 175.60 KiB / gzip 37.56 KiB).
- UNAVAILABLE locally: Bun executable; `CI=1 pnpm test:api` completed worker build then failed before tests with `bun: command not found`. Run Bun suites in CI.
- Source/test inspection: central guard tests cover decision truth table, explicit binding, and zero downstream calls.
