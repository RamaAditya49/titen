# HTTP API reference

Status: **implemented route inventory verified** against `src/core/app.ts` by
`node scripts/check-route-docs.mjs`. Detailed examples below are descriptive;
features explicitly listed as proposed are not routes.

## Implemented route inventory

<!-- ROUTE_INVENTORY_START -->
- `DELETE /v1/checkpoints/:id`
- `DELETE /v1/dashboard-sessions/current`
- `DELETE /v1/identity-mappings/:id`
- `DELETE /v1/keys/:id`
- `DELETE /v1/leases/:id`
- `DELETE /v1/memberships/:id`
- `DELETE /v1/observations/:id`
- `DELETE /v1/webhooks/:id`
- `GET /healthz`
- `GET /readyz`
- `GET /v1/audit`
- `GET /v1/audit/export`
- `GET /v1/channels`
- `GET /v1/checkpoints`
- `GET /v1/checkpoints/:id`
- `GET /v1/claim-approvals`
- `GET /v1/claims/:id/evidence`
- `GET /v1/context/:id`
- `GET /v1/events`
- `GET /v1/events/:id`
- `GET /v1/export`
- `GET /v1/federation/log`
- `GET /v1/federation/peers`
- `GET /v1/federation/peers/:id/filters`
- `GET /v1/handoffs`
- `GET /v1/identity-mappings`
- `GET /v1/keys`
- `GET /v1/knowledge-releases`
- `GET /v1/leases`
- `GET /v1/memberships`
- `GET /v1/policies`
- `GET /v1/principal`
- `GET /v1/webhooks`
- `GET /v1/webhooks/:id/deliveries`
- `GET /v1/workspaces`
- `PATCH /v1/channels/:id`
- `PATCH /v1/operator-accounts/current/password`
- `PATCH /v1/policies/:id`
- `POST /mcp`
- `POST /v1/channels`
- `POST /v1/channels/:id/context/compile`
- `POST /v1/checkpoints`
- `POST /v1/claim-approvals`
- `POST /v1/claim-approvals/:id/decide`
- `POST /v1/claims/:id/expire`
- `POST /v1/claims/:id/revoke`
- `POST /v1/claims/:id/supersede`
- `POST /v1/consolidations`
- `POST /v1/context/:id/feedback`
- `POST /v1/context/compile`
- `POST /v1/dashboard-sessions`
- `POST /v1/enrichment/drain`
- `POST /v1/federation/peers`
- `POST /v1/federation/peers/:id/filters`
- `POST /v1/federation/peers/:id/suspend`
- `POST /v1/federation/pull`
- `POST /v1/federation/push`
- `POST /v1/handoffs`
- `POST /v1/handoffs/:id/resolve`
- `POST /v1/identity-mappings`
- `POST /v1/import`
- `POST /v1/index/drain`
- `POST /v1/index/verify`
- `POST /v1/keys`
- `POST /v1/knowledge-releases`
- `POST /v1/knowledge-releases/:id/activate`
- `POST /v1/knowledge-releases/:id/approve`
- `POST /v1/knowledge-releases/:id/revoke`
- `POST /v1/leases`
- `POST /v1/leases/:id/force-release`
- `POST /v1/legal-holds`
- `POST /v1/legal-holds/:id/release`
- `POST /v1/memberships`
- `POST /v1/memory-views/compile`
- `POST /v1/observations`
- `POST /v1/operator-accounts`
- `POST /v1/policies`
- `POST /v1/projects/resolve`
- `POST /v1/retention/apply`
- `POST /v1/webhooks`
- `POST /v1/webhooks/:id/pause`
- `POST /v1/webhooks/:id/resume`
- `POST /v1/webhooks/deliver`
- `POST /v1/workspaces`
<!-- ROUTE_INVENTORY_END -->

## Proposed/unimplemented endpoints

- Observation batch ingestion (`POST /v1/observations/batch`).
- The old `webhook-subscriptions`, `webhook-deliveries`, `channel-releases`,
  `channel-context`, and `audit/events` paths are not aliases. Use the
  implemented inventory above.

## API keys

`POST /v1/keys` accepts a label, scopes, and optional `max_trust`,
`principal_id`, `principal_kind`, `not_before`, and `expires_at`. Timestamps are
canonical UTC; `not_before` is inclusive, `expires_at` is exclusive, and the
former must precede the latter. The lifecycle window is immutable. Unknown
creation fields are rejected so a client cannot mistake an ignored security
control for an enforced one. Its one-time creation response includes
the raw `api_key`, credential `key_id`, and the caller-supplied or generated
`principal_id`. Use `principal_id` for handoff targets; `key_id` identifies the
revocable credential and is not an agent identity. `GET /v1/keys` returns the
same non-secret identity metadata plus `not_before`, `expires_at`, monotonic
nullable `last_used_at`, and `pending|active|expired|revoked` status, but never
returns the raw key.

