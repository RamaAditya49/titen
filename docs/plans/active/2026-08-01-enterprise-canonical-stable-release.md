---
work_id: enterprise-canonical-stable-release
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-01
updated: 2026-08-01
review_after: 2026-08-15
owner: CADIS
spec: docs/specs/active/2026-08-01-enterprise-canonical-stable-release.md
---
# Plan — enterprise, canonical federation, dashboard, and stable release

Spec: [enterprise-canonical-stable-release](../../specs/active/2026-08-01-enterprise-canonical-stable-release.md)

- [x] Audit current main, live host, open issues, roadmap gaps, and architecture.
- [x] Implement and verify the paired enterprise-governance work item.
- [x] Implement and verify the paired canonical-federation work item.
- [x] Implement and verify the paired live-dashboard work item.
- [x] Resolve #208-#212 with the smallest shared-boundary fixes and tests.
- [x] Integrate migrations, contracts, SDK, API, docs, and dashboard without
      weakening cross-scope or lifecycle guarantees.
- [x] Run complete Bun, workerd/D1, integration, type, build, workflow, Ponytail,
      package-install, and clean-tree checks.
- [ ] Build and deploy the exact candidate on `rama-tuf`; run live, restart,
      persistence, backup/restore, and dashboard browser/HTTP smokes.
- [ ] Merge the verified commit to `main`, publish npm and GitHub release assets,
      update stable release discovery, and verify a clean install.
- [ ] Comment on and close #208-#212, sweep merged/obsolete branches, move every
      paired artifact to `done`, and record terminal evidence.

## Acceptance evidence mapping

- AC-ECS-001: federation role contract plus enterprise governance contract in
  `tests/contract/cases.ts` enforce capability, persisted role, and scope before
  lookup on Bun/SQLite and workerd/D1.
- AC-ECS-002: the enterprise governance contract covers atomic policy,
  membership, approval, release, hold, retention, identity, audit, and event
  transitions.
- AC-ECS-003: enterprise and erasure-race tests prove hold/retention precedence
  and fail-closed destructive paths.
- AC-ECS-004: the signed canonical federation contract and
  `tests/integration/federation.test.ts` prove evidence/provenance import,
  conflict preservation, idempotency, and recall.
- AC-ECS-005: canonical federation tests cover signatures, tamper, replay,
  source binding, filters, suspension, trust ceilings, and zero-write denials.
- AC-ECS-006: `scripts/verify-dashboard-live.ts` proves six real adapter lenses
  over imported canonical memory; `tests/dashboard.spec.ts` covers loading,
  empty, denial, disconnect, stale-data clearing, and governance focus rules.
- AC-ECS-007: `tests/integration/cli.test.ts` covers missing storage,
  organization, key, schema, revocation, and bounded diagnostics.
- AC-ECS-008: shared packing contracts and SDK tests cover selected, omitted,
  deduplicated, and budget-exhaustion metadata without hidden-record counts.
- AC-ECS-009: final local gates pass D1 105/105, Bun/vector/SDK 129/129,
  integration 182/182, browser 5/5, 78 route docs, workflow, package 9/9, and
  production dependency audit without GitHub Actions.
- AC-ECS-010: pending final `rama-tuf` production switch, restart/restore smoke,
  tailnet dashboard smoke, and direct-API denial evidence.
- AC-ECS-011: pending exact main/tag/npm/GitHub/titen.dev publication and issue
  closure evidence.

## Rollback

- Keep the previous `rama-tuf` image and named volume until the candidate passes.
- Restore the verified online backup and previous Quadlet image reference if any
  runtime or data check fails.
- Do not publish npm until package/install and deployed-candidate gates pass;
  after publication, correct defects only with a newer patch release.
