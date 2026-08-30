---
work_id: actionable-error-reporting-20260830
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-30
updated: 2026-08-30
owner: CADIS
---

# Actionable error reporting for agents

## Problem

Titen returns a generic `NOT_FOUND` when a caller resolves a missing project
without `create:true`. This response protects foreign records, but it does not
distinguish an expected setup step from a product defect. The MCP transport also
drops safe `ApiError.meta` data, so an agent cannot use route-specific recovery
guidance that REST already supports.

The distributed Titen skills tell an agent to continue safely after memory
failure. They do not define when to fix configuration, when to retry, when to
prepare a report, or when to create a GitHub issue. This omission can cause
silent defects, duplicate issues, public disclosure, or issues for expected
authorization behavior.

## Goal

Titen must give agents bounded recovery guidance for public errors. Titen must
let an authorized agent report a verified product defect without giving the
Titen server a GitHub credential.

## Scope

- Add safe support guidance to REST and MCP error results.
- Identify a missing project reference as an expected setup condition.
- Preserve the existing HTTP status and public error code.
- Preserve safe error metadata in MCP tool failures.
- Define one agent-side triage and issue-reporting procedure.
- Copy the procedure to every distributed Titen skill.
- Update the SDK, API reference, agent guide, README, and changelog.
- Publish a compatible patch release through the manual release process.
- Update the Titen website release metadata and changelog page.
- Back up, upgrade, and verify the Titen services on `server-wulan`.

## Out of scope

- Do not send GitHub requests from the Titen server.
- Do not store a GitHub token in Titen configuration or memory.
- Do not add an MCP tool or change the nine-tool contract.
- Do not create an issue for expected validation, authentication,
  authorization, not-found, or conflict results.
- Do not publish a security vulnerability in a public issue.
- Do not include credentials, prompts, memory content, request bodies, or raw
  production payloads in a report.
- Do not add GitHub Actions or automated deployment.
- Do not disable Mem0 during this release.

## Error guidance contract

Every public API error response keeps its current `error.code` and HTTP status.
The response metadata adds a bounded `support` object:

```json
{
  "classification": "expected | investigate | defect_candidate",
  "action": "bounded operator action",
  "docs_url": "https://titen.dev/docs/agent-integrations#project-resolution"
}
```

The server selects the classification from its own error code. It does not use
the error message or request body as support metadata.

