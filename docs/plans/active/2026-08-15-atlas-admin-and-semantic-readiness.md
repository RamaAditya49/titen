---
work_id: atlas-admin-and-semantic-readiness
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-15
updated: 2026-08-15
review_after: 2026-08-29
owner: titen-maintainers
spec: docs/specs/active/2026-08-15-atlas-admin-and-semantic-readiness.md
---

# Plan: Atlas administrator access and semantic readiness

- [ ] Add the explicit scope, request mode, same-organization record predicate,
  root/owner gate, bounded reasons, metadata-only audit, response metadata, and
  SDK contract.
- [ ] Add dual-runtime contract fixtures for ordinary denial, privileged
  success, missing authority, audit detail hygiene, retention, and
  cross-organization denial.
- [ ] Change only pending-projection readiness semantics; preserve 503 for
  dependency/configuration/startup failures and cover write/drain recovery on
  Bun/SQLite and Cloudflare/D1.
- [ ] Update the dashboard and adapter to show principal scope, conditionally
  request audited administrator mode, and render semantic syncing accurately.
- [ ] Align PRD, architecture, API, changelog, and public release documentation
  with the observable contract.
- [ ] Run workflow/route, focused security, dual-runtime, SDK, integration,
  dashboard/browser, package, and disclosure verification.
- [ ] Commit and push with required attribution, publish the patch release,
  update titen-web and server-wulan, smoke production, and close #300–#302 with
  evidence.
- [ ] Record terminal evidence and move the paired artifacts to `done/`.

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
  pin `0.8.2`; server-wulan and titen-web retain pre-upgrade backups/deployment
  versions for verified restoration.

## Verification

Pending implementation and release evidence.
