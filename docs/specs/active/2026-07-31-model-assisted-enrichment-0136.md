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
---
# Evidence-grounded automatic derivation and bounded reflection

## Problem

Titen stores observations and caller-supplied claims, but it cannot yet turn an
accepted raw conversation into recallable claims or reflect over related claims
without an external harness. This blocks the server-wulan Mem0 replacement gate
in issue #136. A model is untrusted and optional, so adding it must not place a
provider call on the canonical write or retrieval path, widen authority, or make
Cloudflare and Bun implement different memory semantics.

This slice implements PRD FR-13 and ADR-0004 through one shared SQL ledger and
one shared validator. Runtime entrypoints only configure the same native-fetch
model boundary and trigger the same bounded maintenance drain.

## In scope

- Atomically enqueue a derivation job with each eligible observation when an
  extraction capability is configured.
- Schedule idempotent reflection jobs from bounded, currently authorized,
  same-scope claim snapshots through a durable cursor so a perpetually hot
  newest page cannot starve older eligible anchors.
- Lease and drain both lanes from one durable SQL ledger with at most four
  attempts, a 60-second lease, and exponential backoff capped at five minutes.
- Acquire work immediately before each sequential provider call; never pre-lease
  a batch whose later calls can begin after their lease expires.
- Store immutable model, prompt, schema, input, and policy fingerprints plus
  sanitized operational failure classes and a SHA-256 output hash; never
  persist prompts or raw model output.
- Lease only work whose model, prompt, and schema fingerprints match the active
  worker so an overlapping rollout cannot consume or terminally fail an older
  pipeline's acknowledged work (#148).
- Send at most one observation to derivation and at most eight claims to
  reflection. Accept at most one atomic ADD claim or eight link-only results so
  the same worst-case commit fits the Cloudflare Free query budget.
- Validate exact source/premise IDs, scope, visibility, trust, lifecycle,
  Unicode, size, and temporal fields locally before one ADD-only transaction.
- Materialize model-assisted claims at `unverified` trust with exact observation
  sources and, for reflection, exact premise links.
- Report embedding, extraction, and background enrichment separately while
  retaining the existing readiness compatibility fields.
