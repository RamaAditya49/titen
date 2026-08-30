---
work_id: host-compatibility-adapters
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-02
updated: 2026-08-02
owner: ramaaditya
spec: docs/specs/done/2026-08-02-host-compatibility-adapters.md
---

# Protocol-first MCP host compatibility plan

## Steps

- [x] Rebase the old PR scope on current `main`, inspect the real nine-tool MCP
  contract and ten published host packages, and verify the current MCP and Codex
  primary-source capabilities.
- [x] Replace the speculative digest, hook, registry, and universal-installer
  design with the standard MCP instructions plus one stateless stdio bridge.
- [x] Add the initialization guidance and stdio bridge with no new dependency.
- [x] Add protocol, CLI, failure, notification, EOF, and secret-boundary tests.
- [x] Update the smallest relevant agent and install documentation.
- [x] Serialize the dashboard auth-mode smoke on one released listener after
  the full gate exposes the existing random-port collision.
- [x] Verify current Codex, Claude Code, OpenClaw, and Hermes MCP configuration
  against primary documentation and installed CLI help.
- [x] Rewrite the npm README as one ordered install-to-agent path and document
  the four primary hosts plus the generic stdio fallback.
- [x] Add the dedicated titen.dev agent integration page and correct adjacent
  stale MCP, schema, and Cloudflare capability text.
- [x] Run the complete manual gate, package inspection, dependency audit, and
  exact-tarball MCP smoke; inspect the final diff for stale claims or secrets.
- [x] Move this pair to `done/` with terminal evidence and no unchecked work.
- [x] Merge the 0.5.7 follow-up, publish the stable npm and GitHub releases,
  update stable discovery, smoke the registry artifact, and remove the merged
  remote topic branch.

## Acceptance evidence mapping

| Acceptance | Planned evidence |
| --- | --- |
| AC-HC-001 | MCP protocol test asserts task-boundary compile guidance and untrusted-data warning |
| AC-HC-002 | CLI parser and spawned-process tests reject positional input and credential flags |
| AC-HC-003 | local real-service bridge test compares initialize and tools responses with HTTP |
| AC-HC-004 | initialized-notification bridge test observes empty stdout |
| AC-HC-005 | spawned bridge closes stdin and exits successfully within one second |
| AC-HC-006 | malformed-input and unreachable-endpoint tests observe sanitized per-request errors and continued processing |
| AC-HC-007 | direct validation tests reject userinfo, query, fragment, and non-HTTP URLs before fetch |
| AC-HC-008 | agent-package test and documentation grep validate the nine names and explicit-invocation boundary |
| AC-HC-009 | `scripts/verify-pack.sh` plus an installed-tarball stdio handshake against a local Titen service |
| AC-HC-010 | public npm metadata, GitHub release target, stable `titen.dev` manifest, and clean registry install |
| AC-HC-011 | dashboard suites use disjoint upstream lanes, the session test switches auth modes on one listener, and the complete integration gate passes |
| AC-HC-012 | README review, website docs checks/build, installed CLI help, and live host configuration smoke where the host is locally available |
| AC-HC-013 | titen.dev stale-claim grep, docs checker, exact-checkout build, and public page smoke after deployment |

## Release safety

- Keep credentials in environment-only test variables and never print them.
- Use no GitHub Actions; all repository and release gates run locally.
- Publish only after the packed tarball and its hashes match the reviewed source.
- Preserve the previous npm version and release tag as rollback authorities.

## Terminal evidence

## Verification

- PR [#215](https://github.com/RamaAditya49/titen/pull/215) merged the
  protocol-native instructions and stateless stdio bridge as `0.5.6`; PR
  [#216](https://github.com/RamaAditya49/titen/pull/216) merged the verified
  host guide, test-port root fixes, and `0.5.7` release commit
  `f226df0f04b7480b8ebf99df34f6378e5a5dfa88`.
- `pnpm test:all` passed: 110 workerd/D1, 135 Bun/vector/SDK, and 200
  integration tests; the live dashboard verifier passed all six product areas,
  Playwright passed 6 tests with 2 screenshot-only tests skipped, and the
  workflow self-test plus Ponytail ledger passed with zero markers.
- `bash scripts/verify-pack.sh` passed all nine installed-tarball checks;
  `pnpm audit --prod` reported no known vulnerabilities, `git diff --check`
  passed, and the reviewed prose/secret scan found no credential literal.
- The packed `0.5.7` CLI exposed nine tools through a real local service;
  Codex configuration and live Claude Code and Hermes stdio connections passed.
- titen-web cross-checked 84 routes, 9 MCP tools, and 28 navigation entries,
  then built 42 static pages against the exact release checkout.

## Stable release and live surfaces

- npm `latest` is `titen-memory@0.5.7`; its SHA-1 is
  `e3a0c7aa3dc7c48948754e3fcecb25ef2b51e51b`, a clean registry install ran CLI
  `0.5.7`, and annotated tag `v0.5.7` peels to the release commit above.
- The non-draft GitHub Release is
  [v0.5.7](https://github.com/RamaAditya49/titen/releases/tag/v0.5.7).
- titen-web PR [#13](https://github.com/RamaAditya49/titen-web/pull/13)
  merged as `bc110fc0e0ad1d410b593a89e61aa6c1ebc7f83e`; Cloudflare static deployment
  `e3c8e34e-2c06-4b8d-bd67-9065974bb30f` serves CLI `0.5.7`, the release page,
  and the HTML/Markdown agent guide from both `titen.dev` hostnames.
- The retained Cloudflare stack was backed by D1 bookmark
  `00000004-000000e0-000050ba-4832da9f1149daff41dbe2a0f133eda9` and deployed
  as Worker version `0335b2bb-5490-49ee-a35c-c3cb3caaf17a`; readiness reports
  the exact release revision, verified schema 21, Vectorize, Workers AI, and
  background repair, while unauthenticated MCP returns `401`.
- `benchmark-host` runs rootless image `localhost/titen:0.5.7-f226df0` for the API and
  dashboard. A verified production snapshot with SHA-256
  `8fcd6f682dfc92f2b8d2e8b4bbc35825fe5490a9ca220f9440b6359c8b2b30c1`
  passed a restored-data canary, authenticated nine-tool MCP smoke, dashboard
  smoke, active cutover, and restart recovery. Both listeners remain bound to
  loopback and remote probes are denied; the 0.5.5 image, units, and snapshot
  remain available for rollback.

## Closure

- Immediately before this terminal move, GitHub returned zero open Titen
  issues, zero open pull requests, and only `origin/main`; this closure uses one
  disposable documentation branch that is deleted on merge.
- The user's dirty primary checkout was not reset, cleaned, committed, or used
  as release authority.
