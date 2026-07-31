# Data model reference

Status: logical target schema. Current migrations implement the canonical
kernel, `index_outbox`, and delivery state; model-assisted `enrichment_jobs`,
their worker lease/fingerprint semantics, and vector `submitted/ready` states
remain proposed. Collaboration leases described below are implemented.

## Authority and precedence

The [PRD](../PRD.md) defines product intent, the [FRD](../FRD.md) defines
observable behavior, and the [memory model](../architecture/memory-model.md)
defines domain semantics. This document translates those contracts into a
portable SQL model for D1 and SQLite.

The earlier single `memories` table in the root research blueprint is not the
implementation contract. Titen now separates immutable observations, derived
claims, evidence links, compiled context, feedback, and execution state.

## Portability rules

- Use SQLite-compatible SQL in the shared migration path.
- Store timestamps as UTC integer milliseconds or one other representation
  selected once in P0; never mix units.
- External identifiers are opaque `TEXT` values. Their exact generator is a P0
  decision, but IDs must remain stable across export/import.
- JSON fields contain bounded, versioned objects and are validated at the API
  boundary.
- Booleans use checked integer values where SQLite requires it.
- Every tenant-owned lookup includes `organization_id`, even when the record ID
  is globally unique.
- Foreign keys are enabled in both runtimes and tested after migration.

## Relationship overview

```text
organization
├── principal ── api_key
├── workspace ── project ── project_reference
│                     └── membership ── principal
├── subject ── subject_reference
├── observation ──< claim_source >── claim ── claim_version
│        └────────────── record_event ───────────┘
│                                         └── context_item ── context_run
│                                                            └── feedback
├── tag ── record_tag ── observation / claim / checkpoint
├── channel ── knowledge_release ── claim_version
├── checkpoint ── checkpoint_version ── lease
│                └── handoff
├── idempotency_record
├── vector_outbox
├── event_outbox ── webhook_delivery
├── webhook_subscription
└── audit_event
```

P0 may provision a minimal project and project reference for deterministic
agent scoping. Workspace membership, leases, handoffs, audit, tags, subject
aliases, and webhook delivery activate in their roadmap release. Their future
tables must not be required for an unscoped personal P0 kernel path.
Channels and knowledge releases activate in v0.3 and likewise do not burden the
Level 5/v0.2 path.

Memory Atlas adds no canonical entity or graph table. Its v0.2/v0.3 views are
read-only projections over the entities below.

## Common columns

Tenant-owned records use these concepts where applicable:

| Column            | Meaning                                               |
| ----------------- | ----------------------------------------------------- |
| `id`              | stable opaque record identifier                       |
| `organization_id` | mandatory canonical tenant boundary                   |
| `created_at`      | record creation time                                  |
| `created_by`      | principal that caused the record                      |
| `version`         | monotonic version for mutable lifecycle/state records |
| `metadata_json`   | bounded non-authoritative metadata object             |

`subject_id`, `agent_id`, and `run_id` are domain scope dimensions. They do not
replace `organization_id`, and a request body never grants authority to them.

## Foundation and identity

### `organizations`

The top-level isolation boundary, including personal mode's internal singleton
organization.

Required fields: `id`, `name`, `status`, `created_at`, and `disabled_at`.
Disabling an organization blocks operations without deleting evidence.

### `principals`

Human, agent, service, administrator, and auditor identities.

Required fields: `id`, `organization_id`, `type`, `label`, `status`,
`created_at`, and `disabled_at`. An agent and the human authorizing it remain
distinct principals.

P0 may expose only the subset required for scoped credentials. The table must
still avoid encoding a shared key as an identity.

### `api_keys`

Credential metadata; never the raw secret.

Required fields: `id`, `organization_id`, `principal_id`, `label`,
`secret_hash`, bounded capability/scope data, `created_at`, `last_used_at`,
`expires_at`, and `revoked_at`.

Rules:

- raw key material is displayed once and never stored;
- key listings exclude hashes and secrets;
- rotation creates a new record and may keep the prior key valid only for an
  explicit bounded overlap;
- revocation is checked on every request.

### `subjects` and `subject_references`

`subjects` identify who or what memory is about without treating the author,
project, and visibility as one ambiguous owner. Initial types are `human`,
`agent`, `service`, `organization`, `repository`, `artifact`, `system`, and
`concept`.

Required subject fields are `id`, `organization_id`, `type`, bounded display
label, status, creation actor, and timestamps. Optional
`subject_references` map an authorized namespaced external reference or alias to
one subject. Automatic entity similarity may propose a link but never merges
subjects.

