---
work_id: post-release-cli-context-hardening-20260801
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-01
owner: CADIS
---
# Post-release CLI and context hardening

## Problem

Exact package `titen-memory@0.4.1` has four independently reported correctness
failures: key revocation can report a false success, key commands can create a
missing database and leak SQLite/Bun internals, key creation leaks the same
internals for an unknown organization, and context compilation does not say
when authorized candidates were omitted only because none fit the token budget.
The frozen `0.4.1` replacement evaluation is therefore terminal `NO-GO` even
when these defects are corrected on `main` for a future release.

## In scope

- Resolve issues #208, #209, and #210 at the shared Bun CLI/database boundary.
- Make existing-state key commands refuse missing or unready databases without
  filesystem mutation or raw runtime diagnostics.
- Make unknown and already-revoked key outcomes explicit and test canonical
  state as well as process output.
- Add deterministic context-packing omission metadata to REST responses and the
  public SDK type, with identical Bun/SQLite and Cloudflare/D1 behavior.
- Document the additive context response and exact `0.4.1` terminal NO-GO.
- Produce a checksummed, non-sensitive release-bound report for issue #211 and
  close all five issues only after merged evidence is available.

## Out of scope

- Publishing a successor npm version, moving npm tags, or changing the existing
  `v0.4.1` tag or GitHub Release.
- Running a costly side-by-side performance benchmark after a frozen release
  already fails a pre-registered security/correctness hard gate.
- Replacing, migrating, reconfiguring, restarting, or otherwise modifying the
  authoritative Mem0 deployment.
- New storage abstractions, dependencies, hosted CI, or GitHub Actions.

## Constraints and risks

- Existing database commands must not silently migrate or create storage.
- CLI errors must be bounded and useful without exposing stack frames, package
  paths, source excerpts, raw SQL, key material, or SQLite diagnostics.
- Budget metadata may count only authorized post-retrieval candidates and must
  not disclose hidden records.
- Context packing remains whole-item and fail-closed; no content truncation or
  budget overrun is permitted.
- Source fixes after publication cannot retroactively change the release-bound
  `0.4.1` verdict.

## Acceptance criteria

- **AC-PRH-001 — Unwanted behavior:** If `key list`, `key revoke`, or local
  `key create` receives a missing database path, then Titen shall exit nonzero,
  leave the path absent, emit one bounded `error:` diagnostic, and emit no raw
  SQLite/Bun stack or source path.
- **AC-PRH-002 — Unwanted behavior:** If an existing database is unmigrated or
  fails the canonical schema check, then Titen shall reject the key operation
  with a bounded schema-readiness error and shall not mutate canonical rows.
- **AC-PRH-003 — Unwanted behavior:** If local key creation references an
  unknown organization, then Titen shall exit nonzero, emit no key material,
  commit no key row, and report that the organization was not found without a
  raw runtime diagnostic.
- **AC-PRH-004 — Event-driven:** When an active key ID is revoked, Titen shall
  persist a non-null revocation timestamp and report success; when the ID is
  unknown or already revoked, Titen shall return an explicit tested outcome
  that never implies an unknown credential was changed.
- **AC-PRH-005 — Event-driven:** When context compilation has authorized unique
  candidates that cannot all fit the available whole-item budget, Titen shall
  return deterministic selected and omitted counts plus an explicit truncation
  or budget-exhaustion state without exceeding `max_tokens`.
- **AC-PRH-006 — Event-driven:** When no eligible candidate is omitted by token
  packing, Titen shall report zero omissions and no budget exhaustion; duplicate
  active statements removed by exact deduplication shall not be mislabeled as
  budget omissions.
- **AC-PRH-007 — State-driven:** While Bun/SQLite and Cloudflare/D1 expose the
  context compile contract, Titen shall return identical packing metadata and
  the public TypeScript SDK shall type the additive fields.
- **AC-PRH-008 — Event-driven:** When the exact published `0.4.1` artifact is
  evaluated against the pre-registered replacement hard gates, Titen shall
  retain a checksummed terminal NO-GO report that records package identity,
  confirmed blockers, skipped comparison work, and unchanged Mem0 authority.
- **AC-PRH-009 — State-driven:** While this work is being integrated, the dirty
  primary checkout shall remain untouched, verification shall run locally
  without GitHub Actions, and rollback shall require only reverting the isolated
  branch or merged commit.

## Done conditions

- Focused CLI, ranking, SDK, and dual-runtime contract regressions pass.
- Full relevant manual gates, workflow self-test, dependency audit, package
  smoke, and diff checks pass from the isolated worktree.
- The REST/API documentation and SDK declarations match observed behavior.
- The terminal `0.4.1` report and checksum contain no secrets or private memory.
- The verified commit is merged directly to `main`, each issue receives exact
  evidence and is closed,
  and temporary remote work is removed without touching the primary WIP.
- This spec and its paired plan move together to `done/` with terminal evidence.
