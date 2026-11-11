---
work_id: readiness-operator-failures
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-11
updated: 2026-11-11
owner: maintainers
spec: docs/specs/done/2026-11-11-readiness-operator-failures.md
---
# Readiness operator failures plan

Goal: readiness shows `terminal_error` only for failures that an operator can fix, and a rejected output gets one automatic second run.

- [x] Add failing contract cases for the readiness state with content failures and with provider failures.
- [x] Limit the readiness check in `src/core/app.ts` to the operator failure classes.
- [x] Add failing contract cases for the automatic second run after `unsafe_output`.
- [x] Make `unsafe_output` on attempt 1 return the job to `pending` without an output hash.
- [x] Update existing cases that pin a terminal failure on the first `unsafe_output`.
- [x] Update `docs/reference/`, `docs/dashboard.md`, and CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-RDY-001 | Block "readiness marks only failures that an operator can fix": `provider_unavailable`, `provider_rejected`, and `provider_protocol` give `terminal_error` (in `assertEnrichmentContract` (`tests/contract/enrichment.ts`), run by `bun-sqlite.test.ts` and `cloudflare-d1.test.ts`) |
| AC-RDY-002 | Same block: `unsafe_output`, `invalid_output`, and `source_changed` leave `terminal_error` unset (in `assertEnrichmentContract` (`tests/contract/enrichment.ts`), run by `bun-sqlite.test.ts` and `cloudflare-d1.test.ts`) |
| AC-RDY-003 | Block "A retried job records the output of its new run", step `AC-RDY-003`: pending, attempts 1, `output_hash` null (in `assertEnrichmentContract` (`tests/contract/enrichment.ts`), run by `bun-sqlite.test.ts` and `cloudflare-d1.test.ts`) |
| AC-RDY-004 | Same block, step `AC-RDY-004`: the second run completes and records a hash (in `assertEnrichmentContract` (`tests/contract/enrichment.ts`), run by `bun-sqlite.test.ts` and `cloudflare-d1.test.ts`) |
| AC-RDY-005 | Same block, step `AC-RDY-005`: the second rejection is terminal with the second hash (in `assertEnrichmentContract` (`tests/contract/enrichment.ts`), run by `bun-sqlite.test.ts` and `cloudflare-d1.test.ts`) |
| AC-RDY-006 | Block "readiness marks only failures that an operator can fix", step `AC-RDY-006`: `list`, `retry`, `ack`, and `purge` (in `assertEnrichmentContract` (`tests/contract/enrichment.ts`), run by `bun-sqlite.test.ts` and `cloudflare-d1.test.ts`) |
| AC-RDY-007 | The same cases run in `bun-sqlite.test.ts` and `cloudflare-d1.test.ts` (in `assertEnrichmentContract` (`tests/contract/enrichment.ts`), run by `bun-sqlite.test.ts` and `cloudflare-d1.test.ts`) |

## Verification

Run on `rama-tuf` in a separate worktree, on the pushed branch.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | no errors |
| `pnpm test:d1` (Cloudflare D1 contract) | 156 pass, 0 fail |
| `bun test tests/contract/bun-sqlite.test.ts` | 145 pass, 0 fail |
| `pnpm test:api` | Bun contract, vectors, and SDK: 185 pass, 0 fail |
| `pnpm test:integration` | 310 pass, 0 fail |
| `pnpm verify:dashboard-live` | OK |

With `src/core/app.ts` and `src/core/enrichment.ts` restored to the old code, the Bun contract run fails at the adapted reflection block: `rejected.body.data.failed` is 0, not 1.
