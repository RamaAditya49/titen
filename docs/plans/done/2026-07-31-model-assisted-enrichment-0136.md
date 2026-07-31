---
work_id: model-assisted-enrichment-0136
status: done
stage: done
outcome: cancelled
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
spec: docs/specs/done/2026-07-31-model-assisted-enrichment-0136.md
---
# Plan

- [x] Add migration 15 for the durable enrichment ledger, immutable-input
  trigger, current-lease commit fence, non-authoritative claim links, indexes,
  and exact job/result provenance. (AC-ENR-003, AC-ENR-004, AC-ENR-008,
  AC-ENR-009, AC-ENR-010)
- [x] Implement one shared enrichment module that enqueues derivation with the
  observation batch, schedules bounded reflection snapshots, leases due work,
  builds bounded prompts, validates proposals, commits ADD/link/abstain, and
  applies bounded retry/backoff with fixed failure classes. (AC-ENR-001 through
  AC-ENR-010)
- [x] Make leasing pipeline-compatible for zero-downtime rollout, persist only a
  deterministic output hash after provider return, isolate stale-authority
  anchors per tenant, advance a durable scheduler cursor, acquire a fresh lease
  per sequential provider call, reuse exact duplicate derivations, and cancel
  redirect/rejected response bodies. (AC-ENR-003, AC-ENR-010, AC-ENR-014,
  AC-ENR-015, AC-ENR-018 through AC-ENR-020; #148)
- [x] Compact per-claim source and premise links into bounded multi-row SQL,
  cap semantic ADD at one atomic claim, enforce a Cloudflare invocation budget
  with a safe job ceiling, and fail readiness closed for any unsupported/unproven
  D1 activation. (AC-ENR-016; #149)
- [x] Version the portable stream to include enrichment jobs, commits, output
  hashes, and generated-claim links; add atomic preflight and idempotent
  dual-runtime round-trip/rejection coverage, lifecycle-safe historical
  snapshots, dependency-topological paging with atomic strongly connected
  components, unavailable-cursor and incomplete-authorized-provenance rejection,
  deployment-wide evidence/provenance validation, export-time input-hash and
  commit/result/link-shape validation, and a 16-job deterministic export-owner
  bound for LINK provenance; propagate premise supersede, revoke, and expire
  transitions to current reflection ADD results in the same batch.
  (AC-ENR-017; #150)
- [x] Bind proposed validity bounds to canonical or explicitly cited normalized
  RFC 3339 instants and cover unsupported future dates, inverted intervals,
  offsets, and explicit future windows. (AC-ENR-021; #160)
- [x] Classify malformed optional extraction before traffic, preserve canonical
  writes without enqueue, and add bounded idempotent observation backfill after
  corrected startup while excluding logical imports from implicit model input.
  (AC-ENR-022; #161)
- [x] Preserve genuine or ambiguous semantic outage markers across migration
  15, clear only provably stale loser state, and prove readiness cannot recover
  through migration, delete-only completion, retirement, purge, expiry, or
  another organization's work. (AC-ENR-023; #168)
- [x] Reject reflection ADD whenever any cited premise is disputed at proposal
  validation or commit time; retain idempotent LINK/abstain behavior and cover
  mixed active/disputed premise ordering without laundering source conflict.
  (AC-ENR-024; #172)
- [x] Revoke direct reflection ADD dependents atomically on premise supersede,
  revoke, or expire; remove FTS/vector projections, reject nested reflection
  premises at logical boundaries, and prove exact self-round-trip afterward.
  (AC-ENR-025; #150)
- [ ] Require a reflection ADD to cite the complete ordered job-input snapshot,
  reject partial/duplicate/reordered/foreign/stale inputs before mutation, and
  prove exact provenance plus lifecycle propagation on both runtime contracts.
  (AC-ENR-026; #176)
- [x] Bundle the tracked multilingual fixture into the D1 contract artifact and
  give the measured enrichment case a truthful explicit timeout, with a
  deterministic missing-fixture build failure. (AC-ENR-027; #174)
- [ ] Remove deployment-wide enrichment counts from public readiness and add an
  adversarial cardinality test that proves the categorical response has no
  numeric count influence. Do not add an unrequested operator-count surface.
  (AC-ENR-028; #177)
- [x] Align repository, deployment, scheduler, and historical evaluation docs
  on implemented opt-in enrichment versus still-blocked production activation.
  (AC-ENR-029; #175)
- [x] Rebuild the Ponytail debt ledger from live tracked marker identities and
  add the smallest local/manual exactness check; keep hosted automation absent.
  (AC-ENR-030; #173)
- [x] Implement one native-fetch OpenAI-compatible extraction adapter with
  explicit endpoint/model/fingerprint/timeout configuration and strict local
  response-size handling; wire it into Bun timer/manual drain and Cloudflare
  Cron/manual drain without a provider factory. (AC-ENR-002, AC-ENR-005,
  AC-ENR-006, AC-ENR-011)
- [x] Add separate readiness and a minimal authorized manual drain surface,
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
  due queue, fail-closed Free-plan/invalid-Cron readiness matrix, and real Paid
  D1 smoke evidence below the full-invocation budget.
- AC-ENR-017: versioned Bun/D1 export-import round trip, re-import, missing-job,
  conflicting-hash, foreign-scope, tombstoned-source, unavailable cursor,
  inaccessible supersession, dependency-order/SCC boundary, corrupt whole-export
  evidence/provenance, premise-lifecycle propagation/self-round-trip, atomic
  rollback, and real-D1 2,000-claim dependency-chain duration cases.
- AC-ENR-018: stale private workspace anchor ordered before a healthy tenant and
  a healthy reflection job still scheduled on both SQL adapters.
- AC-ENR-019: fetch-init redirect assertion and response-stream cancellation
  hooks for rejected and oversized declared responses.
- AC-ENR-020: same-domain duplicate observation replay proving one model call,
  one canonical claim, explicit reuse mappings, bounded evidence-source append,
  fresh bounded generation after source saturation, and non-duplicate eligibility.
- AC-ENR-021: dual-runtime 2026-to-2099 rejection, inverted interval, normalized
  timezone-offset, explicit future interval, exact snapshot, and output-hash rows.
- AC-ENR-022: invalid injected/runtime capability readiness, successful canonical
  write without a job, corrected restart backfill, idempotent replay, and drain.
- AC-ENR-023: populated schema-v14 Bun/D1 migration with genuine, stale-loser,
  delete-only, cross-organization, and fault-injected marker states; readiness
  remains local and changes only after an owned embed-plus-vector success.
- AC-ENR-024: dual-runtime disputed-only and mixed-premise ADD rejection before
  semantic mutation, provider-call status/version drift rejection, and unchanged
  idempotent LINK/abstain replay.
- AC-ENR-025: dual-runtime premise supersede/revoke/expire propagation, FTS and
  vector-delete projection assertions, nested-reflection import/export
  rejection, and post-transition exact export/import replay.
- AC-ENR-026: dual-runtime partial, duplicate, reordered, foreign, stale, and
  complete reflection ADD cases; unchanged semantic tables on rejection; exact
  `derived_from` rows and lifecycle propagation for every accepted premise.
- AC-ENR-027: a bundled-D1 artifact inspection proving fixture data is embedded,
  a missing-fixture build failure, and the held D1 contract on supported Node
  versions once the shared Miniflare lane is released.
- AC-ENR-028: public readiness snapshots before and after another organization
  changes queue cardinality, with identical categorical JSON and no numeric job
  fields, replayed through SQLite and D1.
- AC-ENR-029: claim audit across `AGENTS.md`, deployment docs, external scheduler
  examples, and the dated model-evaluation record.
- AC-ENR-030: exact live-marker-to-ledger identity comparison, source-derived
  ceiling/trigger inspection, explicit no-trigger count, and a clean local
  workflow run without GitHub Actions.

## Current verification

- Bun/SQLite contract: 90 passed, 0 failed; focused vector/SDK unit suite:
  28 passed, 0 failed.
- Integration suite: 164 passed, 0 failed.
- Worker dry-build: 446.02 KiB upload / 95.03 KiB gzip.
- npm build and package dry-run, bundled-D1 artifact with embedded tracked
  fixture, 57-route documentation check, 52-artifact workflow check plus
  self-test, exact 19-marker Ponytail audit, and `git diff --check`: passed.
- Independent source/Bun review: passed. D1/workerd execution remains held for
  the shared redaction gate; locked evaluation and real Cloudflare Paid D1,
  VPS, and local-computer smokes remain incomplete activation evidence.

## Security, migration, deployment, smoke, and rollback

Migration 15 is additive. Back up canonical SQL before applying it; a pre-merge
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

## Closure reason

Cancelled at production activation. The opt-in ledger, provider boundary,
validation, dual-runtime replay, and maintenance path are merged and remain
disabled by default. The locked model gate selected no candidate, and the real
Paid D1, VPS, and local-computer activation smokes did not run. Those unchecked
items remain explicit; a future activation needs a new spec and fresh model and
runtime evidence.
