---
work_id: enterprise-canonical-stable-release
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-01
updated: 2026-08-01
owner: CADIS
---
# Enterprise, canonical federation, live dashboard, and stable release

## Problem

Titen already ships the evidence kernel, collaboration, audit, external channel
snapshots, signed federation events, and a synthetic operator dashboard. It is
not yet code-complete for the enterprise controls and canonical recallable-memory
federation promised by the product direction, and the dashboard cannot prove a
running deployment. Five post-release defects also block treating `0.4.1` as a
stable replacement candidate.

## Scope

- enforce organization roles, policies, governed approvals/releases, retention,
  legal hold, identity-provider linkage boundaries, and auditable decisions;
- federate authorized canonical claims with their evidence and provenance using
  the existing signed peer transport while preserving conflicts and replay safety;
- make the Astro dashboard a real authenticated REST client with loading, empty,
  denial, error, governance lenses, and federated canonical recall through Atlas;
- resolve issues #208-#212 at their shared CLI/context boundaries;
- verify Bun/SQLite and workerd/D1, package/install the candidate, deploy the same
  candidate on `benchmark-host`, run immediate live and rollback smokes, publish the
  stable npm/GitHub release, update titen.dev release discovery, and close issues;
- keep GitHub Actions disabled and remove only branches proven merged or obsolete.

## Out of scope

- an agent-loop scheduler, general workflow engine, graph database, queue, ORM,
  Redis, Postgres, provider factory, or mandatory hosted Titen service;
- automatic identity-provider provisioning or vendor-specific SSO/SCIM SDKs;
- public firewall exposure without a narrow authenticated ingress decision;
- waiting for a calendar soak after the complete immediate runtime and rollback
  evidence explicitly requested by the operator.

## Acceptance criteria

- **AC-ECS-001 — Ubiquitous:** Titen shall derive organization and resource
  authority from authentication and persisted membership/role policy before
  lookup, count, traversal, release, retention, or federation behavior.
- **AC-ECS-002 — Event-driven:** When an authorized enterprise operator changes
  policy, membership role, approval, release state, retention, legal hold, or an
  external identity link, Titen shall enforce the transition atomically and
  append a non-secret audit event.
- **AC-ECS-003 — Unwanted behavior:** If a destructive lifecycle operation targets
  held or retained canonical evidence, then Titen shall reject it without canonical,
  index, event, or audit side effects that imply success.
- **AC-ECS-004 — Event-driven:** When a trusted peer sends a correctly signed,
  scoped canonical bundle, Titen shall import its claims, source evidence, and
  provenance idempotently, preserve local disagreement, and make authorized
  imported memory recallable.
- **AC-ECS-005 — Unwanted behavior:** If a canonical federation request is
  unsigned, tampered, replayed, foreign-scoped, suspended, or outside the peer
  filter, then Titen shall disclose no canonical content and shall create no
  canonical memory, provenance, or index mutation; bounded metadata-only
  federation logs may record a denial or idempotent replay.
- **AC-ECS-006 — State-driven:** While the dashboard has a configured authenticated
  API session, it shall render authorized live health, readiness, ordinary and
  governance Atlas lenses, including imported canonical federation records;
  without data or authority it shall render an honest empty, setup, denial, or
  error state and never synthetic service proof.
- **AC-ECS-007 — Unwanted behavior:** If CLI key operations address a missing
  database, organization, or key, then Titen shall fail without creating state,
  leaking a raw stack, or reporting false success.
- **AC-ECS-008 — Event-driven:** When context compilation returns no item because
  its budget is exhausted, REST and SDK clients shall receive explicit bounded
  metadata distinguishable from an authorized empty corpus.
- **AC-ECS-009 — Ubiquitous:** The shared contract shall pass against Bun/SQLite
  and workerd/D1 with adversarial cross-organization, migration, replay, conflict,
  dashboard-build, CLI, SDK, packaging, and workflow checks.
- **AC-ECS-010 — Event-driven:** When the exact candidate is deployed on
  `benchmark-host`, it shall start from persistent storage, become ready, serve the live
  dashboard through a tailnet-authenticated operator path, preserve data through
  a bounded restart/restore smoke, and expose a URL verified from the operator host.
- **AC-ECS-011 — Event-driven:** When every gate passes, maintainers shall publish
  one exact stable semantic version to npm and GitHub, update the stable release
  manifest, close the five issues with evidence, merge to `main`, and leave no
  open PR or unabsorbed release branch.

## Done conditions

Every criterion has current reproducible evidence, domain specs/plans are in
`done`, this pair is in `done` with no unchecked step, the public package/tag and
deployed revision agree, and the final dashboard URL passes a fresh smoke.

## Terminal evidence

- `main`, `v0.5.1`, the GitHub Release, npm `latest`, the `benchmark-host` images, and
  the live dashboard all resolve to release `0.5.1`; the deployed revision is
  `3d53431`.
- Bun/vector/SDK passed 129/129, integration passed 182/182, browser passed 5/5,
  D1 passed all 105 cases, package install passed 9/9, and the production
  dependency audit reported no known vulnerabilities.
- `benchmark-host` passed schema 19 readiness, signed canonical federation recall,
  six Atlas lenses, restart persistence, disposable restore, a read-only
  migration probe, visual dashboard inspection, and direct API denial.
- `titen.dev` and `www.titen.dev` publish stable discovery `0.5.1`; GitHub has no
  open issue or PR and the remote has only `main`.
- The operator link `http://127.0.0.1:4322/dashboard/` passes through an
  SSH-over-Tailnet loopback tunnel; no public firewall port or GitHub Action was
  introduced.
