---
work_id: import-portability-api-truth
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: Wulan
---
# Import portability and API truth

## Problem
Canonical exports do not declare dependency order, missing references surface as opaque conflicts, and API documentation can drift from the router.

## Scope
Add deterministic export dependency metadata, order-independent import preflight and safe diagnostics, shared portability contract coverage, and an executable route-document consistency gate. Reconcile API/backup/status documentation with implemented behavior.

## Out of scope
Deployment and deploy-script cleanup owned by Shinta in issue #14. This change documents that dependency and does not edit her scope.

## Constraints and risks
No new dependency. Preserve tenant non-disclosure and canonical IDs. Validate all references before mutation. Keep both runtimes on the shared core contract.

## Acceptance criteria
- **AC-IMP-001 — Ubiquitous:** Titen shall emit `dependency_order` and the selected record type's direct `depends_on` values in every canonical export header, using the deterministic order `projects`, `observations`, `claims`.
- **AC-IMP-002 — Event-driven:** When a canonical import contains parents and children in any NDJSON line order, Titen shall preflight the full request and persist records in dependency order.
- **AC-IMP-003 — Unwanted behavior:** If an imported observation or claim references a parent absent from both the request and authenticated organization, then Titen shall return `UNRESOLVED_REFERENCE` with record type, field, and dependency type but no foreign-tenant or record-content disclosure.
- **AC-IMP-004 — Unwanted behavior:** If import preflight fails, then Titen shall leave canonical project, observation, claim, and claim-source counts unchanged.
- **AC-IMP-005 — Event-driven:** When the same valid export is imported repeatedly, Titen shall preserve one canonical copy and return success on both supported runtimes.
- **AC-DOC-001 — Ubiquitous:** Titen shall expose a machine-readable route inventory from the router source and an executable checker shall fail when the documented implemented-route inventory differs.
- **AC-DOC-002 — State-driven:** While a feature is not present in the route inventory, Titen documentation shall label it proposed or unimplemented rather than presenting it as an available endpoint.
- **AC-DOC-003 — Ubiquitous:** Titen shall describe current vector, MCP, webhook, release, export, import, and backup behavior without changing issue #14 deployment scripts.

## Done conditions
All criteria have reproducible evidence; workflow checks, route-doc check, build, Worker dry-run, and available targeted Bun contract tests pass; paired artifacts move to done.
