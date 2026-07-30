---
work_id: ci-guardrail
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-07-30
updated: 2026-07-30
review_after: 2026-08-13
owner: shintaaurelia
spec: docs/specs/active/2026-07-30-ci-guardrail.md
---

# Plan: CI guardrail

- [ ] Add `.github/workflows/ci.yml` with pull-request and `main` push triggers.
- [ ] Pin GitHub Actions to immutable SHAs, pin Node 22/Bun 1.2 tooling, and use the committed lockfile.
- [ ] Run workflow docs, API/SDK, integration, build, and browser checks as separate steps.
- [ ] Validate YAML and run local equivalent gates where tooling is available.
- [ ] Move paired artifacts to `done/` after evidence is captured.

## Acceptance mapping

- AC-CI-001: workflow trigger and setup inspection.
- AC-CI-002: GitHub Actions `set -e`/failed-step semantics and local failure gate review.
- AC-CI-003: lockfile-based install command and no secret references inspection.
- AC-CI-004: separate named workflow steps plus local command evidence.
- AC-CI-005: workflow inspection confirms every third-party action uses a full commit SHA.

## Risks and rollback

Risk is limited to CI configuration; rollback is reverting the workflow commit. No deployment or credential mutation is performed.
