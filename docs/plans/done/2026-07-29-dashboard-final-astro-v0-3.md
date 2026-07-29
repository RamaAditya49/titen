---
work_id: titen-dashboard-final-astro-v0-3
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-29
updated: 2026-07-29
owner: titen-maintainers
spec: docs/specs/done/2026-07-29-dashboard-final-astro-v0-3.md
---

# Plan: Titen final dashboard v0.3 Astro Memory Atlas

## Ordered steps

- [x] Audit the repository, shared memory, existing Graphify graph, ZIP
      contents, design source, and rendered 1600 x 1080 reference frame.
- [x] Close the unimplemented v0.2 dashboard pair as superseded and revise the
      approved scope into this EARS spec/plan before source implementation.
- [x] Add the smallest Astro static scaffold, local brand/font assets, and
      production/local verification commands without GitHub Actions.
- [x] Reproduce the final dashboard frame with semantic Astro markup, exact
      desktop visual tokens, native SVG graphs, and a responsive composition.
- [x] Implement four lens states, three inspector states, search dialog,
      keyboard shortcut, disconnect/reconnect, focus treatment, reduced motion,
      and forced-colors behavior with a small dependency-free browser script.
- [x] Add one Playwright browser suite that covers the reference render,
      runtime-request boundary, interactions, keyboard dialog, disconnect,
      desktop/mobile overflow, accessibility basics, and console errors.
- [x] Build production output, run tests against `astro preview`, measure gzip
      size, and capture desktop, alternate-lens, and mobile screenshots.
- [x] Inspect the captured images, correct visual/responsive drift, and add the
      selected real screenshots to the public README.
- [x] Align DESIGN, PRD, FRD, documentation map, and dashboard documentation
      with the implemented Astro frontend-demonstration boundary.
- [x] Run formatting, workflow checker/self-test, local-link validation, build,
      browser tests, bundle checks, secret/static-artifact inspection, and
      `git diff --check`.
- [x] Record criterion-by-criterion evidence, close every checkbox, move this
      pair to `done/`, verify a clean post-move gate, and commit the result.

## Acceptance evidence

| Criterion         | Result | Evidence                                                                                                               |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| AC-FINAL-DASH-001 | PASS   | Production screenshot is 1600 x 1080; DOM smoke covers the named Atlas regions; visual MAE against the source is 1.49% |
| AC-FINAL-DASH-002 | PASS   | `package.json` and artifact gate confirm Astro 7.1.4 is the only production dependency                                 |
| AC-FINAL-DASH-003 | PASS   | Playwright request log contains loopback-only assets with zero failed requests                                         |
| AC-FINAL-DASH-004 | PASS   | Browser loop verifies all four lenses, one visible panel, heading, and `aria-pressed` state without a request          |
| AC-FINAL-DASH-005 | PASS   | Browser assertions verify focus, disputed, and observation inspectors without a request                                |
| AC-FINAL-DASH-006 | PASS   | Browser assertions cover click, Control-K, focus transfer, selection, and Escape close on the native dialog element    |
| AC-FINAL-DASH-007 | PASS   | Disconnect/reconnect browser assertions pass and local/session storage remain empty                                    |
| AC-FINAL-DASH-008 | PASS   | 390 x 844 and 768 x 1024 browser checks show no page overflow and an internally scrollable graph                       |
| AC-FINAL-DASH-009 | PASS   | Stylesheet includes reduced-motion removal and forced-colors boundaries; controls retain text and pressed state        |
| AC-FINAL-DASH-010 | PASS   | README and dashboard/design/requirement docs label the data synthetic and the other areas unavailable                  |
| AC-FINAL-DASH-011 | PASS   | Browser test finds eight non-Atlas labels without links; source has no API client or mutation path                     |
| AC-FINAL-DASH-012 | PASS   | Production gate measures 9.2 KiB gzip; browser smoke reports zero failed requests and console errors                   |
| AC-FINAL-DASH-013 | PASS   | Three inspected production screenshots are checked in and rendered by README                                           |
| AC-FINAL-DASH-014 | PASS   | Build emits portable static `dist/`; `docs/dashboard.md` documents the same artifact for Cloudflare or VPS             |
| AC-FINAL-DASH-015 | PASS   | `.github/workflows/` contains zero files; package scripts expose all local verification commands                       |

## Test, security, deployment, and rollback

- Tests run only against synthetic fixture data and may not contain credentials.
- The browser suite rejects non-loopback requests, console errors, storage
  writes, and horizontal page overflow at required viewports.
- Deployment is not part of this work; the verified artifact is `dist/` and no
  provider configuration is added.
- Rollback is a Git revert of this commit or removal of the optional static
  dashboard route; the memory kernel and canonical data are untouched because
  the dashboard has no backend import or runtime write path.

## Verification

- `pnpm test` — PASS on Node 24.18.0 and pnpm 11.17.0: Astro 7.1.4 built two
  static routes and all eight Chromium tests passed.
- `pnpm build` — PASS: dashboard CSS plus inline JavaScript is 9.2 KiB gzip
  against the 80 KiB budget.
- `pnpm check:workflow` — PASS: ten artifacts valid and checker self-test pass.
- Markdown link audit — PASS: 110 local targets across 36 Markdown files
  resolve before closure; the post-move audit is the final authority.
- Prettier 3.6.2 with prettier-plugin-astro 0.14.1 — PASS for changed source and
  documentation; these one-shot tools are not repository dependencies.
- Static-artifact inspection — PASS: no source map, external runtime asset,
  credential marker, or GitHub Actions workflow.
- `pnpm audit --prod` — PASS: no known production dependency vulnerability.
- `git diff --check` — PASS.
- Visual evidence — inspected
  `docs/assets/screenshots/dashboard-atlas-evidence.png` at 1600 x 1080,
  `dashboard-conflict-freshness.png` at 1600 x 1080, and
  `dashboard-mobile.png` at 390 x 2140. ImageMagick MAE between the source
  frame and default production frame is 0.0149284 (1.49%).
- Deployment — not applicable to this work. The verified handoff is the static
  `dist/` contract; no provider, publish, or live runtime was requested.
- Rollback — revert the implementation commit. No backend, canonical memory,
  credential, or remote service was changed.
