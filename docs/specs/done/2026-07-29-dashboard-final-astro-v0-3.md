---
work_id: titen-dashboard-final-astro-v0-3
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-29
updated: 2026-07-29
owner: titen-maintainers
---

# Titen final dashboard v0.3: Astro Memory Atlas

## Decision source

Rama approved `Titen Dashboard Final.dc.html` from
`Titen #1 Level 6 Memory Agent.zip` on 2026-07-29 as the final visual source.
This work replaces the unimplemented v0.2 browser-native plan with an
Astro-first static dashboard. The supplied 1600 x 1080 default frame is the
desktop visual reference; the current repository contracts remain the source
of truth for security and product boundaries.

## Problem

Titen has a documented Memory Atlas contract and a final interface mockup, but
no runnable dashboard, visual regression evidence, responsive behavior, or
README preview. The implementation must reproduce the approved design without
pretending that the memory service or the other operator areas already ship.

## Intended outcome

Ship a production-built Astro dashboard at `/dashboard/` that faithfully
renders the approved Memory Atlas frame, supports its four lens views and three
inspector states against a deterministic demonstration fixture, works from
mobile through the 1600 x 1080 reference frame, and includes real screenshots
from the built artifact in the public README.

## In scope

- one Astro static site in this repository, with `/` redirecting to
  `/dashboard/` and no server adapter;
- the supplied Titen mark, final palette, type hierarchy, spacing, icons,
  navigation rail, header, lens rail, truncation notice, Atlas workspace,
  compile trace, inspector, and boundary notice;
- Evidence Trace, Neighborhood, Conflict & Freshness, and Scope Preview fixture
  views;
- focus-claim, disputed-claim, and observation inspector selection;
- the mockup's search affordance using an accessible native dialog and keyboard
  shortcut, plus a demonstrable disconnect/reconnect state;
- responsive desktop, tablet, and mobile layouts with a deliberately scrollable
  graph canvas where its topology would otherwise become unreadable;
- locally served brand assets and font files; no runtime third-party request;
- Astro build, browser smoke tests, accessibility assertions, bundle-size
  evidence, visual inspection, and checked-in screenshots;
- aligned README, DESIGN, PRD, FRD, documentation index, and work records.

## Out of scope

- a real memory API, authentication, browser-held API keys, database access,
  writes, approvals, releases, webhooks, or orchestration;
- functional pages behind Memories, Context, Work, Audit & Events, System,
  Access, Approvals, or Releases;
- a graph library, UI component library, state library, analytics, service
  worker, remote font, server rendering, Cloudflare adapter, or GitHub Actions;
- claiming that fixture values, the displayed connection, or other navigation
  areas represent a deployed backend;
- changing Titen's canonical data, authorization, retrieval, or dual-runtime
  architecture.

## Product and security boundary

The first build is an interactive product-quality frontend demonstration. Its
data is a frozen synthetic fixture embedded at build time. The sidebar is the
approved dashboard information map: Atlas is the only active route, while
other labels are non-interactive orientation, not locked controls or claims of
shipped functionality. The browser makes no API request and stores no
credential or fixture state. Future API integration requires a new EARS work
item covering authorization, failure, degraded, and parity behavior.

## Technical boundary

Use Astro as the only runtime dependency and generate static HTML. Keep the
visual implementation in one page, one stylesheet, and one small browser
script unless a real reuse boundary emerges. Use inline SVG for the approved
icon and graph language and the native dialog element for search. Use Playwright only as
a development verification dependency.

The production output must be portable static files. Cloudflare Pages/Workers
static assets and a VPS file server may serve the same `dist/` directory; this
work does not add provider-specific runtime code.

## Responsive behavior

- At 1360 CSS pixels and wider, preserve the reference rail proportions and
  two-column Atlas/inspector composition.
- Below 1360 pixels, keep the rail legible and stack the inspector beneath the
  Atlas column when needed.
- Below 900 pixels, move the product rail into a compact horizontal header,
  wrap controls, and keep tables/graph topology inside labelled scroll regions.
- Below 640 pixels, use a single-column reading order with no horizontal page
  overflow; graph/table internals may scroll within their own boundaries.

## Accessibility and motion

- Use semantic landmarks, a single page heading, native buttons, meaningful
  button names, `aria-pressed` lens state, `aria-current` navigation state,
  live status updates, and a correctly labelled dialog.
- All interactive elements require visible focus and keyboard operation.
- The graph is accompanied by visible labels and inspector text; color is not
  the only state signal.
- `prefers-reduced-motion` disables the mockup caret and nonessential
  transitions. Forced-colors mode preserves boundaries and selection.

## Performance budget

- Astro client JavaScript plus CSS must stay below 80 KiB gzip in the production
  build; local fonts and SVG/image assets are excluded.