A wildcard root credential may reissue any explicit principal identity. A
non-wildcard key manager may explicitly reuse only its own `principal_id` with
the same `principal_kind`; omitting `principal_id` asks the server to generate a
new opaque identity. This prevents a scoped key manager from borrowing an
existing owner/admin role by name.

An optional `membership_role` (`owner`, `admin`, `member`, or `reader`) turns
the same operation into a managed human API credential. It fixes
`principal_kind` to `human` and atomically creates one organization-level
membership with the new key. The
caller needs `keys:manage`, `memberships:write`, and an active organization
`owner` or `admin` role; an admin cannot assign `owner`. Scope and trust ceilings
still cannot exceed the caller. A duplicate membership or any validation,
authorization, or SQL failure creates neither record. The one-time response adds
`membership_id` and `membership_role`; key listing never returns the raw key.

### `GET /v1/principal`

Validate the bearer key and return its own non-secret `organization_id`,
`principal_id`, `principal_kind`, `key_id`, `scopes`, `max_trust`, and active
organization role. This route requires authentication but no additional scope,
so a least-privilege dashboard session can verify its identity. A wildcard
bootstrap/recovery key reports role `root`; a key without an active
organization membership reports `null`. Expired or revoked keys return `401`
on the next request.

## Dashboard operator accounts

`POST /v1/operator-accounts` accepts `username`, `role`, non-empty `scopes`, and
optional `max_trust`. The caller needs `keys:manage`, `memberships:write`, and an
active organization `owner` or `admin` role; only an owner may assign `owner`.
The operation atomically creates one human membership and password account,
then returns a random `temporary_password` once with
`password_change_required: true`. It never returns a raw API key. Usernames are
lowercase and unique across one Titen deployment; use `titen bootstrap
--username <unique-name>` when bootstrapping another organization into the same
database.

`POST /v1/dashboard-sessions` is the unauthenticated username/password exchange.
A valid established account receives an eight-hour revocable API key for the
same principal, scopes, trust ceiling, and organization role. A temporary
password receives a 15-minute key with no scopes and
`password_change_required: true`; it can call only authenticated scope-free
routes such as principal introspection and the password-change route. Unknown
users and wrong passwords return the same `INVALID_LOGIN` response, and failed
attempts are bounded.

`PATCH /v1/operator-accounts/current/password` accepts only `password`. It is
available to an authenticated operator session even when that session has no
scopes. A successful change replaces the salted verifier, clears the first-login
flag, revokes every active dashboard session for that principal, and requires a
fresh login. Passwords contain 15–128 Unicode characters after NFC
normalization and are checked against a small deployment-local common/context
list.

`DELETE /v1/dashboard-sessions/current` revokes the bearer dashboard session.
API keys created for agents, services, SDKs, CLI recovery, or other integrations
are separate and unchanged.

## Webhook delivery

`POST /v1/webhooks` accepts only a configured allowlisted HTTPS hostname. The
Bun runtime resolves and rejects private, link-local, special-use, mapped IPv4,
and unsafe IPv6 addresses, re-resolves before every attempt, pins TLS to one
approved address, and never follows redirects. Cloudflare returns `503` for
webhook registration/delivery because Worker `fetch` cannot prove this pinning.

