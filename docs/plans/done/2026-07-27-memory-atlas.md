---
work_id: titen-memory-atlas-docs
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-27
updated: 2026-07-27
owner: titen-maintainers
spec: docs/specs/done/2026-07-27-memory-atlas.md
---

# Plan: Memory Atlas product and architecture contract

## Steps

- [x] Audit Graphify guidance, repository decisions, feature phases, and
      affected documentation.
- [x] Add the product boundary to the blueprint, README, PRD, FRD, and roadmap.
- [x] Add a dedicated architecture contract and accepted ADR.
- [x] Align REST API, data projection, security, deployment, and evaluation
      contracts.
- [x] Validate terminology, phases, endpoint parity, formatting, local links,
      workflow state, and whitespace.
- [x] Record evidence and move this spec/plan pair to `done/`.

## Acceptance evidence

| Criterion    | Planned evidence                                              |
| ------------ | ------------------------------------------------------------- |
| AC-ATLAS-001 | ADR-0003, Memory Atlas architecture, and data-model projection contract |
| AC-ATLAS-002 | FRD OBS-001 and REST compile-view response contract                    |
| AC-ATLAS-003 | TM-22 and Atlas cross-scope/topology evaluation cases                  |
| AC-ATLAS-004 | canonical hydration rules in architecture, API, data, and eval docs    |
| AC-ATLAS-005 | Cloudflare/VPS disabled-mode and failure-degradation contracts          |
| AC-ATLAS-006 | v0.3 Scope Preview/Knowledge Release authority and eval cases           |
| AC-ATLAS-007 | bounded traversal contract, edge behavior, and resource tests           |
| AC-ATLAS-008 | same-repo ADR, separate integration boundary, and six-tool MCP check    |

## Verification

```bash
node scripts/check-workflow-docs.mjs
node scripts/check-workflow-docs.mjs --self-test
git diff --check
```

Formatting and all relative Markdown links must pass before closure.

Recorded result:

- workflow validation and checker self-test passed;
- `git diff --check` passed;
- 31 Markdown files had zero broken relative links;
- the contract consistency check found all 8 EARS IDs in the spec and FRD;
- the ordinary-agent MCP profile remained exactly six tools;
- `.github/workflows/` remained empty/absent.

## Rollback

Revert the Memory Atlas requirement, architecture, API, security, and evaluation
documentation together. No runtime, schema, data, dependency, CI, or deployment
change is part of this work.
