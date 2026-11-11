---
work_id: readiness-operator-failures
status: active
stage: implement
outcome: pending
review_after: 2026-11-18
complexity: complex
created: 2026-11-11
updated: 2026-11-11
owner: maintainers
---
# Readiness marks only failures that an operator can fix

`/readyz` reports `enrichment_jobs: terminal_error` while a failed job is not
acknowledged. Most failed jobs are content rejections: the local validator
rejected the model output, or the source changed. An operator cannot fix these.
On a production Bun host the validator rejects 5 to 10 percent of derivation
jobs, so readiness shows `terminal_error` again each day.

A second run of a rejected job often passes. On the same host, 38 of 97
rejected derivation jobs completed on a manual second run.

Scope: `src/core/app.ts` (readiness check), `src/core/enrichment.ts`
(`failJob` and its callers), the dashboard hint in `src/lib/dashboard-view.ts`
if its text needs it, the contract suite, `docs/reference/`, `docs/dashboard.md`,
and `CHANGELOG.md`. No schema, route, or response-shape change.

## Decisions

| Question | Decision |
| --- | --- |
| Operator failure classes | `provider_unavailable`, `provider_rejected`, and `provider_protocol`. These mark readiness as `terminal_error` while the job is not acknowledged. |
| Content failure classes | `unsafe_output`, `invalid_output`, and `source_changed`. A failed job with one of these classes does not mark readiness. The job stays `failed`. |
| Job commands | `titen jobs list`, `retry`, `ack`, and `purge` select every failed job, as before. The status name `terminal_error` in these commands does not change. |
| Automatic second run | A job that fails with `unsafe_output` on its first attempt returns to `pending` one time. A failure with `unsafe_output` on attempt 2 or later is terminal. Other classes do not change. |
| Output hash on the second run | A failure that returns the job to `pending` does not record an output hash. The trigger `enrichment_jobs_output_immutable` permits a hash change only on an operator retry, so a recorded hash would block the second run. A terminal failure records the hash, as before. |

## EARS acceptance criteria

- **AC-RDY-001 — State-driven:** While an unacknowledged failed job has the class `provider_unavailable`, `provider_rejected`, or `provider_protocol`, Titen shall report `enrichment_jobs.state` as `terminal_error`.
- **AC-RDY-002 — State-driven:** While each unacknowledged failed job has the class `unsafe_output`, `invalid_output`, or `source_changed`, Titen shall report `enrichment_jobs.state` as `backlog` or `idle`, not `terminal_error`.
- **AC-RDY-003 — Event-driven:** When a job fails with `unsafe_output` on its first attempt, Titen shall return the job to `pending` with no recorded output hash.
- **AC-RDY-004 — Event-driven:** When the second run of that job returns a valid output, Titen shall complete the job and record the hash of that output.
- **AC-RDY-005 — Event-driven:** When the second run of that job fails with `unsafe_output`, Titen shall mark the job failed and record the hash of the second output.
- **AC-RDY-006 — Ubiquitous:** The job commands `list`, `retry`, `ack`, and `purge` shall select failed jobs of every failure class.
- **AC-RDY-007 — Ubiquitous:** The Bun SQLite runtime and the Cloudflare D1 runtime shall pass the same contract cases for AC-RDY-001 to AC-RDY-006.
