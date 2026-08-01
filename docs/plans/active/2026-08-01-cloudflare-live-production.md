---
work_id: cloudflare-live-production
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-01
updated: 2026-08-01
review_after: 2026-08-15
owner: CADIS
spec: docs/specs/active/2026-08-01-cloudflare-live-production.md
---
# Plan — prefix-isolated Cloudflare live production

Spec: [cloudflare-live-production](../../specs/active/2026-08-01-cloudflare-live-production.md)

- [x] Audit clean `origin/main`, locate the maintainer placeholder, map the
      existing native Cloudflare boundary, and verify the authenticated account.
- [x] Refresh August 2026 D1, Vectorize, Workers AI, Wrangler, pricing, limits,
      eventual consistency, Time Travel, and rollback facts from official docs.
- [ ] Replace the username placeholder/test fixture and add one isolated
      account-specific Wrangler config without changing the generic OSS config.
- [ ] Add the smallest manual deploy/verify documentation and status updates;
      do not add a dependency, Queue, provider abstraction, or GitHub Action.
- [ ] Run focused browser/config checks, the full local Cloudflare/Bun contracts,
      integration/browser suites, workflow checks, package install, and audit.
- [ ] Provision `titen-test-db` and `titen-test-claims-v1`, record a D1 Time
      Travel bookmark, apply schema, and bootstrap credentials through mode-0600
      temporary files without printing secrets.
- [ ] Commit the exact candidate, stamp its revision, deploy `titen-test-api`,
      and verify health, readiness, bundle size, and binding truth.
- [ ] Run live canonical write/read, Workers AI/Vectorize semantic retrieval,
      eventual-consistency retry, unauthenticated and cross-scope denials,
      cold-request persistence, Cron maintenance, and dashboard-adapter smokes.
- [ ] Deploy a schema-compatible successor, prove Worker rollback and retained
      D1 data, then redeploy and re-smoke the exact release candidate.
- [ ] Move this pair to `done`, merge to `main`, publish npm/GitHub, update and
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

## Verification

- Local: focused placeholder/config checks; Bun/SQLite and workerd/D1 contracts;
  integration, dashboard browser, type/build, workflow, package-install, and
  production dependency audit.
- Cloudflare: resource/binding inspection; D1 schema/bookmark; health/readiness;
  authorized write/read; semantic drain/query; denial; Cron; cold request;
  rollback/redeploy; dashboard adapter against the live Worker.
- Distribution: packed tarball contents, clean install/import/CLI, npm `latest`,
  annotated Git tag, GitHub release, stable manifest, and public Worker smoke.

## Rollback

- Do not alter or delete any existing non-`titen-test-*` resource.
- Keep the D1 Time Travel bookmark and the previous Worker version. Roll back
  only code known to accept the current schema; do not restore D1 unless a
  separately verified data-loss condition requires the destructive operation.
- Do not publish npm or update stable discovery until the exact deployed
  candidate passes every gate. After publication, fix defects with a newer
  patch release instead of rewriting the published artifact.
