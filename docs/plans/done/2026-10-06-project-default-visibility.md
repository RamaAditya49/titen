---
work_id: project-default-visibility-316
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-10-06
updated: 2026-10-06
owner: maintainers
spec: docs/specs/done/2026-10-06-project-default-visibility.md
---
# Per-project default visibility

- [x] Add nullable `projects.default_visibility` in migration 25.
- [x] Apply the default only when a write omits visibility, and warn on a private write into a wider project.
- [x] Accept the field on project create and `PATCH /v1/projects/:id`.
- [x] Add `titen project create` and `titen project update`.
- [x] Cover organization sharing, the private fallback, the warning, team workspace rejection, MCP, CLI, and a v24 migration.

## Acceptance evidence

| Acceptance | Verified evidence |
| --- | --- |
| AC-VIS-001 | Contract `project default visibility shares an omitted write inside the organization`, including the MCP remember and compile |
| AC-VIS-002 | Same contract creates `castle/plain` without a default and checks the private observation |
| AC-VIS-003 | Same contract matches `visibility_warning` and checks the other key cannot compile the private claim |
| AC-VIS-004 | Same contract expects HTTP 400 when a team default has no workspace |
| AC-VIS-005 | `tests/integration/project-default-migration.test.ts` |

## Verification

Dual-runtime contract, Bun CLI test, and the schema-24 migration test. Rollback is restore of the pre-migrate database snapshot. The new column is nullable and is not required by older insert statements.

## Rollback

Restore the database snapshot taken before migration 25. A forward database still reads null as private if the process is rolled back only when that binary does not select the new column. Prefer restoring the snapshot.
