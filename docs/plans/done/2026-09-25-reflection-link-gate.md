---
work_id: reflection-link-gate
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-09-25
updated: 2026-09-25
owner: CADIS
spec: docs/specs/done/2026-09-25-reflection-link-gate.md
---
# Plan

- [x] Add a reflection branch to `createHttpDecisionGate`: one choice question per premise pair, one request per job.
- [x] Order supersession by date in code, apply the conflict floor, and cap links at eight.
- [x] Add `TITEN_EXTRACT_GATE_LANES` and `TITEN_EXTRACT_GATE_LINK_MIN_CONFIDENCE` to both runtimes.
- [x] Add focused tests for links, fall-through, and configuration.
- [x] Document the variables and record the shadow evidence in the spec.
- [x] Run the focused tests, the contract suite, and a live shadow run.

## Acceptance evidence mapping

- AC-RLG-001, AC-RLG-002, AC-RLG-003, AC-RLG-006: "Reflection gate turns confident pair choices into an ordered link-only proposal".
- AC-RLG-004: "Reflection gate leaves synthesis and uncertain or failed answers to the model".
- AC-RLG-005, AC-RLG-006: "Reflection gate configuration fails closed".

## Security, deployment, and rollback

No migration. The reflection lane stays off until an operator lists it. Rollback removes `reflection` from `TITEN_EXTRACT_GATE_LANES`.

## Verification evidence

Recorded below after the runs.
