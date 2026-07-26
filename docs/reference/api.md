# HTTP API reference

Status: draft contract for P0. Endpoint names and envelopes are stable targets;
payload details may change before the first tagged release.

## Common behavior

- Base path: `/v1`.
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

### `POST /v1/context/:id/feedback`

Record used/useful/irrelevant/incorrect/harmful outcomes for the context or
individual items.

### `GET /v1/claims/:id/evidence`

Return an authorized claim and its supporting, contradicting, and qualifying
observations.

## Collaboration operations

These ship after the Level 5 kernel gate.

### `POST /v1/checkpoints`

Create or version resumable task state with explicit TTL.

### `POST /v1/leases`

Acquire or renew an idempotent, expiring claim to a bounded work item.

### `POST /v1/handoffs`

Offer, accept, decline, or complete a handoff referencing a checkpoint and
evidence.

### `GET /v1/audit/events`

List authorized metadata-only audit events with cursor pagination.

## Health

- `GET /healthz`: process liveness without sensitive details.
- `GET /readyz`: migrations, canonical SQL, embedding fingerprint when enabled,
  vector capability when enabled, and outbox health.

## Authorization responses

- missing/invalid/revoked credential: `401`;
- authenticated but operation not permitted: `403` when revealing the resource
  class is safe;
- foreign tenant/resource ID: `404` to avoid existence disclosure;
- active competing lease: `409` with non-sensitive lease metadata;
- stale checkpoint version: `409`.

## Compatibility

- v1 export format is versioned independently from the HTTP API.
- Breaking request/response changes require a new API version or migration path.
- A future Mem0 import adapter maps scopes and re-embeds; Titen does not promise
  complete Mem0 API compatibility.
