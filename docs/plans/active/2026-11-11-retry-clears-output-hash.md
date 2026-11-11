---
work_id: retry-clears-output-hash
status: active
stage: implement
outcome: pending
review_after: 2026-11-18
complexity: complex
created: 2026-11-11
updated: 2026-11-11
owner: maintainers
spec: docs/specs/active/2026-11-11-retry-clears-output-hash.md
---
# Retry clears output hash plan

Goal: a retried enrichment job reaches a terminal state when the model returns a different output.

- [ ] Add a failing contract case: a job fails with `unsafe_output`, the operator retries it, and the next run returns a different valid output.
- [ ] Add migration 32: clear `output_hash` on `pending` and `leased` jobs, then replace the trigger `enrichment_jobs_output_immutable`.
- [ ] Set `output_hash = NULL` in `retryEnrichmentJobs`.
- [ ] Add contract cases for the rejected second output, the trigger rejection, and the migration cleanup.
- [ ] Update `docs/reference/` and CHANGELOG.

## Acceptance evidence map

| Acceptance | Verification |
| --- | --- |
| AC-RTY-001 | pending |
| AC-RTY-002 | pending |
| AC-RTY-003 | pending |
| AC-RTY-004 | pending |
| AC-RTY-005 | pending |
| AC-RTY-006 | pending |