Registration records the current event sequence as the webhook's watermark, and
delivery is owed for every event committed after it. Eligibility never depends
on comparing wall-clock timestamps, so events written in the same millisecond as
the registration are delivered rather than dropped.

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
    "ref": "deploy_456#smoke",
    "id": "deployment-event-456-smoke"
  },
  "trust": "verified",
  "visibility": "team"
}
```

Only authorized service/agent identities may assert `verified` trust.
Observations cannot assert `policy_approved`; that trust exists only on claims
promoted by the approval workflow.
Visibility defaults to `private`. `team` requires `workspace_id` and an active
non-reader membership; this predicate is applied before retrieval, export,
events, Atlas limits/counts, and webhook delivery.

`source.type` and `source.ref` are both **required**. `source.ref` became
mandatory in 0.6.0, matching the obligation the MCP `titen_remember` tool spec
already stated; a write without it returns `400 VALIDATION_ERROR`. Existing rows
stored before 0.6.0 may still have a null `source_ref` and are unaffected.

`source.id` is an optional stable source-event identity. Re-ingesting the exact
same normalized observation with that ID converges on the original canonical
record even after the request `Idempotency-Key` expires. Reusing the ID with
different content or scope creates a distinct canonical hash; `source.ref`
remains a provenance pointer and is not treated as a uniqueness key.

#### Recalled provenance

`recalled` is a reserved, server-assigned `source.type`: it marks content Titen
itself handed back through a context pack, which is the write that turns a
memory store into an echo chamber. A caller may never author it.

- Declaring `"source": {"type": "recalled"}` returns `400 VALIDATION_ERROR`.
- Passing the optional top-level `context_token` from a
  [`POST /v1/context/compile`](#post-v1contextcompile) response stamps the
  stored row with `source_type` `recalled`, **overriding** whatever
  `source.type` the caller declared.
- A `context_token` that was not issued to this principal — unknown, foreign
  organization, or another actor without a live handoff — returns
  `400 VALIDATION_ERROR` rather than being ignored. Silently downgrading an
  unrecognized token would record a recalled write as fresh input, which is the
  exact mislabelling this rule exists to prevent.
- A `recalled` observation cannot be cited as claim evidence:
  `POST /v1/consolidations` refuses it with `400 VALIDATION_ERROR`, so the loop
  is closed rather than merely labelled.

The token is verified against the stored context run and the same read boundary
`GET /v1/context/:id` enforces. It is opaque; do not parse it.

### `DELETE /v1/observations/:id`

An operator credential with the explicit `observations:purge` scope can
irreversibly tombstone readable evidence in its organization. The atomic write
retains the observation ID, original content hash, source metadata, and history;
removes FTS content; queues a vector delete; redacts and revokes dependent
claims; and appends a content-free audit/event record. An active legal hold on
the observation or any dependent claim blocks the purge. Foreign IDs return the
same `404` as missing IDs. Ordinary agent and MCP keys should never receive
this scope, and no MCP forget tool exists.

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
or visibility widening. Direct writes cannot assign `policy_approved`; only the
versioned claim-approval workflow may do that.

The separately configured background derivation/reflection path does not add
model latency to this request or change its direct-claim semantics.

### `POST /v1/enrichment/drain`

An operator credential with `enrichment:write` may drain the optional durable
derivation/reflection ledger. The route exists even though extraction is
disabled by default; without a valid extraction tuple it returns a validation
error and canonical observation/direct-claim paths remain available. Bun accepts
`limit=1..50`; Cloudflare accepts only `limit=1` to preserve its declared Paid
D1 invocation budget. Bun timers and a provisioned Cloudflare Cron Trigger call
the same shared core automatically.

Jobs keep immutable input, model, prompt, schema, and policy fingerprints plus
an output hash and result IDs, never raw prompts or model responses. Imported
observations are provenance restores and are excluded from automatic recovery
backfill; submit a new observation explicitly if restored v1/v2 evidence should
be considered new enrichment input. Format-v3 restores carry their original
enrichment provenance instead.

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
  "max_candidates": 300,
  "top_k": 5,
  "at": "2026-08-01T09:00:00.000Z",
  "include_checkpoints": true
}
```

`max_tokens` accepts 128 through 32,000. `max_candidates` optionally accepts 1
through 1,000 and defaults to 200; Vectorize requests remain capped at its
native 100-match boundary. `top_k` optionally accepts 1 through 1,000 and is
absent by default, leaving `max_tokens` as the only bound on pack size. The two
limits are different things: `max_candidates` bounds what retrieval considers,
`top_k` bounds what comes back. `top_k` is applied to the ranked list before the
token budget, so a bounded pack costs fewer tokens rather than being trimmed
after the caller has paid for a full one. `budget.omitted_items` counts every
ranked candidate that was dropped, by the count bound as well as by the budget,
so a truncated answer is never reported as a complete one;
`budget.budget_exhausted` stays specific to the token budget, and omissions with
`budget_exhausted: false` are the count bound. It is a ceiling, not an exact
count: duplicate statements are still deduplicated, and fewer eligible claims
still return fewer items. `meta.candidates` continues to report everything
retrieval considered. `at` optionally supplies an ISO-8601 point-in-time
eligibility anchor and defaults to the server's current instant. The response
scope reports the normalized `as_of` instant. The response includes selected claims,
evidence IDs, trust, temporal validity, conflicts, score components, token usage,
and a `context_id`. Each item carries `untrusted: true`; this is structured
provenance for the caller, not an instruction-enforcement claim.

