---
work_id: retrieval-correctness-20260731
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
spec: docs/specs/done/2026-07-31-retrieval-correctness.md
---
# Plan

- [x] Add one forward FTS rebuild/backfill and update every projection writer.
- [x] Normalize and bound lexical planning with static EN/ID stopwords.
- [x] Scope MATCH by organization and subject before BM25, retaining canonical
  authorization predicates.
- [x] Replace the fixed kind cap with diversity-first budget fill and suppress
  byte-identical active statements in a pack.
- [x] Add focused migration, query, packing, Unicode, morphology, long-query,
  duplicate, and cross-subject regressions.
- [x] Regenerate `PONYTAIL-DEBT.md` after removing the resolved retrieval debt
  markers.
- [x] Run focused tests, both runtime contracts, workflow checks, and diff checks.

## Acceptance evidence mapping

- AC-RET-001: schema-v10 backfill test plus FTS schema/content assertions.
- AC-RET-002: shared plural/gerund contract case on D1 and Bun/SQLite.
- AC-RET-003: focused planner tests and shared Unicode/long-query cases.
- AC-RET-004: retrieval query-shape assertion and shared cross-subject case.
- AC-RET-005: focused packer test and shared budget/duplicate context cases.
- AC-RET-006: package diff and shared-core/runtime verification.
- AC-RET-007: full source-marker scan, ledger row count, and stale issue search.

## Migration, security, rollback, and smoke

The derived FTS tables are rebuilt from canonical SQL in one forward migration;
retry follows the existing atomic migration path. Canonical organization,
subject, project, lifecycle, temporal, and visibility checks remain after the
scoped index scan. Before merge, rollback is branch deletion; after merge it is
a reviewed revert and restore from the deployment snapshot if migration ran.
No production deployment or npm publication belongs to this worktree.

## Verification evidence

- `bun test tests/integration/retrieval-correctness.test.ts`: 4 passed.
- Populated schema-v10 rebuild and dynamic scoped MATCH: passed on Bun and D1.
- `pnpm test:api`: D1 76 passed; Bun/vector/SDK 94 passed.
- `pnpm test:integration`: 72 passed.
- Ponytail debt scan: 24 source markers, 24 ledger rows, zero without a trigger.
- `node scripts/check-workflow-docs.mjs` and `--self-test`: passed.
- `git diff --check`: passed.
