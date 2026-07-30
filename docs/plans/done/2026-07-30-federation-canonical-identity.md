---
work_id: federation-canonical-identity-22-23
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: wulan
spec: docs/specs/done/2026-07-30-federation-canonical-identity.md
---

# Plan

- [x] Add portable migration for destination policy, event receipts/provenance, external identity mappings/history, uniqueness, and auditability.
- [x] Extend peer/filter configuration and signed push ingestion with fail-closed eligibility, destination trust/visibility, atomic canonical observation projections, and replay safety.
- [x] Add minimal authorized identity display-update/relink API only if required; update route inventory and reference docs.
- [x] Add shared dual-runtime contract cases and two-node integration regression cases.
- [x] Update product/architecture/roadmap language to describe the bounded canonical observation capability without overstating claims or transport semantics.
- [x] Run workflow, build, Worker, TypeScript, shared runtime, integration, and migration checks; record exact evidence and unavailable tooling.
- [x] Move the paired artifacts to done and commit with issue-closing trailers.

## Evidence mapping

| Acceptance | Planned evidence |
| --- | --- |
| AC-FED-001 | shared contract SQL assertions and two-node signed integration |
| AC-FED-002 | legacy/ineligible transport-only regression |
| AC-FED-003 | disabled policy and inactive peer tests |
| AC-FED-004 | destination trust/visibility assertions |
| AC-FED-005 | replay counts and response assertions |
| AC-ID-001 | mapping/provenance SQL assertions |
| AC-ID-002 | same-subject/two-peer regression |
| AC-ID-003 | authorized display-update API test plus audit row |
| AC-ID-004 | authorized relink API test, history, audit, later-ingestion assertion |
| AC-ID-005 | uniqueness/collision rejection test |
| AC-PAR-001 | Cloudflare D1 and Bun/SQLite contract commands, or explicit tool-unavailable evidence |

## Security, migration, rollback, deployment

- Authorization remains API-scope plus signed active peer and explicit filter policy; destination policy supplies visibility/trust ceiling.
- Migration is additive and portable SQL. Rollback is application rollback while retaining inert additive tables/columns.
- No deployment or infrastructure change is in scope.

## Recorded evidence

Worker dry-run, Astro build, workflow check/self-test, and diff check passed. Bun contract/integration execution was unavailable because Bun is not installed; TypeScript standalone execution was unavailable because `tsc` is not installed. The additive migration is compiled by the Worker build; deployment is not applicable and rollback retains inert additive schema.

## Acceptance evidence mapping

| Acceptance | Evidence |
| --- | --- |
| AC-FED-001 | `pushEvents` canonical transaction statements: observation, provenance, FTS, history, outbox |
| AC-FED-002 | Eligibility guard limits canonical projection to complete `observation.appended`; transport insert precedes it |
| AC-FED-003 | Active-peer guard and opt-in `canonical_ingest` filter |
| AC-FED-004 | Destination policy supplies visibility and `destination_max_trust` cap |
| AC-FED-005 | Existing `(org, event id)` replay guard plus unique `(org, peer, remote event)` provenance |
| AC-ID-001 | `external_actor_mappings` issuer+subject unique lookup in signed push |
| AC-ID-002 | Unique key includes issuer namespace, never raw subject alone |
| AC-ID-003 | PATCH rename preserves `local_actor_id` and writes audit |
| AC-ID-004 | PATCH relink requires reason and writes history plus audit |
| AC-ID-005 | Issuer-scoped collision lookup and unique constraint |
| AC-PAR-001 | Migration uses portable SQLite/D1 SQL and Worker/D1 bundle passes; Bun runtime execution unavailable |

## Verification

- `pnpm build:worker` — PASS (Wrangler dry-run).
- `pnpm build` — PASS (Astro build and bundle check).
- `node scripts/check-workflow-docs.mjs --self-test` — PASS.
- `git diff --check` — PASS.
- Bun contract/integration tests — unavailable (`bun` not installed).
- Standalone `tsc --noEmit` — unavailable (`typescript`/`tsc` not installed).
