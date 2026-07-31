# HTTP API reference

Status: **implemented route inventory verified** against `src/core/app.ts` by
`node scripts/check-route-docs.mjs`. Detailed examples below are descriptive;
features explicitly listed as proposed are not routes.

## Implemented route inventory

<!-- ROUTE_INVENTORY_START -->
- `DELETE /v1/checkpoints/:id`
- `DELETE /v1/keys/:id`
- `DELETE /v1/leases/:id`
- `DELETE /v1/memberships/:id`
- `DELETE /v1/observations/:id`
- `DELETE /v1/webhooks/:id`
- `GET /healthz`
- `GET /readyz`
- `GET /v1/audit`
- `GET /v1/audit/export`
- `GET /v1/checkpoints`
- `GET /v1/checkpoints/:id`
- `GET /v1/claims/:id/evidence`
- `GET /v1/context/:id`
- `GET /v1/events`
- `GET /v1/events/:id`
- `GET /v1/export`
- `GET /v1/federation/log`
- `GET /v1/federation/peers`
- `GET /v1/federation/peers/:id/filters`
- `GET /v1/handoffs`
- `GET /v1/keys`
- `GET /v1/leases`
- `GET /v1/memberships`
- `GET /v1/webhooks`
- `GET /v1/webhooks/:id/deliveries`
- `GET /v1/workspaces`
- `POST /mcp`
- `POST /v1/checkpoints`
- `POST /v1/claims/:id/expire`
- `POST /v1/claims/:id/revoke`
- `POST /v1/claims/:id/supersede`
- `POST /v1/consolidations`
- `POST /v1/context/:id/feedback`
- `POST /v1/context/compile`
- `POST /v1/federation/peers`
- `POST /v1/federation/peers/:id/filters`
- `POST /v1/federation/peers/:id/suspend`
- `POST /v1/federation/pull`
- `POST /v1/federation/push`
- `POST /v1/handoffs`
- `POST /v1/handoffs/:id/resolve`
- `POST /v1/import`
- `POST /v1/index/drain`
- `POST /v1/keys`
- `POST /v1/leases`
- `POST /v1/leases/:id/force-release`
- `POST /v1/memberships`
- `POST /v1/memory-views/compile`
- `POST /v1/observations`
- `POST /v1/projects/resolve`
- `POST /v1/webhooks`
- `POST /v1/webhooks/:id/pause`
- `POST /v1/webhooks/:id/resume`
- `POST /v1/webhooks/deliver`
- `POST /v1/workspaces`
<!-- ROUTE_INVENTORY_END -->

## Proposed/unimplemented endpoints

- Observation batch ingestion (`POST /v1/observations/batch`).
- Channel CRUD (`/v1/channels`).
- Automatic derivation/reflection has no public route. It is a planned
  background capability; `POST /v1/consolidations` is not its queue endpoint.
- The old `webhook-subscriptions`, `webhook-deliveries`, `knowledge-releases`,
  `audit/events`, and channel-scoped context paths are not aliases. Use the
  implemented inventory above.

## API keys

`POST /v1/keys` accepts a label, scopes, and optional `max_trust`,
`principal_id`, and `principal_kind`. Its one-time creation response includes
the raw `api_key`, credential `key_id`, and the caller-supplied or generated
`principal_id`. Use `principal_id` for handoff targets; `key_id` identifies the
revocable credential and is not an agent identity. `GET /v1/keys` returns the
same non-secret identity metadata but never returns the raw key.

## Webhook delivery

`POST /v1/webhooks` accepts only a configured allowlisted HTTPS hostname. The
Bun runtime resolves and rejects private, link-local, special-use, mapped IPv4,
and unsafe IPv6 addresses, re-resolves before every attempt, pins TLS to one
approved address, and never follows redirects. Cloudflare returns `503` for
webhook registration/delivery because Worker `fetch` cannot prove this pinning.

Canonical writes enqueue durable delivery rows before outbound I/O. Claims are
atomic leases that recover after expiry. `X-Titen-Delivery` is stable across
retries; `X-Titen-Attempt` changes per network attempt. Delivery is
at-least-once, times out after at most 10 seconds, and reaches `success` or
terminal `failed` after five attempts. The drain response includes
`delivery_attempts`, `delivered`, `pending_deliveries`, `failed_deliveries`,
`oldest_retry_at`, `oldest_pending_at`, and `semantics: "at_least_once"`.

