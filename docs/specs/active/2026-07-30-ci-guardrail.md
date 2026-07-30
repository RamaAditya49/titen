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
---

# CI guardrail

## Problem

The repository has no automated CI gate, so regressions can land without the documented build, workflow, and API checks running.

## Scope

Add a GitHub Actions workflow for supported Node/Bun tooling that installs dependencies from the lockfile and runs the repository's existing workflow, build, and API checks. Keep credentials and deployment mutations out of CI.

## Out of scope

Deployments, live service smoke tests requiring secrets, and changes to application behavior.

## Acceptance criteria

- **AC-CI-001 — Event-driven:** When a pull request or push targets `main`, Titen shall run a reproducible CI workflow on Ubuntu with Node 22 and Bun 1.2 tooling.
- **AC-CI-002 — Unwanted behavior:** If dependency installation, workflow validation, build, or API checks fail, then Titen shall mark the CI run failed and prevent a passing check conclusion.
- **AC-CI-003 — Ubiquitous:** Titen shall install dependencies from the committed lockfile and shall not require deployment credentials for the default CI path.
- **AC-CI-004 — Event-driven:** When the CI workflow runs, Titen shall execute the repository workflow-doc check, production build, and API contract test command as separate observable steps.

## Done conditions

- Workflow is committed and scoped to pull requests/pushes on `main`.
- Acceptance criteria have reproducible evidence.
- Paired plan is moved to `docs/plans/done/` with evidence and this spec is moved to `docs/specs/done/`.
