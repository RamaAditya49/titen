---
work_id: typecheck-baseline-306
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-09-21
updated: 2026-09-21
review_after: 2026-10-05
owner: maintainer
spec: docs/specs/active/2026-09-21-typecheck-baseline.md
---

# Typecheck baseline implementation plan

## Design

Keep `tsc --noEmit` as the maintained source check. Exclude only four named, frozen probe files from `tsconfig.json`.
Run a separate compiler program for those files. Match their SHA-256 hashes and exact diagnostics against a checked manifest.
Reject missing files, changed content, new diagnostics, and removed diagnostics. Document that archived errors remain historical evidence.

Use explicit JSON callbacks, typed SQL rows, complete vector fixtures, and complete Bun fetch doubles for maintained sources.
Use current Miniflare public types for outbound requests and scheduled dispatch. Do not change production contracts to accommodate tests.

## Steps

- [x] Resolve project memory, inspect issue #306, and reproduce the failure on current main.
- [x] Inspect the release policy and current production service commands.
- [x] Add failing archive checker tests for changed content and unexpected compiler errors.
- [x] Implement `scripts/check-historical-harnesses.mjs` and its exact archive manifest.
- [x] Add `typecheck:maintained` and `typecheck:historical` scripts; run both from `typecheck` and `test:all`.
- [x] Correct fixture and script types; keep runtime assertions intact.
- [x] Update `CONTRIBUTING.md` and the release guide with both lane contracts.
- [x] Run typecheck, the full release gate, SDK builds, package verification, and workflow checks.
- [ ] Review the diff and commit only scoped changes with the required attribution.
- [ ] Push the fix branch, merge its pull request, and verify the remote main commit.
- [ ] Back up the canonical database, installed package, and service configuration; verify the backup.
- [ ] Install the checked candidate and set its revision; restart the service and dashboard.
- [ ] Verify readiness, schema, dashboard, unauthenticated rejection, and authenticated MCP discovery.
- [ ] Close issue #306 and move both workflow files to done with evidence.

## Verification map

| Criterion | Evidence |
| --- | --- |
| AC-TC-001 | Baseline compiler log; clean `pnpm typecheck`; maintained source input inspection |
| AC-TC-002 | Archive SHA-256 manifest and zero diff for archived probes |
| AC-TC-003 | Archive checker regression tests and exact diagnostic comparison |
| AC-TC-004 | `pnpm test:all`, including D1, Bun, integration, dashboard, and browser checks |
| AC-TC-005 | `pnpm build:npm` and `bash scripts/verify-pack.sh` |
| AC-TC-006 | Private backup record, deployed revision, readiness, dashboard, and MCP smoke |

## Rollback

Restore the previous package and service configuration if candidate readiness or smoke fails.
Restart both services and confirm the previous revision and readiness.
The schema stays unchanged. Preserve the canonical backup; restore it only if integrity verification requires recovery.

## Verification evidence

- `pnpm typecheck` passed: maintained sources have zero diagnostics; four archive hashes and six frozen diagnostics match.
- The archive checker tests failed before implementation and passed afterward: five tests, zero failures.
- `pnpm test:all` passed: 9 D1 harness, 129 D1 contract, 157 Bun/SDK, 246 integration, and 18 browser tests.
- Five optional screenshot tests stayed skipped. The live adapter verification passed all fifteen product destinations.
- `bun test tests/contract/mcp-compat.test.ts` passed: eight tests, zero failures.
- `pnpm build:npm` and all nine `scripts/verify-pack.sh` checks passed.
- Workflow checks, public artifact checks, and `git diff --check` passed.
- Independent review approved the change after checking types, archive coverage, fetch doubles, and scheduled dispatch.
