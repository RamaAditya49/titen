---
work_id: open-issue-sweep-and-npm-release
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-07-31
updated: 2026-07-31
review_after: 2026-08-14
owner: CADIS
spec: docs/specs/active/2026-07-31-open-issue-sweep-and-npm-release.md
---
# Plan

- [x] Capture the immutable starting inventory: local WIP/stash, remote heads,
  open issues and pull requests, tags/releases, npm metadata, and Actions state.
- [ ] Review and integrate or explicitly supersede every remote topic branch;
  validate its completed workflow artifacts and remove only a merged branch.
- [ ] Build an issue resolution matrix, group shared root causes, and update this
  spec first if a verified issue requires scope outside its current boundaries.
- [ ] Land focused fixes from isolated worktrees with the smallest failing tests;
  re-run affected dual-runtime, authorization, migration, and data-loss paths.
- [ ] Rewrite and human-review README.md, verify `titen.dev`, run `seng-jelas`
  strictly, and prove the packaged README contains only stable external links.
- [ ] Run focused checks after each integration, then the complete local manual
  gate: route/workflow checks, API/integration/browser tests, package smoke,
  production dependency audit, secret scan, and `git diff --check`.
- [ ] Resolve every starting GitHub issue with its merged evidence, exact
  duplicate, or concrete Ponytail not-planned reason; verify zero accidental
  closures and no open pull request.
- [ ] Finalize the changelog and smallest valid SemVer version, close this
  spec/plan pair with exact evidence, merge the reviewed release pull request,
  and verify the exact merge source before publication.
- [ ] From a clean detached checkout of the release commit, run the irreversible
  prepublish gate, publish npm manually, push the annotated tag, generate the
  GitHub release from the changelog, and smoke a clean registry install.
- [ ] Remove only merged temporary branches/worktrees, re-audit GitHub/npm and
  the preserved original checkout, then record the durable non-secret handoff.

## Acceptance evidence mapping

- AC-SWP-001: issue resolution matrix plus final GitHub issue audit and linked
  commits, duplicate targets, or not-planned comments.
- AC-SWP-002: focused regression tests and shared dual-runtime/security gates for
  every qualifying defect.
- AC-SWP-003: branch divergence review, pull-request review/merge records, and
  final remote branch list.
- AC-SWP-004: README diff, direct website smoke, packaged README inspection, and
  clean npm-page-compatible link audit.
- AC-SWP-005: strict `seng-jelas` output, package verification, and capability
  claim review against the roadmap maturity matrix.
- AC-SWP-006: repository Actions permission, absence of workflow files, and
  manual command evidence.
- AC-SWP-007: changelog diff, package version, annotated tag peel, GitHub release,
  npm registry metadata, and exact source commit.
- AC-SWP-008: focused/full command transcript with all exit statuses recorded in
  the terminal plan evidence.
- AC-SWP-009: clean registry install, SDK import, installed CLI/bootstrap/readyz,
  MCP negotiation, npm version, and digest evidence.
- AC-SWP-010: before/after status, branch pointer, diff hashes, untracked hashes,
  and stash object IDs for the original checkout.

## Security, migration, deployment, smoke, and rollback

Issue fixes may cross authentication, migrations, Cloudflare D1, Bun/SQLite,
and canonical export/import boundaries. Each such fix must fail closed and run
the same shared contract where applicable. No production service deploy is part
of this release; npm and GitHub are the publication surfaces.

Before merge, rollback is branch deletion. After merge and before npm publish,
rollback is a reviewed revert. After npm publish, a bad immutable artifact must
be deprecated and replaced by a corrected patch; unpublish is not the rollback
plan. The user's original dirty checkout is never a release source or rollback
mechanism.