- `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
  `CONFLICT`, and `UNRESOLVED_REFERENCE` are expected results.
- `UNAVAILABLE` needs investigation and a bounded retry or dependency check.
- `INTERNAL` is a defect candidate.

The project resolver adds these safe fields when the supplied normalized
reference does not exist:

```json
{
  "reason": "project_not_registered",
  "reference": "lowercase-owner/repository",
  "can_create": true
}
```

`can_create` reports only the caller's `projects:create` capability. The caller
already supplied `reference`, so returning its normalized form does not disclose
another record. A foreign project ID on another route remains indistinguishable.

The resolver does not create a project unless the caller sends `create:true` and
has `projects:create`. This release keeps that authorization boundary.

## Agent issue workflow

An agent must use this order after a Titen failure:

1. Read the error code, request ID, support classification, and safe metadata.
2. Perform the stated expected recovery action when one exists.
3. Reproduce a suspected defect with synthetic or redacted input.
4. Verify the current package version, runtime, and relevant source or health.
5. Search open and closed Titen issues for the same behavior.
6. Use the private security channel when the behavior can expose protected data,
   credentials, or authorization boundaries.
7. Create one public GitHub issue only for a unique verified non-security defect
   when the host has GitHub write authority.
8. Otherwise produce a complete sanitized draft for the operator.

The issue contains the runtime, Titen version or commit, request ID when
available, minimal reproduction, expected behavior, actual safe error envelope,
and verification evidence. It never contains a secret or memory payload.

Titen remains the memory service. The host agent owns GitHub authentication and
the external issue mutation.

## Compatibility

This is a patch release. Existing HTTP statuses, `error.code` values, success
envelopes, tool names, and required tool arguments remain unchanged. New error
metadata is additive. SDK users that ignore `TitenError.meta` keep their current
behavior.

## Security

- Build support metadata from constants and allowlisted values.
- Never copy an exception stack, response body, input body, credential, memory
  content, or arbitrary provider detail into support metadata.
- Keep foreign record denial indistinguishable outside the project-reference
  route.
- Keep security reports outside public GitHub issues.
- Keep GitHub credentials outside Titen server, package, memory, and logs.

## Acceptance criteria

- **AC-AER-001 — Event-driven:** Saat authorized caller resolves a missing project without `create:true`, Titen harus return `404 NOT_FOUND` with reason `project_not_registered`.
- **AC-AER-002 — Event-driven:** Saat resolver returns `project_not_registered`, Titen harus return the caller-supplied normalized reference and truthful `can_create` capability.
- **AC-AER-003 — Unwanted behavior:** Jika caller does not send `create:true`, maka Titen harus not create a project.
- **AC-AER-004 — Unwanted behavior:** Jika caller lacks `projects:create`, maka Titen harus not create a project even when `create:true` is supplied.
- **AC-AER-005 — Ubiquitous:** Titen harus keep current HTTP statuses and public error codes.
- **AC-AER-006 — Ubiquitous:** Titen harus add bounded support classification, action, and documentation URL to every REST API error.
- **AC-AER-007 — Event-driven:** Saat an MCP tool returns an `ApiError`, Titen harus preserve safe error metadata and request ID in the readable tool result.
- **AC-AER-008 — Unwanted behavior:** Jika an error concerns a foreign resource, maka Titen harus not disclose its existence through support metadata.
- **AC-AER-009 — Unwanted behavior:** Jika an unexpected exception occurs, maka Titen harus not expose its message, stack, body, or provider response.
- **AC-AER-010 — Ubiquitous:** Titen harus give every distributed skill the same issue-triage procedure.
- **AC-AER-011 — Unwanted behavior:** Jika a failure is expected setup, request, authorization, not-found, or conflict behavior, maka Titen harus instruct the agent not to create a GitHub issue.
- **AC-AER-012 — Event-driven:** Saat a non-security Titen defect is uniquely reproduced and GitHub write authority is available, Titen harus instruct the agent to create one sanitized issue after duplicate search.
- **AC-AER-013 — Unwanted behavior:** Jika GitHub write authority is unavailable, maka Titen harus instruct the agent to produce a sanitized issue draft.
- **AC-AER-014 — Unwanted behavior:** Jika a suspected defect can expose protected data or credentials, maka Titen harus instruct the agent to use the private security-reporting path.
- **AC-AER-015 — Ubiquitous:** Titen harus document the additive error contract and host-owned issue workflow in the API reference and agent guide.
- **AC-AER-016 — Ubiquitous:** Titen harus ship the change as a compatible patch with synchronized package, changelog, tag, GitHub Release, and website metadata.
- **AC-AER-017 — Unwanted behavior:** Jika npm browser approval is incomplete, maka Titen harus not publish the new package.
- **AC-AER-018 — Event-driven:** Saat `server-wulan` upgrades, Titen harus preserve its canonical database and return healthy, ready, authorized, and unauthenticated smoke results on the new revision.

## Risks and mitigations

- Additive metadata can become an oracle. Keep route-specific detail only on the
  caller-supplied project reference path.
- Agent reporting can create spam. Require reproduction, duplicate search, and a
  unique non-security defect.
- Error reports can leak data. Use an allowlisted report shape and forbid raw
  payloads.
- npm publication is permanent. Verify the packed artifact and wait for browser
  approval before publishing.
- A production upgrade can use an old revision drop-in. Back up the service and
  inspect all systemd drop-ins before restart.

## Rollback

Revert the source commit if contract tests fail. Keep npm `latest` at `0.9.0`
until all local release gates and browser approval complete. Before the VPS
upgrade, save the database, vector projection, package files, environment,
systemd units, and checksums. Restore package `0.9.0` and the prior revision
drop-in if any production smoke fails.

## Done conditions

- All acceptance criteria have reproducible evidence.
- Dual-runtime, MCP, SDK, integration, workflow, package, and documentation
  checks pass.
- The branch commits and pushes with the required CADIS trailer.
- npm, tag, GitHub Release, and titen.dev report the same release.
- `server-wulan` runs the new package revision or a verified rollback.
- The spec and plan move to `docs/specs/done/` and `docs/plans/done/`.

## Completion evidence

- Commit `c2e1ce77ccdfa0f4f3cdda6971304f4b7776b507` passed the complete
  release gate and became npm package `titen-memory@0.9.1`.
- npm `latest`, annotated tag `v0.9.1`, and the non-draft GitHub Release all
  identify version `0.9.1` from that commit.
- Cloudflare deployment `56429876-32e7-43c3-b593-bbee5fe1754e` serves the
  release metadata, notes, changelog, resolver guidance, and error triage on
  both public hostnames.
- Backup `/var/backups/titen/20260830T194247+0700-pre-0.9.1` passed checksums
  and SQLite integrity checks before the VPS upgrade.
- `server-wulan` runs package, CLI, API, and dashboard revision `0.9.1` with
  schema 23 of 23 and unchanged canonical counts.
- A live authenticated missing-project resolve returned safe expected guidance.
  It created no project and required explicit approved `create:true` recovery.