- The default dashboard must become interactive without hydration framework
  code, API calls, polling, WebSocket, or timers other than the CSS caret.
- The 1600 x 1080 screenshot must finish after `document.fonts.ready` with no
  failed runtime requests or browser console errors.

## EARS acceptance criteria

- **AC-FINAL-DASH-001 — Ubiquitous:** Titen shall generate a static Astro dashboard at `/dashboard/` whose 1600 x 1080 default state follows the approved final mockup's content, palette, typography, spacing, navigation, Atlas topology, compile trace, and inspector hierarchy.
- **AC-FINAL-DASH-002 — Ubiquitous:** Titen shall keep Astro as the only production package dependency and shall require no UI, graph, state, icon, analytics, or provider framework.
- **AC-FINAL-DASH-003 — Ubiquitous:** Titen shall serve every dashboard font, logo, and visual asset from the built artifact and shall make no third-party runtime request.
- **AC-FINAL-DASH-004 — Event-driven:** When an operator activates a lens control, Titen shall show exactly one matching Evidence Trace, Neighborhood, Conflict & Freshness, or Scope Preview view and shall update the pressed state and heading without navigation or a network request.
- **AC-FINAL-DASH-005 — Event-driven:** When an operator selects the focus claim, disputed claim, or observation, Titen shall show the matching inspector content without changing the selected lens topology or issuing a network request.
- **AC-FINAL-DASH-006 — Event-driven:** When an operator invokes the search control or its documented keyboard shortcut, Titen shall open a labelled, keyboard-closable native search dialog and shall move focus into its search field.
- **AC-FINAL-DASH-007 — Event-driven:** When an operator disconnects the demonstration workspace, Titen shall remove the connected presentation and private-detail fixture from view until the operator explicitly reconnects, without persisting state.
- **AC-FINAL-DASH-008 — Optional feature:** Where the viewport is narrower than 900 CSS pixels, Titen shall preserve a single-column reading path with no horizontal page overflow and shall confine wide graph/table content to labelled internal scroll regions.
- **AC-FINAL-DASH-009 — Optional feature:** Where reduced motion or forced colors are enabled, Titen shall preserve labels, focus, selected state, and boundaries while removing nonessential motion and color-only meaning.
- **AC-FINAL-DASH-010 — Ubiquitous:** Titen shall identify the dashboard data in public documentation as a synthetic demonstration fixture and shall not claim that sidebar areas or the displayed runtime connection are deployed capabilities.
- **AC-FINAL-DASH-011 — Unwanted behavior:** If a dashboard interaction would require an unavailable backend capability, then Titen shall leave the control non-interactive or explain the demonstration boundary and shall not fabricate a successful mutation.
- **AC-FINAL-DASH-012 — Ubiquitous:** Titen shall keep production dashboard JavaScript plus CSS below 80 KiB gzip and shall emit no browser console error or failed runtime request during the reference smoke.
- **AC-FINAL-DASH-013 — Event-driven:** When the production build is verified, Titen shall capture real dashboard screenshots from that build, inspect them, and publish the selected images in the public README.
- **AC-FINAL-DASH-014 — Optional feature:** Where the static artifact is hosted on Cloudflare or a VPS, Titen shall use the same `dist/` files without a provider-specific dashboard runtime.
- **AC-FINAL-DASH-015 — Ubiquitous:** Titen shall keep GitHub Actions disabled and shall expose reproducible local build, test, screenshot, and workflow-document checks instead.

## Risks and mitigations

| Risk                                                    | Mitigation                                                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Mockup-only data is mistaken for a live service         | Label the README preview and technical docs as a synthetic fixture; add no API client in this work                    |
| Pixel fidelity creates an unmaintainable component maze | Preserve the mockup structure in one Astro page and one tokenized stylesheet; split only at a measured reuse boundary |
| Fixed graph coordinates break narrow screens            | Preserve exact desktop coordinates in an internal scroll canvas and provide responsive page composition around it     |
| Remote fonts break privacy/offline rendering            | Vendor only the used font files and licenses in the repository                                                        |
| Navigation implies unavailable features                 | Keep only Atlas active and make other labels semantic non-links with an explicit documentation boundary               |
| Screenshots drift from production output                | Capture from `astro preview` after the production build and keep the browser script reproducible                      |

## Done conditions

- every acceptance criterion has recorded, reproducible evidence;
- the production build, browser tests, document workflow checks, formatting,
  link checks, and `git diff --check` pass;
- desktop and mobile screenshots are visually inspected and the chosen preview
  images are referenced by README;
- no GitHub Actions workflow exists;
- the plan has no unchecked item and both work artifacts move to `done/` with
  `outcome: completed` in the same commit.