## Common behavior

- Base path: `/v1`.
- Streamable HTTP MCP endpoint: `/mcp`.
- Protected endpoints use `Authorization: Bearer <key>`.
- JSON requests use `application/json`.
- External field names use `snake_case`.
- Requests may include `Idempotency-Key` on mutations.
- An idempotency key is bound to the acting principal plus canonical method,
  concrete path, normalized query, and JSON body. Rotation to another key for
  the same principal replays the original response; the originating `key_id`
  remains stored for audit. Reuse for a different request is `409`, and another
  principal has an independent key space.
- Tenant/organization authority never comes from a request body.
- JSON bodies may nest at most 64 object/array levels. Free text rejects unsafe
  terminal and bidirectional controls while retaining tab and line feed.

Success envelope:

```json
{
  "data": {},
  "meta": {
    "request_id": "req_...",
    "degraded": {}
  }
}
```

Error envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request is invalid."
  },
  "meta": {
    "request_id": "req_..."
  }
}
```

## Kernel operations

### `POST /v1/projects/resolve`

Resolve an authenticated agent's stable project reference to an opaque Titen
`project_id`. A hosted Git origin should be normalized to lowercase
`owner/repo`; credential material, query parameters, and local absolute paths
are never accepted as shared project identity.

Resolution does not grant membership. Creating a missing project requires a
separate capability; ordinary agents may only resolve projects already in their
authorized scope.

### `POST /v1/observations`

Append evidence.

```json
{
  "subject_id": "user_123",
  "agent_id": "agent_research",
  "run_id": "run_456",
  "workspace_id": "ws_deploy",
  "kind": "tool_result",
  "content": "Production smoke returned 200 application/json.",
  "source": {
    "type": "tool",
    "ref": "deploy_456#smoke"
  },
  "trust": "verified",
  "visibility": "team"
}
```

Only authorized service/agent identities may assert `verified` trust.
Visibility defaults to `private`. `team` requires `workspace_id` and an active
non-reader membership; this predicate is applied before retrieval, export,
events, Atlas limits/counts, and webhook delivery.

### `DELETE /v1/observations/:id`

An operator credential with the explicit `observations:purge` scope can
irreversibly tombstone readable evidence in its organization. The atomic write
retains the observation ID, original content hash, source metadata, and history;
removes FTS content; queues a vector delete; redacts and revokes dependent
claims; and appends a content-free audit/event record. Foreign IDs return the
same `404` as missing IDs. Ordinary agent and MCP keys should never receive this
scope, and no MCP forget tool exists.

The tombstone marker binds the retained SHA-256 and remains portable. A restore
from a backup made before the purge can reintroduce the readable content, so an
erasure runbook must identify and expire or replace affected backups separately.

### Proposed: `POST /v1/observations/batch`

Append a bounded batch using the same item schema and authorization path as the
single-observation endpoint. Each item has its own client mutation ID; the
request has one `Idempotency-Key`. The batch is atomic only when explicitly
declared and within the server limit. The default returns per-item status so one
invalid candidate does not force an adapter to resend accepted items.

### `POST /v1/consolidations`

Materialize caller-supplied claims for an authorized scope. The implemented
handler validates and commits the submitted claims, returns `model_used: false`,
and performs no automatic extraction or classification. Every claim needs
supporting evidence from the same subject, project, and workspace, with no trust
or visibility widening.

ADR-0004 defines a future background derivation/reflection path. It will not
silently add model latency or change this route's direct-claim semantics.

### Claim lifecycle routes

`supersede`, `revoke`, and `expire` require `expected_version`. A superseding
claim must match the original subject, project, workspace, kind, and visibility;
stale or concurrent transitions return `409` without partial history or events.

### `POST /v1/context/compile`

Compile a task-specific context pack.

```json
{
  "subject_id": "user_123",
  "project_id": "project_titen",
  "task": "prepare a safe deployment",
  "max_tokens": 1200,
  "include_checkpoints": true
}
```

`max_tokens` accepts 128 through 32,000. The response includes selected claims,
evidence IDs, trust, temporal validity, conflicts, score components, token usage,
and a `context_id`. Each item carries `untrusted: true`; this is structured
provenance for the caller, not an instruction-enforcement claim.

Project scope is fail-closed:

- a concrete `project_id` selects only that authenticated-organization project;
- omitting `project_id` selects only claims whose canonical `project_id` is
  absent; omission is never a wildcard;
- `cross_project: true` is the only all-project mode, is mutually exclusive with
  `project_id`, and requires both `context:compile` and
  `context:compile:all` on the credential.

The response `scope` repeats `subject_id` and `project_id`, adds
`project_mode` (`project`, `unscoped`, or `cross_project`), and returns
`broad_access_reason` as `credential_scope:context:compile:all` only for an
authorized broad compile. All modes retain organization, subject, visibility,
membership, lifecycle, and temporal policy. A pre-`0.3.1` stored run whose null
project scope included project claims fails current reauthorization instead of
being relabeled as unscoped.

Ranking is auditable and deterministic. Lexical BM25 and vector similarity are
each min-max normalized inside the authorized candidate set; relevance is the
stronger normalized signal. The final score is:

`0.40 relevance + 0.20 trust + 0.15 recency + 0.10 utility + 0.05 conflict + 0.10 confidence`

Every factor is returned in `score_components`. A zero-span positive matched
signal is assigned `1` for each matched candidate; absent lexical or vector
signals, including vector similarity `0`, are `0`. Confidence is therefore an
explicit weighted factor, not a hidden multiplier.

Lexical planning removes Unicode format characters, preserves combining marks,
normalizes to NFC, and drops a bounded English/Indonesian function-word set;
an all-function-word task falls back to its original terms. Porter stemming
handles common word forms. The FTS MATCH includes encoded organization and
subject scope before BM25, then canonical SQL repeats every authorization and
lifecycle check. `meta.degraded.lexical` is `no_terms` when normalization leaves
no searchable term and `used` otherwise. The existing `remove_diacritics 2`
tradeoff remains: diacritic-only distinctions fold together, while separate
letters such as `ł` and `ß` do not.

Packing selects one fitting claim per available kind before filling the
remaining token budget in deterministic rank order. Byte-identical active claim
statements appear at most once in a context pack; canonical claims and their
evidence remain unchanged.

### `POST /v1/context/:id/feedback`

Record used/useful/irrelevant/incorrect/harmful outcomes for the context or
individual items. Only the run actor or the intended recipient of a pending or
accepted handoff may submit feedback. Titen re-authorizes the complete stored
pack first; a removed membership or hidden item makes the request return the
same `404` as an unknown context.

### `POST /v1/index/drain`

Drain a bounded batch of pending indexing outbox rows into the configured vector
store. If embedding or vector-store upsert is unavailable, the response is
`503 UNAVAILABLE`; safe metadata includes `dependency` (`embedder` or
`vector_store`), `retryable: true`, and `pending`, the number of rows selected
by the bounded request. No selected outbox row advances on either dependency
failure, so the same batch can be retried after recovery.

Both built-in embedding adapters require exactly one dense, configured-length
vector per input and reject non-numeric or non-finite coordinates. Provider
indices, when present, must be the ordered contiguous range starting at zero.
Malformed successful provider output follows the same safe retryable embedder
failure path before any vector upsert; canonical SQL and FTS remain available.

### `GET /v1/claims/:id/evidence`

Return an authorized claim and its supporting, contradicting, and qualifying
observations.

## Memory Atlas operation

This optional v0.2 surface is read-only even though compilation uses `POST` for
a bounded request body. It follows
[ADR-0003](../decisions/0003-memory-atlas-authorized-projection.md) and uses the
same contract on Cloudflare and VPS.

### `POST /v1/memory-views/compile`

Compile one authorized visual projection around a focus record.

```json
{
  "lens": "neighborhood",
  "focus_id": "claim_...",
  "scope": { "project_id": "project_..." },
  "max_depth": 2,
  "max_nodes": 200,
  "max_edges": 400
}
```

The implemented lenses are `evidence_trace`, `neighborhood`,
`conflict_freshness`, and the read-only `review_queue`. Additional operations
and governance queues remain planned until their policy gates pass. The example
limits are caller requests, not normative server maxima; the server clamps them
to measured deployment limits.

`review_queue` accepts optional `subject_id`, canonical `owner_id`,
`review_reason` (`all`, `disputed`, `contradiction`, `low_confidence`, or
`negative_feedback`), `cursor`, and `limit`. It returns claim nodes with
deterministic `priority`, explicit `reasons`, canonical `owner_id`, bounded
`next_action`, canonical-validity `deadline`, `terminal_state`, and only
authorized `evidence_refs` and `audit_refs`. Metadata contains authorized
page/remaining counts and an opaque
stable keyset `next_cursor`. The lens is not an action route or canonical queue;
supersede, expire, and revoke remain claim lifecycle operations.

```json
{
  "view_id": "view_...",
  "lens": "neighborhood",
  "focus_id": "claim_...",
  "policy_snapshot": "policy_...",
  "nodes": [
    {
      "id": "claim_...",
      "type": "claim",
      "label": "Authorized bounded label",
      "status": "active",
      "trust": "verified",
      "validity": { "valid_from": "2026-07-27T00:00:00Z", "valid_to": null }
    }
  ],
  "edges": [],
  "truncated": false,
  "degraded": { "semantic": false, "cache": false }
}
```

Policy runs before traversal. Both endpoints of every edge and all returned
labels/provenance must be authorized, and canonical hydration rechecks current
version, lifecycle, visibility, and release eligibility. Hidden candidates do
not contribute edges, labels, or counts. Limit metadata describes only the
authorized result.

Governance previews remain proposed and are not present in the current route
inventory.

## Collaboration operations

These ship after the Level 5 kernel gate.

### `POST /v1/checkpoints`

Create or replace resumable task state with explicit TTL. One current head is
stored for each organization, subject, agent, and kind; concurrent saves use a
single database upsert and cannot create duplicate heads.

`GET /v1/checkpoints` reads the caller's current head by subject, agent, and
kind. `GET /v1/checkpoints/:id` also lets the intended recipient read the exact
unexpired checkpoint referenced by a pending or accepted handoff. Other
same-organization principals receive the same `404` as a missing record.

### `POST /v1/leases`

Acquire or renew an expiring claim to a bounded work item. `GET /v1/leases`
requires `leases:read`, returns only unreleased leases in the authenticated
organization, accepts `limit` from 1 through 200 plus an opaque `after` cursor,
and labels rows `active` or `expired` without exposing another organization.

`POST /v1/leases/:id/force-release` requires `leases:write` plus an active
organization-level membership with role `owner` or `admin`. Workspace roles and
ordinary members cannot force-release an organization-scoped lease.

### `POST /v1/handoffs`

Create a pending handoff to a known active principal. A supplied context must
match the organization and subject, and every item must be currently visible to
both sender and recipient. Missing claims, foreign claims, and claims whose
subject or project differs from the context make the complete reference
ineligible. A supplied checkpoint must be an unexpired
sender-owned checkpoint for the same subject. Missing, foreign,
cross-organization, inaccessible, and mismatched references return `404` before
the foreign-key write.

`POST /v1/handoffs/:id/resolve` accepts `accepted` or `rejected` from the exact
recipient. A database fence commits only one terminal resolution and event
under concurrent calls.

`GET /v1/context/:id` requires `handoffs:read`. It returns an actor-owned run or
the exact run delegated to the intended recipient by a pending or accepted
handoff. Every context item is re-authorized at read time; if any item is no
longer visible, the whole pack fails closed with `404`.

### `GET /v1/handoffs`

List pending handoffs addressed to the authenticated principal. This is the
default pull path for ephemeral agents that cannot receive webhooks.

### `GET /v1/events`

Return authorized metadata-only domain events after an opaque cursor. It lets an
orchestrator poll when inbound webhooks are unavailable; it is not a transcript
or raw memory feed. Public cursors remain stable event IDs; the database maps
them to a monotonic local sequence, so equal-timestamp pages and federation
pulls do not order by random UUIDs or skip committed events. An exhausted page
echoes its incoming cursor so a poller can continue from the same position.

### Federation routes

Each federation peer and cursor belongs to the principal that registered it.
Signed push input proves the configured transport peer, not a local actor or
canonical record. Accepted input is stored as an owner-visible
`federation.received` event with resource type `federated_event`; the complete
remote event remains untrusted under `payload.untrusted_remote_event`. Remote
actor, resource type, and resource ID therefore never grant local feed or
webhook visibility and never create canonical observations or claims.

### Proposed legacy webhook-subscription shape (not implemented)

The implemented API uses `/v1/webhooks`, pause/resume action routes, and
`/v1/webhooks/:id/deliveries` as listed in the inventory. The names below are
retained only as a proposal history and must not be used by clients.


- `POST /v1/webhook-subscriptions`: create an authorized organization,
  workspace, or project subscription; v0.3 additionally permits an authorized
  channel scope;
- `PATCH /v1/webhook-subscriptions/:id`: pause, rotate signing material, or
  change allowed event types/destination;
- `DELETE /v1/webhook-subscriptions/:id`: stop future delivery without deleting
  domain events or memory;
- `GET /v1/webhook-deliveries`: inspect metadata-only delivery state.

Webhook delivery happens from a durable post-commit outbox. Payloads include an
opaque event ID, scope reference, event type, record ID/version, occurrence
time, and delivery attempt. Content is excluded by default. Requests are signed,
bounded, retry-safe, and protected by destination allowlisting and SSRF checks.

### Proposed legacy `GET /v1/audit/events` (not implemented)

List authorized metadata-only audit events with cursor pagination.

## Governed channel knowledge operations

All channel and `knowledge-releases` names below are **proposed and not
implemented**. No governed release route is present in the current inventory.


These v0.3 operations implement
[ADR-0002](../decisions/0002-channel-release-not-public-memory.md). Every
operation is authenticated. Titen does not expose an anonymous canonical-memory
or search endpoint.

Release statuses are `draft`, `approved`, `active`, `suspended`, `replaced`,
`expired`, and `revoked`. Source eligibility can suspend an active release
without waiting for an API mutation; replacement creates a new immutable
release row.

### `POST /v1/channels`

Create an operator-managed CRM, website, support, or partner channel under the
authenticated organization. The request defines a bounded label, allowed
audiences, and gateway-service capability binding. Creating a channel does not
release any claim.

### `GET /v1/channels`

List authorized channels with opaque IDs, labels, allowed audiences, gateway
policy reference, status, and lifecycle metadata. It returns no credentials,
assertion verification keys, or released content.

### `PATCH /v1/channels/:id`

Pause/disable a channel or update bounded non-secret policy references using
expected-version semantics. Disabling a channel makes all of its releases
ineligible before the next context compile without deleting release history.

### `POST /v1/knowledge-releases`

Create a draft release from one exact claim version.

```json
{
  "claim_id": "claim_product_return_window",
  "claim_version": 4,
  "channel_id": "channel_crm_web",
  "audience": "anonymous",
  "released_content": "Returns are accepted within 30 days under the published terms.",
  "locale": "en",
  "valid_from": "2026-07-27T00:00:00Z",
  "valid_to": null,
  "proposal_reason": "Prepared from the current published returns policy."
}
```

The caller must be able to read the exact claim/evidence and propose a release.
The server records source hashes and never copies private evidence into the
released citation set. `verified` trust alone does not activate this draft.

### `GET /v1/knowledge-releases`

List authorized release metadata by channel, audience, status, validity, source
claim, and cursor. Released content is returned only to principals with the
matching inspection capability; source evidence remains separately authorized.

### `POST /v1/knowledge-releases/:id/approve`

Approve an exact draft snapshot/hash, or reapprove a suspended snapshot, with
expected version and a bounded approval reason. The approver must have
release-approval capability and satisfy the configured separation-of-duty
policy. Approval records `approved_by` and `approved_at`; it does not activate
the release or change source claim trust. Reapproval fails unless the same
source claim version is current, active, and undisputed; otherwise the publisher
must create a new release.

### `POST /v1/knowledge-releases/:id/activate`

Activate an approved release using expected-version semantics. The caller must
have release-approval capability and satisfy separation-of-duty policy. The
transaction appends history/audit, updates release FTS, invalidates projections,
and emits a metadata event/outbox entry. Activation fails if the referenced
claim version is not the current active, undisputed version.

### `POST /v1/knowledge-releases/:id/revoke`

Revoke an active release with expected version and bounded reason. Canonical
eligibility ends in the commit; cache/vector cleanup may finish asynchronously,
but stale results are rejected during hydration.

### `POST /v1/channels/:id/context/compile`

Compile context for an authenticated channel gateway.

```json
{
  "audience": "authenticated_customer",
  "task": "answer the customer's returns question",
  "max_tokens": 900,
  "locale": "en",
  "customer_session_assertion": "opaque-short-lived-signed-value"
}
```

The gateway credential must be bound to the channel and audience. An
`anonymous` request cannot include a customer assertion. For
`authenticated_customer`, Titen verifies an operator-configured assertion
issuer, signature, channel/audience, expiry, and replay value, then resolves the
customer subject from the assertion. The gateway must derive that assertion
from an authenticated upstream session; it must never copy a user-controlled ID
or assertion. Customer items remain distinct from release items in the returned
manifest.

The response contains only active, valid release snapshots matching the channel
and audience, plus optional eligible memory for that authenticated customer. It
returns released citation metadata, never unreleased source content. Dynamic
balances, inventory, order, payment, or ticket state should be fetched through
their authoritative tools instead of assumed from memory.

Eligibility joins the source claim head. A version mismatch, dispute,
supersession, expiry, or revocation excludes the release immediately even if a
derived cache/vector or release-status maintenance job is stale.

## Health

- `GET /healthz`: process liveness without sensitive details.
- `GET /readyz`: canonical SQL, migration integrity, signing-secret
  decryptability, and capability-contract version 1. Capability states include
  FTS, vector, embedding, extraction, background enrichment,
  `background_repair`, and export/import. `disabled`, `enabled`, and
  `configured_error` distinguish intentional omission from broken opt-in
  configuration.

`capabilities.model` and `meta.degraded.model` are deprecated `0.3.x` aliases
for embedding. `embedding`, `extraction`, and `background_enrichment` are
separate fields; planned extraction/enrichment remain `disabled` until their
own implementation and evidence ship.

When semantic retrieval is configured, readiness compares credential-free
provider identity, model, revision, dimensions, metric, preprocessing version,
and index-schema version with migration-13 metadata. Partial/invalid
configuration, unavailable or aliased local vector storage, an untracked legacy
index, missing historical requeue work, an empty projection after canonical-only
restore, or fingerprint mismatch returns `503 NOT_READY`, marks the affected
capability `configured_error`, and supplies one fixed
`checks.semantic_index` diagnostic. The response does not expose the
fingerprint, endpoint, database path, or provider error.

Readiness performs bounded local configuration/path/schema/metadata checks only. It
makes no embedding-provider or vector-index network call. `enabled` therefore
means locally initialized and fingerprint-compatible, not that a remote provider
was reachable; indexing and context degradation report runtime provider failure.

`capabilities.background_repair` is canonical scheduler evidence. `enabled`
means a configured scheduler recorded a successful pass within its bounded
freshness window, `stale` means the pass is absent, failed, malformed, or old,
and `disabled` means this process has no configured scheduler. Readiness makes no
model, webhook, or scheduler network call. It also reports verified migration
objects and whether persisted signing secrets can be decrypted with the external
keyring; either failure blocks protected API traffic while health diagnostics
remain available.

When Memory Atlas is disabled, it does not affect liveness/readiness. When
enabled, readiness checks only the server-side compiler's canonical
dependencies; an optional browser renderer is never a service-readiness gate.

## MCP surface

The implemented `/mcp` endpoint exposes nine wire tools in eight ordinary-agent
families:

- `titen_project_resolve`;
- `titen_remember`;
- `titen_consolidate`;
- `titen_compile`;
- `titen_feedback`;
- `titen_checkpoint_save`;
- `titen_checkpoint_get`;
- `titen_lease_acquire`;
- `titen_handoff`.

Administrative key, membership, retention, and webhook-subscription operations
are not enabled for ordinary agent profiles by default. MCP tools are stateless
adapters over the same validated handlers as REST; restarting or disconnecting
the MCP client loses no canonical state. Only `titen_checkpoint_get` is
read-only. `titen_compile` persists a context run, and every other tool is also
write-capable, so hosts can apply their native approval policy correctly. Server
metadata uses the running build revision rather than a separately maintained MCP
version. Every successful tool's text content serializes one stable
`{ "data": ..., "meta"?: ... }` envelope. Tool schemas publish enforced enums,
property descriptions, and `additionalProperties: false`; annotations remain
conservative when a tool can mutate or is idempotent only with an optional key.

`titen_compile` exposes the same optional `cross_project` flag as REST. The MCP
credential needs ordinary `mcp:call` authority and the separate
`context:compile:all` capability for that flag; omitting the flag and
`project_id` remains unscoped-only.

The Streamable HTTP endpoint accepts JSON responses without server-side SSE.
`GET /mcp` therefore returns `405`. A present `Origin` must match the request URL
origin, or the exact external origin configured by the Bun runtime's
`TITEN_MCP_ORIGIN`, or the request returns `403`; non-browser clients may omit
it. The configured value must be an HTTP(S) origin without credentials, path,
query, hash, or trailing slash. Titen does not trust forwarded-protocol headers
to derive it. The server negotiates protocol versions through `2025-11-25`,
assumes the compatible `2025-03-26` behavior when the HTTP version header is
absent, and returns `400` for an unsupported `MCP-Protocol-Version`. Tool
discovery includes read-only, destructive, idempotent, and open-world hints;
these are client hints only and never replace server-side scopes.

Channel creation, release approval/activation/revocation, and channel context
are not part of the ordinary agent MCP profile. Publisher, approver, and gateway
service principals use the narrower REST capabilities above.

Memory Atlas compilation is also not part of the ordinary-agent MCP profile;
authorized operator clients use its read-only REST endpoint.

## Authorization responses

- missing/invalid/revoked credential: `401`;
- authenticated but operation not permitted: `403` when revealing the resource
  class is safe;
- foreign tenant/resource ID: `404` to avoid existence disclosure;
- active competing lease: `409` with non-sensitive lease metadata;
- stale checkpoint version: `409`.
- wrong/ineligible channel, audience, release, or customer subject:
  non-disclosing `404`;
- invalid, expired, replayed, wrong-channel, or wrong-audience customer
  assertion: generic `403` without resolving/disclosing a subject;
- stale claim/release version during publication: `409`.
- unauthorized or foreign Memory Atlas focus/scope: non-disclosing `404` with
  no hidden topology/count metadata;
- authorized Atlas request above server limits: `200` with a bounded result and
  `truncated: true`.

## Compatibility

- Export format v2 is versioned independently from HTTP API v1. Import still
  accepts v1 files; because v1 carried no transferable actor authority, their
  observations and claims are owned by the authenticated importing principal.
- Breaking request/response changes require a new API version or migration path.
- A future Mem0 import adapter maps scopes and re-embeds; Titen does not promise
  complete Mem0 API compatibility.

## Portability and backup restore

`GET /v1/export?type=workspaces|memberships|projects|observations|claims`
returns one canonical NDJSON stream. Retain all five streams and headers for a
logical migration. Headers declare format v2, source organization, scope,
deterministic dependency order, count, completion state, and the next opaque
cursor. Pages contain at most 2,000 records and are cut on UTF-8 byte length so
the complete response remains within the import request limit. Follow
`next_cursor` until it is `null`; IDs are stable pagination cursors, not a
change feed.

Ordinary export is principal-scoped: private records belong to the caller,
team records require active membership, workspace export includes only joined
workspaces, and membership export includes only the caller. `all=true` requires
the separate `export:all` scope, exports the whole authenticated organization,
and appends a metadata-only audit entry for each page. It never crosses the
organization derived from the API key.

`POST /v1/import` preflights the complete request before mutation, accepts
canonical records independent of NDJSON line order, and writes in dependency
order. Workspaces and active memberships restore team authority before team
records; claims preserve source links and `superseded_by`. Missing parents
return `422 UNRESOLVED_REFERENCE` with only `record_type`, `field`, and
`dependency_type`; no foreign record or content is disclosed. Cross-organization
ID collisions fail closed, every request is atomic, and re-import is idempotent.
An exact self-authenticating redaction marker retains its original content hash
but is not re-added to FTS or vector projections; non-current claims are likewise
restored canonically with delete, rather than upsert, projection work. If purge
wins after import preflight, the same atomic batch rejects a current claim while
still allowing an explicit revoked tombstone on retry.

Format v2 never trusts a foreign `actor_id` as local authority. Before records
from another principal, add an explicit noncanonical control line:

```json
{"type":"titen.import.actor_map","source_org_id":"org_source","source_actor_id":"agent_source","destination_actor_id":"agent_destination"}
```

Mapping to the authenticated importer needs no extra scope. Mapping to another
destination principal additionally requires `keys:manage`; missing, conflicting,
foreign, or unused mappings fail before mutation. Canonical records retain the
mapped actor, while import history records the authenticated importer. That
administrative scope may restore team records on behalf of mapped members;
without it, the importer must be an active non-reader in each workspace.

Logical JSONL is not a full deployment snapshot. It deliberately excludes API
keys, encrypted integration bindings, checkpoints, leases, context runs and
feedback, audit/event/history rows, and rebuildable indexes or vectors. Use
`titen backup` for complete Bun/SQLite disaster recovery and a provider-native
database snapshot for Cloudflare rollback.
