---
work_id: retrieval-query-shape-20260731
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
spec: docs/specs/done/2026-07-31-retrieval-query-shape.md
---
# Plan

- [x] Move the existing lexical eligibility/order/limit into one bounded CTE,
  then evaluate dispute and feedback projections only for its survivors.
- [x] Replace the evidence join with bounded `claim_sources` iteration plus an
  authorized canonical observation-ID existence check.
- [x] Add one focused SQL-shape regression and one shared scale regression that
  keeps a late best-ranked claim through candidate and token limits.
- [x] Refresh stale #121 Ponytail triggers without widening the fixed limit or
  adding an abstraction.
- [x] Run focused tests, affected Bun and D1 contracts, route/workflow checks,
  and diff/dependency checks.
- [x] Record reproducible evidence, mark the pair done, and move both artifacts
  to matching `done/` paths.

## Acceptance evidence mapping

- AC-RQS-001: captured SQL-order assertion plus shared late-best-match scale
  case on Bun/SQLite and D1.
- AC-RQS-002: captured evidence query shape and existing multi-candidate
  evidence hydration contract.
- AC-RQS-003: authorization predicates in the captured SQL plus existing
  private/team/cross-organization contract coverage.
- AC-RQS-004: dual-runtime contract, 51-route check, dependency diff, workflow
  checker, and `git diff --check`.

## Security, migration, deployment, smoke, and rollback

Canonical authorization remains inside both queries before any ID is returned.
There is no schema migration, service deployment, or production mutation. The
shared contract is the runtime smoke. Before merge, rollback is branch deletion;
after merge, rollback is a reviewed revert of the two SQL shapes and their tests.

## Verification evidence

- `bun test tests/integration/retrieval-correctness.test.ts`: 4 passed, 0 failed.
- `bun test tests/contract/bun-sqlite.test.ts`: 74 passed, 0 failed.
- `pnpm build:worker && bun test --timeout=20000 tests/contract/cloudflare-d1.test.ts`:
  Worker dry-run passed; 77 tests passed, 0 failed.
- `pnpm test:integration`: 72 passed, 0 failed.
- `bun test tests/contract/vectors.test.ts tests/sdk`: 24 passed, 0 failed.
- `pnpm check:routes`: route documentation passed with 51 routes.
- `pnpm check:workflow`: artifact check and checker self-test passed.
- Ponytail scan: 23 source markers and 23 ledger rows; all retained triggers
  identify an observed ceiling before an upgrade.
- `git diff --check` passed; `package.json`, `pnpm-lock.yaml`, README files,
  changelog, version metadata, and `.github` have no lane diff.
