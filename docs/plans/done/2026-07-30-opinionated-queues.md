---
work_id: issue-31-opinionated-queues
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: Wulan
spec: docs/specs/done/2026-07-30-opinionated-queues.md
---
# Plan
- [x] Define all three schemas/transitions. (AC-OQ-001)
- [x] Implement authorized reviewer projection, priority and cursor. (AC-OQ-002, AC-OQ-003, AC-OQ-004)
- [x] Delegate actions to canonical claim lifecycle. (AC-OQ-005)
- [x] Add SDK and run feasible verification; runtime contract execution unavailable because Bun is absent. (all)
## Evidence mapping
- AC-OQ-001: FRD/DESIGN review.
- AC-OQ-002: contract priority/pagination test.
- AC-OQ-003: cross-organization/private contract test.
- AC-OQ-004: response assertions.
- AC-OQ-005: lifecycle/audit contract assertion.
## Security, migration, deployment, rollback
No migration/dependency/deployment. Revert routes/projection; canonical records remain valid.

## Completion evidence
Build, Worker dry-run, workflow checks, route-doc check, and diff check passed. Reviewer projection and SDK compile in Worker. Bun is unavailable, so shared runtime tests could not execute locally; no deployment or CI/CD changed.

## Acceptance evidence
- AC-OQ-001: FRD and DESIGN define three queue schemas and transitions.
- AC-OQ-002: reviewer implementation documents and applies deterministic priority and keyset ordering.
- AC-OQ-003: SQL candidate query binds authenticated organization and private actor before mapping/counting.
- AC-OQ-004: reviewer item serializer exposes all required fields.
- AC-OQ-005: action handler delegates to canonical lifecycle functions.

## Verification
- `pnpm build`: PASS.
- `pnpm build:worker`: PASS (Wrangler dry-run).
- Workflow checker and self-test: PASS.
- Route documentation checker: PASS.
- `git diff --check`: PASS.
- Bun runtime tests: not executable because Bun is unavailable on host.
