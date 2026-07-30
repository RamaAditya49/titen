# HTTP API reference

Status: **P0 endpoints verified** on Cloudflare Workers/D1 and Bun/SQLite.
Endpoint names, envelopes, and payload shapes are stable. Post-P0 operations
remain draft until their implementation ships.

## Common behavior

- Base path: `/v1`.
- Planned Streamable HTTP MCP endpoint: `/mcp`.
- Protected endpoints use `Authorization: Bearer <key>`.
- JSON requests use `application/json`.
- External field names use `snake_case`.
- Requests may include `Idempotency-Key` on mutations.
- Tenant/organization authority never comes from a request body.

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

### `POST /v1/observations/batch`

Append a bounded batch using the same item schema and authorization path as the
single-observation endpoint. Each item has its own client mutation ID; the
request has one `Idempotency-Key`. The batch is atomic only when explicitly
declared and within the server limit. The default returns per-item status so one
invalid candidate does not force an adapter to resend accepted items.

### `POST /v1/consolidations`

Materialize or reconcile claims for an authorized scope. Direct deterministic
claims do not require a model. Automatic extraction is optional and bounded.

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

The response includes selected claims, evidence IDs, trust, temporal validity,
conflicts, score components, token usage, and a `context_id`.

Ranking is auditable and deterministic. Lexical BM25 and vector similarity are
each min-max normalized inside the authorized candidate set; relevance is the
stronger normalized signal. The final score is:

`0.40 relevance + 0.20 trust + 0.15 recency + 0.10 utility + 0.05 conflict + 0.10 confidence`

Every factor is returned in `score_components`. A zero-span positive matched
signal is assigned `1` for each matched candidate; absent lexical or vector
signals, including vector similarity `0`, are `0`. Confidence is therefore an
explicit weighted factor, not a hidden multiplier.

### `POST /v1/context/:id/feedback`

Record used/useful/irrelevant/incorrect/harmful outcomes for the context or
individual items.

### `POST /v1/index/drain`

Drain a bounded batch of pending indexing outbox rows into the configured vector
store. If embedding or vector-store upsert is unavailable, the response is
`503 UNAVAILABLE`; safe metadata includes `dependency` (`embedder` or
`vector_store`), `retryable: true`, and `pending`, the number of rows selected
by the bounded request. No selected outbox row advances on either dependency
failure, so the same batch can be retried after recovery.

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
  "lens": "memory_neighborhood",
  "focus": { "type": "claim", "id": "claim_..." },
  "scope": { "project_id": "project_..." },
  "max_depth": 2,
  "max_nodes": 200,
  "max_edges": 400
}
```

The initial v0.2 lenses are `evidence_trace`, `memory_neighborhood`, and
`conflict_freshness`. v0.3 adds `scope_preview` and `knowledge_release` after
their policy gates pass. The example limits are caller requests, not normative
server maxima; the server clamps them to measured deployment limits.

```json
{
  "view_id": "view_...",
  "lens": "memory_neighborhood",
  "focus": { "type": "claim", "id": "claim_..." },
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

`scope_preview` additionally accepts a preview principal/scope only for callers
with explicit preview capability. It reports that principal's eligibility but
does not impersonate it, mint authority, or return source content the operator
cannot inspect. `knowledge_release` follows the same distinction between
verified evidence and active external release.

## Collaboration operations

These ship after the Level 5 kernel gate.

### `POST /v1/checkpoints`

Create or version resumable task state with explicit TTL.

### `POST /v1/leases`

Acquire or renew an idempotent, expiring claim to a bounded work item.

### `POST /v1/handoffs`

Offer, accept, decline, or complete a handoff referencing a checkpoint and
evidence.

### `GET /v1/handoffs`

List authorized handoffs by status, recipient/team, project, and cursor. This is
the default pull path for ephemeral agents that cannot receive webhooks.

### `GET /v1/events`

Return authorized metadata-only domain events after an opaque cursor. It lets an
orchestrator poll when inbound webhooks are unavailable; it is not a transcript
or raw memory feed.

### Webhook subscriptions

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

### `GET /v1/audit/events`

List authorized metadata-only audit events with cursor pagination.

## Governed channel knowledge operations

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
- `GET /readyz`: migrations, canonical SQL, embedding fingerprint when enabled,
  vector capability when enabled, outbox health, and release FTS plus
  customer-assertion verifier readiness when channel serving is enabled.

When Memory Atlas is disabled, it does not affect liveness/readiness. When
enabled, readiness checks only the server-side compiler's canonical
dependencies; an optional browser renderer is never a service-readiness gate.

## MCP surface

The planned `/mcp` endpoint exposes the smallest ordinary-agent tool set:

- `titen_context`;
- `titen_remember`;
- `titen_feedback`;
- `titen_checkpoint`;
- `titen_lease`;
- `titen_handoff`.

Administrative key, membership, retention, and webhook-subscription operations
are not enabled for ordinary agent profiles by default. MCP tools are stateless
adapters over the same domain operations as REST; restarting or disconnecting
the MCP client loses no canonical state. `titen_context` is declared read-only;
the other default tools are declared write-capable so hosts can apply their
native approval policy correctly.

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

- v1 export format is versioned independently from the HTTP API.
- Breaking request/response changes require a new API version or migration path.
- A future Mem0 import adapter maps scopes and re-embeds; Titen does not promise
  complete Mem0 API compatibility.

## Operator work queue

The queue records coordination state only; Titen does not select workers, schedule retries, or execute work. All routes require organization authentication, the named route scope, and membership in the work item's workspace. Readers may list but not mutate.

| Method | Route | Scope | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/work-items` | `work-items:write` | Create a pending bounded work item. |
| `GET` | `/v1/work-items?workspace_id=...&status=...` | `work-items:read` | List visible workspace work items. |
| `POST` | `/v1/work-items/:id/claim` | `work-items:claim` | Atomically claim with `{ttl_seconds}`; returns opaque `lease_token` and increasing `lease_version`. |
| `POST` | `/v1/work-items/:id/heartbeat` | `work-items:claim` | Renew with `{lease_token,lease_version,ttl_seconds}` before expiry. |
| `POST` | `/v1/work-items/:id/complete` | `work-items:claim` | Complete with the current fence plus `idempotency_key` and `outcome`. |
| `POST` | `/v1/work-items/:id/requeue` | `work-items:claim` | Current claimant supplies its fence; workspace owner/admin may recover without it. |

Claim, heartbeat, completion, and requeue use token/version fencing. An expired or reassigned worker receives `409 CONFLICT`. Completion repeats with the same claimant, idempotency key, and outcome return the stored response; changing the outcome conflicts. Events expose lifecycle metadata but omit payloads, outcomes, and tokens.
