# Live operator dashboard

Titen includes an optional Astro dashboard at `/dashboard/`. It uses the
authenticated Titen API through a loopback same-origin adapter. Human operators
use username/password; the browser contains no fixture fallback and never stores
a password or API key in Web Storage.

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

Memories is principal-scoped by default, including for owners. A root/owner
with the separate `views:compile:all` capability may explicitly enable the
same-organization administrator view and choose a bounded incident/recovery
reason. The adapter forwards that mode only through the fixed Atlas route, and
the API records metadata-only audit evidence. The dashboard never probes for
hidden counts or claims that an empty principal-scoped result means canonical
memory is globally empty.

## Run disconnected

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:4321/dashboard/`. Static Astro development has no
credential-bearing adapter, so it shows a disconnected state.

## Run with per-user login

The npm package includes the current dashboard build and adapter. Start the Bun
API first, then run the adapter from the same installed release:

```bash
TITEN_DASHBOARD_LIVE=true \
TITEN_DASHBOARD_AUTH=session \
TITEN_API_URL=http://127.0.0.1:8787 \
titen dashboard
```

A source checkout may use `pnpm build && pnpm dashboard:adapter` instead.

Open `http://127.0.0.1:4322/dashboard/` and sign in with an operator username and
password. The API verifies the password, issues a short-lived API key to the
adapter, which seals it with AES-GCM inside an opaque
`HttpOnly; SameSite=Strict` cookie. The raw key never enters browser-visible
JSON or Web Storage. Sessions expire after eight hours and fail closed after
logout, revocation, password change, tampering, or key rotation. With no
`TITEN_DASHBOARD_SESSION_KEY`, startup creates an ephemeral key and restart logs
everyone out. Replicas may share a base64url-encoded 32-byte key through their
secret manager when restart-stable sessions are required.

`titen bootstrap` creates username `owner` and prints a random temporary
password once. A temporary password opens only the **Set a new password** page;
the private sidebar, topbar, and product routes remain unavailable. The change
revokes the temporary session and requires a fresh login. For a second
organization in the same database, pass a unique `--username` because dashboard
usernames are deployment-wide login identifiers.

For a remote HTTPS hostname, set its exact origin:

```bash
TITEN_DASHBOARD_LIVE=true \
TITEN_DASHBOARD_AUTH=session \
TITEN_API_URL=http://127.0.0.1:8787 \
TITEN_DASHBOARD_ORIGIN=https://memory.example.com \
titen dashboard
```

The listener remains `127.0.0.1:4322`. The origin only authorizes the reverse
proxy Host and same-origin mutations and adds `Secure` to the session cookie.
Use [Tailscale Serve or Cloudflare Tunnel with Access](./deployment/secure-ingress.md)
instead of opening the adapter or API port.

## Add a user

An organization `owner` or `admin` with `keys:manage` and
`memberships:write` sees **Governance → Add a human user**. One submission
creates the organization membership and its password account in one transaction.
Titen generates a random temporary password, displays it once, and requires the
new user to replace it on first login. An
admin cannot grant the owner role, scope/trust escalation is rejected, and a
partial failure creates neither record. No raw API key is returned.

Titen reuses its existing human principal, membership, scope, trust, and role
contracts. Email delivery, recovery, self-registration, MFA, and SSO/SCIM remain
out of scope; add them when a deployment has those identity requirements.

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

The real smoke starts temporary Bun/SQLite and proves login, forced first
password replacement, all six areas, atomic Add User, logout, and fresh login
through the real adapter. Integration and browser tests also cover credential
isolation, revocation, exact origin checks, request-size limits, capability
hiding, stale private-state clearing, principal-scoped empty results, audited
administrator mode, semantic-sync readiness, keyboard use, and a 320 px
viewport.

Rollback is stopping the optional adapter or restoring the previous dashboard
image. Neither action mutates canonical memory.
