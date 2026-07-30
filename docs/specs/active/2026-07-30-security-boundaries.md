---
work_id: security-boundaries-20-21-24
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-07-30
updated: 2026-07-30
review_after: 2026-08-06
owner: wulan
---
# Security boundary foundation (#20, #21, #24)

## Problem and scope
Boundary crossings need one fail-closed contract. Implement typed policy decisions, a central guard, and explicit configured single-tenant embedding identity. Authenticated credentials remain authoritative. #22 canonical federation promotion and #23 external actor identities are deferred as separate schema-heavy work; no unsafe partial implementation.

## Acceptance criteria
- **AC-SB-001 — Ubiquitous:** Titen shall authorize a protected boundary only when tenant, scope, policy, visibility, trust, and release-filter decisions are explicit and complete.
- **AC-SB-002 — Unwanted behavior:** If a tenant is absent, unknown, or differs from the configured single tenant, then Titen shall deny before a protected handler executes.
- **AC-SB-003 — Event-driven:** When an embedding explicitly enables single-tenant authentication and supplies its configured tenant binding, Titen shall derive the principal tenant from that binding rather than a synthetic identifier.
- **AC-SB-004 — Unwanted behavior:** If any boundary decision is deny or abstain, then Titen shall deny and shall not invoke downstream fetch, embed, vector, or sink effects.
- **AC-SB-005 — Ubiquitous:** Titen shall use deny-overrides precedence and require built-in policy evaluators to return explicit allow or deny; abstain shall mean incomplete and fail closed.
- **AC-SB-006 — Ubiquitous:** Titen shall preserve authenticated behavior and dual-runtime compatibility without widening scopes.

## Constraints, risks, completion state
Public health/readiness remain tenant-neutral. Defaults do not widen access. This
change establishes the decision contract, bearer-authoritative tenant binding,
and database-fenced leases with holder authorization. It does **not** close #20
or #21: canonical records still need workspace bindings and all retrieval/export
surfaces need shared membership eligibility; every persisted policy kind still
needs its complete runtime hook (approval workflow, visibility, trust, retention
and legal hold). Those issues must remain open until dual-runtime acceptance
tests pass.
