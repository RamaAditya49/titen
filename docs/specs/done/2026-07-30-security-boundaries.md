---
work_id: security-boundaries-20-21-24
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: wulan
---
# Security boundaries (#20, #21, #24)

## Problem and scope
Boundary crossings need one fail-closed contract. Implement typed policy decisions, a central guard, and explicit configured single-tenant embedding identity. Authenticated credentials remain authoritative. #22 canonical federation promotion and #23 external actor identities are deferred as separate schema-heavy work; no unsafe partial implementation.

## Acceptance criteria
- **AC-SB-001 — Ubiquitous:** Titen shall authorize a protected boundary only when tenant, scope, policy, visibility, trust, and release-filter decisions are explicit and complete.
- **AC-SB-002 — Unwanted behavior:** If a tenant is absent, unknown, or differs from the configured single tenant, then Titen shall deny before a protected handler executes.
- **AC-SB-003 — Event-driven:** When an embedding explicitly enables single-tenant authentication and supplies its configured tenant binding, Titen shall derive the principal tenant from that binding rather than a synthetic identifier.
- **AC-SB-004 — Unwanted behavior:** If any boundary decision is deny or abstain, then Titen shall deny and shall not invoke downstream fetch, embed, vector, or sink effects.
- **AC-SB-005 — Ubiquitous:** Titen shall use deny-overrides precedence and require built-in policy evaluators to return explicit allow or deny; abstain shall mean incomplete and fail closed.
- **AC-SB-006 — Ubiquitous:** Titen shall preserve authenticated behavior and dual-runtime compatibility without widening scopes.

## Constraints, risks, done
Public health/readiness remain tenant-neutral. Defaults do not widen access. Done requires mapped passing evidence and terminal paired artifacts.
