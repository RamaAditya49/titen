# Multi-agent collaboration

The end-to-end Level 5/6 sequence is defined in the
[memory lifecycle protocol](./memory-lifecycle.md). This document expands the
collaboration-specific identity, visibility, coordination, and governance rules.
Host adapters, hooks, project resolution, signed events, and orchestrator
responsibilities are defined in the
[agent integration flow](./agent-integration.md).
Customer-facing distribution is governed by
[ADR-0002](../decisions/0002-channel-release-not-public-memory.md).

## Goal

Titen enables agents to share useful memory and coordinate bounded work while
preserving private context, perspective, policy, and auditability.

It is a collaboration memory layer, not an agent runtime.

## Identity model

Titen distinguishes:

- **actor:** identity performing an operation;
- **subject:** person, system, or entity the memory concerns;
- **observer:** identity whose perspective a claim represents;
- **agent:** software identity acting under a human/team policy;
- **service:** non-agent automation identity;
- **organization/workspace/project:** collaboration and policy scopes.

An agent receives its own revocable credential. Shared credentials are not a
substitute for membership.

## Collaboration modes

### Private agent memory

An agent can retain private observations and checkpoints that other agents do
not receive. Administrators do not automatically inject private content into
team context.

### Shared project memory

Verified decisions, artifacts, outcomes, and procedural guidance can be shared
within a project. Sharing is an explicit operation or authorized policy result,
not an automatic consequence of relevance.

### Organization memory

Company-wide policy, approved procedures, and stable reference facts can be
visible across workspaces. Organization visibility requires stronger write
authority than personal or episodic memory.

### Approved channel knowledge

An organization may serve reviewed knowledge through CRM, website, support, or
partner gateways. This is not a fourth visibility value and does not make the
source claim or evidence public. An authorized publisher creates a versioned
release snapshot for one channel/audience; an authorized gateway retrieves only
active releases for that scope.

`Verified` does not mean publishable. Release approval, redaction/localization,
validity, and revocation are independent of claim trust. Customer-specific
memory remains subject-scoped and cannot enter anonymous or other-customer
context.

### Authorized operator views

Memory Atlas may explain evidence, relationships, conflicts, freshness, scope
eligibility, and channel release state, but it is not a sharing mechanism. Its
v0.2 views include only records the operator may inspect. v0.3 Scope Preview
requires explicit preview authority and computes another principal's
eligibility without impersonating it or granting it access; Knowledge Release
inspection never exposes private source evidence to a release-only operator.
All views follow the [Memory Atlas architecture](./memory-atlas.md).

## Parallel work primitives

Titen provides only the state needed to prevent silent collisions:

- **checkpoint:** resumable progress;
- **lease:** expiring ownership of a bounded work item;
- **handoff:** explicit transfer with context and expected action;
- **outcome:** completion or failure linked to evidence;
- **idempotency key:** retry-safe mutation identity.

The caller still decides agent selection, scheduling, retries, and model loops.

## Orchestrator boundary

An orchestrator may receive a post-commit event, select an authorized/capable
agent, and start it with a handoff ID. The agent must still accept the handoff,
acquire the lease, and compile context under its own credential. Titen never
turns an event subscription into project membership.

Without a long-running orchestrator, agents list pending handoffs or poll the
metadata event cursor. Webhooks target explicit operator-managed gateways or
dispatchers, not model-generated destinations or ephemeral CLI sessions.

## Conflict handling

Titen distinguishes:

- conflicting facts from different sources;
- different observer opinions;
- decisions that intentionally replace earlier decisions;
- concurrent checkpoint updates;
- duplicate work attempts.

Behavior:

- facts remain disputed until evidence or authorized resolution exists;
- opinions stay observer-scoped;
- decisions use explicit supersession;
- checkpoint heads use one atomic scope upsert;
- leases reject or report active competing ownership.
- handoff resolution uses one durable uniqueness fence.

No LLM may silently declare consensus.

## Context compilation for teams

The compiler receives actor, role, task, scope, and token budget. It may include:

- shared claims visible to the actor;
- the actor's private memory;
- relevant checkpoints and handoffs;
- unresolved conflicts;
- organization procedures permitted for the task.

It must not include another agent's private memory merely because it is
semantically similar.

Channel context is a separate policy mode. It includes active approved release
snapshots plus, only for an authenticated customer, that server-resolved
customer's eligible memory after signed assertion validation. It excludes
unreleased internal claims, source evidence the audience cannot inspect, and
every other customer's memory.

## Audit

Audit events cover:

- observation/claim creation and status changes;
- visibility changes and shares;
- policy decisions and denied access;
- lease acquisition/release/expiry;
- checkpoint versions and handoff lifecycle;
- context compilation item IDs;
- feedback and authorized conflict resolution;
- channel/release creation, approval, activation, replacement, expiry,
  revocation, and context item IDs.

Audit events should identify records and actors without copying sensitive
content into logs.

## Enterprise governance

Enterprise capabilities are layered onto the same model:

- role and policy enforcement;
- retention and legal hold;
- approval requirements for procedural/organization memory;
- channel/audience policy and release approval for external knowledge serving;
- identity-provider mapping;
- audit export and data-residency controls;
- per-workspace or per-region storage placement.

SSO, SCIM, and policy language are integration boundaries, not mandatory kernel
dependencies.

## Signed federation event and canonical-memory exchange

The implemented default exchanges authorized signed event records between
Titen deployments. `include_memory=true` adds one explicit mode for active or
disputed organization-visible direct claims: the source hydrates the complete
authorized evidence graph, and the signed destination push imports it into
canonical SQL only under the destination principal's peer and import authority.
Private/team memory, incomplete evidence, and model-enrichment graphs are
rejected rather than widened or partially copied.

Event-exchange constraints:

- append events and advance per-scope cursors;
- assign a local monotonic event sequence while preserving public event-ID
  cursors;
- filter by source policy before transmission;
- preserve source node, actor, timestamps, and signatures/hashes;
- never replicate credentials;
- preserve conflicts instead of last-write-wins;
- allow a scope to stop sharing without corrupting local history.

Canonical-import constraints:

- require explicit claim filters on both peers plus source `export:read` and
  destination `import:write`; project creation additionally needs
  `projects:create`;
- bind one source organization to the destination peer on its first successful
  canonical import; the peer row and record trigger make that binding immutable
  and race-safe;
- bind every remote observation and claim identity to one immutable payload
  hash and deterministic local ID in `federated_records`;
- store canonical actors as the destination principal while retaining remote
  actor, source organization, timestamp, ID, and payload hash as provenance;
- rebuild FTS and optional vector work from canonical SQL, preserve disputed
  status and contradicting evidence, and use the normal context compiler;
- make exact or alternate-event replay idempotent and reject changed content
  under an existing remote identity; the same event ID must also resolve to the
  identical stored wrapper and canonical provenance graph;
- reject remote `policy_approved` observations and claims; only a local approval
  decision may promote the imported destination claim to that trust.

Do not choose CRDT or consensus algorithms until concrete offline/concurrent
mutation cases are measured.
