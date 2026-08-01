---
work_id: canonical-memory-federation-2026-08-01
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-01
owner: maintainers
spec: docs/specs/done/2026-08-01-canonical-memory-federation.md
---

# Canonical recallable-memory federation plan

- [x] Add one forward-only provenance/idempotency migration shared by both
  runtimes.
- [x] Add opt-in authorized memory hydration to the existing federation pull.
- [x] Add signed, destination-authorized, atomic canonical import to the
  existing federation push.
- [x] Cover success and adversarial paths in the shared dual-runtime contract.
- [x] Update product, architecture, API, data-model, roadmap, and threat-model
  documentation.
- [x] Run all relevant checks, record evidence, and move this pair to `done/`.

## Acceptance evidence

| Acceptance | Evidence |
| --- | --- |
| AC-FMEM-001 | shared contract: explicit filter/export scope and authorized bundle |
| AC-FMEM-002 | shared contract: filter, visibility, project/evidence validation |
| AC-FMEM-003 | shared contract plus SQL assertions for canonical graph and provenance |
| AC-FMEM-004 | shared contract: cross-org, unsigned, and tampered rejection |
| AC-FMEM-005 | shared contract: event and alternate-event replay counts |
| AC-FMEM-006 | shared contract: disputed context item and evidence trace after import |
| AC-FMEM-007 | Bun/SQLite and Cloudflare/D1 contract suites plus migration readiness |

## Security, migration, deployment, rollback

- Security: HMAC covers the exact raw body; peer ownership, immutable
  first-success source-organization binding, explicit filters, export/import
  scopes, organization visibility, non-`policy_approved` trust, trust ceiling,
  and project domain are checked before retrieval or mutation.
- Migration: append one nullable peer binding, one provenance table, and
  immutable source/record triggers; no canonical row is rewritten.
- Deployment: no deployment is part of this worktree; both real runtime adapters
  execute the shared contract locally.
- Rollback: stop sending `include_memory`; event-only federation remains
  compatible. The append-only migration and already imported evidence remain
  canonical history rather than being destructively removed.

## Verification

- `pnpm test:api`: Cloudflare/D1 103/103 and Bun/vector/SDK 127/127 passed; the
  final canonical/migration-focused D1 rerun passed 2/2 after the last approval,
  source-binding, orphan-evidence, and event-replay hardening.
- `pnpm test:integration`: 178/178 passed, including Bun migration rollback and
  retry against migration 19.
- `pnpm build:npm`, Worker dry-build, and `pnpm check:routes` passed; the Worker
  bundle was 107.06 KiB gzip and the route inventory remained 57.
- The final shared canonical fixture passed on both runtimes and proved source
  and destination filters, HMAC, import scope, complete evidence, disputed
  recall, immutable peer/source provenance, local-only approval trust, replay
  idempotency, concurrent first-use fencing, and changed-payload rejection.
- `pnpm check:workflow` and `git diff --check` passed after this pair moved to
  `done/`.