P0 may use pre-provisioned opaque subject IDs without enabling alias management.

### `workspaces`, `projects`, `project_references`, and `memberships`

A minimal project record may be provisioned in P0 because observations and
context can already be project-scoped. Workspaces belong to organizations;
projects belong to a workspace when that layer is enabled. Memberships, added
for v0.2, connect principals to the narrowest useful scope with capabilities.
Removing membership prevents new access but does not erase record provenance.

`project_references` map an organization-scoped normalized source and value to
one project. For Git-hosted repositories the preferred portable value is
lowercase `owner/repo`. The mapping stores no credential-bearing URL or local
absolute path. Resolving a reference never creates membership; creating a
missing project requires an explicit capability.

## Evidence and memory

### `observations`

Append-only evidence received or verified by Titen.

| Field group | Required semantics                                                                 |
| ----------- | ---------------------------------------------------------------------------------- |
| identity    | `id`, `organization_id`, `actor_id`                                                |
| scope       | `workspace_id`, `project_id`, `subject_id`, optional `agent_id`, optional `run_id` |
| evidence    | `kind`, `content`, `content_hash`, `source_type`, `source_ref`                     |
| trust       | `trust`, `visibility`                                                              |
| time        | `occurred_at`, `ingested_at`, `created_at`                                         |
| lifecycle   | append-only creation metadata; no content update path                              |

Initial kinds: `user_statement`, `tool_result`, `imported_source`, `decision`,
and `system_event`.

Initial trust values: `unverified`, `asserted`, `verified`, and
`policy_approved`. Only authorized principals may select the latter two.

Equal content is not automatically the same event. Idempotency is determined by
the mutation key and normalized payload, not text similarity.

### `claims`

Current identity and lifecycle head for a compact, temporal, disputable memory.

Required fields:

- `id`, `organization_id`, and the same eligible scope dimensions as evidence;
- optional `observer_id` and required `subject_id`;
- `kind`, `content`, `confidence`, `trust`, and `visibility`;
- `valid_from`, optional `valid_to`, `status`, and current `version`;
- `created_at`, `created_by`, and latest lifecycle time;
- nullable derivation method and pipeline fingerprint for generated claims;
  provider/model/prompt/schema metadata is recorded without raw prompt/output.

Kinds: `semantic_fact`, `episodic_event`, `preference`,
`procedural`, `decision`, and `relationship`.

Statuses: `active`, `disputed`, `superseded`, `expired`, and `revoked`.

### `claim_sources`

Append-only many-to-many evidence links.

Required fields: `claim_id`, `claim_version`, `observation_id`, `relation`,
`created_at`, and `created_by`. Relation is `supports`, `contradicts`, or
`qualifies`.

The write path verifies that the caller may access both records and that the
observation belongs to the same organization. Ordinary claims require at least
one source.

### `claim_versions`

Append-only snapshots of claim lifecycle changes. Each row records claim ID,
monotonic version, content/lifecycle fields, transition reason, evidence or
policy authority reference, actor, and time.

Updating the `claims` head and appending its version occur in one transaction.
Observation content is never copied into version history.

### `record_events`

Append-only domain history for canonical creation and lifecycle transitions.
Required fields: `id`, `organization_id`, record type/ID, record version, event
type, actor, bounded reason/authority reference, request ID, and `created_at`.

This is not the access-oriented enterprise audit log. It exists from P0 so an
observation creation or claim transition remains traceable even before the v0.2
audit API ships. Sensitive content is referenced by canonical ID rather than
duplicated into the event.

### `tags` and `record_tags`

Added only when tag filtering enters an accepted feature slice. `tags` stores a
bounded, normalized organization-local namespace/value, display label, status,
and creation provenance. `record_tags` links an authorized observation, claim,
or checkpoint to a tag and records whether the link was caller-supplied,
deterministic, model-proposed, or approved.

Tags are navigation/ranking metadata. They never grant scope, visibility,
trust, or lifecycle status. A model-proposed tag is not activated until it
passes the configured validator. Category, trust, visibility, and status remain
typed columns rather than magic tags.

## Governed external channel knowledge

These v0.3 entities implement
[ADR-0002](../decisions/0002-channel-release-not-public-memory.md). They do
not add `public` to canonical memory visibility.

### `channels`

An operator-managed CRM, website, support, or partner serving boundary.

Required fields: `id`, `organization_id`, bounded `name`, `status`, allowed
audience configuration, optional locale/product defaults, optional external
customer-assertion policy/key reference, `created_by`, `created_at`, and
lifecycle timestamps. Gateway access is authorized through principal
capabilities/policy rather than a shared channel secret stored in this row.

