# ADR 0006: Persistent dashboard throttling and WebAuthn

- Status: Accepted
- Date: 2026-08-30

## Context

The password dashboard used one process-local failure counter. A restart or a
second replica could reset that protection. Password-only sessions also had no
phishing-resistant second factor or one-time recovery path.

Titen supports Cloudflare D1 and Bun/SQLite. The product must keep one
provider-neutral authentication contract. Existing API keys and headless MCP,
SDK, and REST clients must remain compatible.

## Decision

Store the account throttle in canonical SQL. Hash the normalized account
identifier before storage. Check the persistent delay before account lookup and
password verification. Start a 30-second delay after five failures. Increase
later delays to a maximum of 30 minutes. Keep a bounded table and remove the
oldest rows.

Keep an optional runtime edge guard before password verification. Cloudflare
uses its native Rate Limiting binding with the hashed account bucket. Other
deployments can apply an equivalent reverse-proxy guard. The SQL throttle stays
authoritative across restarts and replicas.

Add optional WebAuthn with `@simplewebauthn/server`. Configure it with one RP ID,
one exact origin, and one display name. Disable it when all values are absent.
Fail readiness when configuration is partial or unsafe.

Use explicit API-key stages: `password_change`, `second_factor`, and `full`.
Central route authorization limits each staged key. A password login creates a
15-minute second-factor key when the account has an active passkey. Successful
WebAuthn or recovery replaces that key with an eight-hour full key.

Hash challenges and recovery codes in SQL. Bind each challenge to its
organization, account, session, purpose, and expiry. Claim a challenge,
credential counter, or recovery code with one conditional SQL update. A crash
after a claim can require a retry with a new challenge or recovery code. It
cannot increase authority or permit replay.

Issue eight 128-bit recovery codes after the first passkey registration. Show
them once. Regeneration invalidates the prior generation. Removing the last
passkey requires the current password. First enrollment revokes other active
dashboard sessions so that second-factor policy starts immediately.
Recovery completion, credential listing, and credential revocation remain
available when RP configuration is disabled. This prevents configuration
rollback from locking out an enrolled account.

Exclude dashboard sessions from credential portability. They are transient
browser authorization, not reusable service credentials.

## Consequences

- Login protection survives process restarts and coordinates through SQL.
- WebAuthn remains optional and does not make Cloudflare Access part of Titen.
- Existing full API keys keep their behavior through the migration default.
- Staged sessions add one authorization state to API-key storage.
- WebAuthn adds one production dependency and increases the Worker bundle.
- Migration 24 is additive. Older code can ignore the new tables, but it cannot
  provide the new protection.
- Rollback must preserve a pre-upgrade database snapshot and the prior package.

## Verification

Run the same throttle, staged-session, WebAuthn, recovery, replay, concurrency,
and migration contracts on D1 and SQLite. Run a real browser WebAuthn flow with
a virtual authenticator. Verify the Worker bundle, dashboard adapter, package,
public artifacts, and runtime smoke before release.
