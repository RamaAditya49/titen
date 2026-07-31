---
work_id: reference-agent-plugin
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-07-31
updated: 2026-07-31
review_after: 2026-08-14
owner: CADIS
spec: docs/specs/active/2026-07-31-reference-agent-plugin.md
---
# Plan

- [x] Inventory every Ponytail marker, trace the existing MCP/package paths, and
  verify current official Codex, Claude, Pi, OpenClaw, and Hermes host contracts.
- [x] Scaffold the smallest valid repo-marketplace Codex plugin and replace its
  generated skill with the bounded Titen lifecycle/security instructions.
- [x] Add one focused structural test and an installed-tarball MCP handshake
  without adding a dependency or a second server.
- [x] Update agent integration, quick-start, protocol, and Ponytail debt truth.
- [x] Validate/install the plugin in an isolated Codex configuration and run the
  focused MCP, plugin, package, workflow, and diff gates.
- [x] Run independent security, packaging, host-UX, and Ponytail reviews; fix all
  blockers without widening the approved scope.
- [ ] Commit with the required attribution, push, open and merge a reviewed PR,
  remove only the merged temporary branch/worktree, and move this pair to done.

## Verification before the implementation PR

- Plugin and skill validators pass; an isolated Codex CLI 0.146.0 marketplace
  add/install discovers and enables `titen-memory@titen` with its URL-free MCP
  dependency metadata intact.
- Focused plugin/MCP protocol tests pass 14/14; the real installed-tarball smoke
  authenticates, initializes MCP 2025-11-25, and discovers exactly seven tools.
- Full gates pass: 65 integration, 71 Cloudflare D1, and 90 Bun/vector/SDK tests,
  plus Worker dry-build, workflow checker/self-test, route docs, shell syntax,
  diff checks, and all 11 trigger-based Ponytail markers.
- Seven parallel review roles covered MCP/debt inventory, Codex/Claude research,
  Pi/OpenClaw/Hermes research, security, packaging, host UX, and final Ponytail
  simplicity. Security, packaging, host UX, and final Ponytail reviews are clean.

## Acceptance evidence mapping

- AC-RAP-001: repository tree/diff inspection plus existing dual-runtime MCP
  parity and protocol suites.
- AC-RAP-002: plugin validator, isolated marketplace add/install/list output,
  and skill discovery inspection.
- AC-RAP-003: structural secret/URL scan and documented user-level `codex mcp
  add` configuration using `TITEN_API_KEY`.
- AC-RAP-004: skill content assertions and independent security review.
- AC-RAP-005: `scripts/verify-pack.sh` against the real packed tarball.
- AC-RAP-006: focused plugin integration test with positive and negative path,
  name, secret, and tool-list assertions.
- AC-RAP-007: architecture matrix and regenerated Ponytail ledger retaining
  explicit host-specific upgrade triggers.

## Security, migration, deployment, smoke, and rollback

No schema, canonical data, runtime, or production deployment changes are
planned. Credentials stay outside source control and the isolated install smoke
uses a temporary Codex home. Before merge, rollback is branch deletion. After
merge, rollback is a documentation/plugin removal change; the existing MCP and
npm service remain independently usable.
