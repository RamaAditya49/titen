---
work_id: titen-ears-workflow
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-27
updated: 2026-07-27
owner: titen-maintainers
spec: docs/specs/done/2026-07-27-ears-workflow.md
---

# Plan: EARS requirements and closed work lifecycle

## Steps

- [x] Read the source article and audit current repository requirements,
      contributor guidance, issue forms, pull-request template, and graph.
- [x] Publish the Titen EARS and work-lifecycle standard.
- [x] Add a dependency-free local artifact validator without enabling GitHub
      Actions.
- [x] Align agent, contributor, issue, pull-request, PRD/FRD, roadmap, and
      documentation indexes.
- [x] Run formatting, link, workflow, self-test, and whitespace checks.
- [x] Record acceptance evidence and move this spec/plan pair to `done/`.

## Acceptance evidence

| Criterion   | Evidence                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------- |
| AC-EARS-001 | complex classification and EARS contract in `docs/engineering/requirements-workflow.md`        |
| AC-EARS-002 | this paired plan maps every acceptance ID before closure                                       |
| AC-EARS-003 | validator checks pair state, metadata, stage, owner, and review deadline                       |
| AC-EARS-004 | paired terminal artifacts are under `docs/specs/done/` and `docs/plans/done/`                  |
| AC-EARS-005 | simple inline path is documented and exposed in contributor and pull-request guidance          |
| AC-EARS-006 | local validator and self-test reject malformed EARS, bad paths, stale work, gaps, and mismatch |

## Verification

```text
node scripts/check-workflow-docs.mjs             -> workflow docs OK
node scripts/check-workflow-docs.mjs --self-test -> workflow checker self-test OK
Prettier check                                   -> all matched files formatted
local Markdown link check                        -> all relative links resolve
git diff --check                                 -> no whitespace errors
test ! -e .github/workflows/docs.yml             -> GitHub Action absent
```

## Rollback

Revert the workflow policy, validator, and template changes together. The
change contains no runtime data, migration, CI activation, or deployment.
