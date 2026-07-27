---
work_id: titen-ears-workflow
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-27
updated: 2026-07-27
owner: titen-maintainers
---

# EARS requirements and closed work lifecycle

## Problem

Titen had detailed product requirements but no repository-wide rule that turned
complex work into unambiguous, testable acceptance criteria. It also had no
durable state convention that prevented completed, cancelled, or superseded
specifications and plans from remaining active indefinitely.

## Scope

- define which Titen changes are complex;
- adapt the five EARS patterns to Titen requirements;
- require the `spec -> plan -> implement -> done` lifecycle;
- add a dependency-free local repository check for workflow artifacts;
- expose the workflow through contributor, agent, issue, and pull-request docs.

## Out of scope

- rewriting historical research notes as executable requirements;
- adding a project-management service or dependency;
- enabling GitHub Actions;
- claiming existing product features are implemented.

## EARS acceptance criteria

- **AC-EARS-001 — Ubiquitous:** The Titen workflow shall require every complex work item to have a durable specification containing uniquely identified, testable EARS acceptance criteria before implementation begins.
- **AC-EARS-002 — Event-driven:** When a complex specification is ready for implementation, the Titen workflow shall require a paired plan that maps work and verification evidence to its acceptance criteria.
- **AC-EARS-003 — State-driven:** While complex implementation is active, the Titen workflow shall keep its specification and plan status aligned and shall update both before out-of-scope work proceeds.
- **AC-EARS-004 — Unwanted behavior:** If work is completed, cancelled, or superseded, then the Titen workflow shall close both artifacts with a terminal outcome and shall leave no stale active plan.
- **AC-EARS-005 — Optional feature:** Where a change is classified as simple, the Titen workflow shall permit an inline specification and plan while preserving the same four lifecycle stages.
- **AC-EARS-006 — Ubiquitous:** The local repository check shall reject mismatched artifact pairs, invalid state metadata, overdue active artifacts, incomplete completed plans, and missing acceptance evidence without requiring GitHub Actions.

## Constraints

- Use Markdown and Node.js standard-library code only.
- Preserve the documentation-first repository stage.
- Do not add product runtime scaffolding or dependencies.
- Existing PRD/FRD requirements must be normalized into a work spec before their
  implementation starts; they are not evidence of completed work.

## Done conditions

- all six acceptance criteria have recorded evidence;
- documentation and workflow checks pass;
- this specification and its plan are stored under their paired `done/` paths.
