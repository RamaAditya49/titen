---
work_id: purge-cascade-relation
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-10
updated: 2026-11-10
owner: maintainers
spec: docs/specs/done/2026-11-10-purge-cascade-relation.md
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

On `rama-tuf`: `pnpm typecheck` passed, `pnpm test:api` passed (D1 harness 9, contract and SDK 185), `pnpm test:integration` passed (308), and
`pnpm check:workflow` passed. The new contradicting-source case failed before the fix. One unrelated atlas case failed once and passed on two reruns.
