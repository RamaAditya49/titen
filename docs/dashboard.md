# Live operator dashboard

Titen includes an optional Astro dashboard at `/dashboard/`. It uses the
authenticated Titen API through a loopback same-origin adapter. The browser
contains no fixture fallback and never stores an API key in Web Storage.

The product map has six live, capability-gated areas:

| Area | Live job | Required read capability |
| --- | --- | --- |
| Memories | compile the six bounded Memory Atlas lenses | `views:compile` |
| Context | compile a task-specific context pack | `context:compile` |
| Work | list leases and pending handoffs; find an exact checkpoint | `leases:read`, `handoffs:read`, or `checkpoints:read` |
| Audit | list bounded audit records and domain events | `audit:read` or `events:read` |
| Governance | inspect memberships, keys, policies, approvals, channels, and releases | matching governance read capability |
| Federation | inspect owned peers and a bounded peer log | `federation:read` |

The navigation hides an area when the signed-in principal has none of its
capabilities. That is presentation only: the API authenticates and authorizes
every request again.

## Run disconnected

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:4321/dashboard/`. Static Astro development has no
credential-bearing adapter, so it shows a disconnected state.

## Run with per-user login

Start the Bun API first, then build and run the adapter:

```bash
pnpm build
TITEN_DASHBOARD_LIVE=true \
TITEN_DASHBOARD_AUTH=session \
TITEN_API_URL=http://127.0.0.1:8787 \
pnpm dashboard:adapter
```

Open `http://127.0.0.1:4322/dashboard/` and sign in with an active Titen API
key. The adapter verifies it against `GET /v1/principal`, keeps it only in
process memory, and gives the browser an opaque `HttpOnly; SameSite=Strict`
cookie. Sessions expire after eight hours and are discarded on logout, API-key
revocation, or adapter restart. A new login with the same key replaces its
previous session; one adapter holds at most 128 active sessions.

For a remote HTTPS hostname, set its exact origin:

```bash
TITEN_DASHBOARD_LIVE=true \
TITEN_DASHBOARD_AUTH=session \
TITEN_API_URL=http://127.0.0.1:8787 \
TITEN_DASHBOARD_ORIGIN=https://memory.example.com \
pnpm dashboard:adapter
```

The listener remains `127.0.0.1:4322`. The origin only authorizes the reverse
proxy Host and same-origin mutations and adds `Secure` to the session cookie.
Use [Tailscale Serve or Cloudflare Tunnel with Access](./deployment/secure-ingress.md)
instead of opening the adapter or API port.

## Add a user

An organization `owner` or `admin` with `keys:manage` and
`memberships:write` sees **Governance → Add a human user**. One submission
creates the organization membership and its API key in one transaction. An
admin cannot grant the owner role, scope/trust escalation is rejected, and a
partial failure creates neither record. The raw key is shown once.

Titen intentionally reuses its existing human principal, membership, and API
key contracts. It does not add a password database, email invitation flow, or
identity provider merely for the dashboard. Add SSO/SCIM when a deployment has
an external identity requirement.

## Legacy server-key mode

Existing private installations can omit `TITEN_DASHBOARD_AUTH=session` and set
`TITEN_API_KEY`. Every browser then shares that one server-side principal and
user administration is disabled. Keep this mode behind a private ingress; use
session mode for a new deployment.

## Verification

```bash
pnpm verify:dashboard-live
pnpm test:adapter
pnpm build
pnpm test:browser tests/dashboard.spec.ts
pnpm check:workflow
```

The real smoke starts temporary Bun/SQLite and proves login, all six areas,
atomic Add User, logout, and login with the newly issued key through the real
adapter. Integration and browser tests also cover credential isolation,
revocation, exact origin checks, request-size limits, capability hiding, stale
private-state clearing, keyboard use, and a 320 px viewport.

Rollback is stopping the optional adapter or restoring the previous dashboard
image. Neither action mutates canonical memory.
