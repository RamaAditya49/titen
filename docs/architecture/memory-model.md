# Memory model

The corresponding logical SQL entities, transaction boundaries, and open P0
storage decisions are defined in the [data model reference](../reference/data-model.md).
The complete evidence-to-context flow and embedding/vector decision are defined
in the [memory lifecycle protocol](./memory-lifecycle.md).
Agent attribution, project resolution, tags, hooks, and orchestration are
defined in the [agent integration flow](./agent-integration.md).

## Core distinction

Titen separates evidence, derived knowledge, and execution state.

```text
Observation (immutable evidence)
        |
        v
Claim (derived, temporal, disputable) ---- Claim source
        |
        |-------------------------------> Knowledge release
        v                                      |
Context run (bounded selection) ---------- Feedback
                                               |
                                               v
                                      Channel context

Checkpoint / lease / handoff (execution state, separate lifecycle)
```

## Observation

An observation records something received or verified.

Required semantics:

- `id`, `organization_id`, and scope;
- `actor_id`, `subject_id`, optional `agent_id` and `run_id`;
- kind: user statement, tool result, imported source, decision, or system event;
- content and content hash;
- source type/reference;
- `occurred_at` and `ingested_at`;
- trust: unverified, asserted, verified, or policy-approved;
- visibility;
- append-only creation metadata.

Observations are never instructions merely because they are stored.

## Claim

A claim is a compact memory derived from observations or supplied explicitly by
an authorized caller.

Claim kinds begin with:

- semantic fact;
- episodic event;
- preference;
- procedural guidance;
- decision;
- relationship.

Every claim carries:

- confidence and trust;
- `valid_from` and optional `valid_to`;
- creation time and version;
- status: active, disputed, superseded, expired, or revoked;
- observer and subject when perspective matters;
- one or more claim-source links.

Contradictory claims are not automatically merged. A resolution creates an
auditable status transition and cites evidence or policy authority.

## Claim source

The claim-source join records whether an observation supports, contradicts, or
qualifies a claim. Context items expose these links so callers can inspect the
evidence instead of trusting a generated summary.

## Checkpoint

A checkpoint records resumable work, not durable truth.

It includes:

- owner/actor and work-item scope;
- status and version;
- bounded state payload;
- TTL and last activity;
- optional result observation IDs.

Completed findings become observations before they can support claims.

## Lease

A lease is an expiring claim to a bounded work item. Acquisition is idempotent
for the same actor and operation key. Expiration makes the work available again;
it does not delete checkpoint history.

## Handoff

A handoff transfers responsibility with:

- sender and intended recipient/team;
- checkpoint and evidence references;
- expected next action;
- acceptance/decline status;
- timestamps and audit actor.

## Context run

A context run records the query/task, actor, policy snapshot reference, token
budget, selected claim IDs, score components, conflicts, and creation time.
Raw prompts are not stored by default.

Context ranking may consider:

- hard scope and visibility eligibility;
- lexical and semantic relevance;
- trust and confidence;
- temporal validity and recency;
- previous usefulness feedback;
- diversity and conflict coverage;
- checkpoint relevance.

No score can bypass authorization.

## Feedback

Feedback links an actor and downstream outcome to a context run or item.
Supported initial labels are used, useful, irrelevant, incorrect, and harmful.
Feedback changes utility projections, not observations.

## Memory Atlas projection

Memory Atlas does not add a memory type. It visualizes authorized relationships
already represented by observations, claim sources and versions, context items,
feedback, checkpoints, handoffs, releases, and audit metadata. Its nodes,
edges, clusters, layout, summaries, and counts are rebuildable projections and
never evidence, claims, trust, visibility, or release authority.

Every compiled view is bounded and principal-specific. Candidate discovery may
use an index, but canonical hydration rechecks lifecycle, version, visibility,
and release state and authorizes both endpoints of each edge. Hidden records do
not contribute labels, topology, or aggregate counts. See the
[Memory Atlas architecture](./memory-atlas.md).

## Knowledge release

A knowledge release is a versioned, externally serveable snapshot of one exact
claim version. It is separate from the claim because evidence authority,
internal access, and external disclosure answer different questions.

A release carries:

- organization, channel, and audience;
- source claim ID and exact claim version;
- bounded approved content, which may be redacted or localized;
- approval actor/reason and minimum-trust policy result;
- status: draft, approved, active, suspended, replaced, expired, or revoked;
- validity, creation, activation, and revocation times.

Initial audiences are `anonymous`, `authenticated_customer`, and `partner`.
The release snapshot never changes when its source claim changes. A new claim
version requires a new review/release, preserving what each audience was
actually allowed to receive.

An active release is eligible only while that exact claim version remains the
current active, undisputed source. Version change, dispute, supersession,
expiry, or revocation denies it immediately and requires review before any
reactivation; recording `suspended` may happen after the denial.

## Attribution and classification

Titen does not use one ambiguous memory-owner field. Organization, workspace,
project, subject, actor, observer, agent, run, and visibility remain separate
dimensions. Authentication supplies actor/tenant authority; explicit validated
scope says where memory applies; `subject_id` says who or what it is about.

Observation kind, claim kind, trust, lifecycle, visibility, and validity are
typed fields. Tags are optional bounded navigation/ranking labels and cannot
grant access or trust. A subject is a canonical entity reference; evidence-
backed relationship claims connect subjects without requiring a graph database.

External distribution is a third axis. `verified` describes evidence authority,
`visibility` describes internal retrieval, and a `knowledge_release` describes
what one external channel/audience may receive. None implies another.

## Scope hierarchy

```text
organization
└── workspace
    └── project
        ├── subject
        ├── agent
        └── run
```

Not every deployment needs every level. Personal mode can use one organization
and workspace internally while exposing a simpler API.

## Visibility

- `private`: only the principal(s) explicitly bound by private-scope policy and
  explicitly authorized administrators; actor or subject alone does not grant
  access;
- `team`: members of the selected workspace/project according to policy;
- `organization`: organization-wide readers according to policy.

Public/internet visibility is not a canonical memory mode. Anonymous or
customer-facing distribution uses a separately approved
[channel knowledge release](../decisions/0002-channel-release-not-public-memory.md).

## Channel context

A public-facing user talks to an application gateway, not Titen. The gateway
authenticates as a scoped service principal and requests context for its fixed
channel and audience. Titen retrieves only active release snapshots and exposes
only released citations/provenance.

For an authenticated customer, the gateway resolves the customer's external
identity through a short-lived signed customer assertion. Titen validates its
configured issuer, signature, channel/audience, expiry, and replay value before
resolving an authorized `subject_id`. Customer-specific memory is compiled
separately and can be used for that interaction, but it is never copied into
anonymous/partner release indexes. An anonymous request cannot select a subject
ID.

## Temporal rules

- `occurred_at` describes the source event.
- `ingested_at` describes when Titen learned it.
- `valid_from`/`valid_to` describe when a claim applies.
- `created_at`/version describe the derived record history.

These timestamps must not be collapsed into one generic date.

## Storage invariants

1. SQL rows are canonical.
2. History and source links are append-only.
3. Vector payloads contain opaque IDs and minimal indexed scope metadata.
4. Deleted/revoked canonical rows cannot be revived by stale vector hits.
5. Embedding model, dimensions, metric, and normalization form a fingerprint.
6. Export excludes credentials and vectors by default.
7. Release indexes and caches are projections; active canonical release rows
   decide channel eligibility on every hydration.
8. Memory Atlas projections and caches are principal/policy scoped,
   non-canonical, and safe to discard or rebuild.
