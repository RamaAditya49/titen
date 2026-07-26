# Multi-agent collaboration

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

## Parallel work primitives

Titen provides only the state needed to prevent silent collisions:

- **checkpoint:** resumable progress;
- **lease:** expiring ownership of a bounded work item;
- **handoff:** explicit transfer with context and expected action;
- **outcome:** completion or failure linked to evidence;
- **idempotency key:** retry-safe mutation identity.

The caller still decides agent selection, scheduling, retries, and model loops.

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
- checkpoints use version checks;
- leases reject or report active competing ownership.

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

## Audit

Audit events cover:

- observation/claim creation and status changes;
- visibility changes and shares;
- policy decisions and denied access;
- lease acquisition/release/expiry;
- checkpoint versions and handoff lifecycle;
- context compilation item IDs;
- feedback and authorized conflict resolution.

Audit events should identify records and actors without copying sensitive
content into logs.

## Enterprise governance

Enterprise capabilities are layered onto the same model:

- role and policy enforcement;
- retention and legal hold;
- approval requirements for procedural/organization memory;
- identity-provider mapping;
- audit export and data-residency controls;
- per-workspace or per-region storage placement.

SSO, SCIM, and policy language are integration boundaries, not mandatory kernel
dependencies.

## Federation

Federation synchronizes authorized events between Titen deployments. It is
required only when one deployment cannot satisfy ownership, region, or network
boundaries.

Initial constraints:

- append events and advance per-scope cursors;
- filter by source policy before transmission;
- preserve source node, actor, timestamps, and signatures/hashes;
- never replicate credentials;
- preserve conflicts instead of last-write-wins;
- allow a scope to stop sharing without corrupting local history.

Do not choose CRDT or consensus algorithms until concrete offline/concurrent
mutation cases are measured.
