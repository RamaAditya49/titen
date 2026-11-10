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
---
# Purge cascade follows the source relation

Issue #404. `DELETE /v1/observations/:id` redacts and revokes every claim that
cites the purged observation. The dependency predicate in `purgeObservation`
ignores `claim_sources.relation`. A claim that cites the observation only as
`contradicts` loses its statement, although its supporting evidence is intact.
The statement cannot be recovered from canonical SQL.

Scope: `src/core/observations.ts` (`purgeObservation`: the cascade predicate
and the redacted-claim count),
`docs/reference/api.md`, the contract suite, and `CHANGELOG.md`. No schema,
route, or response-shape change.

## Decisions

| Question | Decision |
| --- | --- |
| `qualifies` sources | The cascade includes them. A qualifying note can shape the claim wording, so erasure stays conservative. |
| Dispute state | A claim that keeps a purged `contradicts` source keeps its status. Conflict resolution stays explicit. |
| Legal hold | A hold on a claim still blocks the purge of every observation that the claim cites, in any relation. A hold preserves the full evidence record of the claim. The database trigger `record_history_purge_respects_holds` enforces this rule, so the fix needs no migration. |
| Past purges | The fix is forward-only. Overwritten statements cannot be restored. The CHANGELOG states this. |

## Design

A dependent claim is a claim with a `claim_sources` row for the purged
observation whose relation is `supports` or `qualifies`. One SQL fragment
carries this definition. The cascade statements and the
`dependent_claims_redacted` count use it. The legal-hold preflight does not
change. A claim that cites the
observation as both `contradicts` and `supports` is dependent.

## Acceptance criteria

- **AC-PRG-001 — Event-driven:** When an observation that is only a `contradicts` source of a claim is purged, Titen shall keep that claim's statement, status, and version unchanged.
- **AC-PRG-002 — Event-driven:** When an observation that is a `supports` source of a claim is purged, Titen shall redact and revoke that claim.
- **AC-PRG-003 — State-driven:** While a legal hold protects a claim, Titen shall refuse the purge of an observation that only contradicts that claim.
- **AC-PRG-004 — Event-driven:** When a claim keeps a purged contradicting source, Titen shall list that source in `GET /v1/claims/:id/evidence` with its tombstone marker and content hash, without its original content.
- **AC-PRG-005 — Event-driven:** When an observation that is a `qualifies` source of a claim is purged, Titen shall redact and revoke that claim.
- **AC-PRG-006 — State-driven:** While a legal hold protects a claim, Titen shall refuse the purge of an observation that supports that claim.

## Done conditions

The contract suite covers each criterion on Bun SQLite and on the D1 harness.
The existing purge and legal-hold cases still pass. `docs/reference/api.md`
states the dependency definition.
