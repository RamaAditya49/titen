---
work_id: typecheck-baseline-306
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-09-21
updated: 2026-09-21
owner: maintainer
---

# Repository typecheck baseline

## Problem

Issue #306 reports a failed contributor typecheck. Current main reproduces 100 diagnostics across 20 files.
The release gate does not run that check. Maintained fixtures have stale types, and four archived probes retain their original execution paths.

## Scope

- Correct maintained script, contract, integration, and SDK fixture types.
- Keep strict checks for maintained sources, including tests and examples.
- Preserve the four archived probes without changes.
- Check archive content hashes and their exact existing compiler diagnostics in a separate lane.
- Run both lanes through `pnpm typecheck` and the manual release gate.
- Deploy the checked revision to the existing Bun service and dashboard after a verified backup.

## Constraints

This work implements the contributor gate for PRD FR-9 and the repository verification rules.
Use existing dependencies. Keep public APIs, data formats, authentication, and runtime behavior unchanged.
Do not add compiler suppressions or reduce strictness. Keep all maintained tests in the compiler input.
The release impact is `none`: this change affects internal tests and contributor checks.
Keep the package version at 0.10.0 under the release policy. Identify the deployment by its Git revision.
Do not change public release discovery metadata or publish an unchanged npm version.

## Risks and recovery

An archive exclusion could conceal future errors. Use exact paths, content hashes, and exact diagnostic matching.
Fixture changes could alter test behavior. Run the complete release gate on both supported test runtimes.
A deployment could interrupt the existing service. Retain its package, service configuration, and verified canonical backup for rollback.
No database migration is required. Keep private deployment details outside public artifacts.

## Acceptance criteria

- **AC-TC-001 — Event-driven:** When a contributor runs `pnpm typecheck`, Titen shall exit zero after checking every maintained TypeScript source.
- **AC-TC-002 — Ubiquitous:** Titen shall preserve the four archived probe files byte for byte.
- **AC-TC-003 — Unwanted behavior:** If an archived probe changes or its compiler diagnostics differ, then Titen shall fail the historical check.
- **AC-TC-004 — Event-driven:** When a maintainer runs `pnpm test:all`, Titen shall run both typecheck lanes and the existing release tests.
- **AC-TC-005 — Event-driven:** When the candidate is installed, Titen shall pass package verification and SDK declaration checks.
- **AC-TC-006 — Event-driven:** When deployment completes, Titen shall report the candidate revision and pass readiness, dashboard, and authenticated MCP checks.

## Done conditions

All acceptance criteria have reproducible evidence. The fix is on main and the deployed revision passes production smoke.
The issue is closed. This spec and its paired plan move to their matching done paths.

## Acceptance evidence

| Criterion | Result |
| --- | --- |
| AC-TC-001 | `pnpm typecheck` passed with zero maintained-source diagnostics. |
| AC-TC-002 | All four archive hashes matched, and their Git diff stayed empty. |
| AC-TC-003 | Five checker regression tests passed after an observed failing baseline. |
| AC-TC-004 | The complete release gate passed with 559 tests and five optional screenshot skips. |
| AC-TC-005 | SDK builds and all nine package checks passed. Eight additional MCP compatibility tests passed. |
| AC-TC-006 | Revision `git-905d865a3332` passed readiness, dashboard, integrity, and authenticated MCP smoke after a verified backup. |

PR #308 merged the implementation. Issue #306 closed after production verification.
The paired plan records the command results and deployment evidence.
