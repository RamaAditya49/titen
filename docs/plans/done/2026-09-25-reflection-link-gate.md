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

- `tsc --noEmit`: PASS.
- `bun test tests/integration/enrichment-http.test.ts tests/integration/enrichment-runtime.test.ts` on `rama-tuf`: 21 pass, 0 fail. The first run caught a reversed supersession direction, fixed in the same branch.
- `pnpm test:api` on `rama-tuf`: 157 pass, 0 fail.
- Live run of the shipped `createHttpDecisionGate` on 120 random past reflection jobs (TypeSafe `jev-1.13.0`), through the real `validateEnrichmentProposal`:
  - 104 jobs (87%) got a link-only proposal without the generative call; 16 fell through.
  - 0 proposals failed validation.
  - 613 links: 446 `related_to`, 166 `duplicate_candidate`, 1 `conflict_candidate`. The mean was 5.9 links per job against 3.7 from the generative model.
  - Mean latency was 326 ms per job.
  - Cost: 2 of the 3 sampled synthesis (add) jobs became link-only, so about 1.7% of reflection jobs lose a synthesized claim.
