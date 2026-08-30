---
work_id: dashboard-product-map-session-release
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-01
owner: CADIS
spec: docs/specs/done/2026-08-01-dashboard-product-map-session-release.md
---
# Plan

- [x] Audit the implemented REST contracts, scope/role boundaries, current
  dashboard adapter, release policy, and official private-ingress guidance.
- [x] Add authenticated principal introspection and atomic human-user
  provisioning by reusing the existing key, membership, validation, audit, and
  transaction primitives.
- [x] Add bounded in-process dashboard sessions plus exact allowlisted proxies
  for Memories, Context, Work, Audit, Governance, and Federation.
- [x] Convert the six product-map labels into capability-gated live controls,
  add login/logout and add-user interaction, and preserve accessible failure and
  no-storage behavior.
- [x] Update PRD, DESIGN, API, dashboard, VPS, release discovery, and dedicated
  Tailscale Serve and Cloudflare Tunnel tutorials.
- [x] Run focused and full local security, contract, integration, browser,
  package, route, dependency, bundle, and workflow gates.
- [x] Build and deploy the exact candidate container on `benchmark-host`, preserve a
  rollback target, and run authenticated six-area, add-user, denial, restart,
  persistence, and exposure smokes.
- [x] Prepare and publish the stable npm package, annotated tag, generated
  GitHub Release, and deterministic titen.dev discovery update without GitHub
  Actions.
- [x] Close completed issues/PRs, remove merged remote branches and disposable
  worktrees, record reproducible evidence, and move both workflow artifacts to
  `done/`.

## Acceptance evidence mapping

- AC-DPM-001, AC-DPM-002, AC-DPM-003: adapter and Playwright product-area
  tests plus real Bun/SQLite live-dashboard verification.
- AC-DPM-004, AC-DPM-005, AC-DPM-006: adapter session security tests covering
  cookie attributes, exact Origin/Host, clear-text remote denial, revocation,
  expiry, logout, restart, body bounds, and no credential reflection/storage.
- AC-DPM-007: shared D1 and Bun contract cases for `GET /v1/principal`, including
  invalid, expired, and revoked keys.
- AC-DPM-008, AC-DPM-009: shared D1 and Bun contract cases proving atomic user
  creation, one-time key use, active membership, role/scope non-escalation,
  duplicate rollback, and cross-organization isolation.
- AC-DPM-010: legacy server-key adapter regression and headless API suites.
- AC-DPM-011: browser keyboard/mobile/storage assertions, Astro build, bundle
  check, and dependency/package inspection.
- AC-DPM-012: copyable-command review against current official Tailscale and
  Cloudflare documentation plus local config validation and rollback probes.
- AC-DPM-013: exact-image `benchmark-host` readiness, session, area, user, denial,
  restart, persistence, loopback, resource, backup, and rollback evidence.
- AC-DPM-014: npm metadata and clean install, package shasum/integrity, Git/tag/
  release/revision equality, deployed image label, and dual-host website smokes.
- AC-DPM-015: workflow checker, GitHub issue/PR/branch queries, clean release
  worktrees, and final terminal artifacts.

## Security, migration, deployment, and rollback

No SQL migration or dependency is planned. New API operations use existing
tables and one transaction. Dashboard sessions are opt-in, process-local, and
invalidated by restart; canonical API keys remain hashed in SQL and raw keys
remain only in the operator and active adapter memory. Deploy one exact image
to the existing rootless `benchmark-host` units after a verified snapshot and retain
the prior image and data snapshot. Rollback restores the prior unit/image and,
only if canonical migration or data integrity requires it, the verified
snapshot. Tailscale and Cloudflare Tunnel mappings can be removed independently
without changing Titen data. Publication remains manual; no GitHub Actions file
or hosted release gate is permitted.

## Verification evidence

- `pnpm test:d1`: 107/107 Cloudflare D1/workerd contract tests pass. One combined
  run hit the existing 60-second semantic-readiness timing ceiling and caused a
  dependent `503`; the clean isolated rerun passed both tests and the full lane.
- `bun test tests/contract/bun-sqlite.test.ts tests/contract/vectors.test.ts tests/sdk`:
  131/131 pass, including principal introspection, atomic Add User, hard list
  caps, SDK lens parity, and SDK Add User fields.
- `pnpm test:integration`: 188/188 pass. Focused adapter/session execution is
  21/21 and also passes concurrently with the browser suite.
