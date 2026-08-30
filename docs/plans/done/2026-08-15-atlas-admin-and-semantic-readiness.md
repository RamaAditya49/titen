---
work_id: atlas-admin-and-semantic-readiness
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-15
updated: 2026-08-15
owner: titen-maintainers
spec: docs/specs/done/2026-08-15-atlas-admin-and-semantic-readiness.md
---

# Plan: Atlas administrator access and semantic readiness

- [x] Add the explicit scope, request mode, same-organization record predicate,
  root/owner gate, bounded reasons, metadata-only audit, response metadata, and
  SDK contract.
- [x] Add dual-runtime contract fixtures for ordinary denial, privileged
  success, missing authority, audit detail hygiene, retention, and
  cross-organization denial.
- [x] Change only pending-projection readiness semantics; preserve 503 for
  dependency/configuration/startup failures and cover write/drain recovery on
  Bun/SQLite and Cloudflare/D1.
- [x] Update the dashboard and adapter to show principal scope, conditionally
  request audited administrator mode, and render semantic syncing accurately.
- [x] Align PRD, architecture, API, changelog, and public release documentation
  with the observable contract.
- [x] Run workflow/route, focused security, dual-runtime, SDK, integration,
  dashboard/browser, package, and disclosure verification.
- [x] Commit and push with required attribution, publish the patch release,
  update titen-web and deployment-host, smoke production, and close #300–#302 with
  evidence.
- [x] Record terminal evidence and move the paired artifacts to `done/`.

## Acceptance evidence map

| Acceptance | Planned evidence |
| --- | --- |
| AC-AVA-001 | shared contract ordinary principal fixture with foreign-private zero result |
| AC-AVA-002 | shared contract privileged same-org private-memory fixture |
| AC-AVA-003 | shared contract missing scope/role/reason non-disclosing failures |
| AC-AVA-004 | shared contract audit row field and content-exclusion assertions |
| AC-AVA-005 | shared contract cross-org, retention, lifecycle, and limit assertions |
| AC-AVA-006 | shared contract authorization metadata assertions |
| AC-AVA-007 | Playwright empty-result copy assertions for empty and hidden-private fixtures |
| AC-AVA-008 | Playwright and adapter visibility/forwarding assertions |
| AC-SRS-001 | D1 and Bun semantic-readiness pending-work assertions |
| AC-SRS-002 | existing plus focused dependency/fingerprint/metadata failure assertions |
| AC-SRS-003 | repeated enqueue/drain readiness assertions on both database adapters |
| AC-SRS-004 | Playwright syncing status and warning-copy assertion |
| AC-SRS-005 | full dual-runtime/API/integration/browser gates and disclosure scan |

## Security and rollback

- Reject administrator mode before any expanded query unless the dedicated
  capability, active root/owner authority, and reason code all pass.
- Reuse canonical organization IDs from authentication and existing retention
  predicates; never accept an organization override in the request.
- Store only selectors and reason metadata in audit evidence, never node labels,
  observation/claim content, prompts, credentials, or embeddings.
- Source rollback is a revert of the release commit. Published npm consumers can
  pin `0.8.2`; deployment-host and titen-web retain pre-upgrade backups/deployment
  versions for verified restoration.

## Verification

Commit `a9a1339`, npm `0.8.3`, GitHub tag/release `v0.8.3`, titen-web commit
`fbc9919`, Cloudflare Worker `6a6e349c-4806-4d09-8ccd-9b3641c181dc`, and the
deployment-host `npm-0.8.3` health/readiness/dashboard/session smoke provide the
terminal evidence. `pnpm test:all`, route/workflow checks, package disclosure
smoke, and website build/deploy checks passed. Issues #300–#302 are closed and
no open issue or pull request remains.
