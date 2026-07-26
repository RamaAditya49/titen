# Memory model

## Core distinction

Titen separates evidence, derived knowledge, and execution state.

```text
Observation (immutable evidence)
        |
        v
Claim (derived, temporal, disputable) ---- Claim source
        |
        v
Context run (bounded selection) ---------- Feedback

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

- `private`: only the owning human/agent identity and explicitly authorized
  administrators;
- `team`: members of the selected workspace/project according to policy;
- `organization`: organization-wide readers according to policy.

Public/internet visibility is not a core memory mode.

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
