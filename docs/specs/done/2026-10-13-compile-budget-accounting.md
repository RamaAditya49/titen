---
work_id: compile-budget-accounting
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-10-13
updated: 2026-10-13
owner: maintainers
---

# Compile budget accounting and omission reasons

## Problem

`POST /v1/context/compile` and the MCP compile path can report a token budget as
exhausted while `used_tokens` is still well below `max_tokens`, and can omit
matching results without saying why. Issue 331 observed a budget of 300, about
165 tokens used, and 2 of 3 results omitted with no reason.

The packer subtracted a fixed wrapper reserve from `max_tokens` and did not
include that reserve in `used_tokens`. Callers compared the reported numbers and
saw room. Results that fit in that room were dropped. Omission was only a count
plus a boolean.

## In scope

- Pack selected items against the same `max_tokens` that the response reports.
- Set `used_tokens` to the sum of the selected items' token estimates.
- Include a candidate when its estimate fits in the remaining reported budget.
- Return `budget.omissions` for every authorized candidate left out of `items`,
  with `claim_id`, `tokens`, and `reason`.
- Reasons are `result_too_large`, `budget_exhausted`, and `count_bound`.
- Cover the partial-fit case in the shared contract and in the packer unit test.
- Document the additive response fields.

## Out of scope

- Changing the minimum or maximum `max_tokens`.
- Truncating item text to force a fit.
- Persisting omission rows on the stored context run.
- A package release, tag, or publish.
- Counting the HTTP envelope, scope, or instructions inside `used_tokens`.
  An empty pack still reports `used_tokens: 0`.

## Constraints and risks

- Whole items only. A candidate is selected or omitted. Its statement is never
  cut down to fit.
- `used_tokens` must not exceed `max_tokens`.
- Omissions list only candidates the same compile was authorized to rank.
  Deduplicated statements stay in `deduplicated_items` and are not listed again.
- `budget_exhausted` stays false when the only omissions are `count_bound`.
- The field is additive. Existing counters keep their meaning.

## Acceptance criteria

- **AC-BUD-001 — Ubiquitous:** Titen shall pack compile items against the
  reported `max_tokens` and shall set `used_tokens` to the sum of the selected
  items' token estimates.
- **AC-BUD-002 — Unwanted behavior:** If a ranked candidate's token estimate is
  less than or equal to `max_tokens` minus `used_tokens`, then Titen shall
  include that candidate.
- **AC-BUD-003 — Event-driven:** When an authorized candidate is omitted because
  its estimate exceeds `max_tokens`, Titen shall report reason
  `result_too_large` and that estimate.
- **AC-BUD-004 — Event-driven:** When an authorized candidate is omitted because
  its estimate fits in `max_tokens` but not in the remaining budget, Titen shall
  report reason `budget_exhausted` and that estimate.
- **AC-BUD-005 — Event-driven:** When `top_k` omits an authorized candidate,
  Titen shall report reason `count_bound` and that candidate's token estimate,
  and shall leave `budget_exhausted` false.
- **AC-BUD-006 — Unwanted behavior:** If a claim is outside the caller's
  authorization, then Titen shall not include its identifier in
  `budget.omissions`.
- **AC-BUD-007 — State-driven:** While the Bun/SQLite and Cloudflare/D1
  contract runtimes serve compile, Titen shall apply the same inclusion rule
  and the same omission reasons.

## Done conditions

- The packer unit test and the shared contract cover partial fit, a result
  larger than the budget, and a count-bound omission.
- Both contract runtimes pass those cases.
- The API reference, changelog, and SDK type match the response.
- No schema migration and no package version bump.
