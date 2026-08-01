---
work_id: enterprise-governance-v03
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-01
owner: maintainers
spec: docs/specs/done/2026-08-01-enterprise-governance-v03.md
---

# Plan: enterprise governance v0.3

## Steps

- [x] Add one forward-only governance migration that reuses the v4 `policies`
      and `channel_releases` ledgers, adding only the missing lifecycle tables,
      columns, and indexes.
- [x] Reuse capability authentication plus organization memberships to enforce
      fail-closed governance roles and safe membership administration.
- [x] Implement typed versioned policies and exact-version claim approvals.
- [x] Implement channel lifecycle, immutable reviewed release snapshots, and
      audience-scoped gateway compilation.
- [x] Implement retention exclusions, legal holds, purge guard, and external
      identity mappings.
- [x] Add metadata audit/events and bounded governance Atlas projections.
- [x] Add one shared adversarial enterprise journey to the dual-runtime suite.
- [x] Update observable product, API, architecture, and roadmap documentation.
- [x] Run full relevant verification, record evidence, close both artifacts,
      and commit with the required attribution trailer.

## Acceptance evidence mapping

| Acceptance | Evidence |
| --- | --- |
| AC-EG-001 | Dual-runtime role/self-promotion and membership tests |
| AC-EG-002 | Policy validation/version/audit contract assertions |
| AC-EG-003 | Approval evidence, separation-of-duty, trust/history tests |
| AC-EG-004 | Channel/release lifecycle and compile journey |
| AC-EG-005 | Cross-organization, wrong-gateway, wrong-audience adversarial tests |
| AC-EG-006 | Retention/hold/purge and projection exclusion tests |
| AC-EG-007 | External mapping uniqueness and foreign-target tests |
| AC-EG-008 | Scope Preview and Knowledge Release lens authorization tests |
| AC-EG-009 | Shared case passes in Bun/SQLite and workerd/D1 |

## Deployment, smoke, and rollback

- Deployment is not part of this isolated implementation lane; the parent
  release work owns integration, remote deployment, and publication.
- Runtime smoke is the real local Bun server plus real local workerd/D1 shared
  contract. No synthetic runtime adapter counts as parity evidence.
- Rollback is restore of the pre-migration SQL snapshot and prior application
  revision. Migration 18 is additive and leaves legacy v4 tables intact.

## Verification

- `pnpm build:worker` — passed with a fresh Worker dry-run bundle.
- `pnpm test:d1` — D1 harness 9 passed; workerd/D1 contract 103 passed.
- `bun test tests/contract/bun-sqlite.test.ts` — 96 passed.
- `bun test tests/contract/vectors.test.ts tests/sdk` — 31 passed.
- `bun test tests/integration` — 178 passed.
- `pnpm build:npm` — passed.
- `pnpm check:routes` — passed for all 78 routes.
- `pnpm check:workflow` — passed, including checker self-test and 19-marker
  Ponytail debt validation.
- `git diff --check` — passed.
