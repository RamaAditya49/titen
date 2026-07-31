---
work_id: portability-backup-safety-20260731
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
spec: docs/specs/done/2026-07-31-portability-backup-safety.md
---
# Plan

- [x] Harden existing-file SQLite open modes and make backup stage, verify, and
  atomically replace a fixed destination. (AC-PBS-001, AC-PBS-002, AC-PBS-003)
- [x] Define JSONL v2's five-stream dependency graph and retain v1 import
  compatibility. (AC-POR-001, AC-POR-005, AC-POR-008)
- [x] Add principal-scoped and separately audited whole-organization export,
  preserving authenticated organization authority. (AC-POR-002, AC-POR-003)
- [x] Cut export pages on exact UTF-8 request size as well as record count.
  (AC-POR-004)
- [x] Preflight actor mappings, workspace/team dependencies, cross-org IDs,
  evidence, claim supersession, timestamps, and validity intervals before one
  atomic import batch. (AC-POR-005, AC-POR-006, AC-POR-007, AC-POR-010)
- [x] Preserve exact redaction tombstones without rebuilding searchable or vector
  projections, and delete projections for non-current claims. (AC-POR-009)
- [x] Add read-only migration preview and deterministic schema output.
  (AC-OPS-001, AC-OPS-002)
- [x] Reconcile API, data-model, VPS, Cloudflare, and changelog descriptions with
  the implemented boundary and rollback model. (AC-DOC-001)
- [x] Run shared-runtime, CLI, integration, package, route, workflow, and diff
  verification; record only commands actually executed. (all)

## Acceptance evidence mapping

- AC-PBS-001: CLI integration asserts nonzero missing-source exit, no files, and
  no SQLite/internal stack text.
- AC-PBS-002: CLI integration verifies two successful fixed-target snapshots,
  mode `0600`, two canonical organizations after refresh, integrity `ok`, and
  current verified schema.
- AC-PBS-003: CLI integration stamps a future schema, observes backup failure,
  verifies the previous one-org output remains, and finds no temporary residue.
- AC-POR-001: shared contract parses all five v2 headers and imports the five
  streams; API documentation records the exact order and metadata.
- AC-POR-002: shared contract proves an unrelated principal sees zero workspace
  and membership rows and cannot see another actor's private observation.
- AC-POR-003: shared contract proves `all=true` without scope is `403`, exports
  all five streams with an authorized key, and records five audit rows.
- AC-POR-004: shared multibyte contract exports 20 large emoji observations,
  asserts response bytes do not exceed 1,048,576, observes continuation, and
  submits that exact page successfully to import.
- AC-POR-005: shared v2 contracts restore team evidence and two linked claims to
  a fresh organization, and separately accept a revoked claim line before its
  redacted observation dependency.
- AC-POR-006: shared contract observes a missing actor map fail with
  `UNRESOLVED_REFERENCE` and zero workspace writes, then succeeds with an
  authorized explicit map while retaining mapped canonical actor ownership.
- AC-POR-007: shared cases assert cross-org collision, missing dependency, and
  invalid late-record failures leave authoritative counts unchanged.
- AC-POR-008: existing v1 repeated-import and cross-deployment contract cases
  continue to pass on both runtime harnesses.
- AC-POR-009: shared contract imports a valid redaction marker, preserves its
  original hash, asserts zero observation/claim FTS rows and delete outbox work,
  then rejects a spoofed marker without another write.
- AC-POR-010: shared contract rejects extended/short-year timestamps and
  `valid_to <= valid_from`, checking observation/claim counts remain zero;
  importer fields route through shared string and timestamp helpers.
- AC-OPS-001: CLI integration checks all migrations print for a missing path with
  no file created and zero pending print for a current DB with unchanged size
  and mtime.
- AC-OPS-002: CLI integration compares two schema outputs byte-for-byte and
  asserts `INSERT OR IGNORE` plus the fixed epoch sentinel.
- AC-DOC-001: reviewed diffs in `docs/reference/api.md`,
  `docs/reference/data-model.md`, `docs/deployment/vps.md`, and
  `docs/deployment/cloudflare.md`; route checker passes.

## Security, migration, deployment, smoke, and rollback

- Security: export-all requires explicit capability and writes metadata-only
  audit. Actor maps fail before mutation, mapping another principal requires
  `keys:manage`, organization comes only from authentication, and diagnostics do
  not reveal referenced IDs or content. Redaction markers are exact and
  self-authenticating; optional and required strings reuse shared validation.
- Migration: no SQL schema migration or dependency was added. Portable format
  advances from v1 to v2 while v1 import remains accepted. Forward SQL preview is
  read-only and schema emission remains rerunnable.
- Deployment/smoke: production deployment and public smoke are not applicable to
  this isolated branch. Worker dry-build and both real local runtime adapters are
  the bounded evidence; production release belongs to the root release lane.
- Rollback: before merge, delete the branch. After merge, revert the bounded
  implementation commit. If a forward migration has run in deployment, stop
  traffic and restore the verified pre-upgrade SQLite snapshot or recorded D1
  Time Travel bookmark, start the previous artifact, and require `/readyz` before
  returning traffic. JSONL is not the operational rollback boundary.

## Verification evidence

- `pnpm test:api`: passed; D1 79 tests and Bun/vector/SDK 97 tests.
- `pnpm test:integration`: passed; 74 tests.
- Final `bun test --timeout=30000 tests/contract/bun-sqlite.test.ts`: 76 passed.
- Final Worker build plus D1 `--test-name-pattern 'v2 '`: 2 passed; dry-run upload
  240.04 KiB / 53.18 KiB gzip.
- `bun test --timeout=30000 tests/integration/cli.test.ts`: 5 passed after the
  missing-source, failed-refresh, fixed-target, dry-run, and schema additions.
- `pnpm pack --dry-run`: passed for `titen-memory@0.2.1` with the CLI/core sources.
- `pnpm check:routes`: passed with 51 documented routes.
- `node scripts/check-workflow-docs.mjs` and `--self-test`: passed before terminal
  artifact correction and rerun after this pair was added.
- `git diff --check`: passed before implementation commit and rerun for this
  documentation-only correction.
