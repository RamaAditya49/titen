---
work_id: host-compatibility-adapters
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-02
updated: 2026-08-02
review_after: 2026-08-16
owner: ramaaditya
spec: docs/specs/active/2026-08-02-host-compatibility-adapters.md
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
- [ ] Move this pair to `done/` with terminal evidence and no unchecked work.
- [ ] Merge the 0.5.7 follow-up, publish the stable npm and GitHub releases,
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
