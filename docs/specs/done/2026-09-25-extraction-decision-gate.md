---
work_id: extraction-decision-gate
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-09-25
updated: 2026-09-25
owner: CADIS
---
# Extraction decision gate

## Problem

Every derivation job calls the generative extraction model, including jobs that end as `abstain`. A structured decision model such as TypeSafe Jev can answer "does this observation hold a durable fact?" for a fraction of the cost. Titen has no place to put that decision.

## Scope

Add an optional decision gate in front of the derivation lane. It uses the System One wire format (`model`, `state`, `questions`), which TypeSafe (`/v1/systemone`) and OpenRouter (`/api/v1/systemone`, `/api/alpha/decisions`) share. Configure it on both runtimes with `TITEN_EXTRACT_GATE_*` variables.

## Out of scope

Reflection gating, link choice, retrieval reranking (measured-closed), gate outcome counters, readiness fields for the gate, and production activation. The locked enrichment evaluation still gates activation.

## Constraints and risks

`src/core/**` stays free of external imports. The gate sends observation content to a hosted provider, so it stays off by default. A wrong "no" drops a durable fact, so only a confident "no" skips the model. Gate identity must enter job provenance.

## Acceptance criteria

- **AC-EDG-001 — Event-driven:** When the gate returns a yes probability below the threshold for a derivation job, Titen shall record an ordinary abstain without the generative call.
- **AC-EDG-002 — Event-driven:** When the gate returns any other probability, a malformed answer, an HTTP error, or no response, Titen shall continue to the generative call.
- **AC-EDG-003 — State-driven:** While a job belongs to the reflection lane, Titen shall not call the gate.
- **AC-EDG-004 — Unwanted behavior:** If gate configuration is partial, uses a `latest` alias, uses non-loopback HTTP, has a threshold outside (0, 0.5), a timeout outside 500–5000 ms, or has no complete extraction tuple, then Titen shall report `configured_error`.
- **AC-EDG-005 — Ubiquitous:** Titen shall fold the gate endpoint, model, and threshold into the provider identity, so a gate change re-keys the pipeline fingerprint.
- **AC-EDG-006 — Ubiquitous:** Titen shall send the gate key only in the `authorization` header, never in the body.

## Done conditions

Focused HTTP tests pass on Bun, the maintained typecheck passes, deployment docs list the variables and the data-egress warning, workflow checks pass, and this pair is in `done`.
