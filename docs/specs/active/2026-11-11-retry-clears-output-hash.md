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
---
# A retried enrichment job can record a new output

`titen jobs retry` returns a failed enrichment job to `pending` and keeps its
recorded `output_hash`. The trigger `enrichment_jobs_output_immutable` rejects
each later write of a different hash. A model output is not byte-stable, so the
retried job can never complete or fail. The job stays leased until the lease
expires. A rejected failure write also stops the pass, so newer jobs wait.

Found on a production Bun host: 94 jobs that failed with `unsafe_output` were
retried, and none reached a terminal state.

Scope: `src/core/migrations.ts` (migration 32), `src/core/jobs.ts`
(`retryEnrichmentJobs`), the contract suite, `docs/reference/`, and
`CHANGELOG.md`. No route or response-shape change.

## Decisions

| Question | Decision |
| --- | --- |
| Where the reset happens | `retryEnrichmentJobs` sets `output_hash` to `NULL` in the same statement that resets `attempts`. |
| Trigger | Migration 32 replaces `enrichment_jobs_output_immutable`. The new trigger permits one change of a recorded hash: the reset to `NULL` that moves a `failed` job to `pending` with `attempts = 0`. Every other change of a recorded hash stays rejected. |
| Jobs retried before this fix | Migration 32 clears `output_hash` on each job in `pending` or `leased` state. Only an operator retry puts a recorded hash on such a job. |
| Pass behavior | No change. With the reset, a retried job takes the normal completion and failure paths. |

## EARS acceptance criteria

- **AC-RTY-001 — Event-driven:** When an operator retries a failed job that has a recorded output hash, Titen shall set the output hash of that job to `NULL`.
- **AC-RTY-002 — Event-driven:** When a retried job produces a valid output that differs from the output of its failed run, Titen shall complete the job and record the hash of the new output.
- **AC-RTY-003 — Event-driven:** When a retried job produces a rejected output that differs from the output of its failed run, Titen shall mark the job failed, record the hash of the new output, and continue the pass with the next job.
- **AC-RTY-004 — Unwanted behavior:** If an update other than the retry reset changes a recorded output hash, then Titen shall reject the update with `ENRICHMENT_OUTPUT_IMMUTABLE`.
- **AC-RTY-005 — Event-driven:** When migration 32 runs, Titen shall set the output hash to `NULL` on each job in `pending` or `leased` state.
- **AC-RTY-006 — Ubiquitous:** The Bun SQLite runtime and the Cloudflare D1 runtime shall pass the same contract cases for AC-RTY-001 to AC-RTY-004.
