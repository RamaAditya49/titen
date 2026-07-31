---
work_id: d1-release-gate-runtime
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-07-31
updated: 2026-07-31
review_after: 2026-08-14
owner: CADIS
---
# D1 release gate runtime

## Problem

The locked `miniflare@4.20260722.1` D1 contract lane failed two of five
predeclared serial runs on a quiet host. One run lost an expected checkpoint
success and another received plain `ERROR` where Miniflare expected JSON. The
same 94-case suite passed five of five serial runs after updating only the
matched Miniflare/workerd and Wrangler versions dated 2026-07-30.

The test currently retries one Miniflare parser failure during provisioning.
That can hide a red release gate and conflicts with the repository rule that a
failed canonical-integrity run is retained rather than averaged away.

## Scope

- Pin the existing Miniflare and Wrangler development dependencies to their
  matching 2026-07-30 releases without adding a package.
- Remove the provisioning retry and retain safe per-response diagnostics for
  concurrent checkpoint failures.
- Keep every Miniflare database in a unique temporary directory and prove each
  owned runtime is disposed after the complete lane.
- Require five predeclared complete serial passes and a real Cloudflare D1
  smoke before the npm release can proceed.

## Out of scope

- Product retries, relaxed concurrency assertions, or treating emulator errors
  as successful requests.
- GitHub Actions, a new test framework, or a cross-platform lock service.
- Automatic derivation/reflection implementation or unrelated open issues.

## Constraints and risks

- D1 and SQL remain canonical; the change may alter only the local gate runtime
  and diagnostics.
- Supply-chain age policy must still pass with explicit reviewed exclusions for
  the two new tool versions.
- A five-run local pass does not replace a real Cloudflare D1 smoke.
- Rollback is restoring the prior dependency pins; it also restores the
  reproduced unreliable gate and therefore cannot approve a release.

## Acceptance criteria

- **AC-D1G-001 — Event-driven:** When the complete Cloudflare/D1 contract runs
  with the reviewed runtime pins, Titen shall pass all 94 cases in five
  predeclared consecutive serial runs without retrying a failed run.
- **AC-D1G-002 — Unwanted behavior:** If provisioning or a concurrent request
  returns an unexpected status or parser failure, then the gate shall fail the
  current run and retain the safe status, error code, message, and request ID
  available at that boundary.
- **AC-D1G-003 — Ubiquitous:** Every Miniflare database shall use a unique
  temporary persistence directory, every owned Miniflare runtime shall be
  disposed, and no owned workerd process shall remain after the lane exits.
- **AC-D1G-004 — Event-driven:** When dependencies are installed from the
  frozen lockfile, supply-chain policy and the Worker dry-run build shall pass
  with `miniflare@4.20260730.0` and `wrangler@4.116.0`.
- **AC-D1G-005 — State-driven:** While the npm candidate lacks a passing real
  Cloudflare D1 smoke, Titen shall not publish the release.

## Done conditions

All criteria have reproducible evidence, the full repository gate and package
verifier pass, issue #157 records the old/new comparison, superseded PR #147 is
closed without merging its stale release claims, and this pair moves to
`docs/specs/done/` and `docs/plans/done/`.
