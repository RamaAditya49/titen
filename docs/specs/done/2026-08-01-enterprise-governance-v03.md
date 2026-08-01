---
work_id: enterprise-governance-v03
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-01
owner: maintainers
---

# Enterprise governance v0.3

## Problem

Titen already stores collaboration memberships, audit metadata, and legacy
governance-shaped tables, but it does not expose or enforce the v0.3 role,
approval, release, retention, legal-hold, or identity-mapping contracts. The
roadmap therefore correctly reports enterprise governance as planned.

## In scope

- Enforce organization roles in addition to explicit credential capabilities
  for governance and membership administration.
- Store versioned, typed claim-approval and retention policies.
- Submit, independently approve, reject, and revoke exact claim-version
  approvals without mutating evidence.
- Manage gateway-bound channels and exact reviewed knowledge-release snapshots.
- Compile audience-isolated channel context from currently eligible releases.
- Apply retention exclusions, with legal hold taking precedence, and block
  observation purge while a hold applies.
- Maintain a vendor-neutral external-identity mapping boundary.
- Append metadata-only audit/events and expose bounded Scope Preview and
  Knowledge Release Atlas projections.
- Preserve identical behavior on Bun/SQLite and Cloudflare/D1.

## Out of scope

- An SSO/SCIM vendor SDK or policy language.
- Anonymous access to Titen, customer transactional data, vector release
  indexes, or automatic purge scheduling.
- Dashboard rendering, canonical memory federation, deployment, or publication.

## Constraints and risks

- SQL remains canonical; no dependency or second service is added.
- Foreign organization IDs must remain indistinguishable from missing IDs.
- Trust, internal visibility, and external release eligibility remain separate.
- Existing v0.1/v0.2 routes and stored data remain compatible.
- Retention first removes retrieval eligibility; irreversible purge remains an
  explicit exact-record operation.

## Acceptance criteria

- **AC-EG-001 — State-driven:** While an organization has active role
  memberships, Titen shall require both the route capability and an authorized
  organization role for membership, policy, approval, release, retention,
  legal-hold, and identity-mapping mutations; a wildcard root credential may
  bootstrap and recover organization ownership.
- **AC-EG-002 — Event-driven:** When an authorized operator creates or updates
  a claim-approval or retention policy, Titen shall validate its typed fields,
  increment its version with expected-version semantics, and append a
  metadata-only audit event.
- **AC-EG-003 — Event-driven:** When a claim approval is submitted, Titen shall
  bind it to one readable exact claim version and visible supporting evidence;
  only an independent owner/admin may approve it to `policy_approved`, reject
  it, or revoke the approval while preserving evidence and history.
- **AC-EG-004 — Event-driven:** When a channel release is drafted, approved,
  activated, revoked, or compiled, Titen shall enforce gateway, audience,
  channel status, validity, exact active source version, minimum trust, and
  separation of duty before returning only reviewed snapshot content.
- **AC-EG-005 — Unwanted behavior:** If a caller uses a foreign organization
  resource, another channel/audience, a non-service gateway identity, an
  unreleased claim, or a stale/revoked source version, then Titen shall return
  no protected content and shall not mutate canonical state.
- **AC-EG-006 — State-driven:** While an exact observation or claim is under an
  active legal hold, Titen shall not create its retention exclusion or permit
  observation purge; after authorized hold release, bounded retention apply
  may exclude eligible records from every canonical projection.
- **AC-EG-007 — Event-driven:** When an authorized operator maps an external
  provider subject, Titen shall bind it to one existing organization principal
  without storing an identity-provider credential and shall enforce
  organization-local uniqueness.
- **AC-EG-008 — Optional feature:** Where governance Atlas lenses are requested,
  Titen shall require their explicit inspection capability and return bounded
  authorized policy/release projections without impersonating the previewed
  principal or granting access.
- **AC-EG-009 — Ubiquitous:** Titen shall expose the same migration, route,
  status, authorization, audit, and adversarial isolation behavior through the
  Bun/SQLite and Cloudflare/D1 contract fixtures.

## Done conditions

- All acceptance criteria have reproducible dual-runtime evidence.
- Migration integrity, route documentation, workflow, Ponytail debt, build,
  type, integration, and contract checks pass.
- PRD, FRD/API/architecture, and roadmap accurately describe shipped behavior.
- This spec and its paired plan are terminal in `done/` with no unchecked work.

## Verification evidence

- Shared Bun/SQLite contract: 96 passed, including the complete enterprise
  governance journey.
- Vector and SDK contracts: 31 passed.
- Cloudflare/D1 harness: 9 passed; fresh Worker bundle contract: 103 passed,
  including migration rollback/retry and the same enterprise journey.
- Integration suite: 178 passed.
- Worker dry-run bundle and npm SDK build completed successfully.
- Route documentation covers all 78 routes; workflow and Ponytail debt checks
  completed with 19 deliberate debt markers tracked.
