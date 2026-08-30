---
work_id: ponytail-zero-20260801
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-02
owner: maintainer
spec: docs/specs/done/2026-08-01-ponytail-zero.md
---

# Ponytail zero-debt release plan

## Steps

- [x] Inventory all 22 markers, current callers, tests, public issues, registries,
  and runtime capabilities.
- [x] Confirm current primary-source contracts for Cloudflare Rate Limiting,
  Vectorize, D1, NIST password controls, OpenClaw bundles, and Cursor plugins.
- [x] Add native edge login limiting, bounded password rejection, historical
  context, portable budget units, and per-request candidate bounds.
- [x] Add durable replay convergence, semantic index hashes, and bounded missing
  vector verification while preserving append-only evidence.
- [x] Seal dashboard sessions with Web Crypto and a shared optional key; add
  tamper, expiry, restart, and cross-process checks.
- [x] Convert already-proven scheduling, migration, vector-boundary, Bun profile,
  benchmark, and agent-integration ceilings into explicit tested contracts.
- [x] Rewrite the README opening around the Level 6 product model, concrete
  evidence and collaboration differences, `titen.dev`, and C.A.D.I.S Agent;
  run a human editorial pass before release.
- [x] Package and validate the current OpenClaw HTTP bundle; submit only to
  catalogs with a verified official path and record public evidence.
- [x] Run dual-runtime, security, migration, dashboard, package, workflow, and
  zero-ledger checks; inspect the publish tarball for secrets and omissions.
- [x] Publish the stable npm package and supported agent bundle, create the GitHub
  release, deploy the exact artifact to Cloudflare and benchmark-host, smoke all
  surfaces, and verify the recorded rollback path.
- [x] Move this pair to `done/` with exact command, version, commit, deployment,
  registry, and smoke evidence.

## Acceptance evidence mapping

| Acceptance | Planned evidence |
| --- | --- |
| AC-PZ-001 | `node scripts/check-ponytail-debt.mjs`; repository grep returns zero live comments |
| AC-PZ-002 | Cloudflare auth contract test with a fake native limiter plus published Worker smoke |
| AC-PZ-003 | shared account contract rejects common and contextual values on both runtimes |
| AC-PZ-004 | dual-runtime context contract proves historical inclusion/exclusion and invalid-input denial |
| AC-PZ-005 | existing wide-query contract plus D1 local contract suite under the fixed statement cap |
| AC-PZ-006 | enrichment contract advances beyond 100 anchors after persisted cursor rotation |
| AC-PZ-007 | dual-runtime replay test advances the clock beyond 24 hours and distinguishes changed evidence |
| AC-PZ-008 | semantic-index unit/contract test records hash and observes no second embedding call |
| AC-PZ-009 | maintenance fairness contract processes the organization with the oldest pending work |
| AC-PZ-010 | migration validation, dry-run, rollback-artifact, and forward-only checks |
| AC-PZ-011 | context budget unit test covers ASCII, emoji, and non-Latin UTF-8 input |
| AC-PZ-012 | API, MCP, and SDK schema tests cover valid bounds, rejection, and Vectorize cap |
| AC-PZ-013 | architecture and integration tests retain the shared boundary and native bindings |
| AC-PZ-014 | authorized verify route detects a missing vector, enqueues repair, and denies cross-scope access |
| AC-PZ-015 | webhook delivery contract advances across bounded pages and organizations |
| AC-PZ-016 | deployment docs and Bun smoke identify the supported one-process profile |
| AC-PZ-017 | benchmark output and sanitized artifact label lexical-only evidence |
| AC-PZ-018 | dashboard adapter tests cover cross-process shared key, tamper, expiry, logout, and no-key restart invalidation |
| AC-PZ-019 | package archive inspection, current ClawHub validation, public bundle version, and install smoke |
| AC-PZ-020 | agent plugin integration test rejects hooks, automatic recall, transcript capture, and Pi extensions |
| AC-PZ-021 | current compatibility matrix plus public catalog submission URL where supported |
| AC-PZ-022 | npm/GitHub immutable versions, Worker deployment ID, benchmark-host image/version, live smokes, and rollback artifact |
| AC-PZ-023 | README link/attribution assertions plus a manual anti-slop pass against concrete product contracts |

## Terminal result

All acceptance criteria passed. Exact release, deployment, registry, rollback,
and manual-gate identifiers are recorded in the paired
[done spec](../../specs/done/2026-08-01-ponytail-zero.md#delivery-evidence).
The live debt ledger contains zero markers.

## Verification

- `PLAYWRIGHT_PORT=48973 pnpm test:all`: dual-runtime API contracts, integration,
  dashboard adapter, browser, workflow, and package gates passed on the exact
  release merge.
- `bash scripts/verify-pack.sh`: 9/9 package, CLI, MCP, SDK, and global-bin
  checks passed; `pnpm audit --prod` reported no known vulnerabilities.
- `pnpm check:workflow`, `pnpm check:routes`, `pnpm check:ponytail`,
  `bun test tests/integration/agent-plugin.test.ts`, and `git diff --check`
  passed after terminal documentation was recorded.
- Clean npm-registry install: CLI reported `0.5.5`, the SDK exported
  `TitenClient`, and the downloaded tarball SHA-1 matched registry metadata.
- Public discovery smoke: `titen.dev` and `www.titen.dev` returned stable CLI
  `0.5.5`; the release page, installer guide, and documented index-verification
  route returned successfully after Cloudflare deployment.
- Live `/readyz` checks reported revision
  `35ea5552095cd6509f412266fc4c5458cc7c8b10` and schema 21 on Cloudflare and
  `benchmark-host`; both rootless VPS services remained active and loopback-only.

## Security, migration, deploy, and rollback

- Use fake bindings and local runtimes before any external mutation.
- Keep migrations additive; validate Bun SQLite and local D1 before remote D1.
- Never print credentials or session ciphertext inputs in test/deploy output.
- Publish only after `npm pack --dry-run` and archive inspection match the source
  commit.
- Preserve the prior npm version, Worker version, rootless OCI image, database
  backup, and deployment manifest as rollback authorities.
