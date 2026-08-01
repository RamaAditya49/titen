---
work_id: zero-open-release-sweep-20260801
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-08-01
updated: 2026-08-01
review_after: 2026-08-15
owner: CADIS
spec: docs/specs/active/2026-08-01-zero-open-release-sweep.md
---
# Plan

- [x] Capture the starting live issue, pull-request, remote-branch, tag, npm,
  local-worktree, and dirty-checkout inventory without changing user WIP.
- [ ] Build the issue matrix from current bodies/comments and source-level
  reproduction; group reports that share one root fix.
- [ ] Review pull request #193 and every unique local commit/worktree; integrate,
  supersede, or archive each before branch cleanup.
- [ ] Implement the SDK, auth lifecycle, database-permission, and streamed-
  redaction corrections with focused package/runtime checks.
- [ ] Implement the extraction, Cloudflare/Bun runtime, shutdown/readiness,
  Vectorize limit, and documentation-command corrections with focused dual-
  runtime checks.
- [ ] Implement ranking, benchmark/gate parity, replacement import/reconciliation,
  and quality-floor corrections without weakening locked evidence.
- [ ] Run focused tests after each root fix, then the complete local manual gate,
  package smoke, production dependency audit, secret scan, and workflow checks.
- [ ] Update changelog and package version to the smallest valid SemVer, review
  the exact candidate, and merge it to `main` with the required CADIS trailer.
- [ ] From a clean detached checkout, repeat irreversible prepublish checks,
  publish npm manually, push the annotated tag, create the GitHub release, and
  smoke the registry artifact.
- [ ] Reply to and close all resolved issues/PRs, remove merged remote branches,
  safely archive unique local WIP, and prove only `main` plus zero open items.
- [ ] Record exact terminal evidence, move this pair to `done/`, run the workflow
  checker, commit/push the closure, and preserve a concise shared handoff.

## Acceptance evidence mapping

- AC-ZERO-001: issue matrix, reproduction/focused test commands, merged commit
  links, and final GitHub closure audit.
- AC-ZERO-002: adversarial security, auth, extraction, import, and retrieval
  tests on every affected runtime.
- AC-ZERO-003: strict external TypeScript consumer compile, readiness-shape
  tests, and terminal-cursor iteration regression.
- AC-ZERO-004: Cloudflare workerd provider request, delayed Bun provider,
  maintenance/shutdown, lease-reclaim, and readiness regressions.
- AC-ZERO-005: full-fit and constrained packing tests, disputed-score test, and
  Vectorize capped-query integration evidence.
- AC-ZERO-006: gate self-tests plus current-schema, current-version,
  project-scoped live verification, hard-negative floor, rollback, and soak
  transcripts.
- AC-ZERO-007: import CLI/API tests proving bulk-plus-delta idempotency and a
  machine-readable reconciliation checkpoint with mismatch detection.
- AC-ZERO-008: repeated packaged CLI SIGTERM probes at pre/post side-effect cut
  points, bounded exit, restart reclaim, and truthful readiness evidence.
- AC-ZERO-009: copied Wrangler command check and reviewed changelog-driven manual
  website handoff output.
- AC-ZERO-010: focused/full command transcript, package verifier, audit/secret
  checks, workflow self-test, and clean candidate status.
- AC-ZERO-011: package version/changelog, tag peel, GitHub release, npm metadata,
  integrity digest, and clean installed CLI/SDK/MCP smoke.
- AC-ZERO-012: before/after checkout hashes, recoverable archive inventory,
  remote head list, and zero-open GitHub queries.

## Rollback

- Before merge, drop only the isolated sweep branch; never reset the user's
  primary checkout.
- After merge but before npm publication, revert the reviewed merge on `main`
  and rebuild a new candidate.
- After npm publication, never rewrite the tag or unpublish the package; publish
  a corrective patch and record the failed artifact explicitly.
