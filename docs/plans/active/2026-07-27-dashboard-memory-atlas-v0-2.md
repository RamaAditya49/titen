---
work_id: titen-dashboard-memory-atlas-v0-2
status: active
stage: plan
outcome: pending
complexity: complex
created: 2026-07-27
updated: 2026-07-27
review_after: 2026-08-10
owner: titen-maintainers
spec: docs/specs/active/2026-07-27-dashboard-memory-atlas-v0-2.md
---

# Plan: Titen Dashboard v0.2 Memory Atlas workspace

## Delivery boundary

This plan prepares one read-only dashboard vertical slice. It does not authorize
implementation before the spec's entry gate, and it does not include the v0.3
governance lenses or a general administration console.

## Ordered steps

- [ ] Verify the implementation entry gate: root runtime scaffold, frozen
      authorized fixture, server view contract/release owner, declared effective
      limits, and reference browsers.
- [ ] Move both artifacts to `stage: implement` immediately before the first
      dashboard source edit.
- [ ] Add the smallest root build commands and one `dashboard/` static source
      boundary; do not create a package, workspace, frontend framework, graph
      library, or provider SDK.
- [ ] Implement an exact runtime decoder for the v0.2 view response, bounded
      client validation, same-origin/custom-origin connection rules, and a
      memory-only credential lifecycle.
- [ ] Implement the disconnected, ready, loading, empty, unauthorized, degraded,
      truncated, network-error, success, and disconnected-after-data states.
- [ ] Implement the three pure deterministic layouts and native SVG pan, zoom,
      reset, and selection without force simulation or background animation.
- [ ] Implement the synchronized HTML record/relationship list, details
      inspector, legend, focus management, keyboard behavior, mobile collapse,
      reduced motion, forced colors, and 200% zoom behavior.
- [ ] Apply the canonical Titen brand tokens and existing Kawung asset with no
      remote font, third-party asset, fake metric, or unimplemented navigation.
- [ ] Add the minimum pure-layout/state tests and one local browser suite for
      credential storage, auth denial, keyboard/mobile accessibility, response
      bounds, rendering, disconnect clearing, and performance measurements.
- [ ] Integrate the real `POST /v1/memory-views/compile` endpoint and run the same
      fixture against mock, Cloudflare, and VPS contracts without direct storage
      access from the client.
- [ ] Build one production static artifact, record gzip size and browser
      performance samples, and verify its content has no source maps, secrets,
      test fixtures, or environment-specific API key.
- [ ] Update dashboard, architecture, API, security, evaluation, and deployment
      documentation only where implementation creates an observable contract.
- [ ] Verify optional hosting and rollback: disable/remove the static route while
      confirming headless REST/MCP and canonical data remain unchanged.
- [ ] Record all acceptance evidence, close every checkbox, and move the paired
      artifacts to `done/` in the same change.

## Acceptance evidence

| Criterion   | Planned evidence                                                                          |
| ----------- | ----------------------------------------------------------------------------------------- |
| AC-DASH-001 | dependency graph/build inspection; kernel import check; six-tool MCP assertion            |
| AC-DASH-002 | browser network test proving zero authenticated request before explicit connect            |
| AC-DASH-003 | browser storage/URL/console/request inspection with synthetic canary credential/data        |
| AC-DASH-004 | invalid, revoked, private, and foreign-focus browser/contract cases                         |
| AC-DASH-005 | request spy plus authorized fixture parity for all three v0.2 lenses                        |
| AC-DASH-006 | delayed-response test for skeleton, duplicate-submit prevention, and stale-view clearing    |
| AC-DASH-007 | authorized empty-response screenshot/DOM assertion with zero fabricated records             |
| AC-DASH-008 | degraded and truncated fixtures with persistent labeled notices and authorized-only metadata |
| AC-DASH-009 | selection test proving stable coordinates, synchronized inspector/list, and zero fetch      |
| AC-DASH-010 | narrow-viewport browser test at 320 and 767 CSS pixels with overflow assertion              |
| AC-DASH-011 | reduced-motion and forced-colors browser snapshots plus keyboard/focus assertions           |
| AC-DASH-012 | malformed and above-cap fixtures proving pre-layout rejection and bounded error output       |
| AC-DASH-013 | raw local performance samples on the declared 200-node/400-edge reference fixture            |
| AC-DASH-014 | production gzip report and dependency/import audit                                           |
| AC-DASH-015 | identical artifact hash plus Cloudflare/VPS route and headless-disabled smoke                 |
| AC-DASH-016 | disconnect, page-unload, and auth-failure data/credential clearing browser tests              |

## Planned local verification

Exact scripts are added with the root scaffold, but the implementation must
provide equivalent local commands for:

```bash
pnpm dashboard:build
bun test test/dashboard
pnpm dashboard:test:browser
node scripts/check-workflow-docs.mjs
node scripts/check-workflow-docs.mjs --self-test
git diff --check
```

The browser command records browser version, reference machine, fixture hash,
initial-render samples, interaction-frame samples, viewport, reduced-motion,
forced-colors, and final asset gzip bytes. GitHub Actions remain disabled.

## Security verification

- capture requests, console, URL/history, storage, IndexedDB, service-worker,
  and built-asset output with a synthetic canary secret;
- verify CORS rejects an unlisted origin and CSP excludes third-party assets,
  `unsafe-eval`, and undeclared `connect-src` targets;
- verify a foreign/private focus and one hidden edge endpoint produce no label,
  topology, count, prior-view, or timing-dependent expansion disclosure;
- verify malformed/oversized data is rejected before coordinate generation;
- verify dashboard errors never include raw response content or credentials;
- verify no dashboard operation mutates memory, feedback, checkpoint, lease,
  handoff, policy, or release state.

## Deployment and smoke sequence

1. Build once and record the static artifact hash.
2. Serve that artifact locally against a deterministic mock and the real VPS
   endpoint.
3. When the Cloudflare runtime is available, serve the identical artifact via
   its optional static-assets path and call the same REST contract.
4. Run unauthenticated, invalid-key, foreign-focus, authorized, empty,
   degraded, truncated, and disconnect smoke cases on each enabled host.
5. Disable the dashboard route and repeat headless health, REST, and MCP smoke.

Publishing, pushing, deploying, or opening an external route requires a later
explicit instruction and the relevant release gate. This planning change does
not perform those actions.

## Migration

No canonical schema or data migration belongs to the dashboard. If the server
view compiler later requires a migration, it receives its own EARS work item and
must land before dashboard integration is called complete.

## Rollback

- remove or disable the `/dashboard/` static route and its asset manifest;
- leave `POST /v1/memory-views/compile`, SQL, indexes, credentials, and MCP
  unchanged;
- remove any dashboard-only CORS/CSP origin entries;
- run headless REST/MCP smoke and confirm canonical record counts/hashes are
  unchanged;
- retain no browser credential or view cache to migrate or recover.

Rollback is static and data-free. A dashboard failure must never require a
database restore.
