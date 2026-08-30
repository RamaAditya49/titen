# Requirements and delivery workflow

Titen uses the
[EARS pattern](https://alistairmavin.com/ears/)
to make complex requirements specific, reviewable, and testable. EARS means
_Easy Approach to Requirements Syntax_. It is a sentence discipline, not a new
project-management framework.

Every change follows one lifecycle:

```text
spec -> plan -> implement -> done
```

The lifecycle may be recorded inline for a simple change. Complex work requires
durable, paired Markdown artifacts.

## What counts as complex

Treat work as complex when any of these apply:

- it changes a public API, data model, storage format, migration, or compatibility
  promise;
- it affects authentication, authorization, tenant scope, privacy, retention,
  release approval, or another security boundary;
- it crosses Cloudflare and Bun/VPS runtimes or depends on an external service;
- it introduces concurrency, idempotency, retries, recovery, destructive
  operations, or possible data loss;
- it introduces a dependency, service, provider, or durable architecture choice;
- it claims a performance, quality, cost, or reliability threshold;
- it spans multiple product features or cannot be safely rolled back as one
  isolated change.

If classification is uncertain, treat the work as complex. A typo, wording-only
correction, mechanical formatting change, or isolated low-risk test may use the
simple path.

## The five EARS patterns

Use one observable behavior per criterion. Give every criterion a stable ID.

| Pattern           | Titen syntax                                                 | Use when                                 |
| ----------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Ubiquitous        | `Titen shall <response>.`                                    | the rule always applies                  |
| Event-driven      | `When <event>, Titen shall <response>.`                      | an event triggers behavior               |
| State-driven      | `While <state>, Titen shall <response>.`                     | behavior depends on a current state      |
| Optional feature  | `Where <feature is enabled>, Titen shall <response>.`        | behavior exists only with an option      |
| Unwanted behavior | `If <failure>, then Titen shall <response or safe failure>.` | an error or unsafe condition must be met |

### Indonesian EARS syntax

Use the Indonesian syntax when the work item requires Indonesian text. Keep the
English pattern name because the checker and evidence map use it as an ID.

| Pattern | Indonesian syntax |
| --- | --- |
| Ubiquitous | `Titen harus <respons>.` |
| Event-driven | `Saat <peristiwa>, Titen harus <respons>.` |
| State-driven | `Selama <keadaan>, Titen harus <respons>.` |
| Optional feature | `Jika <fitur tersedia>, Titen harus <respons>.` |
| Unwanted behavior | `Jika <kegagalan>, maka Titen harus <respons aman>.` |

Use active sentences. Use one observable behavior in each criterion. Use one
consistent term for each item or action.

An acceptable criterion identifies the trigger or state when relevant, the
observable response, and a measurable boundary or authoritative reference.
Words such as "fast", "secure", "easy", "stable", or "correct" are invalid
unless the spec defines how they are verified.

For each complex feature, cover the applicable normal, authorization, failure,
degraded, recovery, compatibility, and runtime-parity paths. Do not force all
five patterns when a pattern has no real scenario.

Example:

```markdown
- **AC-CTX-001 — Event-driven:** When an authorized actor requests a context
  pack with a 900-token budget, Titen shall return an authorized pack that does
  not exceed 900 tokens.
- **AC-CTX-002 — Unwanted behavior:** If vector retrieval is unavailable, then
  Titen shall compile context from authorized SQL/FTS candidates and shall mark
  semantic retrieval as degraded.
```

## Requirement layers

- `docs/PRD.md` defines product intent and scope.
- `docs/FRD.md` defines the feature baseline and release gates.
- `docs/specs/` defines an executable slice of complex work using EARS.
- `docs/plans/` maps that exact slice to implementation and evidence.

PRD and FRD entries are not proof that work started or finished. Before a
complex FRD feature enters implementation, its work spec must reference the
relevant requirement IDs and normalize the selected behavior into EARS
criteria. Historical research and blueprints never count as executable specs.

## Lifecycle

### 1. Spec

Create `docs/specs/active/<work-slug>.md` before implementation. It must contain:

- front matter with `work_id`, `status`, `stage`, `outcome`, `complexity`,
  `created`, `updated`, `review_after`, and `owner`;
- the problem, in-scope and out-of-scope behavior, constraints, and risks;
- uniquely identified EARS acceptance criteria;
- explicit done conditions.

An active artifact must be reviewed at least every 14 days. Set `review_after`
no later than 14 calendar days after `updated`.

### 2. Plan

Before implementation, create the same filename under `docs/plans/active/`.
The plan must reference the spec and contain:

- ordered, bounded steps;
- a mapping from every acceptance ID to planned verification evidence;
- test, security, migration, deployment, smoke, and rollback work when
  applicable;
- the same workflow state metadata as the spec.

A plan cannot exist without its spec. If the plan exposes an unclear or missing
requirement, update the spec first.

### 3. Implement

Work only inside the approved spec. When scope or expected behavior changes:

1. update the EARS criterion;
2. update the mapped plan and risk/rollback notes;
3. continue implementation.

Do not hide deferred scope behind an unchecked item. Give it a new work ID and
a new lifecycle.

### 4. Done

For completed work:

- every acceptance criterion has passing, reproducible evidence;
- required tests, docs, compatibility checks, deploy, and runtime smoke are
  recorded, or explicitly marked not applicable with a reason;
- no plan checkbox remains open;
- spec and plan use `status: done`, `stage: done`, and
  `outcome: completed`;
- both files move to their matching `done/` paths in the same change.

For cancelled or superseded work, move both artifacts to `done/` with
`outcome: cancelled` or `outcome: superseded` and a concrete `Closure reason`.
Terminal closure is not product completion, but it prevents abandoned active
plans from pretending to be current work.

## Front-matter contract

Active pair:

```yaml
---
work_id: stable-work-id
status: active
stage: plan # spec, plan, or implement
outcome: pending
complexity: complex
created: YYYY-MM-DD
updated: YYYY-MM-DD
review_after: YYYY-MM-DD
owner: maintainer-or-team
spec: docs/specs/active/YYYY-MM-DD-work-slug.md # plan only
---
```

Done pair:

```yaml
---
work_id: stable-work-id
status: done
stage: done
outcome: completed # completed, cancelled, or superseded
complexity: complex
created: YYYY-MM-DD
updated: YYYY-MM-DD
owner: maintainer-or-team
spec: docs/specs/done/YYYY-MM-DD-work-slug.md # plan only
---
```

## Simple path

A simple change still follows all four stages, but its issue or pull request may
hold the artifacts inline:

1. **Spec:** one concrete expected outcome;
2. **Plan:** the smallest steps and verification;
3. **Implement:** the bounded change;
4. **Done:** verification evidence and no unchecked work.

If the work becomes complex, stop and create durable active artifacts before
continuing.

## Repository check

Run:

```bash
node scripts/check-workflow-docs.mjs
node scripts/check-workflow-docs.mjs --self-test
```

The check rejects invalid metadata, mismatched pairs, missing or malformed EARS
criteria, plans without specs, overdue active work, incomplete completed plans,
missing evidence mappings, and unresolved placeholders in terminal artifacts.
It remains a local contributor/maintainer gate until the project explicitly
enables CI.
