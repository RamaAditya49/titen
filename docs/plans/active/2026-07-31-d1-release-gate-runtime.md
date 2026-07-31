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
spec: docs/specs/active/2026-07-31-d1-release-gate-runtime.md
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
- [ ] Run focused diagnostics, frozen install, supply-chain check, Worker build,
  five complete D1 passes, teardown inspection, workflow checks, package smoke,
  production audit, secret scan, and the full local repository gate.
- [ ] Rebase onto current `origin/main`, review the exact diff, merge through a
  pull request, and repeat the release-critical checks from clean source.
- [ ] Run a real Cloudflare D1 smoke, record issue/PR evidence, and close this
  pair only when every criterion is proven.

## Evidence mapping

- AC-D1G-001: five old-runtime logs, five candidate-runtime logs, and five final
  clean-branch 94/94 transcripts with no rerun.
- AC-D1G-002: captured pre-fix 501 body, removed retry diff, focused 20/20
  concurrent passes, rejected direct-Request experiment, and unchanged failure
  assertions.
- AC-D1G-003: unique `mkdtempSync` source audit, `dispose()` paths, and empty
  owned-workerd inspection after the five-run lane.
- AC-D1G-004: exact manifest/lock versions, frozen install, supply-chain policy,
  `pnpm build:worker` output, and Node-built-in D1 runner transcript.
- AC-D1G-005: production Worker revision plus real D1 health, readiness, and
  authenticated write/read smoke without logging credentials.

## Security, deployment, smoke, and rollback

No production schema or API behavior changes. Diagnostics retain only response
status, at most 200 characters of a non-JSON body, and the existing safe error
envelope. Deployment is not required for the
dependency pin itself, but the release remains blocked until a real D1 smoke
passes. Before merge, rollback is branch deletion; after merge it is a reviewed
revert to the prior pins, which cannot be used as release approval because the
old gate failed two of five controlled runs.