- `pnpm verify:dashboard-live`: real Bun/SQLite login, all six areas, Add User,
  new-user login, federation, and logout pass through the real adapter.
- `PLAYWRIGHT_PORT=44899 pnpm test`: 5 browser tests pass and 2 documentation
  capture tests are intentionally skipped; `pnpm screenshots` passes 2/2.
- `pnpm build`: dashboard JavaScript plus CSS is 11.9 KiB gzip against the 80
  KiB budget. `bash scripts/verify-pack.sh` passes 9/9 for
  `titen-memory-0.5.2.tgz`.
- `pnpm check:workflow`, `pnpm check:routes`, and `git diff --check` pass with 68
  workflow artifacts, 79 routes, and 20 tracked Ponytail markers.
- Official Tailscale Serve/Linux-operator/grants/container and Cloudflare
  Tunnel/Access/service-token sources are linked directly from
  `docs/deployment/secure-ingress.md`; no GitHub Actions workflow was added.

## Remote deployment and publication evidence

- The source bundle and dashboard archive copied to `benchmark-host` match local
  SHA-256 checksums. Rootless image `localhost/titen:0.5.2-ea44de3` has image ID
  `74cbfda627a62d8329f6a216ff26c256661f3f7d0c7524111e52a44b7cf8677c`
  and labels version `0.5.2`, revision
  `ea44de329b14e0eef42f98a42ba58ccdc91b4ba9`.
- Online backup `pre-0.5.2-20260801T104600Z/titen.db` is owner-only and matches
  SHA-256 `e83ec74cd2688283b974d3614ae58c982447831dd94eb8b1cbd59dca94a61fef`.
  A disposable restore canary reaches verified schema 19 and passes all six live
  areas, login, atomic Add User, new-user login, federation, and logout through
  the exact image; the canary container and volume were removed afterward.
- Production uses the same image for API and dashboard. `/readyz` reports
  revision `ea44de3` and verified schema 19; login and safe principal metadata,
  live Memories, correct 403 capability denials, logout, invalid-key rejection,
  restart recovery, session invalidation, graceful dashboard shutdown, and
  loopback-only ports `127.0.0.1:8787` and `127.0.0.1:4322` pass. Prior units,
  image, and the verified snapshot remain available for rollback.
- npm `latest` is `titen-memory@0.5.2`; registry shasum is
  `4fa93b99d027207175d78502725692882aa25b2f`, registry integrity is
  `sha512-JB+wr3dYT12zg3C4lBxyYW1aWi3DqrW34qbFBUl4Tn48barmTMKYrxpE7SNb+Lvm7wPPNu1FRSSulyGfSkcS5A==`,
  and a clean install reports CLI `0.5.2`.
- Annotated tag `v0.5.2` peels to full revision
  `ea44de329b14e0eef42f98a42ba58ccdc91b4ba9`; the GitHub Release is published,
  non-draft, and non-prerelease at
  `https://github.com/RamaAditya49/titen/releases/tag/v0.5.2`.
- Registry metadata does not expose `gitHead`; an independent comparison proves
  every published source/package file matches the tagged tree byte-for-byte and
  both generated SDK files match a clean release build.
- titen-web `main` commit `f9f74e6a120c4e41b8a773ab26ef84a99fb3708f`
  deployed Cloudflare Worker version
  `bc2b2a00-6512-4fef-aae6-1d8d2925a184`. Cache-bypass smokes on `titen.dev`
  and `www.titen.dev` pass homepage, stable `version.json` 0.5.2, release page,
  API discovery, installer, and Open Graph image. Release sync validates 79/79
  routes, 9/9 MCP tools, 36 pages, exact tag `ea44de3`, and the npm shasum.
- GitHub reports zero open issues and pull requests and only remote `main`. The
  repository Actions permission is disabled, no workflow exists on `main`, and
  the retained legacy workflow record is `disabled_manually`; no hosted action
  can run or incur cost. Patch-equivalent and superseded task worktrees/branches
  were removed after range-diff and clean-tree checks; the unrelated dirty
  primary checkout was preserved.

## Terminal result

All acceptance criteria pass. npm, GitHub, `benchmark-host`, and both discovery hosts
agree on stable 0.5.2 and tagged deployment revision `ea44de3`. The exact
container remains healthy with rollback evidence retained; the public
repository has no open issue, pull request, workflow, or non-main branch. The
paired artifacts are terminal under `done/`.
