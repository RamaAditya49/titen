---
work_id: remember-consolidate-317
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-10-06
updated: 2026-10-06
owner: maintainers
---
# Optional claim on remember

Issue #317. A shared v0.10.4 service with no enrichment model stores `titen_remember` as evidence only. `titen_compile` returns claims, so agents that never call `titen_consolidate` see an empty pack.

## Design and scope

Add optional `consolidate: true` on `POST /v1/observations` and on MCP `titen_remember`. The flag is off when omitted. When set, the same commit inserts the observation and one supporting claim. The claim statement is the observation content. Trust and visibility are copied. A `decision` observation becomes a `decision` claim. Every other observation kind becomes `semantic_fact`. Confidence is 0.8, matching an omitted consolidation confidence. The caller must hold `claims:write`. Content longer than the claim statement limit is rejected. A recalled observation is rejected. No server setting auto-promotes every asserted key. MCP `initialize` instructions state the two-step and the flag. No schema change.

## Acceptance criteria

- **AC-REM-001 — Optional feature:** Where `consolidate` is true and the caller holds `claims:write`, Titen shall store the observation and one supporting claim in one commit, copy trust and visibility, map a decision observation to a decision claim, and return that claim from the next compile on the same subject with `unconsolidated_observations` equal to 0.
- **AC-REM-002 — Ubiquitous:** Titen shall leave a remember call that omits `consolidate` as an unconsolidated observation that compile does not return as an item.
- **AC-REM-003 — Unwanted behavior:** If `consolidate` is true and the credential lacks `claims:write`, then Titen shall return HTTP 403 and shall not store the observation.
- **AC-REM-004 — Unwanted behavior:** If `consolidate` is true for a recalled observation or for content longer than the claim statement limit, then Titen shall reject the request and shall not store a partial claim.
- **AC-REM-005 — Event-driven:** When an MCP client initializes, Titen shall say in `instructions` that compile omits a remember write until `titen_consolidate`, or until remember is called with `consolidate: true`.

## Done conditions

Contract coverage runs on Bun SQLite and D1. The MCP protocol test checks the instructions text and the tool schema. Docs name the flag. No migration.