Initial audiences are `anonymous`, `authenticated_customer`, and `partner`.
Channel status can prevent all new context without deleting releases.

### `knowledge_releases`

A canonical, immutable-content snapshot approved for one channel/audience.

Required fields:

- `id`, `organization_id`, `channel_id`, and `audience`;
- source `claim_id` plus exact `claim_version` and source content hash;
- bounded `released_content` and released-content hash;
- optional locale/product metadata and released citation metadata;
- minimum-trust/policy reference, `approved_by`, bounded approval reason, and
  approval time;
- `status`, monotonic lifecycle version, `valid_from`, optional `valid_to`,
  activation, replacement, expiry, and revocation metadata;
- creation actor and timestamps.

Release content is not updated in place. Redaction, localization, source-claim
change, or correction creates a new release row and may replace the old one.
Statuses are `draft`, `approved`, `active`, `suspended`, `replaced`, `expired`,
and `revoked`. Only `active`, currently valid rows whose exact source claim
version remains current, active, and undisputed are channel-eligible. Eligibility
uses the canonical join even before maintenance records `suspended`.

Evidence trust and release approval remain independent. Model output, tags,
similarity, feedback, or `verified` trust cannot activate a release. A release
may expose only citation metadata authorized for its audience, not private
source evidence.

## Context and learning

### `context_runs`

Metadata for one compiled context pack.

Required fields: `id`, `organization_id`, `actor_id`, authorized scope
references, a bounded task/query hash or redacted summary, policy snapshot
reference, requested/used token budget, degraded capability metadata,
`created_at`, and optional expiry.

Raw prompts are not stored by default.

### `context_items`

The ordered selection manifest for a context run.

Required fields: `context_run_id`, position, `claim_id`, selected claim version,
score components, token estimate, conflict-group reference when applicable, and
created time.

This table records why a claim was selected without duplicating its content.

### `feedback`

An idempotent signal attached to a context run or selected item.

Required fields: `id`, `organization_id`, `context_run_id`, optional
`context_item_id`, `actor_id`, label, bounded reason/metadata, idempotency key,
and `created_at`.

Labels: `used`, `useful`, `irrelevant`, `incorrect`, and `harmful`. Feedback may
influence bounded utility ranking after a defined threshold; it never mutates
evidence, trust, visibility, or authorization.

## Execution and collaboration state

### `checkpoints`

The implemented v0.2 table stores one bounded current head for each
organization, subject, agent, and kind, with optional run ID, state hash, TTL,
expiry, creation time, and update time. A unique scope index plus one SQL upsert
prevents duplicate heads. There is no shipped `checkpoint_versions` table yet.

An unexpired head is private to its agent unless a pending or accepted handoff
references that exact checkpoint for its intended recipient. Expired heads are
not readable through the API.

### `leases`

The implemented v0.2 table stores organization, resource type and ID, holder,
purpose, TTL, expiry, creation time, and optional release time. A partial unique
index permits at most one unreleased row per organization/resource pair;
acquisition, expiry reclaim, and same-holder renewal are atomic.

Unreleased rows are listed through a bounded organization-scoped cursor. An
active organization-level `owner` or `admin` membership may force-release a
lease; no new administrator model is inferred from an API key label.

### `handoffs`

The implemented v0.2 table stores organization, sender, intended principal,
subject, optional context/checkpoint references, optional message, status, and
lifecycle timestamps. Context and checkpoint references use composite
organization-safe foreign keys and API preflight also verifies ownership,
subject, expiry, and sender/recipient visibility.

Statuses are `pending`, `accepted`, `rejected`, and the reserved `expired`.
`handoff_resolutions` supplies one unique fence per handoff so only one
concurrent acceptance/rejection and its event can commit.

## Derived projections and reliability

### FTS tables

FTS indexes claim and/or observation search text according to the P0 retrieval
experiment. v0.3 adds a logically separate release FTS corpus keyed by channel,
audience, release ID, and version. FTS rows are updated in the same canonical
transaction as their source row. Search results always hydrate and re-authorize
canonical records.

### Vector projection

The vector backend stores only opaque canonical IDs, minimum hashed/indexed
scope metadata, record version, kind, and embedding. It stores no canonical
content or user-supplied metadata.

Release vectors use release IDs/versions and minimum channel/audience metadata,
not source claim IDs that a gateway could hydrate directly. Customer-private
memory is never copied into the release vector corpus.

