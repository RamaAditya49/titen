---
work_id: titen-dashboard-information-architecture-docs
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-27
updated: 2026-07-27
owner: titen-maintainers
---

# Dashboard information architecture documentation

## Problem

Titen's PRD and FRD define memory, collaboration, operations, access, and
governance capabilities, while the active dashboard implementation spec
intentionally covers only the first Memory Atlas vertical slice. Without one
public-facing interface contract, later contributors could copy a generic
memory dashboard, expose locked placeholders, or treat a planned menu as a
shipped feature.

## Scope

- define the canonical progressive dashboard information architecture;
- map every planned area to existing PRD/FRD features and release gates;
- preserve Memory Atlas as the only area in the active v0.2 dashboard slice;
- state which concepts remain filters or nested operations rather than menus;
- align PRD, FRD, roadmap, architecture, documentation indexes, and the active
  dashboard spec-plan pair.

## Out of scope

- implementing dashboard source, routes, APIs, authentication, or mutations;
- enabling a future area before its backend capability and work spec are done;
- adding placeholder, locked, paid-upgrade, or speculative navigation;
- changing the Memory Atlas security boundary or enabling GitHub Actions.

## EARS acceptance criteria

- **AC-IA-DOC-001 — Ubiquitous:** Titen shall define one source-neutral dashboard information architecture that maps Memory, Collaboration, Operations, Administration, and Governance areas to existing PRD and FRD requirements.
- **AC-IA-DOC-002 — State-driven:** While a dashboard area lacks an implemented authorized contract or completed UI work spec, Titen shall omit that area from rendered navigation rather than show a placeholder, lock, disabled control, or upgrade prompt.
- **AC-IA-DOC-003 — Optional feature:** Where only the active v0.2 Memory Atlas slice is shipped, Titen shall render Atlas as the sole dashboard area and shall not imply that memory administration, collaboration, access, operations, or governance UI is available.
- **AC-IA-DOC-004 — Ubiquitous:** Titen shall treat categories and tags as memory filters, webhooks as part of Audit & Events, export and runtime capabilities as part of System, and account settings as absent until an account/session contract exists.
- **AC-IA-DOC-005 — Unwanted behavior:** If documentation describes a planned dashboard area, then Titen shall identify its earliest backend release and shall not present the description as implementation evidence.
- **AC-IA-DOC-006 — Ubiquitous:** Titen shall keep the dashboard optional, API-backed, authorization-filtered, and independent from complete headless REST/MCP behavior on Cloudflare and VPS.
- **AC-IA-DOC-007 — Event-driven:** When this documentation change is completed, Titen shall expose the design contract through the documentation indexes and shall leave no new active spec-plan pair for this work.

## Done conditions

- every criterion maps to evidence in the paired plan;
- DESIGN, PRD, FRD, roadmap, architecture, indexes, and active dashboard
  artifacts agree on scope and release order;
- Markdown formatting, links, workflow checks, and whitespace checks pass;
- this spec and its paired plan move to matching `done/` paths together.

## Completion evidence

- `docs/DESIGN.md` defines the source-neutral progressive area map, emergence
  gate, intentional non-menus, interface rules, and EARS design acceptance.
- PRD FR-12 and FRD UI-001 provide product/feature traceability and release
  behavior; roadmap and architecture use the same staged boundary.
- the active Memory Atlas implementation pair adds an explicit no-placeholder
  criterion and remains scoped to direct Atlas rendering with no future-area
  navigation.
- workflow validation, checker self-test, local Markdown link validation,
  Prettier, and `git diff --check` pass on 2026-07-27.
- no runtime, dependency, migration, deployment, or GitHub Action changed.
