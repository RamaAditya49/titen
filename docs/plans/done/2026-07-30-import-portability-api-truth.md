---
work_id: import-portability-api-truth
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: Wulan
spec: docs/specs/done/2026-07-30-import-portability-api-truth.md
---
# Plan

- [x] Export route inventory and add deterministic portability metadata. (AC-IMP-001, AC-DOC-001)
- [x] Add import reference preflight, dependency ordering, diagnostics, and contract cases. (AC-IMP-002, AC-IMP-003, AC-IMP-004, AC-IMP-005)
- [x] Reconcile API and VPS backup/import documentation, verify current README/ROADMAP status, and label proposals. (AC-DOC-002, AC-DOC-003)
- [x] Run all required available verification and record exact evidence. (all)

## Evidence mapping
- AC-IMP-001: shared contract header assertions.
- AC-IMP-002: shared child-before-parent contract case.
- AC-IMP-003: shared missing-parent diagnostic case.
- AC-IMP-004: before/after database count assertions.
- AC-IMP-005: repeated import shared contract case on Bun and D1.
- AC-DOC-001: `node scripts/check-route-docs.mjs`.
- AC-DOC-002: checker plus review of proposed section in API reference.
- AC-DOC-003: documentation diff and build.

## Security, migration, deployment, rollback
No schema migration or dependency. Diagnostics disclose only import-local type/field/dependency type. Worker dry-run is required. Roll back this single commit; imported storage format remains version 1 compatible.

## Acceptance evidence

- AC-IMP-001: contract assertion covers deterministic dependency metadata.
- AC-IMP-002: shared child-before-parent import case passes by construction; targeted Bun execution was unavailable because Bun is not installed on this host.
- AC-IMP-003: shared case asserts 422 `UNRESOLVED_REFERENCE` and non-disclosure.
- AC-IMP-004: shared cases compare project, observation, claim, and claim-source counts before and after failed project/source preflights.
- AC-IMP-005: shared case repeats import and asserts one row; the same CASES suite is consumed by Bun and D1 harnesses.
- AC-DOC-001: `node scripts/check-route-docs.mjs` passed with 58 routes.
- AC-DOC-002: proposed legacy names are explicitly labeled unimplemented; route checker passed.
- AC-DOC-003: API/VPS backup and capability documentation updated; issue #14 scope untouched.

## Verification

- `node scripts/check-workflow-docs.mjs`: passed (16 artifacts after closure).
- `node scripts/check-workflow-docs.mjs --self-test`: passed.
- `node scripts/check-route-docs.mjs`: passed (58 routes).
- `pnpm build`: passed; dashboard bundle 9.8 KiB gzip / 80 KiB budget.
- `pnpm test:api`: passed; 135 shared contract/SDK tests across Cloudflare D1 and Bun SQLite.
- `pnpm test:integration`: passed; 28 integration tests.
- `pnpm build:worker`: passed; Wrangler dry-run upload 178.07 KiB / 37.97 KiB gzip.
- `git diff --check`: passed.