Embedding provider, model, immutable revision when available, dimensions,
metric, and normalization form a fingerprint. Padding or truncating a mismatched
vector is prohibited.

### Memory Atlas projections

Memory Atlas compiles bounded views from existing canonical relationships:
observations, claim sources/versions, context items, feedback, checkpoints,
leases, handoffs, releases, and authorized audit metadata. Nodes, edges,
clusters, layouts, summaries, and counts are not stored as canonical memory.

An optional cache may store only a short-lived rebuildable result keyed by
organization, authenticated principal, policy snapshot, lens, focus, canonical
versions, and configured limits. Entries are never reused across principals or
policy snapshots. Every cache/index hit is canonically hydrated and
re-authorized, including both endpoints of an edge, before response assembly.
Cache failure falls back to a bounded canonical compile or an explicit
unavailable/degraded response; it never widens scope.

### Target: `enrichment_jobs`

Durable optional derivation/reflection work. Required fields include
organization and authorized scope, work kind, bounded source/premise IDs and
versions, pipeline fingerprint, status, lease token and expiry, attempts, next
attempt, bounded error class, bounded input/output hashes, committed result row
IDs, and timestamps.

The lanes have separate creation and idempotency contracts:

- a derivation job is inserted in the same transaction as its eligible
  canonical observation and is unique over work kind, observation ID/version,
  and pipeline fingerprint;
- a reflection scheduler reads a bounded authorized snapshot, then inserts the
  job in its own transaction. Its identity is unique over work kind, the
  snapshot fingerprint derived from ordered premise IDs/immutable versions and
  the policy-snapshot fingerprint, and the pipeline fingerprint. It is not part
  of an unrelated canonical mutation.

Network calls happen outside a SQL transaction. The model proposal exists only
in worker memory. A successful validator commits ADD-only
claim/source/history/link/index work, records the output hash and committed
result row IDs, and marks the job `done` in one transaction. Neither raw nor
normalized proposal payload is persisted. Unsafe or malformed output makes no
semantic write.

This table is not implemented. The current `index_outbox` only schedules vector
indexing; observation rows do not imply extraction work.

### Target vector outbox contract

A durable repair record written in the same transaction as the canonical
mutation. Required fields: record type/ID, operation, target version, embedding
fingerprint, attempts, next attempt, bounded error class, mutation ID, and
updated time.

An outbox row is complete only when the derived index matches the target
canonical version or the deletion is confirmed.

The current physical `index_outbox` has a smaller `pending/done/failed` shape
and marks an accepted upsert complete. It must not be presented as the target
leased/fingerprinted readiness contract until a migration and parity tests ship.

### `event_outbox`

Durable delivery work referencing the canonical metadata-only `record_events`
row written for a subscribed state transition. It is not a second domain
history. Required fields: event/record-event ID, organization/scope, delivery
class, target version, attempts, next attempt, bounded error class, and creation
and update times.

The referenced event does not copy memory content. Appending eligible delivery
work is part of the canonical transaction; delivering it is asynchronous and
cannot roll back the accepted mutation.

### `webhook_subscriptions` and `webhook_deliveries`

Added with v0.2 event delivery. A subscription binds an explicit allowlisted
HTTPS destination and event-type filter to an authorized organization,
workspace, or project scope; v0.3 may bind it to a channel. It stores encrypted
signing material or an external key reference plus rotation metadata—never
plaintext or a hash-only value that cannot sign—along with status, timeout, and
lifecycle timestamps.

Each delivery records event/subscription IDs, attempt number, next attempt,
bounded result/error class, HTTP status when safe, request timestamp, response
timestamp, and terminal state. The event ID is the receiver idempotency key.
Retries use bounded jittered backoff; terminal failure remains inspectable and
does not mutate the source record.

### `idempotency_records`

Maps organization, actor, operation, and idempotency key to a normalized request
hash plus stable response reference. The implemented primary scope is
organization, principal, and key hash, so key rotation preserves a retry while
another principal stays isolated. The credential `key_id` that first committed
the record remains as audit metadata. Reusing the key with another route or
payload is a conflict, not a second mutation.

### `event_order`

Public event IDs remain stable UUID-based replay keys. A local autoincrementing
sequence is assigned by an insert trigger and drives event and federation
paging. Pre-migration equal-timestamp events are backfilled deterministically by
timestamp and ID; every event committed after migration follows database write
order even when timestamps are identical.

### `schema_meta`

Stores migration/export versions and, when implemented, separate embedding and
extraction pipeline fingerprints. Current `/readyz` fails on an incompatible
migration. The proposed extension also fails semantic readiness on an enabled
vector fingerprint mismatch and reports extraction degradation independently
from semantic retrieval.

