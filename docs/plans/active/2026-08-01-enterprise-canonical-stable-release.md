---
work_id: enterprise-canonical-stable-release
status: active
stage: plan
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
- [ ] Implement and verify the paired enterprise-governance work item.
- [ ] Implement and verify the paired canonical-federation work item.
- [ ] Implement and verify the paired live-dashboard work item.
- [ ] Resolve #208-#212 with the smallest shared-boundary fixes and tests.
- [ ] Integrate migrations, contracts, SDK, API, docs, and dashboard without
      weakening cross-scope or lifecycle guarantees.
- [ ] Run complete Bun, workerd/D1, integration, type, build, workflow, Ponytail,
      package-install, and clean-tree checks.
- [ ] Build and deploy the exact candidate on `rama-tuf`; run live, restart,
      persistence, backup/restore, and dashboard browser/HTTP smokes.
- [ ] Merge the verified commit to `main`, publish npm and GitHub release assets,
      update stable release discovery, and verify a clean install.
- [ ] Comment on and close #208-#212, sweep merged/obsolete branches, move every
      paired artifact to `done`, and record terminal evidence.

## Rollback

- Keep the previous `rama-tuf` image and named volume until the candidate passes.
- Restore the verified online backup and previous Quadlet image reference if any
  runtime or data check fails.
- Do not publish npm until package/install and deployed-candidate gates pass;
  after publication, correct defects only with a newer patch release.
