# Live Memory Atlas dashboard

Titen includes an optional Astro dashboard at `/dashboard/`. It is a read-only
same-origin client of the authenticated Titen API; it contains no fixture
records and is not required for REST or MCP operation.

## Run disconnected

```bash
pnpm install
pnpm dev
```

Open `http://localhost:4321/dashboard/`. Static Astro development has no
credential-bearing adapter, so the page truthfully shows a disconnected state.

## Run live

Build once, then start the existing loopback adapter with a least-privilege key:

```bash
pnpm build
TITEN_DASHBOARD_LIVE=true \
TITEN_API_URL=http://127.0.0.1:8787 \
TITEN_API_KEY='replace-with-a-dashboard-read-key' \
TITEN_DASHBOARD_ORIGIN=https://host.example.ts.net \
pnpm dashboard:adapter
```

Open `http://127.0.0.1:4322/dashboard/`. The browser calls only same-origin
`/dashboard-api/*` routes. The adapter keeps the upstream URL and API key in its
process environment, forwards `/healthz`, `/readyz`, and the six current
read-only Atlas lenses, and never returns the key. Nothing is written to Web
Storage.

Supported lenses:

- Neighborhood and Conflict & freshness require a subject ID;
- Evidence trace requires a focus claim ID;
- Review queue accepts an optional subject filter;
- Scope preview requires a focus principal ID;
- Knowledge releases accepts an optional channel ID and otherwise returns all
  authorized channel releases up to the requested limit.

The four memory lenses need `views:compile`. Scope preview also needs
`governance:read`; Knowledge releases also needs `releases:read`. Use all three
scopes only when the dashboard must expose all six lenses.

Empty, loading, disconnected, not-ready, unauthorized, forbidden, and upstream
failure are distinct states. A failed request never falls back to synthetic
records. Atlas remains the only active dashboard route; the product-map labels
are non-interactive and describe whether an area is visible through Atlas or
remains headless.

## Verification

```bash
pnpm verify:dashboard-live
pnpm test:adapter
pnpm build
pnpm test:browser tests/dashboard.spec.ts
pnpm check:workflow
```

The real smoke provisions a temporary Bun/SQLite service and proves health,
readiness, evidence trace, neighborhood, conflict/freshness, review queue, and
cross-subject exclusion through the adapter. Browser and adapter tests also
cover the exact Scope preview and Knowledge releases input contracts, including
an empty principal timestamp. Browser tests cover no-secret, no-storage,
disconnected, loading, empty, denial, mobile, and keyboard paths.

Refresh documentation captures explicitly with `pnpm screenshots`; ordinary
test runs do not rewrite tracked images.

## Deployment and rollback

The included adapter binds only to loopback and rejects foreign Host and Origin
values. `TITEN_DASHBOARD_ORIGIN` allowlists exactly one HTTPS reverse-proxy
origin while keeping the listener and upstream API private. Put authentication
and TLS at a separately audited ingress before making it remotely reachable;
do not treat the adapter as a public session service. Rollback is stopping the
optional adapter or removing the dashboard static assets. Neither action
changes canonical data or headless readiness.
