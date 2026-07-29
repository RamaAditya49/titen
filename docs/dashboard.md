# Dashboard

Titen includes a static Astro implementation of the approved Memory Atlas
dashboard at `/dashboard/`. It is a product-quality frontend preview, not the
memory service: every displayed record, count, connection label, and trace is a
frozen synthetic fixture.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:4321/dashboard/`.

The production and browser gate is:

```bash
pnpm test
pnpm check:workflow
```

`pnpm test` builds static output into `dist/`, enforces the 80 KiB gzip CSS/JS
budget, starts `astro preview`, and runs the Chromium interaction, network,
storage, responsive, and screenshot checks. GitHub Actions remain disabled;
these are local maintainer gates.

## Implemented frontend behavior

- exact desktop composition from the approved 1600 x 1080 final mockup;
- Evidence Trace, Neighborhood, Conflict & Freshness, and Scope Preview lenses;
- focus claim, disputed claim, and observation inspectors;
- tap-to-inspect phone flow that brings the selected detail card into view;
- native search dialog from the header or <kbd>Ctrl/Command</kbd>+<kbd>K</kbd>;
- disconnect/reconnect that removes the private fixture from view and persists
  nothing;
- responsive page composition with a vertical evidence trail and labelled table
  cards on phones, plus bounded graph/table scrolling on wider screens;
- reduced-motion, forced-colors, visible-focus, and semantic landmark support;
- locally built fonts, logo, SVG graphs, and icons with no third-party runtime
  request.

Atlas is the only active route. Memories, Context, Work, Audit & Events, System,
Access, Approvals, and Releases are non-interactive labels that preserve the
approved information map; they are not available product pages.

## Screenshot workflow

The README images are real captures from `astro preview`:

```bash
pnpm build
pnpm screenshots
```

Outputs:

- `docs/assets/screenshots/dashboard-atlas-evidence.png`;
- `docs/assets/screenshots/dashboard-conflict-freshness.png`;
- `docs/assets/screenshots/dashboard-mobile.png`.

Inspect every refreshed image before committing it. A test pass proves the
capture completed; it does not replace visual review.

## Static hosting

The dashboard has no Astro server adapter. Serve the same `dist/` directory on
Cloudflare static assets/Pages or a VPS static file server and preserve trailing
slash routing for `/dashboard/`. Do not expose the preview as a live memory
service or attach production credentials to it.

The future authorized API integration needs a new EARS work item. It must add
memory-only credential handling, generic denial, bounded response decoding,
canonical hydration behavior, Cloudflare/VPS contract parity, and deployment
smoke evidence before any fixture label is replaced by live data.

## Rollback

Remove or revert the optional static dashboard artifact. The current frontend
imports no Titen database, API, provider adapter, or memory kernel, so rollback
cannot mutate canonical data or headless REST/MCP behavior.
