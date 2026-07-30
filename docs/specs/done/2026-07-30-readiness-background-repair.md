---
work_id: readiness-background-repair
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-30
updated: 2026-07-30
owner: CADIS
---
# Readiness background-repair capability

## Problem

`GET /readyz` always reports background repair as disabled even when the Bun maintenance timer is running, so operators cannot distinguish self-draining and manually drained deployments.

## Scope

Report the scheduler ownership already selected by each runtime: `enabled` for an actual Bun in-process timer, `disabled` when Bun creates no timer, and `external` for Cloudflare's scheduled-handler boundary. Keep the model field tied to the configured embedding provider rather than the vector store label.

## Out of scope

Scheduler freshness evidence, Cloudflare Cron provisioning, model network probes, migrations, and changes to maintenance behavior. Issue #11 tracks evidence-based freshness separately.

## Constraints and risks

Readiness stays network-free and non-blocking. The value must mirror the exact condition that creates the Bun timer. Cloudflare must not claim it can observe Cron configuration.

## Acceptance criteria

- **AC-RBR-001 — State-driven:** While the Bun runtime has created its in-process maintenance timer, Titen shall report `background_repair: enabled` from `GET /readyz`.
- **AC-RBR-002 — State-driven:** While the Bun runtime has not created a maintenance timer, Titen shall report `background_repair: disabled`.
- **AC-RBR-003 — State-driven:** While running on Cloudflare, Titen shall report `background_repair: external` because scheduler configuration is outside the Worker request runtime.
- **AC-RBR-004 — Ubiquitous:** Titen shall derive the readiness model capability from the configured embedding provider and shall make no network call on the readiness path.

## Done conditions

The shared contract passes on Bun/SQLite and workerd/D1, an integration test proves a real Bun timer reports enabled, the API reference documents all states and their limits, workflow checks pass, and the paired artifacts move to `done`.
