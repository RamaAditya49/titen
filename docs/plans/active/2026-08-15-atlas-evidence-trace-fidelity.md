---
work_id: atlas-evidence-trace-fidelity
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-15
updated: 2026-08-15
review_after: 2026-08-29
owner: titen-maintainers
spec: docs/specs/active/2026-08-15-atlas-evidence-trace-fidelity.md
---

# Plan

1. Extend the Evidence Trace SQL projection with authorized context and active
   release decorations while preserving complete-pack and retention boundaries.
2. Update the shared API types and adapter contract only as needed for the
   additive node/edge fields; preserve existing lens and authorization inputs.
3. Replace the generic Atlas grid renderer with a small deterministic layout:
   central claim, observation rails, labeled SVG paths, and context/release
   side nodes, including responsive and accessible states.
4. Verify Memories → Atlas handoff and add shared Bun/D1, adapter, and browser
   tests for node types, labels, hidden context, empty/error, and mobile layout.
5. Update API/architecture/dashboard/release documentation, run all gates, and
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
