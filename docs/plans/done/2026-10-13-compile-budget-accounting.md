---
work_id: compile-budget-accounting
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-10-13
updated: 2026-10-13
owner: maintainers
spec: docs/specs/done/2026-10-13-compile-budget-accounting.md
---

# Plan: compile budget accounting and omission reasons

## Steps

- [x] Stop subtracting an unreported wrapper from the compile packing budget.
      Pass the reported `max_tokens` into `packUnderBudget`.
- [x] Record each non-duplicate omission with `result_too_large` or
      `budget_exhausted`, and each `top_k` tail item with `count_bound`.
- [x] Size a count-bound tail from the authorized evidence the caller would
      have received.
- [x] Add the partial-fit packer test and the shared compile contract case.
- [x] Extend the existing count-bound and cross-scope compile cases.
- [x] Update the SDK type, API reference, Python compile note, and changelog.

## Acceptance evidence

- AC-BUD-001: `tests/contract/cases.ts` case "a partial token budget includes
  every result that fits and explains each omission" asserts `used_tokens`
  equals the sum of selected item estimates and equals the requested budget
  when that budget is exactly the first two estimates. The wide compile in the
  same case asserts the three-item sum. Passed on bun-sqlite and cloudflare-d1.
- AC-BUD-002: the same contract case sets `max_tokens` to the first two
  estimates and requires both claim ids. The packer test "partial fit keeps
  every item that fits and names the ones that do not" requires the 50-token
  item inside a 300 budget after 180 tokens are selected, and requires a later
  40-token item when an earlier item exceeds the budget.
- AC-BUD-003: the contract case compiles the same three claims at `max_tokens`
  128 and requires `result_too_large` plus a `tokens` value above 128 for each.
  The packer test requires reason `result_too_large` and tokens 400 for the
  item that exceeds 300, and tokens 250 for the item that exceeds 200.
- AC-BUD-004: the contract case requires the third claim's reason to be
  `budget_exhausted` when its estimate is within `max_tokens` but larger than
  the remainder, and requires that estimate on the omission. The packer test
  requires the same reason and tokens 90 for the item that does not fit in the
  remainder.
- AC-BUD-005: "top_k hard-caps the returned pack and leaves the default
  unbounded" requires one `count_bound` omission whose tokens match the
  dropped item, with `budget_exhausted` false.
- AC-BUD-006: "compilation excludes other organizations, subjects, and private
  memory" asserts the response body does not contain the other organization's
  claim id or the other principal's private claim id.
- AC-BUD-007: the shared cases above passed in `bun test
  tests/contract/bun-sqlite.test.ts` and in the filtered cloudflare-d1 contract
  run of the partial-fit, top_k, empty-pack, and cross-scope cases.

## Verification

- `bun test tests/integration/retrieval-correctness.test.ts` — 6 pass.
- `bun test tests/contract/bun-sqlite.test.ts` — 126 pass.
- Filtered cloudflare-d1 contract run of the partial-fit, top_k, empty-pack,
  and cross-scope cases — 4 pass.
- No migration. Rollback is reverting the compile response assembly and the
  packer omission list. Stored context rows are unchanged.

## Security

Omissions are built from the authorized ranked set. Hidden claims never enter
that set, and the cross-scope case checks the serialized response.

## Deployment and smoke

Not applicable. This change does not deploy, release, or publish.
