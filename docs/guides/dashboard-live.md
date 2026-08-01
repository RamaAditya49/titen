# Secure live dashboard

The dashboard has no synthetic fallback. A loopback same-origin adapter accepts
`TITEN_API_URL` and `TITEN_API_KEY` only as server environment variables and
forwards safe service checks plus bounded read-only Atlas requests.

```sh
pnpm build
TITEN_DASHBOARD_LIVE=true \
TITEN_API_URL=http://127.0.0.1:8787 \
TITEN_API_KEY='...' \
TITEN_DASHBOARD_ORIGIN=https://host.example.ts.net \
pnpm dashboard:adapter
# open http://127.0.0.1:4322/dashboard/
```

Use a least-privilege key with `views:compile`; add `governance:read` for Scope
preview and `releases:read` for Knowledge releases. Give that key's principal an
active organization-level `reader`, `admin`, or `owner` membership before
enabling the governance lenses. Never put credentials in `PUBLIC_*` variables:
Astro embeds those in browser assets. The adapter exposes
an exact `/dashboard-api/*` allowlist, validates lens-specific subject, claim,
principal, and optional channel input, caps the limit at 100, times out upstream
calls after five seconds, uses no-store JSON, and preserves generic
401/403/404/503 states without relaying upstream secrets.

The adapter still binds loopback when `TITEN_DASHBOARD_ORIGIN` is set; that
value only allowlists one exact reverse-proxy Host/Origin. It supports an HTTPS
Tailscale Serve origin without exposing the API listener or API key. A broader
public ingress requires its own authenticated TLS/session review.
