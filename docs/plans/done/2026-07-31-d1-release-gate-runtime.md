---
work_id: d1-release-gate-runtime
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
spec: docs/specs/done/2026-07-31-d1-release-gate-runtime.md
---
# Plan

- [x] Reproduce the locked-runtime failure in five predeclared serial runs and
  retain each complete log and digest.
- [x] Run the same five-run experiment with only the matched 2026-07-30
  Miniflare/workerd and Wrangler versions changed.
- [x] Pin the two existing development tools, update the reviewed supply-chain
  exclusions, remove the parser retry, bundle the D1 test entrypoint for Node's
  built-in runner, bound only its long semantic-readiness case at 60 seconds,
  and add exact checkpoint response diagnostics.
- [x] Run focused diagnostics, frozen install, supply-chain check, Worker build,
  five complete D1 passes, teardown inspection, workflow checks, package smoke,
  production audit, secret scan, and the full local repository gate.
- [x] Rebase onto current `origin/main`, review the exact diff, merge through a
  pull request, and repeat the release-critical checks from clean source.
- [x] Run a real Cloudflare D1 smoke, record issue/PR evidence, and close this
  pair only when every criterion is proven.

## Acceptance evidence

- AC-D1G-001: five old-runtime logs, five candidate-runtime logs, and five final
  clean-branch 94/94 transcripts with no rerun.
- AC-D1G-002: captured pre-fix 501 body, removed retry diff, focused 20/20
  concurrent passes, rejected direct-Request experiment, and unchanged failure
  assertions.
- AC-D1G-003: unique `mkdtempSync` source audit, `dispose()` paths, and empty
  owned-workerd inspection after the five-run lane.
- AC-D1G-004: exact manifest/lock versions, frozen install, supply-chain policy,
  `pnpm build:worker` output, and Node-built-in D1 runner transcript.
- AC-D1G-005: disposable Worker revision plus real D1 health, readiness, and
  authenticated write/read smoke without logging credentials.
- AC-D1G-006: schema 16, health/readiness 200, unauthenticated 401, twelve
  concurrent checkpoint saves with one durable head, twelve concurrent handoff
  resolutions with one durable winner, and post-delete inventories proving the
  exact Worker and D1 targets absent.

## Security, deployment, smoke, and rollback

No production schema or API behavior changes. Diagnostics retain only response
status, at most 200 characters of a non-JSON body, and the existing safe error
envelope. Deployment is not required for the
dependency pin itself, but the release remains blocked until a real D1 smoke
passes. Before merge, rollback is branch deletion; after merge it is a reviewed
revert to the prior pins, which cannot be used as release approval because the
old gate failed two of five controlled runs.

## Verification

- PRs #164 and #170 are merged; the final release candidate retains the matched
  Miniflare/Wrangler patch set and Node built-in test runner.
- The final manual gate passed the harness 9/9, Cloudflare/D1 98/98,
  Bun/vector/SDK 120/120, integration 164/164, dashboard adapter smoke, and
  browser 10/10 with no retry. The Worker dry build is 463.72 KiB upload and
  98.11 KiB gzip.
- The disposable real Cloudflare smoke used only synthetic state and an
  ephemeral credential. Schema 16 applied; health and readiness returned 200;
  an unauthenticated protected write returned 401; twelve concurrent checkpoint
  saves produced one 201, eleven 200 updates, one ID, and one durable row;
  twelve concurrent handoff resolutions produced one winner, one resolution
  row, and one terminal event.
- The exact disposable Worker and D1 database
  `titen-release-smoke-20260731-1237` were deleted and verified absent. No
  route or persistent deployment was added, and the mode-600 credential
  workspace was deleted.
