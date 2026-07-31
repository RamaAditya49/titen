---
work_id: open-issue-sweep-and-npm-release
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
spec: docs/specs/done/2026-07-31-open-issue-sweep-and-npm-release.md
---
# Plan

- [x] Capture the immutable starting inventory: local WIP/stash, remote heads,
  open issues and pull requests, tags/releases, npm metadata, and Actions state.
- [x] Review and integrate or explicitly supersede every remote topic branch;
  validate its completed workflow artifacts and remove only a merged branch.
- [x] Build an issue resolution matrix, group shared root causes, and update this
  spec first if a verified issue requires scope outside its current boundaries.
- [x] Land focused fixes from isolated worktrees with the smallest failing tests;
  re-run affected dual-runtime, authorization, migration, and data-loss paths.
- [x] Rewrite and human-review README.md, verify `titen.dev`, run `seng-jelas`
  strictly, and prove the packaged README contains only stable external links.
- [x] Run focused checks after each integration, then the complete local manual
  gate: route/workflow checks, API/integration/browser tests, package smoke,
  production dependency audit, secret scan, and `git diff --check`.
- [x] Resolve every starting GitHub issue with its merged evidence, exact
  duplicate, or concrete Ponytail not-planned reason; verify zero accidental
  closures and no open pull request.
- [x] Finalize the changelog and smallest valid SemVer version, close this
  spec/plan pair with exact evidence, merge the reviewed release pull request,
  and verify the exact merge source before publication.
- [x] From a clean detached checkout of the release commit, run the irreversible
  prepublish gate, publish npm manually, push the annotated tag, generate the
  GitHub release from the changelog, and smoke a clean registry install.
- [x] Remove only merged temporary branches/worktrees, re-audit GitHub/npm and
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
| #117 | Close not planned because Actions are intentionally disabled to keep the repository free of hosted automation cost; publication remains manual. |
| #123 | Record and retain the single-process ceiling, then close worker pools/sharding until measured small-team demand breaches it. |
| #124 | Make FULL durability explicit and retain synchronous context-run evidence; close NORMAL/async persistence as incompatible with acknowledged-write and feedback provenance requirements. |

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

## Verification evidence

- Integration: PR
  [#131](https://github.com/RamaAditya49/titen/pull/131) merged the issue
  sweep; PR [#132](https://github.com/RamaAditya49/titen/pull/132) restored the
  requested C.A.D.I.S credit. Their merge commits carry the required CADIS
  trailer.
- GitHub disposition: all 44 starting issues were closed with a merged fix,
  duplicate/meta closure, or explicit not-planned reason. Final queries returned
  zero open issues and zero open pull requests. The two merged remote topic
  branches were deleted and the release audit found only `refs/heads/main`.
- Release identity: npm `titen-memory@0.3.0`, annotated tag `v0.3.0`, and
  [GitHub Release v0.3.0](https://github.com/RamaAditya49/titen/releases/tag/v0.3.0)
  all identify release commit
  `9f10bfd625ba947897056f1dbc0ab7bfc4ce6304`. Tag object
  `7ff8b3d5a802d68e4af8403d27174824712c3f11` peels to that commit.
- Registry identity: npm `latest` is `0.3.0`; SHA-1 is
  `568d56175257f515ee3c79c7672d62bc39c07dda`; integrity is
  `sha512-R49HwOllKtfn3psuNz4WBW0vVrqJteuGwjatH25djqh4RA5hqbyM5hbd+nlNFtkvlkhuAMmiXrARFodp/wTR/w==`.
  The registry tarball contains 46 files.
- Registry smoke: a fresh `npm install titen-memory@0.3.0` installed no runtime
  dependency, imported `TitenClient` and `TitenError` from the root and SDK
  subpath, explained the missing-Bun path, bootstrapped and served a schema-12
  database, negotiated MCP revision `2025-11-25`, listed all nine tools, and
  ran from a custom global prefix.
- Final manual gate: D1 contract 91 passed; Bun/vector/SDK 112 passed;
  integration 82 passed; browser 10 passed; the live dashboard adapter,
  workflow checker/self-test (44 artifacts), 56-route checker, package smoke,
  production audit, secret scan, and diff check passed. The first loaded-host
  run exposed one Miniflare shim flake; isolated targeted D1 ran 30/30, a full
  API run passed 203/203, and the final clean `pnpm test:all` passed without
  weakening the concurrency contract or adding a retry.
- Documentation: `https://titen.dev` and `https://cadis.digital/` returned
  HTTP 200. The published README prominently links Titen's website, retains
  `Built with C.A.D.I.S Agent`, and reports zero strict `seng-jelas`
  findings.
- Cost policy: repository Actions permission is `enabled: false` and there is
  no workflow. Manual local gates are deliberate because the maintainer wants
  the repository to incur no hosted automation cost.
- Preservation: the original checkout stayed on
  `b19bd917e6dec493261109ad1693097fbb47d7dc`; its tracked diff SHA-256 remained
  `9a3fdfe6f36938bfed608fb30c93b37109bc13ada8f860c9c30612ab44347c88`.
  Stash objects remained `d99c8e3a957f9e4b5d2629ad63f481f377e71421`,
  `fd9181b0fc62221849300c85e071fe8fd7b7c547`,
  `104a17d4e7a0d496b091c746eea7f222d77f516a`, and
  `9f2a2fc918f5af4ba4093ba8752d8832539616be`; all five named untracked-file
  hashes also matched the starting inventory.
- Durable handoff: the verified release outcome and the maintainer's zero-cost
  Actions rationale were stored in repository-scoped `mem0-coding`. No
  credential, prompt, memory content, or raw command transcript was stored.
