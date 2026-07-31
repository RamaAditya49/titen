---
work_id: version-discovery
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
spec: docs/specs/done/2026-07-31-version-discovery.md
---
# Plan

- [x] Reuse package metadata as the single implementation version and separate
  it from the existing deployment revision in MCP initialization.
- [x] Add the smallest explicit release-manifest client and wire
  `titen version --check` without changing ordinary CLI startup.
- [x] Add focused injected-response, CLI side-effect, dual-runtime MCP, and
  packed-artifact checks.
- [x] Document manual CLI/plugin update ownership and record the compatible
  change under `CHANGELOG.md` Unreleased.
- [x] Run focused and repository-required local checks, inspect the full diff,
  and confirm the original checkout plus other worktrees remain untouched.
- [x] Commit with the required C.A.D.I.S. attribution, push, merge the reviewed
  change without GitHub Actions, verify `origin/main`, and move this pair to
  `done` with terminal evidence.

## Acceptance evidence

- AC-VER-001: CLI integration test plus an injected valid schema-1 manifest and
  an empty command working directory.
- AC-VER-002: focused release-manifest test covering response status, schema,
  channel, and version rejection with no remote URL or command consumption.
- AC-VER-003: shared contract assertion on both runtimes, Bun protocol test,
  Worker dry-build, and installed-tarball MCP initialization.
- AC-VER-004: README, agent-plugin guide, release guide, and Actions-tree audit.
- AC-VER-005: package manifest/diff inspection, tool-count tests, migration
  inventory, and explicit-command-only CLI tests.

## Security, migration, deployment, smoke, and rollback

No data migration or runtime deployment is required. The network response is
display-only after strict validation; update and release URLs are fixed local
constants. The check has a bounded timeout and runs only when explicitly
requested. Before merge, rollback is branch deletion; after merge, rollback is
a normal revert. The website remains a separate manual deployment and its live
endpoint is smoke-tested only after that deployment exists.

## Verification

- Focused CLI/MCP integration passed 21/21; the injected release manifest proved
  success, invalid-channel rejection, HTTP failure, version comparison, exact
  output, and an empty command directory.
- Bun contract passed 92/92; Cloudflare D1 passed 98/98; the combined Bun,
  vector, and SDK lane passed 120/120; all integration tests passed 165/165.
- Worker dry-build, compiled Bun CLI, static dashboard build, browser tests
  10/10, live-dashboard adapter smoke, route docs, workflow/self-test, Ponytail
  debt, and diff checks passed.
- `scripts/verify-pack.sh` installed the packed `titen-memory-0.4.0.tgz`, checked
  the exact CLI and MCP versions, bootstrapped/served it, imported the Node SDK,
  and ran the global executable with Bun as the only runtime on `PATH`.
- Production `https://titen.dev/version.json` returned schema 1 with stable CLI
  0.4.0 and plugin 0.1.0; the real `titen version --check` reported both as
  expected, and the release/install links plus `www` manifest returned 200.
- `.github/workflows/` remains absent. The dirty original Titen checkout and the
  separately owned Titen Web checkout were inspected read-only and unchanged.
- Commit `e1a39ccdddae8a2369243f4e2c0aeeb9a72785d5` carries the exact C.A.D.I.S.
  trailer and was fast-forwarded directly to `origin/main`; no remote feature
  branch or pull request was created. Independent final review returned CLEAR
  with no blocker or actionable non-blocker.
