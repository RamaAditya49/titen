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

The terminal `0.3.0` closure is withdrawn. Keep this pair active until the
reviewed `0.3.1` artifact has complete registry, tag, release, and issue
evidence.

- [x] Capture the immutable starting inventory: local WIP/stash, remote heads,
  open issues and pull requests, tags/releases, npm metadata, and Actions state.
- [ ] Review and integrate or explicitly supersede every remote topic branch;
  validate its completed workflow artifacts and remove only a merged branch.
- [x] Build an issue resolution matrix, group shared root causes, and update this
  spec first if a verified issue requires scope outside its current boundaries.
- [x] Land focused fixes from isolated worktrees with the smallest failing tests;
  re-run affected dual-runtime, authorization, migration, and data-loss paths.
- [x] Reproduce issue #133, trace every typed SDK caller through
  `requestWithMeta()`, add table-driven envelope-shape regressions, and reject
  invalid successful JSON at that one shared boundary without retry machinery.
- [x] Rewrite and human-review README.md, verify `titen.dev`, run `seng-jelas`
  strictly, and prove the packaged README contains only stable external links.
- [x] Run focused checks after each integration, then the complete local manual
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
- [x] After the issue #133 fix passes focused and package gates, record it in the
  changelog, set `package.json` to `0.3.1`, and verify the pnpm lockfile remains
  valid and unchanged because it does not store the root package version.
- [ ] Remove only merged temporary branches/worktrees, re-audit GitHub/npm and
  the preserved original checkout, then record the durable non-secret handoff.

## Issue disposition

This matrix fixes shared root causes once. Final GitHub comments link each issue
to its merged evidence or to the concrete decision recorded here.

| Issues | Resolution |
| --- | --- |
| #83, #84, #85, #120, #122 | One FTS v11 migration and retrieval/packing batch; merged into this release branch. |
| #101 | Prevent duplicate statements inside one context pack and document deterministic import for re-sync; automatic write-time convergence remains outside the evidence-preserving contract. |
| #88, #91, #93, #95, #97, #98 | One SDK/MCP batch: project resolution, evidence-to-claim recall, timeout/signal composition, misuse guard, typed results/error metadata, and truthful schemas/envelopes. |
| #94, #108 | Runnable README flow, accurate injection language, packaged security guidance, input hardening, and security-file packaging. |
| #92, #99, #118, #119 | One validation/erasure batch for audited tombstoning, field paths/depth, timestamp ordering, and foreign references. |
| #102, #103, #104, #106 | One collaboration-integrity batch for atomic checkpoints/handoffs, handoff readability, principal idempotency, and monotonic event cursors. |
| #110, #111, #112, part of #116 | One bounded portability/backup batch; portable canonical dependencies only, byte-safe pages, explicit authority, and atomic verified backup. |
| #100, #105, #107, remainder of #116 | One operational batch for actionable CLI errors, maintenance of ephemeral bookkeeping, high-value audit coverage, quiet/dry-run/export operations, and native operator guidance. |
| #114, #121 | One portable SQL-shape batch that bounds candidates before correlated hydration; no scheduler or provider abstraction. |
| #79, #82 | Close as umbrella issues after every referenced focused issue has its own resolution; no second competitive or HA framework. |
| #86 | Close after #84/#85: score components are relative candidate signals, while zero-result noise and fixed packing were the current defects. |
| #89 | Close after #88/#91: authorized compile already covers search without duplicating the retrieval API or removing required subject scope. |
| #96 | Close as duplicate of #80. |
| #80, #81, #87, #90 | Close not planned: explicit conflict evidence, the current remote MCP boundary, full explainability, and host support remain deliberate until their recorded triggers occur. |
| #115 | Close the in-core token-bucket proposal not planned; rate limits stay at authenticated ingress where Cloudflare and VPS controls are authoritative. |
| #117 | Close not planned because manual npm publication and disabled GitHub Actions are an explicit project decision. |
| #123 | Record and retain the single-process ceiling, then close worker pools/sharding until measured small-team demand breaches it. |
| #124 | Make FULL durability explicit and retain synchronous context-run evidence; close NORMAL/async persistence as incompatible with acknowledged-write and feedback provenance requirements. |
| #133 | Reject non-object 2xx JSON envelopes once in `requestWithMeta()`; cover every JSON top-level shape and typed callers, then publish the compatible correction as `0.3.1`. |

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
- AC-SWP-011: table-driven SDK tests for array, `null`, string, number, boolean,
  and valid object responses through both `requestWithMeta()` and a typed
  convenience method, including `TitenError` status/request-ID/metadata checks.
- AC-SWP-012: changelog and package version diff, frozen-lockfile verification,
  focused SDK and package gates, annotated-tag peel, npm/GitHub metadata, and
  clean `0.3.1` registry smoke against the exact reviewed source.

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
