---
work_id: cross-host-agent-distribution
status: done
stage: done
outcome: cancelled
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
spec: docs/specs/done/2026-07-31-cross-host-agent-distribution.md
---
# Plan

- [x] Freeze the verified host matrix and the per-host environment interpolation
  syntax from current primary documentation.
- [x] Add the Claude/ZCode/OpenClaw bundle, Cursor plugin, Hermes plugin, Pi
  package, and OpenClaw/OpenCode/Windsurf/TRAE kits by copying one canonical
  skill and pointing every host at the existing remote `/mcp` endpoint.
- [x] Extend the focused integration test to validate manifests, marketplaces,
  paths, skill equality, secret hygiene, interpolation syntax, and the nine-tool
  boundary without adding a test dependency.
- [x] Update README, agent guide, architecture, and Ponytail debt so shipped
  support and remaining hook/catalog limits are explicit.
- [x] Run isolated Claude and Hermes package checks, all focused/full repository
  gates, ClawHub package validation, and ClawHub dry-run; fix blockers without
  widening the approved scope.
- [ ] Commit with required attribution, push, open and merge a reviewed PR, then
  publish the exact merged Claude bundle to ClawHub and verify its public record.
- [ ] Record terminal evidence, move this pair to `done`, merge the evidence PR,
  and remove only the merged temporary branch/worktree.

## Acceptance evidence mapping

- AC-CHD-001: repository diff plus existing MCP protocol and dual-runtime
  contract suites.
- AC-CHD-002: Claude strict validator, isolated marketplace install/list, ZCode
  marketplace schema inspection, isolated OpenClaw bundle install/inspect,
  native config validation, and ClawHub dry-run artifact inventory.
- AC-CHD-003: official Cursor schemas plus focused manifest/marketplace/config
  assertions.
- AC-CHD-004: Python syntax/import smoke and isolated Hermes plugin-manager load.
- AC-CHD-005: Pi package manifest/skill assertions and, when available, an
  isolated local package discovery smoke.
- AC-CHD-006: focused config parsing/interpolation assertions and documented
  install steps for OpenCode, Windsurf, and TRAE.
- AC-CHD-007: negative focused tests for secrets, placeholders, names, paths,
  skill divergence, and tool-list drift.
- AC-CHD-008: ClawHub validation/dry-run output plus the live immutable package
  record for the exact merged commit.
- AC-CHD-009: diff scan and manifest inspection proving no hooks, extensions,
  native providers, or transcript code.

## Security, migration, deployment, smoke, and rollback

There is no database migration or service deployment. Credentials remain in
host environment/secret storage; tests use placeholders only. ClawHub reads the
maintainer's existing local auth config without copying it. Before merge,
rollback is branch deletion. After merge, host artifacts can be removed in a
normal revert; after ClawHub publication, an immutable version cannot be erased
as a rollback mechanism, so a corrected superseding version or registry yank is
required. The existing MCP and npm service remain independently usable.

## Current external publication evidence

- The current nine-tool source passes the portable skill validator, plugin
  validator, and focused agent-package parity tests. `titen_compile` remains
  conservatively non-read-only because it records a context run, while
  `titen_remember` remains non-idempotent by default because its idempotency key
  is optional.
- PRs #127 and #128 are merged; the package source is commit
  `1cc8823282c8b660126c17a38a26a8c5452571b6`.
- The standalone `titen-memory@0.1.0` ClawHub skill is the verified earlier
  seven-tool snapshot and passes `clawhub skill verify` with clean static,
  SkillSpector, and VirusTotal results. The current nine-tool source has not
  been published there.
- The earlier bundle source passes local Plugin Inspector with zero breakages
  and zero warnings. Validation and dry-run must be repeated for the current
  nine-tool source before any live publication claim.
- Live bundle publication is still blocked by the upstream ClawHub inspector
  sandbox incident `openclaw/clawhub#3327`. Keep the publication and terminal
  evidence items unchecked until the package itself is public and inspected.

## Closure reason

Cancelled at the external publication boundary. The nine-tool host packages
remain merged, tested, and usable, but the upstream ClawHub inspector incident
prevents an honest immutable bundle publication claim. npm release does not
depend on that separate catalog, so the two unchecked publication items remain
recorded and require a new work item after the upstream service recovers.
