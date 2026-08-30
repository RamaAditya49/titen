---
work_id: zero-open-release-sweep-20260801
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-01
owner: CADIS
spec: docs/specs/done/2026-08-01-zero-open-release-sweep.md
---
# Plan

- [x] Capture the starting live issue, pull-request, remote-branch, tag, npm,
  local-worktree, and dirty-checkout inventory without changing user WIP.
- [x] Build the issue matrix from current bodies/comments and source-level
  reproduction; group reports that share one root fix.
- [x] Review pull request #193 and every unique local commit/worktree; integrate,
  supersede, or archive each before branch cleanup.
- [x] Implement the SDK, auth lifecycle, database-permission, and streamed-
  redaction corrections with focused package/runtime checks.
- [x] Implement the extraction, Cloudflare/Bun runtime, shutdown/readiness,
  Vectorize limit, and documentation-command corrections with focused dual-
  runtime checks.
- [x] Implement ranking and current benchmark-gate parity corrections; archive
  historical or terminal `NO-GO` replacement/cutover issues without changing
  their frozen artifacts or adding an unused migration adapter.
- [x] Run focused tests after each root fix, then the complete local manual gate,
  package smoke, production dependency audit, secret scan, and workflow checks.
- [x] Update changelog and package version to the smallest valid SemVer, review
  the exact candidate, and merge it to `main` with the required CADIS trailer.
- [x] From a clean detached checkout, repeat irreversible prepublish checks,
  publish npm manually, push the annotated tag, create the GitHub release, and
  smoke the registry artifact.
- [x] Reply to and close all resolved issues/PRs, remove merged remote branches,
  safely archive unique local WIP, and prove only `main` plus zero open items.
- [x] Record exact terminal evidence, move this pair to `done/`, run the workflow
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
- AC-ZERO-007: terminal benchmark/cutover records and issue comments that retain
  the exact unmet bulk, delta, reconciliation, and reauthorization triggers.
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

## Terminal evidence

### Issue and pull-request disposition

- Pull requests #193 and #207 merged; their remote topic branches were deleted.
- #171, #182–#188, #190–#191, #194–#196, #198, #200–#201, and #203–#206
  closed through the verified root fixes in #207 and received release comments.
- #189, #192, #197, #199, and #202 closed with explicit completed, cancelled, or
  terminal `NO-GO` evidence; no unused replacement adapter or lowered gate was
  added.
- Final live queries returned zero open issues and zero open pull requests.

## Verification

- Focused benchmark, extraction, shutdown, vector, SDK, CLI, and ranking lanes:
  62 passed, 0 failed.
- `pnpm test:integration`: 178 passed, 0 failed.
- `pnpm test:api`: workerd/D1 102 passed; Bun/vector/SDK 126 passed.
- Real Bun/SQLite to scoped Atlas adapter smoke passed; Playwright passed 10/10.
- `bash scripts/verify-pack.sh` passed twice, including from detached release
  commit `88935bac871811066692c1d149df030ab694862d`.
- Workflow/self-test/Ponytail ledger, `git diff --check`, production dependency
  audit, and changed-commit secret scan all passed; audit reported zero
  advisories and gitleaks reported no leaks.

## Release and cleanup

- npm `latest` is `titen-memory@0.4.1`; registry SHA-1 is
  `8928a08db8f8f099a81bfa672baffad7b2e33fcd` and a clean registry install ran
  CLI `0.4.1` plus a plain-Node SDK import.
- Annotated tag `v0.4.1` peels to `88935bac871811066692c1d149df030ab694862d`;
  the matching non-draft GitHub Release was generated from this changelog.
- GitHub reports only `refs/heads/main` at that commit. All temporary local
  worktrees and non-main branches were retired after a verified recovery bundle
  and four WIP archives were written under
  `/srv/titen-workspace/Backups/titen-cleanup-20260801-1208`.
- The user's dirty primary checkout remains at `b19bd917e6dec493261109ad1693097fbb47d7dc`
  with its original modifications and untracked files untouched.
- The separate `titen-web` authority still showed CLI `0.4.0` at the final Titen
  sweep probe. Its `release:sync 0.4.1 --check` identified the exact stale
  manifest and release page; this repository neither edited nor deployed that
  separately assigned checkout.
