# Run the secure live dashboard

The dashboard talks only to a same-origin adapter bound to
`127.0.0.1:4322`. The adapter talks to the Titen API at `127.0.0.1:8787`.

```sh
pnpm build
TITEN_DASHBOARD_LIVE=true \
TITEN_DASHBOARD_AUTH=session \
TITEN_API_URL=http://127.0.0.1:8787 \
pnpm dashboard:adapter
```

Open `http://127.0.0.1:4322/dashboard/`, then sign in with the operator username
and password printed by `titen bootstrap`. The temporary password must be
replaced before the private product shell opens. The API issues a short-lived
key only to the adapter; the browser receives an opaque HttpOnly cookie. It is
discarded after eight hours, logout, password change, revocation, or restart.

For remote access, keep both listeners on loopback, set the exact HTTPS
`TITEN_DASHBOARD_ORIGIN`, and follow the
[secure ingress tutorial](../deployment/secure-ingress.md): Tailscale Serve for
private tailnet access, or Cloudflare Tunnel plus Cloudflare Access for a
custom hostname.

Never put a credential in `PUBLIC_*`, a URL, or browser storage. Session mode
does not require `TITEN_API_KEY` in the adapter environment. The adapter has a
fixed route allowlist, bounded request bodies, exact Host/Origin validation,
five-second upstream timeouts, no-store JSON, and generic external errors.

An organization owner/admin with `keys:manage` and `memberships:write` can use
Governance → Add a human user. Titen creates the membership and password account
atomically, shows a random temporary password once, and requires its replacement
on first login. API keys remain for agents, services, SDKs, and recovery.

```sh
pnpm verify:dashboard-live
pnpm test:adapter
pnpm test:browser tests/dashboard.spec.ts
```
