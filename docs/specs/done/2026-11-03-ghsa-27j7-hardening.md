---
work_id: ghsa-27j7-hardening
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-11-03
updated: 2026-11-03
owner: maintainers
---
# Close the open findings of the 0.2.1 security evaluation

Source: a private evaluation of `titen-memory@0.2.1`, recorded as draft advisory GHSA-27j7-xc9x-322c.
Rama asked on 2026-11-03 to fix the findings that are still open on `main` at `e27fbc4`.

## Problem

A review of `main` on 2026-11-03 found this state:

| Finding | State on `main` |
| --- | --- |
| 1. `mcp:call` authorizes tools that REST guards with other scopes | Documented in `README.md`, but no decision record exists |
| 2. Membership self-grant | Fixed on `POST /v1/memberships` in 0.5.0. Open through `POST /v1/import` |
| 3. Principal impersonation with `keys:manage` | Fixed on `POST /v1/keys` in 0.5.0. Open through `POST /v1/import` |
| 4. Body limit checked after buffering | Open. A chunked body has no `Content-Length`, so `request.text()` buffers it all |
| 5. Webhook signature has no timestamp | Open. A receiver cannot reject a replayed delivery |
| 6. Audit cursor subquery has no organization filter | Open. A foreign audit id is an existence oracle |
| 7. Malformed percent-encoding returns 500 | Fixed in 0.10.4 |

`importRecords` checks only scopes for membership and credential records.
A credential with `import:write` and `memberships:write` can import an organization `owner` membership for itself.
A credential with `import:write` and `keys:manage` can import a key hash for another principal, then authenticate as that principal.

## Scope

- Apply the `addMember` role rules to imported memberships.
- Apply the `createKey` principal rule to imported credentials.
- Read request bodies through a bounded stream. Stop at `MAX_BODY_BYTES`.
- Set `maxRequestBodySize` on `Bun.serve` and on the dashboard adapter as a second limit.
  The adapter read its bodies the same way, before sign-in.
- Add a timestamped webhook signature. Keep the current signature header for existing receivers.
- Add the organization filter to the audit cursor subquery.
- Record the `mcp:call` decision in ADR 0007.
- Add contract tests for Bun/SQLite and D1, and integration tests for the body limit and the webhook headers.
- Update the API reference, the threat model, and the changelog.

## Out of scope

- Per-tool MCP scopes. ADR 0007 records why.
- Removal of `X-Titen-Signature`. That is a breaking change and needs a minor release.
- Fences on keys that `POST /v1/keys` creates. REST and import follow the same rule after this change.
- The evaluation's unconfirmed items: the process-wide webhook allowlist, `titen key list`, and the federation endpoint field.
- Inbound federation signatures. Event-id uniqueness already rejects a replay.

## Constraints and risks

- Shared code stays in `src/core/**` with Web Standards only.
- Imports by a `*` credential stay unchanged, so backup and migration round trips keep working.
- A role check for memberships audits a denial and returns 404, the same as `addMember`.
- The bounded read keeps `request.text()` decoding: UTF-8 with the byte-order mark removed.
- Bun rejects a body above `maxRequestBodySize` before the app runs, without the Titen error envelope.
  The Bun limit is therefore twice `MAX_BODY_BYTES`, so the app still answers every ordinary oversize request.
- The new signature binds the timestamp and the stable delivery id to the body.
  A receiver rejects an old timestamp and removes duplicates by delivery id.

## Acceptance criteria

- **AC-SEC-001 — Unwanted behavior:** If a credential without `*` and without an active `owner` or `admin` organization role imports a membership record, then Titen shall reject the import before mutation.
- **AC-SEC-002 — Unwanted behavior:** If an organization admin imports a membership record with role `owner`, then Titen shall return HTTP 403 before mutation.
- **AC-SEC-003 — Unwanted behavior:** If a credential without `*` imports an API key record for another principal identity, then Titen shall return HTTP 403 before mutation.
- **AC-SEC-004 — Event-driven:** When a credential without `*` imports an API key record for its own principal identity within its scopes and trust ceiling, Titen shall store the key.
- **AC-SEC-005 — Unwanted behavior:** If a request body without `Content-Length` exceeds `MAX_BODY_BYTES`, then Titen shall return HTTP 413 `PAYLOAD_TOO_LARGE` without reading the rest of the body.
- **AC-SEC-006 — Ubiquitous:** The Bun runtime and the dashboard adapter shall refuse a body above twice their read limit before a handler runs.
- **AC-SEC-007 — Event-driven:** When Titen sends a webhook attempt, Titen shall send `X-Titen-Timestamp` and `X-Titen-Signature-V2`, an HMAC-SHA256 of the timestamp, the delivery id, and the raw body, joined by dots.
- **AC-SEC-008 — Ubiquitous:** Titen shall keep sending `X-Titen-Signature` as an HMAC-SHA256 of the raw body.
- **AC-SEC-009 — Event-driven:** When a webhook is registered, Titen shall return the timestamped signing contract with a tolerance of 300 seconds.
- **AC-SEC-010 — Unwanted behavior:** If an audit cursor names an audit entry of another organization, then Titen shall return no entries.
- **AC-SEC-011 — Ubiquitous:** Titen shall apply AC-SEC-001 to AC-SEC-004 and AC-SEC-010 on Bun/SQLite and Cloudflare D1.
- **AC-SEC-012 — Ubiquitous:** ADR 0007 shall state that `mcp:call` authorizes every listed MCP tool, subject to each handler's own checks.

## Done conditions

- Each criterion has a passing test or an `indirect:` evidence line. The new tests fail on the old code.
- `pnpm typecheck`, `pnpm test:api`, `pnpm test:integration`, and `pnpm check:workflow` pass on `rama-tuf`.
- The API reference, the threat model, ADR 0007, and the changelog describe the new behavior.
- Release and advisory publication stay a separate maintainer decision.

## Delivery

Branch `fix/ghsa-27j7` delivers the change. All acceptance criteria pass on `rama-tuf`.
The paired plan records the failing runs on the old code and the passing suites.