The response also carries `context_token`, a server-issued opaque token for this
run. Pass it as `context_token` on any `POST /v1/observations` derived from this
pack and the write is stamped `recalled`; see
[recalled provenance](#recalled-provenance). It is what makes a recall loop a
server verdict instead of a self-report, so a recall-loop rate measured from
Titen's own store is checkable rather than caller-declared.

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
explicit weighted factor, not a hidden multiplier. The conflict component is
`1` for a conflict-free claim and `0` for a disputed claim, so contradictory
evidence lowers relative rank by `0.05` while remaining visible in the item
status and `conflicts`.

`score` is comparable **across queries**. The relevance term is
`strength / (strength + 3.7)` where `strength` is the FTS `bm25` magnitude
divided by the number of query terms, and the semantic term is raw cosine, so
neither is rescaled against the rest of the candidate set. Measured on the
424,168-claim anchor store: rank 1 returned **one** distinct value over 500
questions before this change and **498** after, spanning 0.4875–0.6632. A
confidence floor is therefore possible; #227 is closed.

Two limits are worth stating plainly. `3.7` is calibrated on LongMemEval-S and
BM25 is not portable across corpora, so the absolute band shifts with the
corpus — the ordering does not. And relevance saturates, so between two
candidates that both match well the remaining components carry relatively more
weight than they used to.

Equal scores are ordered by the stronger vector similarity, then by `claim_id`.
Within-set normalization scores each signal's own best at exactly `1`, so when
the best lexical match and the best semantic match are different claims they tie
on the whole score; the similarity term decides that tie on retrieval evidence
rather than on identity. Two cosines are only ever compared with each other, so
no constant and no cross-scale comparison enters the ordering, and a lexical-only
deployment is unaffected. `claim_id` remains the last term, so a genuine dead
heat still ranks identically on every run.

Lexical planning removes Unicode format characters, preserves combining marks,
normalizes to NFC, and drops a bounded English/Indonesian function-word set;
an all-function-word task falls back to its original terms. Porter stemming
handles common word forms.

A temporal polarity marker is expanded inside the MATCH to the other markers
naming the same window boundary **in the same language**: `mulai`, `sejak`,
`sesudah`, `setelah` name the start of an Indonesian window and `after`, `since`
an English one; `hingga`, `sampai`, `sebelum` name the end of an Indonesian
window and `before`, `prior`, `until` an English one. A query saying "sejak Juli
2026" therefore reaches a claim that says "Mulai Juli 2026" and outranks the
otherwise identical "Sebelum Juli 2026". Groups never span languages: one OR
branch that did would pull an unrelated English document into an Indonesian
query on a shared function word alone. Markers that are also function words
(`dari`, `from`) stay in the stoplist and are not expanded. The expansion is a
recall device inside the MATCH only: `meta.query_terms_used` and
`meta.dropped_query_terms` still count the caller's own terms, claim eligibility
still comes from `valid_from`/`valid_to`, and there is no temporal ranking term.

The FTS MATCH includes encoded organization and
subject scope before BM25, then canonical SQL repeats every authorization and
lifecycle check. `meta.degraded.lexical` is `no_terms` when normalization leaves
no searchable term and `used` otherwise. The existing `remove_diacritics 2`
tradeoff remains: diacritic-only distinctions fold together, while separate
letters such as `ł` and `ß` do not.

Packing preserves deterministic rank order when every deduplicated candidate
fits. Under actual token pressure it selects one fitting claim per available
kind before filling the remaining budget in rank order. `budget` reports
`selected_items`, authorized `omitted_items`, `deduplicated_items`, and the
explicit `budget_exhausted` boolean, so an empty corpus is distinguishable from
authorized candidates that could not fit. Hidden records never contribute to
these counts. Byte-identical active claim statements appear at most once in a
context pack; canonical claims and their evidence remain unchanged.

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
failure. Before either an upsert or removal, Titen persists canonical
reconciliation alongside the source row. A stale or apply-then-throw result
leaves fresh repair independent of the expired owner token, so a later drain
restores the projection from canonical SQL.

Manual and background drains share one expiring SQL owner per outbox row. A
takeover after expiry may finish the row, but completion, attempt accounting,
and safe dependency-outage evidence from the former owner become no-ops. Due-row
eligibility and expiry come from the database clock inside each conditional
claim, so earlier provider work, another organization, or a skewed caller clock
cannot shorten or strand the lease. Every external mutation has durable
canonical reconciliation before I/O; stale upserts are compensated, stale
removals are re-indexed when still eligible, and `indexed`, `removed`, and
`remaining` count only ownership-confirmed work.

Both built-in embedding adapters require exactly one dense, configured-length
vector per input and reject non-numeric or non-finite coordinates. Provider
indices, when present, must be the ordered contiguous range starting at zero.
Malformed successful provider output follows the same safe retryable embedder
failure path before any vector upsert; canonical SQL and FTS remain available.

### `POST /v1/index/verify`

Check up to 100 active or disputed canonical claim IDs against the configured
vector store without reading embedding values. `limit` accepts 1 through 100;
`after` is the previous `next_after` cursor. Missing IDs receive one durable
`reconcile` row and are rebuilt by the normal drain. The route requires
`index:write`, remains organization-scoped, and returns checked, present,
missing, queued-repair, and next-cursor counts.

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
`conflict_freshness`, `review_queue`, `scope_preview`, and
`knowledge_release`. `scope_preview` additionally requires `governance:read`
and an owner/admin/reader organization role, then returns role eligibility
without impersonating or granting authority. `knowledge_release` additionally
requires `releases:read` plus the same inspection roles, exposes reviewed
snapshots and exact claim-version references in metadata, emits no dangling
graph edges, and never includes source evidence.
The example limits are caller requests, not normative server maxima; the server
clamps them to measured deployment limits.

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

Both governance lenses are read-only projections; they cannot change policy,
approval, release, retention, or identity state.

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
The SDK's `iterateEvents()` treats an empty page as terminal before comparing
cursors, rejects a non-advancing/cyclic cursor or repeated event ID, and forwards
the caller's abort signal and configured request timeout.

### Federation routes

Federation capabilities are necessary but not sufficient. Registering or
suspending peers, changing filters, and pulling or pushing data requires an
organization `owner` or `admin` role. Listing peers, filters, or federation log
entries also permits `reader`. A wildcard-root credential bypasses this role
gate only for bootstrap and recovery. Peer resources remain bound to the
principal that registered them.

Each federation peer and cursor belongs to the principal that registered it.
The default `POST /v1/federation/pull` response remains event-only. Passing
`include_memory: true` requires `export:read` and an explicit `claim` filter;
eligible active/disputed organization-visible direct-claim events then carry a
version-1 `memory` object containing the claim, project identity, observations,
and evidence relations. Canonical pulls return at most one claim event so its
relay body stays below the existing request limit. Any hidden or incomplete
graph is omitted.

`POST /v1/federation/push` always requires an HMAC over the exact raw JSON body.
An event with `memory` additionally requires an explicit destination claim
filter and `import:write`; creating its project reference requires
`projects:create`. The destination accepts only complete organization-visible
same-subject/project graphs within the importing credential's trust ceiling.
Remote observations and claims with `policy_approved` trust are rejected; a
local claim approval must assign that trust after import.

The first successful canonical push binds its `memory.source_org_id` to the
destination peer. `GET /v1/federation/peers` exposes the nullable
`source_org_id`; after binding it cannot change. A later or concurrent push
claiming another source organization returns 409 and its complete batch rolls
back. This is a trust-on-first-use provenance boundary, not proof that the peer
controls a globally registered organization name.

The accepted batch writes canonical SQL, FTS, optional index work, audit/event
metadata, and immutable `federated_records` provenance. The result adds
`canonical_claim_id`; exact or alternate-event replay returns `replayed`
without duplicating memory. The same event ID is replayable only when its stored
wrapper and every canonical provenance mapping are identical; changed content
or new records under that event identity return 409 before canonical mutation.

Event-only accepted input remains an owner-visible `federation.received`
wrapper. A memory wrapper excludes copied content and contains only remote event
metadata plus local claim ID, source IDs, and payload hash. A remote actor or ID
never becomes local authority.

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

These implemented v0.3 operations implement
[ADR-0002](../decisions/0002-channel-release-not-public-memory.md). Every
operation is authenticated. Titen does not expose an anonymous canonical-memory
or search endpoint.

Policy and identity administration use `POST|GET|PATCH /v1/policies`,
`POST|GET /v1/claim-approvals`, `POST /v1/claim-approvals/:id/decide`, and
`POST|GET|DELETE /v1/identity-mappings`. Mutations require both an explicit
credential capability and an active owner/admin organization role; a wildcard
root credential is the bootstrap/recovery boundary. Approval binds one current
claim version and visible evidence. An independent-approval policy prevents
submitter self-approval. Only readable evidence linked as `supports` satisfies
submission; approval/revocation changes claim trust with append-only history
rather than changing evidence.

Retention uses the same canonical `policies` table with typed configuration.
`POST /v1/legal-holds` and `POST /v1/legal-holds/:id/release` manage exact
claim/observation holds. `POST /v1/retention/apply` creates bounded retrieval
exclusions for records older than a policy cutoff; an active legal hold wins.
Placing a hold atomically restores retrieval eligibility by removing an exact
existing exclusion and, for a claim hold, exclusions on its supporting
observations; a metadata audit records that restoration. Retention cannot race
an active direct or dependent-claim hold back into exclusion.
`DELETE /v1/observations/:id` also rejects a hold on the observation or any
dependent claim. Retention does not perform implicit physical deletion.

Release statuses are `draft`, `approved`, `active`, `suspended`, `replaced`,
`expired`, and `revoked`. Source eligibility can suspend an active release
without waiting for an API mutation; replacement creates a new immutable
release row.

### `POST /v1/channels`

Create an operator-managed CRM, website, support, or partner channel under the
authenticated organization. The request defines a bounded label, allowed
audiences, minimum claim trust, and gateway-service principal binding. A
channel allowing `authenticated_customer` also receives an operator-supplied
assertion secret of at least 32 characters; Titen stores only its hash plus an
encrypted keyring-wrapped copy. Creating a channel does not release any claim.

### `GET /v1/channels`

List authorized channels with opaque IDs, labels, allowed audiences, gateway
principal binding, status, and lifecycle metadata. It returns no credentials,
assertion verification keys, or released content.

### `PATCH /v1/channels/:id`

Set a channel to `active`, `paused`, or `disabled` using expected-version
semantics. A non-active channel makes all of its releases ineligible before the
next context compile without deleting release history.

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

The proposer must own the exact claim and its supporting evidence. The server
records source hashes and never copies evidence into the released citation set.
`verified` trust alone does not activate this draft.

### `GET /v1/knowledge-releases`

List up to 500 authorized release rows in stable creation order. Released
content is returned only to principals with `releases:read`; source evidence
remains separately authorized.

### `POST /v1/knowledge-releases/:id/approve`

Approve an exact draft snapshot/hash with expected version and a bounded
approval reason. The approver must have
release-approval capability and satisfy the configured separation-of-duty
policy. The proposer cannot approve the release. Approval records `approved_by`
and `approved_at`; it does not activate the release or change source claim
trust. Approval fails unless the same source claim version is current, active,
and undisputed; otherwise the publisher must create a new release.

### `POST /v1/knowledge-releases/:id/activate`

Activate an approved release using expected-version semantics. The caller must
have release-approval capability and satisfy separation-of-duty policy. The
transaction appends audit and metadata event evidence. Activation fails if the
referenced claim version is not the current active, undisputed version.

### `POST /v1/knowledge-releases/:id/revoke`

Revoke an approved, active, or suspended release with expected version and a
bounded reason. Canonical eligibility ends in the commit. The current compiler
reads canonical SQL directly; a future release cache/index must still recheck
this state.

### `POST /v1/channels/:id/context/compile`

Compile context for an authenticated channel gateway.

```json
{
  "audience": "authenticated_customer",
  "task": "answer the customer's returns question",
  "max_tokens": 900,
  "customer_session_assertion": "opaque-short-lived-signed-value"
}
```

The gateway credential must be a service principal bound to the channel. An
`anonymous` request cannot include a customer assertion. For
`authenticated_customer`, Titen verifies an HMAC-SHA256 assertion signed by the
channel gateway. The base64url JSON payload is
`{v:1,channel_id,audience:"authenticated_customer",subject_id,exp,jti}`;
expiry may be at most 15 minutes ahead and each `jti` is accepted once. The
gateway must derive the subject from an authenticated upstream session; it must
never sign a user-controlled ID.

The response contains only active, valid release snapshots matching the channel
and audience. This release-only compiler does not query canonical customer
memory. It returns released citation metadata, never unreleased source content.
Dynamic balances, inventory, order, payment, ticket state, and customer-private
context should be fetched through their authoritative tools instead of assumed
from release memory.

Eligibility joins the source claim head. A version mismatch, dispute,
supersession, expiry, or revocation excludes the release immediately even if a
derived cache/vector or release-status maintenance job is stale.

## Health

- `GET /healthz`: process liveness without sensitive details.
- `GET /readyz`: canonical SQL, migration integrity, signing-secret
  decryptability, and capability-contract version 1. Capability states include
  FTS, vector, embedding, extraction, background enrichment,
  `extraction_response_mode`, `background_repair`, and export/import. The
  response mode is `json_schema`, explicit compatibility mode `json_object`,
  `custom` for an injected extractor, or the matching disabled/error state; it
  never exposes a provider endpoint or credential. `disabled`, `enabled`, and
  `configured_error` distinguish intentional omission from broken opt-in
  configuration.

`capabilities.model` and `meta.degraded.model` are deprecated `0.3.x` aliases
for embedding. `embedding`, `extraction`, and `background_enrichment` are
separate fields. Extraction/enrichment code is implemented but remains
`disabled` until a complete opt-in tuple is supplied; malformed configuration
reports `configured_error`. Production activation remains gated on the locked
evaluation and real Cloudflare, VPS, and local-computer smoke evidence.

When semantic retrieval is configured, readiness compares credential-free
provider identity, model, immutable revision, dimensions, cosine metric, named
role-aware preprocessing/unit normalization plus calibrated floor, and
index-schema version with migration-13 metadata. Partial/invalid
configuration, unavailable or aliased local vector storage, an untracked legacy
index, missing historical requeue work, an empty projection after canonical-only
restore, fingerprint mismatch, or a migration-14 locally recorded embedder/
vector-store indexing failure returns `503 NOT_READY`, marks the affected
capability `configured_error`, and supplies one fixed
`checks.semantic_index` diagnostic. The response does not expose the
fingerprint, endpoint, database path, or provider error.

An active/disputed claim with pending upsert or reconciliation work reports
`index_projection_pending` and keeps readiness at `503` until the rebuildable
projection converges. A graceful Bun shutdown releases only the active
maintenance pass's owned semantic leases; a fresh process can reclaim them
without waiting for the normal lease expiry.

The cosine floor is an operator-supplied calibration policy, not a public API
field or universal Titen default. Sub-threshold vector IDs never reach canonical
hydration; authorized lexical candidates and successful empty packs retain their
normal behavior.

Readiness performs bounded local configuration/path/schema/metadata checks only. It
makes no embedding-provider or vector-index network call. Before a dependency is
used, `enabled` means locally initialized and fingerprint-compatible. A failed
manual or background index attempt stores only a safe dependency timestamp in
semantic metadata, increments only still-owned outbox attempts, and makes
readiness fail locally. Only a later owned complete embed/upsert clears the
observed failure; delete or retirement work cannot report recovery.

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

The implemented `/mcp` endpoint exposes nine native wire tools in eight
ordinary-agent families, plus the nine
[reference-server compatibility](#reference-memory-server-compatibility) names
below, for eighteen tools in `tools/list`:

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

### Reference memory-server compatibility

Titen also serves the nine tool names of
`@modelcontextprotocol/server-memory` — `create_entities`, `create_relations`,
`add_observations`, `delete_entities`, `delete_observations`,
`delete_relations`, `read_graph`, `search_nodes`, `open_nodes` — with that
server's argument shapes, response shapes, tool descriptions and annotations
reproduced from its `src/memory/index.ts`. Each returns both the text content
that server returns and the same object as `structuredContent`. The `titen_*`
tools are unchanged; this is an addition, not a mode.

Switching is one line of MCP configuration — replace the reference server's
command with `npx -y titen-memory mcp` and keep the same tool vocabulary. That
line needs Bun on `PATH`: the published bin is a Bun program, so on a Node-only
machine it exits with `titen: error: bun was not found on PATH.` rather than
starting. `curl -fsSL https://titen.dev/install.sh | bash` installs Bun when it
is missing. No
`outputSchema` is published for these tools. The reference server's
`memory://knowledge-graph` resource **is** served, through `resources/list` and
`resources/read`, returning the same JSON body `read_graph` returns. Resource
*subscriptions* are not: `initialize` advertises `resources` with
`subscribe: false`, so a client is told up front that it will get no change
notifications.

**Adopting an existing store.** On the first local-mode start, `titen mcp`
imports the reference server's newline-delimited JSON graph. `MEMORY_FILE_PATH`
wins outright when set. With it unset the search covers the working directory,
`node_modules/@modelcontextprotocol/server-memory/dist` beneath it, and every
`@modelcontextprotocol/server-memory` install in npm's `_npx` cache — because
that server writes beside its own module, not in the directory it was launched
from, so the cwd alone found nothing for anyone who ran it the documented way.
Both names are tried at each location: `memory.jsonl` since 2025.11.25 and
`memory.json` before it. When `MEMORY_FILE_PATH` is set and no file is there,
`titen mcp` says so on stderr instead of starting empty in silence. A first run
that simply finds no graph says nothing about the import, because most first
runs are not migrations; what it always prints is the store line below.
Import runs through these same MCP tools, reports its counts on stderr, and
records the source path in `~/.titen/memory.db.imported` so a later start does
not resurrect entities deleted since. A failed import leaves that marker
unwritten and retries on the next start; entities are created before their
observations are added, so a resumed import loses nothing. Lines that are
neither an entity nor a relation are ignored as that server ignores them; a
malformed entity or relation line fails the import rather than being dropped.

**How the graph is stored.** Every record lives under the subject
`knowledge_graph` with `private` visibility, so each principal has its own
graph exactly as each client configuration had its own `memory.json`, and
Titen's subject-scoped retrieval can search the whole graph in one pass:

| Reference concept | Titen record |
| --- | --- |
| entity (`name`, `entityType`) | observation, `source_ref` `memory://entity`, `agent_id` the name, content the type |
| entity observation string | observation, `source_ref` `memory://observation`, content verbatim |
| relation (`from`, `to`, `relationType`) | observation, `source_ref` `memory://relation`, content the JSON triple |
| — | one `semantic_fact` claim per entity and per observation, `"<name>: <text>"`, which is what `search_nodes` ranks |

Those observations are canonical and round-trip exactly; the claims are a
searchable projection, so a statement longer than the 4,000-character claim
limit is truncated there while the observation keeps the full text.

**`search_nodes` is the one tool that is not a reimplementation.** The
reference server lower-cases the query and runs a substring scan over the whole
graph re-read from disk, so a query phrased as a question matches nothing.
Titen compiles the query through ordinary retrieval — stemmed FTS, ranking, and
the vector index when one is configured — and returns entities best-first,
bounded by the compiler's candidate and token ceilings rather than returning
every substring hit. Relations still reach outside the matched set, as they do
there. An empty query returns the whole graph, matching that server's
`includes("")`. Each search records a context run, as `titen_compile` does.
Relation text is not searched, which is also true of the server being replaced.

**Deleting is a purge.** `delete_entities`, `delete_observations` and
`delete_relations` purge the underlying observations: content becomes
irrecoverable, the row's hash and history survive, and dependent claims are
revoked. Those three tools require `observations:purge` in addition to
`mcp:call`, so a credential that may write memory cannot destroy it by way of
the compatibility surface.

**Bounds that the reference server does not have.** Entity names and relation
endpoints are limited to 200 characters, entity and relation types to 120, and
observation text to 32,000; empty strings are rejected. Duplicate entity names
inside one file or one call collapse to the first, where that server would
write two nodes with the same name.

### Local mode

`titen mcp` (`npx titen-memory mcp`) with neither `TITEN_MCP_URL` nor
`TITEN_API_KEY` set serves the same MCP surface over stdio against
`~/.titen/memory.db`, creating that store on first run. It is an additional
entry point, not a relaxation: the store is provisioned with an ordinary
organization, workspace (`Local`), project (reference `local`) and owner
principal, and every request is authenticated and authorized by the same core
predicates a served deployment uses. The owner credential is a real API key row;
its raw value is written once to `~/.titen/memory.db.key` with mode `0600` so a
restart reuses one owner instead of minting a credential per process.

Nothing listens on a socket, no request leaves the process, and no embedding
provider is configured, so retrieval is lexical FTS only and
`meta.degraded.vector` reports `disabled`. Setting exactly one of the two
variables remains an error rather than a silent downgrade to the local store,
and reaching local mode is announced twice: one line on stderr naming the store
and the two unset variables, and the same fact appended to the `instructions`
string in the `initialize` result, where the model reading an empty context
pack can see it. A served deployment appends nothing.

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

- Export format v4 is versioned independently from HTTP API v1. Import still
  accepts v1/v2/v3 files; because v1 carried no transferable actor authority, its
  observations and claims are owned by the authenticated importing principal.
- Breaking request/response changes require a new API version or migration path.
- A future Mem0 import adapter maps scopes and re-embeds; Titen does not promise
  complete Mem0 API compatibility.

## Portability and backup restore

`GET /v1/export?type=keys|workspaces|memberships|projects|observations|claims`
returns one canonical NDJSON stream. Retain the five non-credential streams and
headers for a logical data migration. Headers declare format v4, source organization, scope,
deterministic dependency order, count, completion state, and the next opaque
cursor. Pages contain at most 2,000 records and are cut on UTF-8 byte length so
the complete response remains within the import request limit. Follow
`next_cursor` until it is `null`; IDs are stable pagination cursors, not a
change feed.

Claim pages are ordered by actual restore dependencies: replacement claims and
reflection premises/endpoints precede their dependents. A strongly connected
dependency component is never split. If the requested `limit` is too small,
export returns a content-free `400` with the minimum required limit; retry up to
2,000. A component above 2,000 records or the request byte boundary cannot use
logical export and requires an operator backup/restore path. A non-empty claim
cursor that is no longer eligible also returns a generic `400` instead of
restarting from page one. Evidence, supersession, and attached enrichment
provenance are revalidated before the cursor advances.

Ordinary export is principal-scoped: private records belong to the caller,
team records require active membership, workspace export includes only joined
workspaces, and membership export includes only the caller. `all=true` requires
the separate `export:all` scope, exports the whole authenticated organization,
and appends a metadata-only audit entry for each page. It never crosses the
organization derived from the API key.

Credential backup is deliberately explicit: `type=keys&all=true` additionally
requires `keys:manage` and `export:all`. It exports hashes and complete lifecycle
metadata, never the one-time raw bearer token. Protect this stream like a
database backup. Version 4 import requires `keys:manage`, restores the same
immutable window, monotonic last-use and revocation state, and is idempotent.

`POST /v1/import` preflights the complete request before mutation, accepts
canonical records independent of NDJSON line order, and writes in dependency
order. Workspaces and active memberships restore team authority before team
records; claims preserve source links and `superseded_by`. Missing parents
return `422 UNRESOLVED_REFERENCE` with only `record_type`, `field`, and
`dependency_type`; no foreign record or content is disclosed. Cross-organization
ID collisions fail closed, every request is atomic, and re-import is idempotent.
Generated claims carry their committed enrichment job, output hash, result
mapping, and claim links inline. Non-current generated claims and historical
LINK jobs remain portable when their cited evidence is still authorized; they
restore outside FTS/vector projections. LINK history is capped at 16 jobs per
deterministic export-owner claim so one canonical JSONL record cannot grow
without bound.
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

Logical JSONL is not a full deployment snapshot. Unless the separately guarded
credential stream is requested, it excludes API keys. It always excludes
encrypted integration bindings, checkpoints, leases, context runs and
feedback, audit/event/history rows, and rebuildable indexes or vectors. Use
`titen backup` for complete Bun/SQLite disaster recovery and a provider-native
database snapshot for Cloudflare rollback.
