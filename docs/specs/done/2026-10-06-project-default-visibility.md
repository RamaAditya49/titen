---
work_id: project-default-visibility-316
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-10-06
updated: 2026-10-06
owner: maintainers
---
# Per-project default visibility

Issue #316. Writes that omit `visibility` are private. A shared project then hides a fact from every other agent when one caller forgets `visibility: organization`.

## Design and scope

Migration 25 adds nullable `projects.default_visibility`. Null means private, so existing projects and existing insert statements stay private. `POST /v1/projects/resolve` with `create: true` accepts the field. `PATCH /v1/projects/:id` updates it and requires `projects:create`. The CLI commands are `titen project create` and `titen project update`. A write that omits `visibility` uses the stored default after the project id is known. An explicit visibility still wins. An explicit or resulting private write in a project whose default is `team` or `organization` adds `meta.visibility_warning` and stays private. `team` still requires `workspace_id`. Claim visibility still cannot exceed its evidence, so a claim that omits visibility inherits the observation. No read-path change.

## Acceptance criteria

- **AC-VIS-001 — Optional feature:** Where a project's `default_visibility` is `organization`, Titen shall store a remember and a consolidate that both omit `visibility` as organization, and another key in the same organization shall compile that claim.
- **AC-VIS-002 — Ubiquitous:** Titen shall keep a project with no stored default, and a write that omits both project and visibility, on the private visibility used before this column existed.
- **AC-VIS-003 — Event-driven:** When a caller passes `visibility: private` for a project whose default is wider, Titen shall store private and shall return `visibility_warning`.
- **AC-VIS-004 — Unwanted behavior:** If the applied visibility is `team` and `workspace_id` is omitted, then Titen shall reject the write.
- **AC-VIS-005 — Event-driven:** When migration 25 runs on a database whose latest migration is 24 and that already contains a project, Titen shall keep that project and shall leave `default_visibility` null.

## Done conditions

Dual-runtime contract, CLI command test, and a migration test from schema 24. API, data model, and changelog describe the column and the upgrade command.