### `audit_events`

Added in v0.2. Metadata only: actor, action, resource type and opaque ID, scope,
result, policy reference, request ID, and timestamp. It never copies content,
prompts, embeddings, credential material, or full private identifiers.

## State transitions

```text
claim:      active ──> disputed ──> active
               ├────> superseded
               ├────> expired
               └────> revoked

checkpoint: open ──> in_progress ──> completed
               ├──> blocked
               └──> cancelled / expired

handoff:    offered ──> accepted ──> completed
               ├─────> declined
               └─────> cancelled

lease:      active ──> renewed ──> completed / released / expired

release:    draft ──> approved ──> active ──> suspended / replaced / expired / revoked
                                      suspended ──> approved / replaced / revoked
```

Every transition checks authority and expected version, appends history/audit
where required, and invalidates affected projections. No transition deletes its
supporting observation.

## Transaction boundaries

One canonical transaction contains:

- observation plus its record event, FTS, index/event outbox, and optional
  derivation job;
- claim head plus version and validated source links;
- claim lifecycle head plus new version and projection invalidation;
- checkpoint head plus version;
- lease acquisition/renewal/release;
- knowledge release creation/activation/replacement/revocation plus release FTS
  and projection/event invalidation;
- domain event outbox rows for subscribed state transitions;
- idempotency result associated with the mutation.

Reflection snapshot selection and job insertion use a separate idempotent
scheduler transaction; an arbitrary canonical mutation does not imply a
reflection job.

Model, remote vector, and webhook calls do not hold a SQL transaction open. A
canonical commit may return with explicit semantic degradation and repairable
outbox work.

## Deletion, retention, and legal hold

- API deletion/revocation removes retrieval eligibility before projection
  cleanup completes.
- Evidence history is not autonomously deleted.
- Expiry and retrieval eligibility are separate from physical purge.
- Portable JSONL v2 contains workspaces, active memberships, projects,
  observations, and claims with their evidence links and supersession pointers.
  This is the canonical memory/team migration surface, not a physical backup.
- Portable JSONL excludes credentials, secrets, external integration bindings,
  checkpoints, leases, handoffs, context runs and feedback, audit/event/history
  rows, index outboxes, FTS projections, vectors, and Memory Atlas derived data.
  Rebuildable views are regenerated; use a database snapshot when excluded
  operational or learning state must survive disaster recovery.
- Proposed channel/release portability must keep imported releases suspended
  until destination gateway, policy, and customer-assertion key references are
  explicitly rebound and verified.
- Legal hold and physical purge arrive with v0.3 policy; their migration must
  preserve existing tombstones and provenance.
- Revoking or expiring a release removes channel eligibility before derived
  cache/vector cleanup and preserves the released snapshot/history.

## Required and proposed indexes

Exact names wait for their migrations. Existing tables and each proposed table
when it ships must cover:

- organization plus subject/project/agent/run scope and recency;
- active claim eligibility by scope, visibility, status, and validity;
- claim-source lookup in both directions;
- context run/item and feedback lookup;
- credential hash/status lookup;
- vector outbox due work;
- **proposed with `enrichment_jobs`:** organization/status/next-attempt/lease
  due-work lookup;
- **proposed with `enrichment_jobs`:** unique derivation identity and unique
  reflection snapshot identity as defined above;
- project reference uniqueness within an organization/source namespace;
- normalized tag uniqueness and record-tag lookup;
- event outbox and webhook delivery due work;
- channel/audience/status/validity release eligibility and source claim-version
  lookup;
- unique idempotency key within actor/operation scope.

Memory Atlas does not justify a P0 index. Its implementation may add the
smallest targeted composite indexes only after the authorized fixture and query
plans expose a measured need. Every by-ID query still includes
`organization_id`; an index is not an authorization control.

## Target decisions still open

- exact ID generator and timestamp representation;
- whether FTS indexes claims only or both claims and observations;
- whether embedding BLOBs are retained in canonical SQL to avoid re-embedding;
- normalized hashing rules for work keys and content;
- project-reference normalization for self-hosted and non-Git sources;
- subject-reference namespaces and alias collision behavior;
- tag count/length bounds when tag filtering activates;
- webhook signing-key encryption/reference, retry, redirect, and DNS-rebinding
  policy before v0.2 delivery migrations;
- bounded JSON sizes per record type;
- retention duration for context runs and idempotency responses.

Resolve these through the dual-runtime spike and record expensive-to-reverse
choices as ADRs before publishing migration `0001`.
