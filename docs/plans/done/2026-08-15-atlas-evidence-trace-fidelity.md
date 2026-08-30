---
work_id: atlas-evidence-trace-fidelity
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-15
updated: 2026-08-15
owner: titen-maintainers
spec: docs/specs/done/2026-08-15-atlas-evidence-trace-fidelity.md
---

# Plan

- [x] Extend the Evidence Trace SQL projection with authorized context and active
   release decorations while preserving complete-pack and retention boundaries.
- [x] Update the shared API types and adapter contract only as needed for the
   additive node/edge fields; preserve existing lens and authorization inputs.
- [x] Replace the generic Atlas grid renderer with a small deterministic layout:
   central claim, observation rails, labeled SVG paths, and context/release
   side nodes, including responsive and accessible states.
- [x] Verify Memories → Atlas handoff and add shared Bun/D1, adapter, and browser
   tests for node types, labels, hidden context, empty/error, and mobile layout.
- [x] Update API/architecture/dashboard/release documentation, run all gates, and
   deploy the package dashboard/web/server only after smoke evidence is ready.

## Acceptance evidence mapping

| Acceptance | Planned evidence |
| --- | --- |
| AC-AT-001 | Bun/D1 authorization contract with private/team/org, retention, context, and release rows |
| AC-AT-002 | Evidence Trace fixture asserting node types, relation labels, and claim-centered response |
| AC-AT-003 | Hidden context item fixture asserting no context node or partial edge |
| AC-AT-004 | Browser Memories handoff test asserting request and Atlas activation |
| AC-AT-005 | Browser/SVG assertions for center claim, edge labels, and responsive node layout |
| AC-AT-006 | Browser/API pending, empty, and error state assertions |
| AC-AT-007 | Shared contract, adapter, Astro build, package, and deployment smoke |

## Security and rollback

No migration or dependency is planned. Context decoration is emitted only for
an actor-owned or explicitly delegated complete context whose claims remain
authorized; release decoration is emitted only for a current active release
whose source claim remains authorized. Rollback is a package/dashboard revert;
canonical evidence and claims are never rewritten.

## Verification

- `pnpm test:all`: Bun/D1/SDK contracts passed, 229 integration tests passed,
  9 browser tests passed, 2 skipped; build and workflow self-checks passed.
- `npm view titen-memory@0.8.5`: published with the expected package tarball.
- deployment-host: `npm-0.8.5`, health/readiness/dashboard `200`, protected route
  `401`, with a SQLite and package backup at the release backup path.
- titen.dev: Cloudflare deployment `d6dbbfba-21d4-4820-afde-1551462c7598`,
  `/version.json` `0.8.5`, release and API docs smoke `200`.
