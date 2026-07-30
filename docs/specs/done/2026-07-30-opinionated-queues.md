---
work_id: issue-31-opinionated-queues
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: Wulan
---
# Opinionated operator queues
## Problem and scope
Atomic primitives do not answer daily operator questions. Define reviewer, operations, and publication contracts and ship reviewer queue from canonical claims/evidence. Generic queue execution, dashboard navigation, deployment and CI are out of scope.
## Constraints and risks
Policy before candidate/count; deterministic keyset order; canonical lifecycle remains authoritative; no new storage or dependency.
## Acceptance criteria
- **AC-OQ-001 — Ubiquitous:** Titen shall define schemas and terminal transitions for reviewer, operations, and publication queues in FRD and design.
- **AC-OQ-002 — Event-driven:** When an authorized actor lists reviewer work, Titen shall return a stable filtered keyset page ordered by a documented deterministic priority.
- **AC-OQ-003 — Unwanted behavior:** If a claim is outside the authenticated organization or private actor visibility, then Titen shall exclude it before candidate counts and listing.
- **AC-OQ-004 — Ubiquitous:** Titen shall expose owner, next action, deadline or TTL, evidence, audit reference, and terminal state on every reviewer item.
- **AC-OQ-005 — Event-driven:** When an authorized reviewer resolves an item, Titen shall invoke an existing canonical supersede, expire, or revoke operation and preserve its audit trail.
## Done conditions
Docs, route, SDK/contract coverage, security tests and feasible gates pass; paired artifacts move to done.

## Completion evidence
Build, Worker dry-run, workflow checks, route-doc check, and diff check passed. Reviewer projection and SDK compile in Worker. Bun is unavailable, so shared runtime tests could not execute locally; no deployment or CI/CD changed.
