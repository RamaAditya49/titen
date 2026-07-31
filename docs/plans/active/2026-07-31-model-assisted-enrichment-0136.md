---
work_id: model-assisted-enrichment-0136
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-07-31
updated: 2026-07-31
review_after: 2026-08-14
owner: CADIS
spec: docs/specs/active/2026-07-31-model-assisted-enrichment-0136.md
---
# Plan

- [ ] Add migration 14 for the durable enrichment ledger, immutable-input
  trigger, current-lease commit fence, non-authoritative claim links, indexes,
  and exact job/result provenance. (AC-ENR-003, AC-ENR-004, AC-ENR-008,
  AC-ENR-009, AC-ENR-010)
- [ ] Implement one shared enrichment module that enqueues derivation with the
  observation batch, schedules bounded reflection snapshots, leases due work,
  builds bounded prompts, validates proposals, commits ADD/link/abstain, and
  applies bounded retry/backoff with fixed failure classes. (AC-ENR-001 through
  AC-ENR-010)
- [ ] Make leasing pipeline-compatible for zero-downtime rollout, persist only a
  deterministic output hash after provider return, isolate stale-authority
  anchors per tenant, advance a durable scheduler cursor, acquire a fresh lease
  per sequential provider call, reuse exact duplicate derivations, and cancel
  redirect/rejected response bodies. (AC-ENR-003, AC-ENR-010, AC-ENR-014,
  AC-ENR-015, AC-ENR-018 through AC-ENR-020; #148)
- [ ] Compact per-claim source and premise links into bounded multi-row SQL,
  cap semantic ADD at one atomic claim, enforce a Cloudflare invocation budget
  with a safe job ceiling, and fail readiness closed for any unsupported/unproven
  D1 activation. (AC-ENR-016; #149)
- [ ] Version the portable stream to include enrichment jobs, commits, output
  hashes, and generated-claim links; add atomic preflight and idempotent
  dual-runtime round-trip/rejection coverage. (AC-ENR-017; #150)
- [ ] Implement one native-fetch OpenAI-compatible extraction adapter with
  explicit endpoint/model/fingerprint/timeout configuration and strict local
  response-size handling; wire it into Bun timer/manual drain and Cloudflare
  Cron/manual drain without a provider factory. (AC-ENR-002, AC-ENR-005,
  AC-ENR-006, AC-ENR-011)
- [ ] Add separate readiness and a minimal authorized manual drain surface,
  update route/API/deployment documentation, and keep the capability disabled
  unless the complete opt-in tuple is valid. (AC-ENR-002, AC-ENR-011,
  AC-ENR-013)
- [ ] Freeze multilingual ADD/link/abstain fixtures plus malformed, foreign-ID,
  missing-field/time, authority-injection, stale-version/tenant, lease-race,
  old/new-worker rollout, transient-retry, terminal, output-hash, maximum-bound
  commit, provenance, portability, and outage-safe direct-write/recall cases;
  replay on SQLite and D1. (AC-ENR-002 through AC-ENR-019)
- [ ] Run focused tests, both runtime contracts, migration integrity, route and
  workflow checks, package/diff checks, and record locked evaluation plus real
  Cloudflare, VPS, and local smoke before activation. (AC-ENR-012,
  AC-ENR-013)

## Evidence mapping

- AC-ENR-001: observation batch inspection and dual-runtime enqueue/replay case.
- AC-ENR-002: disabled/broken/malformed provider cases plus successful direct
  observation, consolidation, FTS compile, and restart evidence.
- AC-ENR-003: concurrent claimant, expired lease recovery, four-attempt ceiling,
  and exact next-attempt timestamp assertions.
- AC-ENR-004: migration schema/trigger inspection and rejected fingerprint
  mutation on both SQL adapters.
- AC-ENR-005: SQL job inspection and log capture proving fixed classes only.
- AC-ENR-006: fake-model input capture, source/premise count bounds, and exact ID
  set assertions.
- AC-ENR-007: frozen malformed/oversized/unknown-field/authority/foreign/stale
  proposals with unchanged claim/link/source counts.
- AC-ENR-008: valid ADD, link-only, and abstain rows plus unchanged lifecycle and
  evidence tables for prohibited output.
- AC-ENR-009: context compile and evidence query for a derived multilingual claim,
  job commit mapping, and exact observation source row.
- AC-ENR-010: unchanged snapshot uniqueness plus version/policy-change identity
  tests.
- AC-ENR-011: `/readyz` capability matrix for disabled, enabled, and invalid
  configuration, with legacy compatibility fields checked.
- AC-ENR-012: shared frozen fixture replay from Bun/SQLite and workerd/D1.
- AC-ENR-013: opt-in defaults, documentation claim audit, locked evaluation, and
  dated Cloudflare/VPS/local smoke records.
- AC-ENR-014: old/new fingerprint workers over one ledger, unmatched pending
  state, matching completion, restart, and exactly-one commit assertions.
- AC-ENR-015: valid, invalid, unsafe, source-drift, and provider-failure job rows
  proving a deterministic 64-hex hash only when output existed and no raw body.
- AC-ENR-016: statement/parameter counter at maximum proposal bounds, saturated
  due queue, fail-closed readiness matrix, and real Free/Paid D1 smoke evidence.
- AC-ENR-017: versioned Bun/D1 export-import round trip, re-import, missing-job,
  conflicting-hash, foreign-scope, tombstoned-source, and atomic rollback cases.
- AC-ENR-018: stale private workspace anchor ordered before a healthy tenant and
  a healthy reflection job still scheduled on both SQL adapters.
- AC-ENR-019: fetch-init redirect assertion and response-stream cancellation
  hooks for rejected and oversized declared responses.
- AC-ENR-020: same-domain duplicate observation replay proving one model call,
  one canonical claim, both exact evidence sources, and non-duplicate eligibility.

## Security, migration, deployment, smoke, and rollback

Migration 14 is additive. Back up canonical SQL before applying it; a pre-merge
rollback deletes the isolated branch, while a post-migration rollback deploys a
compatible build that leaves the unused ledger intact. Never down-migrate by
dropping canonical provenance.

The model endpoint and API key are trusted operator configuration held only in
runtime secrets. No request payload may select them. The worker receives only
bounded authorized canonical input and returns untrusted JSON that must pass
local validation and an in-transaction lease/source fence.

Local workerd and Bun smokes do not activate production. Cloudflare Cron/D1
must additionally prove the declared worst-case query/parameter budget on the
actual target plan. Cloudflare Cron/D1, VPS timer/SQLite, and loopback
local-computer smoke must each prove enqueue, drain, recall, provider outage
recovery, portable provenance, and truthful readiness against the locked
fixtures before the feature pair can close.
