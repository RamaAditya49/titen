---
work_id: golden-path-live-dashboard
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: Wulan
---
# Golden path and secure live dashboard

## Problem
Titen lacks one runnable small-team narrative across its public contract, while the dashboard's live-looking path places a canonical key in public build variables and silently falls back to fixtures.

## Scope
A researcher-writer-operator-reviewer example using current SDK/API primitives; secure opt-in same-origin dashboard adapter; explicit demo/live/disconnected/error states; tests and operator docs.

## Out of scope
A work queue (issue #31 is not merged), new product areas, orchestration, deployment/CI, and infrastructure.

## Constraints and risks
No credential may enter browser code, HTML, public environment variables, logs, or errors. The adapter exposes only the Atlas compile operation, validates bounded input, and fails closed. The example must use a real Titen service and fail honestly when configuration is absent.

## Acceptance criteria
- **AC-GP-001 — Event-driven:** When configured with a reachable Titen API and scoped role keys, the golden-path example shall use the public SDK to record researcher evidence and claims, compile project-scoped writer context, record operator checkpoint/lease/handoff and reviewer feedback, inspect conflict evidence, and print machine-readable identifiers, citations, conflict relations, and freshness metadata.
- **AC-GP-002 — Unwanted behavior:** If the API URL or key is absent or a prerequisite call fails, then the example shall exit non-zero with an actionable error and shall not substitute fake service results.
- **AC-GP-003 — State-driven:** While no work-queue API exists on current main, the scenario shall use leases, checkpoints, and handoffs and document queue enhancement as deferred rather than emulate a queue.
- **AC-DASH-001 — Optional feature:** Where strict server-only live configuration is enabled, the dashboard shall request Atlas data only through a same-origin allowlisted adapter and no canonical API key shall be emitted to the browser bundle or response.
- **AC-DASH-002 — State-driven:** While live configuration is absent, the dashboard shall preserve an explicitly labelled synthetic demo mode without making an upstream request.
- **AC-DASH-003 — Unwanted behavior:** If live configuration, validation, or upstream access fails, then the adapter/dashboard shall expose a bounded disconnected or error state and shall not silently label fixture data live.
- **AC-DASH-004 — Ubiquitous:** Titen shall keep unimplemented dashboard product areas non-interactive in both demo and live modes.
- **AC-DASH-005 — Event-driven:** When browser tests mock the same-origin adapter, they shall verify live, error, and no-secret behavior without requiring an external service.

## Done conditions
Runnable docs/example, adapter and UI states, SDK coverage, browser mocks, workflow checks, application build, Worker dry-run, and feasible tests pass; paired artifacts are terminal with truthful evidence.

## Completion evidence

The paired done plan records passing independent real-service, scoped-principal, adapter-boundary, dual-runtime, browser, workflow, and package gates.
