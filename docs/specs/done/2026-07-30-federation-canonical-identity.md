---
work_id: federation-canonical-identity-22-23
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: wulan
---

# Destination-canonical federation and external actor identity

## Problem

Signed transport currently stores remote events only. Eligible observations need an explicit, destination-governed path into canonical recallable memory, while remote actor references need collision-safe local identity.

## Scope

In scope: observation events only; explicit per-peer/filter canonical-ingest policy; destination visibility/trust ceilings; provenance, history, FTS and index outbox; replay safety; external identity mapping keyed by peer issuer namespace and external subject; display rename and explicitly authorized/audited relink.

Out of scope: canonical claim federation, automatic trust, credentials, CRDT/consensus, CI/CD, deployment and infrastructure.

## Risks and constraints

SQL must run on D1 and SQLite. Legacy event payloads fail closed for canonical ingestion but remain transport events. Remote identity and trust never grant destination authorization.

## Acceptance criteria

- **AC-FED-001 — Event-driven:** When a correctly signed `observation.appended` event matches an active destination filter with canonical ingestion enabled and contains the required canonical fields, Titen shall atomically store a destination observation, explicit remote provenance, history, FTS, and pending index-outbox work.
- **AC-FED-002 — Unwanted behavior:** If an event type or payload is not eligible for canonical ingestion, then Titen shall retain accepted transport-event behavior without creating recallable canonical memory.
- **AC-FED-003 — State-driven:** While destination canonical-ingest policy is disabled or the peer is inactive, Titen shall create no canonical memory from remote events.
- **AC-FED-004 — Ubiquitous:** Titen shall cap imported trust and set visibility from destination policy rather than accepting remote authority fields as destination authority.
- **AC-FED-005 — Event-driven:** When the same peer event is replayed, Titen shall return an idempotent replay result and create no duplicate event, observation, provenance, FTS, history, or outbox row.
- **AC-ID-001 — Event-driven:** When an eligible remote event names an external actor subject, Titen shall resolve a stable local actor mapping keyed by destination organization, peer issuer namespace, and external subject.
- **AC-ID-002 — Unwanted behavior:** If two peers use the same raw external subject, then Titen shall map them to different local actor identities.
- **AC-ID-003 — Event-driven:** When an authorized caller updates an external actor display name, Titen shall retain the same local actor identity and audit the update.
- **AC-ID-004 — Event-driven:** When an authorized caller explicitly relinks an external identity, Titen shall retain mapping history, audit the old and new local identity, and use the new identity only for later ingestions.
- **AC-ID-005 — Unwanted behavior:** If a relink target would collide with another active mapping in the same issuer namespace, then Titen shall reject it without changing either mapping.
- **AC-PAR-001 — Ubiquitous:** Titen shall expose equivalent migration and behavioral contracts on Cloudflare D1 and Bun/SQLite.

## Done conditions

Implementation, portable migration, API/reference/architecture status updates, shared regression tests, workflow checks, build/Worker checks, and feasible runtime checks have recorded evidence; both artifacts are terminal and no unchecked plan work remains.

## Verification evidence

- `pnpm build:worker`: PASS (Wrangler dry-run, D1 binding).
- `pnpm build`: PASS (Astro and dashboard bundle budget).
- `node scripts/check-workflow-docs.mjs` and `--self-test`: PASS.
- `git diff --check`: PASS.
- Bun shared contract/integration regressions: UNAVAILABLE because `bun` is absent on this worker; no runtime parity claim is made beyond portable migration/Worker compilation.
- Standalone TypeScript check: UNAVAILABLE because the repository does not install `typescript`/`tsc`; Worker bundling is the feasible compiler gate.
