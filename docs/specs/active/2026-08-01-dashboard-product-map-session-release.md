---
work_id: dashboard-product-map-session-release
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-01
updated: 2026-08-01
review_after: 2026-08-15
owner: CADIS
---
# Dashboard product map, session, and stable release

## Problem

The API already implements memory, context, collaboration, audit, governance,
and federation contracts, but the dashboard exposes only Memory Atlas and marks
the six corresponding product areas as `not wired`. The current adapter also
uses one server-side credential and has no browser login or bounded user
provisioning flow. Operators therefore cannot discover or exercise the shipped
contracts from the product surface, and the VPS guide does not provide complete
copyable paths for either Tailscale Serve or Cloudflare Tunnel.

## Scope

- Promote Memories, Context, Work, Audit, Governance, and Federation from
  orientation labels to live, capability-backed dashboard controls.
- Keep every dashboard read or mutation behind the existing API authorization
  boundary and an exact same-origin adapter allowlist.
- Add an opt-in API-key-to-cookie login/logout session that keeps credentials
  out of browser storage and uses each operator's own Titen principal.
- Add an authenticated principal-introspection route and an atomic owner/admin
  operation that creates one human credential plus one organization membership.
- Display the new user's raw API key exactly once so it can be handed to that
  user for dashboard login.
- Publish current Tailscale Serve and Cloudflare Tunnel tutorials that preserve
  loopback-only API and dashboard listeners.
- Verify the exact candidate locally and as a containerized rootless deployment
  on `rama-tuf`, then publish the compatible stable npm/GitHub/titen.dev release
  manually without GitHub Actions.
- Close completed issues and pull requests, terminalize this workflow pair, and
  leave only the remote `main` branch.

## Out of scope

Passwords, password reset, email delivery, SSO, SCIM, OAuth/OIDC providers,
persistent or distributed web sessions, a public Titen control plane, a new
frontend framework, a new state store, mandatory public ingress, automatic
federation scheduling, and GitHub-hosted automation.

## Constraints and risks

The browser must never persist an API key. Session cookies must be opaque,
HttpOnly, SameSite=Strict, time-bounded, and accepted only through the existing
exact Host/Origin boundary; remote login requires HTTPS. Adapter restart may
invalidate sessions. Every proxied method/path is fixed in code, request bodies
remain bounded, upstream errors are non-disclosing, and stale private content
is cleared on area, identity, denial, or logout changes. User creation must be
one SQL transaction so a failed membership cannot leave an active orphan key.
The API remains loopback-only on `rama-tuf`; tunnels expose only the dashboard
adapter. npm publication is irreversible and follows the repository's manual
package, provenance, tag, release, and website gates.

## Acceptance criteria

- **AC-DPM-001 — Event-driven:** When an authenticated operator selects
  Memories, Context, Work, Audit, Governance, or Federation, Titen shall request
  only that area's fixed authorized REST contracts and shall render the current
  live response without fixture substitution.
- **AC-DPM-002 — State-driven:** While a principal lacks every read capability
  for a product area, Titen shall omit that area from interactive discovery and
  shall not reveal its private records, counts, or resource identifiers.
- **AC-DPM-003 — Unwanted behavior:** If an area request is empty, malformed,
  unauthorized, forbidden, not found, not ready, or unreachable, then Titen
  shall show the corresponding bounded state, clear prior private results, and
  shall not fall back to synthetic data.
- **AC-DPM-004 — Event-driven:** When a valid Titen API key is submitted to the
  same-origin login endpoint over loopback or the configured HTTPS origin,
  Titen shall validate it against the canonical service, retain it only in the
  adapter process, set an opaque HttpOnly SameSite=Strict bounded session
  cookie, and return only non-secret principal metadata.
- **AC-DPM-005 — Unwanted behavior:** If login receives an invalid, expired,
  revoked, cross-origin, oversized, or remotely clear-text credential, then
  Titen shall create no session and shall return a generic failure without
  logging or echoing the credential.
- **AC-DPM-006 — Event-driven:** When an authenticated operator logs out or the
  adapter restarts or expires the session, Titen shall remove the server-side
  credential reference, expire the cookie, and require login before another
  protected dashboard request.
- **AC-DPM-007 — Event-driven:** When an authenticated API caller requests its
  own identity, Titen shall return only its organization, principal, key,
  principal kind, scopes, and trust ceiling after canonical key validation and
  without requiring an additional capability.
- **AC-DPM-008 — Event-driven:** When an authorized owner or admin creates a
  human user with a bounded role, label, scopes, trust ceiling, and optional
  expiry, Titen shall atomically create the credential and organization
  membership and shall reveal the raw API key exactly once.
- **AC-DPM-009 — Unwanted behavior:** If user creation attempts role or scope
  escalation, duplicates an active membership, assigns owner from an admin,
  or fails any key or membership constraint, then Titen shall create neither
  the key nor the membership.
- **AC-DPM-010 — Optional feature:** Where dashboard session mode is disabled,
  Titen shall preserve the existing server-key live adapter behavior; where the
  dashboard is omitted, complete REST/MCP behavior shall remain unchanged.
- **AC-DPM-011 — Ubiquitous:** Titen shall keep all six live areas and login,
  logout, and add-user flows keyboard operable, labeled, responsive at 320
  pixels, free of credential persistence, and within the existing bundle
  budget without a new runtime dependency.
- **AC-DPM-012 — Event-driven:** When an operator follows either the Tailscale
  Serve or Cloudflare Tunnel tutorial, the documented topology shall publish
  only the loopback dashboard adapter through authenticated HTTPS while keeping
  the Titen API listener private and shall include verification and rollback.
- **AC-DPM-013 — Event-driven:** When the exact release candidate is deployed
  on `rama-tuf`, Titen shall pass readiness, login/logout, all six product-area
  smokes, atomic add-user and denial checks, restart persistence, loopback API
  exposure checks, and rollback preparation against the deployed revision.
- **AC-DPM-014 — Event-driven:** When the stable release is complete, npm
  `latest`, the annotated Git tag, GitHub Release, `origin/main`, the deployed
  `rama-tuf` image, and both titen.dev discovery hosts shall agree on one exact
  version and revision without any GitHub Actions workflow.
- **AC-DPM-015 — State-driven:** While this work is declared complete, its spec
  and plan shall be terminal with reproducible evidence, GitHub shall have no
  open issue or pull request in scope, and the remote repository shall expose
  only `main`.

## Done conditions

The paired plan maps and records passing evidence for every criterion; focused
security, API contract, adapter, browser, dual-runtime, package, container,
deployment, tunnel-documentation, publication, website, GitHub, workflow, and
cleanup gates pass; the pair moves to `done/` in the final reviewed change.