- Keep every Cloudflare enrichment invocation within an explicit D1 query and
  bound-parameter budget; unsupported or unproven activation fails readiness
  closed instead of discovering a plan limit during mutation (#149).
- Extend the versioned logical export/import contract with enrichment jobs,
  commits, generated-claim links, and output hashes; reject incomplete or
  conflicting generated-claim provenance before mutation (#150).
- Freeze Indonesian, English, and Javanese-in-Indonesian derivation/reflection
  fixtures and replay the same core contract on SQLite and D1.

## Out of scope

- A provider factory, model router, queue service, Redis, workflow engine,
  graph database, or new dependency.
- Synchronous inference on observation, direct-claim, or context requests.
- Model-selected trust, visibility, subject, workspace, project, publication,
  deletion, merge, lifecycle transition, or conflict resolution.
- Persisting raw prompts, private model responses, embeddings, or credentials.
- Production activation before locked evaluation and real Cloudflare, VPS, and
  local-computer smoke evidence exists.

## Constraints and risks

- Canonical SQL and current authentication state are authoritative; model output
  is untrusted data even when a provider advertises strict JSON schema.
- Observation/direct-claim writes and FTS retrieval must remain successful when
  extraction is disabled, slow, unavailable, malformed, or terminally failed.
- A job lease may expire during a model call. The semantic commit must prove
  current lease ownership inside the same SQL transaction so two workers cannot
  commit duplicate output.
- A rolling deployment may have two valid pipeline generations. Each worker may
  lease only its own generation; unmatched jobs remain pending until a matching
  worker drains them or an explicit future supersession records an audit trail.
- Every reflection premise is re-authorized and version-checked at commit time.
  Policy or source drift fails closed and produces no semantic mutation.
- Operational logs and job rows may expose only bounded IDs, fingerprints,
  output hashes, counters, and fixed failure classes, never content or provider
  messages.
- Cloudflare Free allows 50 D1 queries per invocation and 100 bound parameters
  per query. Commit shape, scheduler breadth, and all maintenance sharing the
  invocation must stay below those limits with headroom; local Miniflare success
  alone is not production evidence.
- A logical transfer must either reproduce the complete immutable derivation
  chain or reject it atomically. It may not import a generated claim as if it
  were a caller-authored claim.
- Migration 13 is reserved for semantic-index readiness work in issue #138;
  this feature owns additive migration 14.

## Acceptance criteria

- **AC-ENR-001 — Optional feature:** Where extraction is configured, when an
  authorized observation commits, Titen shall commit one idempotent pending
  derivation job in the same SQL batch and return the observation response
  without waiting for a model.
- **AC-ENR-002 — Unwanted behavior:** If extraction is disabled or its provider
  is unavailable, slow, or malformed, then Titen shall keep observation,
  direct-claim, FTS retrieval, and context compilation available without a lost
  acknowledged write.
- **AC-ENR-003 — State-driven:** While a derivation or reflection job is due,
  Titen shall grant one 60-second durable lease, attempt it at most four times,
  and retry transient failure with deterministic exponential backoff capped at
  five minutes; each sequential model call shall receive a fresh lease and no
  later batch member may be charged against an already aging shared lease.
- **AC-ENR-004 — Ubiquitous:** Titen shall store immutable model, prompt, schema,
  input, and policy fingerprints for every enrichment job and shall reject any
  attempt to mutate those fields after insertion.
- **AC-ENR-005 — Unwanted behavior:** If a provider call fails, then Titen shall
  persist only a fixed sanitized failure class and retry state; prompts, memory
  content, raw output, credentials, and provider error text shall not enter SQL
  state or operational logs.
- **AC-ENR-006 — Event-driven:** When Titen calls the model, it shall supply at
  most one authorized observation or eight authorized same-scope claim premises,
  and the accepted proposal shall cite only IDs from that exact bounded input.
- **AC-ENR-007 — Unwanted behavior:** If proposal JSON is malformed, oversized,
  contains unknown or authority fields, cites an unknown/foreign/stale ID,
  exceeds output bounds, or violates temporal constraints, then Titen shall mark
  the job terminally failed and commit zero semantic rows.
- **AC-ENR-008 — Event-driven:** When a valid proposal requests ADD, link-only,
  or abstain, Titen shall respectively append unverified evidence-linked claims,
  append non-authoritative candidate links, or complete successfully with no
  semantic write; no proposal may delete evidence or change claim lifecycle.
- **AC-ENR-009 — Event-driven:** When derivation adds a claim from a raw
  conversation observation, Titen shall make it recallable through normal
  context compilation and trace it to the exact observation and enrichment job.
- **AC-ENR-010 — Event-driven:** When reflection scheduling sees an authorized
  claim snapshot, Titen shall derive its identity from ordered premise IDs and
  versions plus policy and pipeline fingerprints, reuse an unchanged snapshot,
  create a distinct job after premise-version or policy change, and advance a
  durable pipeline/scope cursor so every eligible anchor is eventually visited.
- **AC-ENR-011 — Ubiquitous:** Readiness shall report `embedding`, `extraction`,
  and `background_enrichment` independently; pending work shall not be reported
  as claim-ready memory and compatibility fields shall remain truthful.
- **AC-ENR-012 — Ubiquitous:** The same frozen Indonesian, English, and
  Javanese-in-Indonesian derivation/reflection fixtures, adversarial proposals,
  lease recovery, retry, abstain, provenance, and recall checks shall pass
  through the shared core on Bun/SQLite and workerd/D1.
- **AC-ENR-013 — State-driven:** While locked multilingual evaluation or real
  Cloudflare, VPS, and local-computer smoke evidence is incomplete, Titen shall
  keep automatic enrichment opt-in and shall not describe it as production
  activated.
- **AC-ENR-014 — Unwanted behavior:** If a due job's model, prompt, or schema
  fingerprint differs from the active worker, then that worker shall not lease
  or terminally fail the job; overlapping old/new workers shall leave every
  acknowledged job in exactly one successful, explicitly superseded, or still
  pending compatible state across restart and retry (#148).
- **AC-ENR-015 — Event-driven:** When a provider returns proposal JSON, Titen
  shall immediately compute its deterministic SHA-256 output hash and persist
  only that hash for a valid commit or terminal invalid/unsafe result; provider
  failures without output shall retain a null hash and raw proposal content
  shall never enter canonical storage.
- **AC-ENR-016 — Unwanted behavior:** If a Cloudflare drain cannot prove its
  worst-case scheduling, lease, read, commit, cleanup, and maintenance work fits
  the declared D1 query, parameter, and duration budget, then extraction and
  background enrichment shall report `configured_error` and perform no model
  mutation; supported Free/Paid claims require a max-bound real-D1 smoke (#149).
- **AC-ENR-017 — Event-driven:** When Titen exports a generated claim, the
  versioned stream shall include its immutable enrichment job, output hash,
  commit, and generated-claim links; import preflight shall reject missing,
  conflicting, cross-scope, or non-current dependencies atomically, while
  re-import preserves stable IDs and fingerprints (#150).
- **AC-ENR-018 — Unwanted behavior:** If one reflection anchor has stale
  workspace authority, then the scheduler shall skip only that anchor and shall
  continue healthy anchors from other tenants; storage and programming failures
  shall still surface.
- **AC-ENR-019 — Unwanted behavior:** If an extraction endpoint redirects or a
  rejected/oversized response still has a body, then Titen shall refuse the
  redirect and cancel the body so the configured endpoint fingerprint remains
  the actual payload destination and retries cannot leak unbounded resources.
- **AC-ENR-020 — Event-driven:** When an eligible observation is an exact
  same-scope duplicate of previously derived evidence, Titen shall reuse the
  existing semantic result and append exact provenance without another model
  call or duplicate canonical claim; non-identical evidence remains independently
  eligible.

## Done conditions

Migration replay, frozen dual-runtime contracts, adversarial validator cases,
rollout-compatible lease/retry/crash recovery, hashed exact provenance,
portable round-trip/rejection, D1 query-budget saturation, outage-safe direct
writes/recall, readiness, package/docs, and workflow checks pass. Locked
evaluation and worst-case real Cloudflare D1, VPS, and local-computer smoke are
recorded before activation. Every plan item is complete and this pair moves to
`done/` with exact evidence.
