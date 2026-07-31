---
work_id: d1-release-gate-runtime
status: active
stage: implement
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
matched Miniflare/workerd and Wrangler versions dated 2026-07-30, while the
existing provisioning retry was still present. Removing that retry exposed one
more harness failure in five runs: Miniflare returned HTTP 501 with
`ERROR: Unrecognized request method.` before Titen handled the request. Passing
the existing request object directly did not fix the proxy: a complete run then
hit twelve non-JSON `ERROR` replies from Miniflare's synchronous D1 stub.

The test currently retries one Miniflare parser failure during provisioning.
That can hide a red release gate and conflicts with the repository rule that a
failed canonical-integrity run is retained rather than averaged away.

## Scope

- Pin the existing Miniflare and Wrangler development dependencies to their
  matching 2026-07-30 releases without adding a package.
- Remove the provisioning retry and retain safe bounded response diagnostics
  for concurrent checkpoint failures.
- Bundle only the D1 contract entrypoint with the existing Bun builder and run
  that bundle under Node's built-in test runner, matching Miniflare's documented
  host runtime without adding a dependency or changing the Bun/SQLite lane.
- Give only the multi-phase semantic-readiness case a 60-second ceiling; keep
  the other 93 cases at the existing 20-second default.
- Keep every Miniflare database in a unique temporary directory and prove each
  owned runtime is disposed after the complete lane.
- Require five predeclared complete serial passes and a real Cloudflare D1
  smoke before the npm release can proceed.
- For the authorized remote smoke only, create uniquely named disposable D1
  and Worker resources, use synthetic data and an ephemeral key, then delete
  those exact resources after evidence is recorded.

## Out of scope

- Product retries, relaxed concurrency assertions, or treating emulator errors
  as successful requests.
- Raising the timeout for the complete D1 lane or its race cases.
- GitHub Actions, a new test framework, or a cross-platform lock service.
- Automatic derivation/reflection implementation or unrelated open issues.
- A persistent Worker, custom route, production database, or live customer data.

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
  current run and retain the safe status, bounded non-JSON body, error code,
  message, and request ID available at that boundary.
- **AC-D1G-003 — Ubiquitous:** Every Miniflare database shall use a unique
  temporary persistence directory, every owned Miniflare runtime shall be
  disposed, and no owned workerd process shall remain after the lane exits.
- **AC-D1G-004 — Event-driven:** When dependencies are installed from the
  frozen lockfile, supply-chain policy and the Worker dry-run build shall pass
  with `miniflare@4.20260730.0` and `wrangler@4.116.0`, and the D1 lane shall
  execute under the repository's supported Node 22-or-newer runtime.
- **AC-D1G-005 — State-driven:** While the npm candidate lacks a passing real
  Cloudflare D1 smoke, Titen shall not publish the release.
- **AC-D1G-006 — Event-driven:** When the real D1 smoke runs, Titen shall apply
  the release schema to uniquely named disposable resources, prove health,
  readiness, authenticated write/read, one checkpoint head, and one handoff
  winner under concurrency, and then delete only the enumerated D1 and Worker.

## Done conditions

All criteria have reproducible evidence, the full repository gate and package
verifier pass, issue #157 records the old/new comparison, superseded PR #147 is
closed without merging its stale release claims, and this pair moves to
`docs/specs/done/` and `docs/plans/done/`.
