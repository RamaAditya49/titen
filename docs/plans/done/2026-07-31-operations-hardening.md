---
work_id: operations-hardening-20260731
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
spec: docs/specs/done/2026-07-31-operations-hardening.md
---
# Plan

- [x] Add the CLI quiet flag and one startup-error boundary; close SQLite when
  `Bun.serve` fails before ownership transfers to the returned server handle.
- [x] Gate observation, claim, import, and purge outbox statements on the
  existing vector capability without changing configured drain semantics.
- [x] Add one portable bounded maintenance batch for expired idempotency and
  checkpoints plus expired or released leases only.
- [x] Fold content-free audit statements into the selected high-value batches
  and record export only after its authorized page is built.
- [x] Set and test explicit SQLite FULL synchronization while retaining the
  synchronous context-run path.
- [x] Document native ingress controls, telemetry, single-process capacity,
  quiet operation, durability, rollback, and the rejected #115/#123/#124
  expansions.
- [x] Add the smallest focused and dual-runtime regressions, preserve purge
  coverage, then run route/workflow/protected-file/dependency/diff gates.
- [x] Record exact evidence, mark this pair done, and move both files to their
  matching `done/` paths.

## Acceptance evidence mapping

- AC-OPS-001 and AC-OPS-002: subprocess CLI collision and quiet-server tests.
- AC-OPS-003: no-vector contract counts plus configured vector upsert/purge
  drain regressions.
- AC-OPS-004: deterministic maintenance fixture with over-limit expired rows,
  future rows, and canonical sentinels.
- AC-OPS-005: shared Bun/D1 contract asserting the selected action set and null
  detail/IP fields despite a forwarded-address header.
- AC-OPS-006: shared compile response assertion for explicit checkpoint
  degradation.
- AC-OPS-007: Bun pragma assertion and existing compile/feedback contracts.
- AC-OPS-008: VPS and Cloudflare deployment diff reviewed against current
  native runtime behavior.
- AC-OPS-009: route checker, workflow checker and self-test, package/lock and
  protected-file diff, Ponytail ledger scan, and `git diff --check`.

## Security, migration, deployment, smoke, and rollback

Audit authority comes only from the authenticated principal. Forwarded headers
remain untrusted and absent from canonical audit. Cleanup is bounded, portable
SQL over explicitly ephemeral tables; canonical evidence has no new deletion
path. There is no migration, dependency, production deployment, or external
state mutation in this lane. Dual-runtime contracts are the shared-core smoke;
the Bun integration suite is the runtime smoke. Before merge, rollback is branch
deletion; after merge, rollback is a reviewed revert. Operators restore a
pre-upgrade verified backup only for an incompatible forward migration.

## Verification evidence

- `bun test tests/integration/cli.test.ts tests/integration/maintenance.test.ts
  tests/integration/runtime-hardening.test.ts tests/contract/vectors.test.ts`:
  28 passed.
- `pnpm build:worker` completed at 246.82 KiB / 54.69 KiB gzip, then
  `bun test --timeout=20000 tests/contract/cloudflare-d1.test.ts`: 81 passed.
- `bun test tests/contract/bun-sqlite.test.ts tests/contract/vectors.test.ts
  tests/sdk`: 103 passed.
- `pnpm test:integration`: 77 passed across 13 files.
- `pnpm check:routes`: route docs OK at 52 routes.
- `pnpm check:workflow`: workflow docs and checker self-test passed with 38
  work artifacts before closure.
- Ponytail scan and ledger: 21 source markers, all with a recorded ceiling and
  upgrade trigger.
- Protected-file diff showed no README, changelog, package, lockfile, version,
  or GitHub mutation; `git diff --check` passed.
