---
work_id: cloudflare-live-production
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-01
owner: CADIS
spec: docs/specs/done/2026-08-01-cloudflare-live-production.md
---
# Plan — prefix-isolated Cloudflare live production

Spec: [cloudflare-live-production](../../specs/done/2026-08-01-cloudflare-live-production.md)

- [x] Audit clean `origin/main`, locate the maintainer placeholder, map the
      existing native Cloudflare boundary, and verify the authenticated account.
- [x] Refresh August 2026 D1, Vectorize, Workers AI, Wrangler, pricing, limits,
      eventual consistency, Time Travel, and rollback facts from official docs.
- [x] Replace the username placeholder/test fixture and add one isolated
      account-specific Wrangler config without changing the generic OSS config.
- [x] Add the smallest manual deploy/verify documentation and status updates;
      do not add a dependency, Queue, provider abstraction, or GitHub Action.
- [x] Replace the unsupported single 600,000-iteration Worker password call
      with six serial native 100,000-iteration stages and retain the legacy Bun
      verifier contract.
- [x] Run focused browser/config checks, the full local Cloudflare/Bun contracts,
      integration/browser suites, workflow checks, package install, and audit.
- [x] Provision `titen-test-db` and `titen-test-claims-v1`, record a D1 Time
      Travel bookmark, apply schema, and bootstrap credentials through mode-0600
      temporary files without printing secrets.
- [x] Commit the exact candidate, stamp its revision, deploy `titen-test-api`,
      and verify health, readiness, bundle size, and binding truth.
- [x] Run live canonical write/read, Workers AI/Vectorize semantic retrieval,
      eventual-consistency retry, unauthenticated and cross-scope denials,
      cold-request persistence, Cron maintenance, and dashboard-adapter smokes.
- [x] Deploy a schema-compatible successor, prove Worker rollback and retained
      D1 data, then redeploy and re-smoke the exact release candidate.
- [x] Move this pair to `done`, merge to `main`, publish npm/GitHub, update and
      deploy titen.dev stable discovery, remove only the absorbed release branch,
      and verify final remote/package/runtime state.

## Acceptance evidence mapping

- AC-CFL-001: `src/pages/dashboard/index.astro` plus the focused Playwright login
  contract assert the canonical `owner` example and request body.
- AC-CFL-002: parsed Wrangler config inspection and live resource lists prove the
  three prefixed names, native bindings/Cron, and absence of secrets.
- AC-CFL-003: cache-busted live `/healthz` and `/readyz` responses record the
  exact revision, schema, runtime, and semantic capability state.
- AC-CFL-004: the live end-to-end verifier records a canonical write, bounded
  index drain/retry, keyword-free query, intended semantic result, and ordering.
- AC-CFL-005: controlled unauthenticated and foreign-project probes record only
  status/code and prove non-disclosing denial with no foreign result.
- AC-CFL-006: a later cache-busted authenticated compile retrieves the same D1
  claim after independent requests and deployment transitions.
- AC-CFL-007: the live dashboard-adapter verifier and browser assertions prove
  forced first-login replacement, session-only shell access, six-area discovery,
  bounded-role Add User, and session revocation behavior.
- AC-CFL-008: Wrangler deployment/version evidence plus pre/post rollback
  readiness, authenticated data read, and candidate redeploy smoke prove safe
  code rollback without a database rollback.
- AC-CFL-009: terminal spec/plan evidence, workflow checks, exact commit/tag,
  npm/GitHub metadata, titen.dev manifest, and remote branch list agree.
- AC-CFL-010: direct Cloudflare Web Crypto probe, shared Bun/workerd account
  contracts, legacy verifier fixture, and live forced-change/login smoke prove
  the six-stage format and compatibility boundary without secret output.

## Verification

- Local: 108 D1 contract tests, 132 Bun/vector/SDK tests, 192 integration tests,
  six browser tests with two intentional screenshot skips, live dashboard
  verifier, workflow checker/self-test, 22-entry Ponytail ledger, production
  dependency audit, exact Worker dry build, and nine-step clean package install
  all passed. The Worker bundle was 600.17 KiB / 124.29 KiB gzip.
- Cloudflare: schema 20, D1/Vectorize/AI bindings, three scope metadata indexes,
  one-minute Cron, authorized semantic write/read, 11-second convergence,
  persistence, `401`/`404` denial, dashboard adapter, rollback, and exact-SHA
  redeploy passed. Final Worker version is
  `38db0dac-c135-415b-8223-e16f41362261`.
- Distribution: npm `latest`, registry tarball shasum, annotated `v0.5.4`,
  non-draft GitHub Release, titen-web deterministic release sync, 83/83 HTTP
  routes, 9/9 MCP tools, 1200x630 release OG image, build, deploy, and dual-host
  public smokes passed.

## Rollback

- Do not alter or delete any existing non-`titen-test-*` resource.
- Keep the D1 Time Travel bookmark and the previous Worker version. Roll back
  only code known to accept the current schema; do not restore D1 unless a
  separately verified data-loss condition requires the destructive operation.
- Do not publish npm or update stable discovery until the exact deployed
  candidate passes every gate. After publication, fix defects with a newer
  patch release instead of rewriting the published artifact.
