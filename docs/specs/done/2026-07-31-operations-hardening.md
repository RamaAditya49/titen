---
work_id: operations-hardening-20260731
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
---
# Operations hardening

## Problem

The Bun CLI exposes raw startup failures and cannot select its already-supported
quiet server mode. Default deployments also enqueue vector work with no vector
consumer, while expired execution bookkeeping has no bounded sweep. The audit
primitive covers claim lifecycle only, leaving credential and integration
changes untraceable. Finally, important operating choices around rate limiting,
telemetry, process concurrency, SQLite durability, and rollback are implicit.

Issues #100, #105, #107, #115, #116, #123, and #124 overlap at this operational
boundary. The smallest safe resolution is native CLI error handling, capability-
aware outbox writes, bounded ephemeral cleanup, selected content-free audits,
one explicit durability pragma, and deployment guidance. It is not a new
operations framework.

## In scope

- Accept `titen serve --quiet`, suppress startup/request/maintenance lines in
  that mode, and turn address collisions or other startup failures into one
  actionable CLI error while closing the opened database.
- Enqueue index work only when a vector capability exists. Keep claim-vector
  upserts and purge deletes intact for configured consumers.
- Delete at most one configured maintenance batch each of expired
  `idempotency_v3`, expired checkpoints, and expired or released leases.
  Preserve active rows, `lifecycle_fences`, canonical events, and record
  history.
- Audit key create/revoke, record export/import, membership add/remove, handoff
  create/resolve, webhook register/delete, and federation-peer
  register/suspend. Store actor, action, resource type/id, and time only; keep
  `detail` and `ip_hint` null.
- Make SQLite `synchronous=FULL` explicit and retain synchronous context-run
  persistence required for feedback provenance.
- Document ingress-native rate limiting, Cloudflare/supervisor-native telemetry,
  the one-process Bun ceiling, explicit FULL durability, quiet mode, and
  backup-before-upgrade rollback.
- Record that `include_checkpoints: true` reports its existing explicit
  degraded state instead of silently implying checkpoint inclusion.

## Out of scope

- A Node launcher shim, package-bin or optional-dependency changes, npm or
  version metadata, and publication work.
- `migrate --dry-run`, backup format/version changes, logical export/import CLI,
  or a change feed; the portability lane owns those changes.
- A Prometheus endpoint, logger, log rotation, token bucket, quota schema,
  worker pool, `SO_REUSEPORT`, read replica, scheduler, timer-backed context
  queue, provider abstraction, dependency, or framework.
- Finite retention for observations, claims, events, record history, audit,
  context provenance, or other canonical evidence.
- Trusting `Forwarded`, `X-Forwarded-For`, or any caller-selected address header.

## Acceptance criteria

- **AC-OPS-001 — Unwanted behavior:** If `titen serve` cannot bind its requested
  port, then the CLI shall exit non-zero with one `error: port PORT is already in
  use` line, no stack trace, and no leaked database handle; another startup
  failure shall likewise return one bounded actionable error.
- **AC-OPS-002 — Optional feature:** Where `titen serve --quiet` is selected,
  Titen shall serve normally without startup, request, or maintenance output.
- **AC-OPS-003 — State-driven:** While no vector capability is configured,
  observation, claim, import, and purge mutations shall create no index-outbox
  work; while a vector capability is configured, claim upserts and purge
  deletes shall remain queued and drainable.
- **AC-OPS-004 — Event-driven:** When maintenance runs, Titen shall delete no
  more than its batch limit from each expired idempotency and checkpoint set or
  expired/released lease set, shall retain active rows, and shall not delete
  lifecycle fences, events, or record history.
- **AC-OPS-005 — Event-driven:** When a selected high-value credential,
  portability, collaboration, webhook, or federation action succeeds, Titen
  shall record the authenticated actor and resource in the same mutation batch
  where one exists, without request content, secrets, URLs, messages, forwarded
  address values, or other free-form detail.
- **AC-OPS-006 — Event-driven:** When a caller requests checkpoint inclusion
  before checkpoint packing is implemented, Titen shall return
  `meta.degraded.checkpoints = "unavailable"`.
- **AC-OPS-007 — Ubiquitous:** The Bun SQLite runtime shall set
  `PRAGMA synchronous = FULL` explicitly and shall keep context-run evidence on
  the acknowledged compile path.
- **AC-OPS-008 — Ubiquitous:** Deployment guidance shall place rate limiting at
  authenticated ingress, use native Cloudflare or supervisor telemetry, state
  the one-process ceiling and its measured upgrade trigger, and define
  backup-before-upgrade restore as rollback without claiming an in-core metrics,
  quota, worker-pool, or asynchronous-context feature.
- **AC-OPS-009 — Ubiquitous:** The change shall add no route, migration,
  dependency, npm/version/changelog/GitHub mutation, logical CLI portability
  command, or canonical finite-retention policy, and the documented inventory
  shall remain 52 routes.

## Risks and done conditions

Capability-aware outbox writes must not suppress deletion work for a vector
that actually exists. Cleanup must stay bounded and may touch execution state
only. Audit rows must commit with their mutation and must never copy request
content or untrusted network identity. Done requires focused CLI, maintenance,
audit, vector-purge, durability, checkpoint-degraded, dual-runtime contract,
52-route, workflow, protected-file, dependency, and diff evidence in the paired
done plan.

## Verification evidence

- Focused CLI, maintenance, durability, and vector-purge suites: 28 passed.
- Cloudflare Worker dry-build and D1 contract: 81 passed.
- Bun/SQLite, configured-vector, and SDK suites: 103 passed.
- Bun integration suite: 77 passed across 13 files.
- Route documentation stayed at 52 routes; workflow checker and self-test
  passed with 38 work artifacts.
- Source debt scan found 21 Ponytail markers and the regenerated ledger has 21
  trigger-bearing entries.
- Protected-file inspection found no README, changelog, package, lockfile,
  version, or GitHub mutation; `git diff --check` passed.
