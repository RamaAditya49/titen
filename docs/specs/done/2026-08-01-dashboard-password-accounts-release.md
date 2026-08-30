---
work_id: dashboard-password-accounts-release
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-01
owner: CADIS
---
# Dashboard password accounts and stable release

## Problem

The dashboard signs human operators in with a raw Titen API key and the current
"Add user" control creates a membership plus another API key. That is suitable
for agents, services, and recovery, but it is not a normal human account flow.
An operator should enter a username and password, while an owner or admin should
create a human account with an explicit organization role.

## Scope

- Add canonical human operator accounts backed by the existing organization,
  principal, membership, scope, and trust model.
- Extend `titen bootstrap` to create the default `owner` username with a random
  temporary password that is displayed once and cannot open the private product
  shell until changed.
- Add username/password login that issues one short-lived, revocable dashboard
  API credential to the server-side adapter and never exposes it to browser
  JavaScript or storage.
- Replace dashboard API-key fields with username/password fields and change Add
  User to create an account, membership, role, scopes, and random temporary
  password atomically; require the user to replace it on first login.
- Keep API keys as the unchanged authentication contract for agents, services,
  SDKs, CLI recovery, and existing integrations.
- Apply and verify the same forward-only schema and route behavior on D1 and
  Bun/SQLite.
- Deploy the exact candidate on `benchmark-host`, then manually publish npm, GitHub,
  and titen.dev discovery without GitHub Actions.

## Out of scope

Email delivery, password recovery, self-registration, MFA, SSO/OIDC, SCIM,
distributed browser sessions, a new identity provider, and a new dependency.
Those require separate product and recovery decisions; they are not necessary
for the requested owner-created account flow.

## Constraints and risks

Passwords are untrusted secrets and must never be logged, exported, echoed, or
stored in plaintext. The generated temporary password is returned only in its
one creation/bootstrap response. Hashing must use one cross-runtime Web Crypto algorithm
with a unique salt, versioned work factor, bounded input, and constant-work
unknown-user verification. Login failures must be generic and locally
rate-limited. Account creation must be atomic so no password record, membership,
or principal credential survives a partial failure. Existing API-key clients
must remain compatible. The forward-only migration requires a verified backup
and exact-image restore canary before production activation.

## Acceptance criteria

- **AC-DPA-001 — Event-driven:** When an active human operator submits a valid
  username and current password, Titen shall verify the versioned salted
  password hash, issue a short-lived API credential bound to that principal,
  and return the credential only to the same-origin dashboard adapter for an
  opaque HttpOnly SameSite=Strict session.
- **AC-DPA-002 — Ubiquitous:** Titen shall store password verifiers using
  PBKDF2-HMAC-SHA-256 with at least 600,000 iterations and a unique random salt,
  and shall never log, export, echo a submitted password, or persist plaintext;
  only a newly generated temporary password may appear in its one creation
  response.
- **AC-DPA-003 — Unwanted behavior:** If a username is unknown or disabled, a
  password is wrong or malformed, or the bounded local attempt limit is reached,
  then Titen shall create no credential or browser session and shall return a
  generic non-disclosing authentication failure after equivalent password work.
- **AC-DPA-004 — Event-driven:** When an authorized owner or admin creates a
  human account with username, role, scopes, and trust ceiling, Titen shall
  atomically create exactly one operator account and one organization membership,
  generate a random temporary password, and reveal that password exactly once
  without returning a raw API key.
- **AC-DPA-005 — Unwanted behavior:** If account creation duplicates a username
  or membership, exceeds the caller's scope or trust, assigns owner from an
  admin, or contains invalid fields, then Titen shall persist none of the account
  or membership changes.
- **AC-DPA-006 — Event-driven:** When an operator logs out, Titen shall revoke
  the current short-lived dashboard API credential, discard the adapter session,
  expire the cookie, and reject its reuse; expiry or adapter restart shall also
  make the browser session unusable.
- **AC-DPA-014 — State-driven:** While an account still has its bootstrap or
  Add User temporary password, Titen shall issue only a password-change session,
  hide every private product area, accept one policy-compliant replacement, then
  revoke that session and require a fresh login before granting normal scopes.
- **AC-DPA-015 — Event-driven:** When `titen bootstrap` creates the first
  organization, Titen shall also create username `owner`, an owner membership,
  and a random temporary password shown once without persisting plaintext.
- **AC-DPA-007 — State-driven:** While a human is authenticated, Titen shall
  derive visible dashboard areas and Add User authority from the current
  principal scopes and active organization role, never from submitted role or
  organization values.
- **AC-DPA-008 — Optional feature:** Where password dashboard mode is disabled,
  Titen shall retain server-key adapter behavior and all existing API-key REST,
  MCP, SDK, CLI, and agent integrations without a compatibility break.
- **AC-DPA-009 — Ubiquitous:** Titen shall render a keyboard-operable responsive
  username/password login without the private sidebar or topbar, and shall keep
  login and Add User password values out of URLs, browser storage, DOM output,
  automatic clipboard writes, and rendered error text.
- **AC-DPA-010 — Event-driven:** When schema 20 and the exact release candidate
  are tested, both D1 and Bun/SQLite shall pass account creation, login, denial,
  role escalation, logout/revocation, migration, and existing contract suites.
- **AC-DPA-011 — Event-driven:** When the exact release is activated on
  `benchmark-host`, Titen shall pass backup/restore canary, readiness, username/password
  login, Add User with role, all six dashboard areas, denial, restart, loopback
  exposure, and rollback probes against the deployed revision.
- **AC-DPA-012 — Event-driven:** When publication completes, npm `latest`, the
  annotated Git tag, GitHub Release, `origin/main`, the `benchmark-host` image, and both
  titen.dev discovery hosts shall agree on one stable version and tagged revision
  without a GitHub Actions workflow.
- **AC-DPA-013 — State-driven:** While this work is complete, this spec and its
  plan shall be terminal with reproducible evidence, GitHub shall have no open
  issue or pull request in scope, and the remote repository shall expose only
  `main`.

## Done conditions

Every criterion has reproducible passing evidence; documentation describes the
human-account boundary and API-key compatibility; the exact image is deployed
with backup and rollback retained; npm, tag, GitHub Release, titen.dev, GitHub
hygiene, and workflow checks pass; both paired artifacts move to `done/`.

## Terminal evidence

- Release commit `4aa9255c3bdf4e156c472f9f2e838ee514806e25`, annotated tag
  `v0.5.3`, npm `titen-memory@0.5.3`, and OCI image
  `localhost/titen:0.5.3-4aa9255` identify the same product candidate.
- Bun contract `101/101`, D1 contract `108/108`, integration `190/190`,
  CLI/adapter `19/19`, browser `6/6`, live-dashboard verification, Worker dry
  build, package clean install, route, audit, and workflow checks pass.
- `benchmark-host` runs schema `20/20` behind loopback-only rootless Quadlets. A
  checksum-matched schema-19 backup, restored-data canary, forced-change owner,
  Add User, six-area dashboard, restart invalidation, and exact prior-image
  rollback probe pass; recovery artifacts remain under the release directory.
- npm `latest` is `0.5.3` with shasum
  `d0c71e381ee78c4d8c57744f575ca5bd3ad42c75`. GitHub Release `v0.5.3` is
  published, not draft or prerelease. `titen.dev` and `www.titen.dev` both serve
  stable `0.5.3` version metadata, install docs, and the release page.
- GitHub has zero open issues, zero open pull requests, only remote branch
  `main`, and Actions disabled. Publication and deployment were manual.
