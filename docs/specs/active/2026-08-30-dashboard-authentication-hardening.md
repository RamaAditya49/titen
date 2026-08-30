---
work_id: dashboard-authentication-hardening-20260830
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-30
updated: 2026-08-30
review_after: 2026-09-13
owner: CADIS
---

# Dashboard authentication hardening

## Problem

The dashboard password exchange uses process-local attempt counters. These
counters do not survive restarts and do not coordinate across replicas. The
dashboard also has no phishing-resistant second factor or one-time recovery
path. A public deployment needs consistent protection on Cloudflare and
Bun/SQLite without making a vendor gateway part of the product contract.

## Scope and constraints

This work adds persistent account throttling, an optional runtime edge guard,
WebAuthn second-factor authentication, one-time recovery codes, staged dashboard
sessions, operator controls, migration 24, and dual-runtime tests. It also
updates the public API, deployment, dashboard, security, and product documents.

The shared SQL contract stays canonical. The Cloudflare rate limiter remains an
optional defense. Bun deployments can provide an equivalent edge guard through
their reverse proxy. The dashboard must remain usable without Cloudflare
Access. Existing API keys and headless clients must keep their current contract.

The WebAuthn configuration uses a relying-party ID, an allowed origin, and a
display name. The feature is disabled when all values are absent. Partial or
invalid configuration must fail closed. Production origins must use HTTPS.

## Risks

- A response difference can reveal whether an operator account exists.
- A restart or second replica can bypass a process-local throttle.
- A staged session can bypass its required authentication step.
- A challenge replay can create or use a credential more than once.
- A lost authenticator can permanently lock out an operator.
- A cross-account credential or recovery code can cross an authority boundary.
- A runtime-specific implementation can break Cloudflare or Bun parity.
- A rollback can strand additive authentication records.

## Requirements

### Login throttling

- **AC-AUTH-001 — Ubiquitous:** Titen shall store failed login state in canonical
  SQL by a non-reversible account identifier and shall not store the submitted
  username or password in that state.
- **AC-AUTH-002 — Event-driven:** When the fifth consecutive password failure
  occurs, Titen shall apply a 30-second delay and shall increase later delays
  to a maximum of 30 minutes.
- **AC-AUTH-003 — State-driven:** While a login delay is active, Titen shall
  reject the password exchange before password verification with the same
  public error used for an invalid login.
- **AC-AUTH-004 — Event-driven:** When a complete dashboard login succeeds,
  Titen shall clear the matching persistent failure state.
- **AC-AUTH-005 — Unwanted behavior:** If a caller uses valid, unknown, or
  malformed account names, then Titen shall not reveal account existence in the
  response status, code, or message.
- **AC-AUTH-006 — Optional feature:** Where a runtime edge guard is configured,
  Titen shall invoke it before password verification and shall fail closed when
  the guard denies the request or cannot make a safe decision.

### WebAuthn and staged sessions

- **AC-AUTH-010 — Optional feature:** Where complete WebAuthn configuration is
  present, Titen shall expose capability status and shall accept credentials
  verified for the configured relying-party ID and origin.
- **AC-AUTH-011 — Event-driven:** When an authenticated operator registers a
  credential, Titen shall bind a one-time challenge to that operator and shall
  store the public credential material without attestation payloads.
- **AC-AUTH-012 — State-driven:** While an operator has an active WebAuthn
  credential, a valid password shall create only a short-lived second-factor
  session until WebAuthn or a recovery code succeeds.
- **AC-AUTH-013 — Ubiquitous:** Titen shall restrict a second-factor session to
  second-factor completion and session revocation operations.
- **AC-AUTH-014 — Event-driven:** When WebAuthn verification succeeds, Titen
  shall replace the staged session with a full dashboard session and shall
  update the credential counter atomically.
- **AC-AUTH-015 — Unwanted behavior:** If a challenge is expired, already used,
  has the wrong purpose, or belongs to another operator, then Titen shall reject
  it without changing credentials or session authority.
- **AC-AUTH-016 — Unwanted behavior:** If WebAuthn configuration is partial or
  unsafe, then readiness shall identify the configuration error and WebAuthn
  operations shall remain unavailable.

### Recovery and operator controls

- **AC-AUTH-020 — Event-driven:** When an operator enables the first WebAuthn
  credential, Titen shall issue a bounded set of high-entropy recovery codes
  once and shall store only their hashes.
- **AC-AUTH-021 — Event-driven:** When a valid recovery code completes a staged
  session, Titen shall consume that code atomically and shall reject all later
  uses.
- **AC-AUTH-022 — Event-driven:** When an authenticated operator regenerates
  recovery codes, Titen shall invalidate every prior unused code before it
  returns the replacement set once.
- **AC-AUTH-023 — Unwanted behavior:** If an operator tries to remove the last
  WebAuthn credential without a recent password confirmation, then Titen shall
  reject the request and shall retain the credential.
- **AC-AUTH-024 — Ubiquitous:** Titen shall append metadata-only audit events for
  credential, recovery, and staged-session security changes without credential
  material, challenge data, recovery codes, or passwords.

### Compatibility and release

- **AC-AUTH-030 — Ubiquitous:** Existing API keys, MCP clients, SDK clients, and
  deployments without WebAuthn configuration shall retain their current
  authentication behavior.
- **AC-AUTH-031 — Ubiquitous:** Cloudflare D1 and Bun/SQLite shall pass the same
  migration, throttle, staged-session, WebAuthn, recovery, and authorization
  contract.
- **AC-AUTH-032 — Ubiquitous:** The loopback dashboard adapter shall expose only
  fixed authentication routes and shall never expose a generic credential
  forwarding route.
- **AC-AUTH-033 — Ubiquitous:** The release shall use one verified npm tarball,
  and the deployed runtime shall report the matching package revision or shall
  restore a verified rollback.

## Non-goals

Passwordless login, social login, email recovery, SMS recovery, automatic
account unlock by an external service, a hosted identity provider, and a
vendor-specific access gateway are not part of this work.

## Done conditions

Every criterion has reproducible evidence. Migration 24 passes from every
supported prior schema. Both runtimes pass the same security contract. The
dashboard and installed package pass. Public documents describe only generic
deployment behavior. The paired plan has no unchecked item. The release is
published, deployed, and smoked, or a verified rollback is restored. Both
workflow artifacts then move to `done/`.
