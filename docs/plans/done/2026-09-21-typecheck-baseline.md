---
work_id: typecheck-baseline-306
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-09-21
updated: 2026-09-21
owner: maintainer
spec: docs/specs/done/2026-09-21-typecheck-baseline.md
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
- [x] Review the diff and commit only scoped changes with the required attribution.
- [x] Push the fix branch, merge its pull request, and verify the remote main commit.
- [x] Back up the canonical database, installed package, and service configuration; verify the backup.
- [x] Install the checked candidate and set its revision; restart the service and dashboard.
- [x] Verify readiness, schema, dashboard, unauthenticated rejection, and authenticated MCP discovery.
- [x] Close issue #306 and move both workflow files to done with evidence.

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| AC-TC-001 | `pnpm typecheck` passed in the isolated checkout and again on clean main. |
| AC-TC-002 | All four archive hashes matched, and their Git diff stayed empty. |
| AC-TC-003 | Five regression tests and exact diagnostic comparison passed. |
| AC-TC-004 | `pnpm test:all` passed, including D1, Bun, integration, dashboard, and browser checks. |
| AC-TC-005 | `pnpm build:npm` and all nine `scripts/verify-pack.sh` checks passed. |
| AC-TC-006 | A verified backup preceded deployment; readiness, dashboard, integrity, and authenticated MCP checks passed afterward. |

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

- PR #308 merged the checked source as `905d865a3332e748755134f4825201cb3a9da8d8`.
- The existing Bun service and packaged dashboard now serve revision `git-905d865a3332`.
- Canonical backup integrity, backup checksums, and the previous package/configuration archive passed before deployment.
- Installed candidate SHA-256: `a1b1df195b39f937b42b6ce3ec1db154511a4ab633499372ae63765c3f7a4223`.
- Local and public readiness returned the candidate revision with schema 24 verified. Both services remained active.
- Public MCP rejected unauthenticated requests with 401 and returned all nine canonical and nine compatibility tools with authentication.
- An authenticated project resolution returned the existing project identity. Canonical integrity and foreign-key checks passed after restart.
- Issue #306 closed after production smoke. The package version remains 0.10.0 under the internal-change release policy.
- No schema migration or rollback was required. The verified rollback snapshot remains available to the operator.
