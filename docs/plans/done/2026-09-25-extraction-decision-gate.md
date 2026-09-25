---
work_id: extraction-decision-gate
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-09-25
updated: 2026-09-25
owner: CADIS
spec: docs/specs/done/2026-09-25-extraction-decision-gate.md
---
# Plan

- [x] Add `createHttpDecisionGate` as a wrapper around the extraction capability in `src/core/extraction.ts`.
- [x] Extend `configureHttpExtraction` with fail-closed gate fields.
- [x] Pass `TITEN_EXTRACT_GATE_*` from the Bun CLI and the Cloudflare Worker.
- [x] Add focused HTTP tests for abstain, fall-through, reflection, and configuration.
- [x] Document variables, provider presets, and the data-egress warning.
- [x] Record the fall-through marker in `PONYTAIL-DEBT.md`.
- [x] Run typecheck, focused tests, and workflow checks.

## Acceptance evidence mapping

- AC-EDG-001, AC-EDG-005, AC-EDG-006: "Decision gate turns only a confident no into an abstain without the generative call".
- AC-EDG-002, AC-EDG-003: "Decision gate delegates uncertain yes answers, reflection, and every gate failure".
- AC-EDG-004: "Decision gate configuration fails closed and never enables without extraction".

## Security, deployment, and rollback

No migration. The gate stays off until an operator sets its URL and model. Rollback removes the variables; queued jobs re-key back to the ungated pipeline.

## Verification evidence

- `tsc --noEmit`: PASS.
- `bun test tests/integration/enrichment-http.test.ts tests/integration/enrichment-runtime.test.ts` on `rama-tuf`: 18 pass, 0 fail.
- `pnpm test:api` on `rama-tuf`: 157 pass, 0 fail.
- `pnpm build:worker` dry-run: PASS.
- `node scripts/check-workflow-docs.mjs` and `node scripts/check-ponytail-debt.mjs`: PASS.
- Live TypeSafe smoke on 2026-09-25 through `createHttpDecisionGate` and real `fetch`: 3/3 correct. A durable preference scored 0.92 and went to the model. Shell output scored 0.08 and chatter scored 0.05. Both abstained. Latency was 266–679 ms.
- The first live run found that TypeSafe rejects `jev-1.13` (`Unknown model`). The pinned ID is `jev-1.13.0`. The gate fell through to the model on all three answers, as AC-EDG-002 requires. The docs and changelog now name `jev-1.13.0`.
- OpenRouter was not tested live. Its row follows OpenRouter's documentation.
