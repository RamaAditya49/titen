---
work_id: purge-cascade-relation
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-11-10
updated: 2026-11-10
review_after: 2026-11-17
owner: maintainers
spec: docs/specs/active/2026-11-10-purge-cascade-relation.md
---
# Purge cascade relation plan

Goal: a purge redacts only the claims whose statement depends on the purged observation.

- [x] Add a failing contract case: one claim with two `supports` sources and one `contradicts` source; purge the contradicting source.
- [x] Narrow `dependentClaim` in `purgeObservation` to relations `supports` and `qualifies`.
- [x] Keep the legal-hold preflight relation-blind. It must agree with the trigger `record_history_purge_respects_holds`.
- [x] Add contract cases for the `supports`, `qualifies`, legal-hold, and evidence-listing criteria.
- [x] Update `docs/reference/api.md` and CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-PRG-001 | Contract case "purging a contradicting source keeps the claim, and purging a supporting source revokes it" |
| AC-PRG-002 | Contract case "purging a contradicting source keeps the claim, and purging a supporting source revokes it" |
| AC-PRG-003 | Contract case "a legal hold on a claim blocks the purge of its supporting and contradicting sources" |
| AC-PRG-004 | Contract case "purging a contradicting source keeps the claim, and purging a supporting source revokes it" |
| AC-PRG-005 | Contract case "purging a qualifying source redacts and revokes the claim" |
| AC-PRG-006 | Contract case "a legal hold on a claim blocks the purge of its supporting and contradicting sources" |

## Rollback

Revert the commit. No schema or data change. The cascade again covers every
cited claim.

## Verification

`pnpm test:api` and `pnpm test:integration` on `rama-tuf`, and
`pnpm check:workflow`.
