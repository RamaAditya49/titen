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
  reflection. Accept at most one atomic ADD claim or eight link-only results to
  minimize model and mutation cost on both runtimes.
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
- Order claim pages by their actual portability dependencies. Ordinary acyclic
  supersession remains importable one record at a time; an inseparable
  supersession/enrichment dependency component fails closed when the requested
  record or byte limit cannot carry it atomically. A claim cursor that is no
  longer eligible fails closed instead of restarting pagination, and no claim
  may be emitted when its authorized evidence, replacement, or generated
  provenance drifts or is absent from the same logical export stream.
  Deployment-wide export bypasses
  visibility filtering only; it still rejects incomplete evidence and invalid
  enrichment dependencies. Before emission, every attached job must pass the
  same input-hash, commit/result ownership, and link-result shape checks that
  import applies.
- Bound retained LINK-job provenance to 16 jobs per deterministic export owner
  so every claim remains one portable JSONL record; later unchanged-scope LINK
  proposals commit as abstentions without deleting prior provenance.
- Treat logical imports as restored provenance, not new model instructions.
  Automatic recovery backfills only locally accepted, non-imported observations;
  v1/v2 imports require an explicit new observation to enter enrichment, while
  v3 carries its original enrichment ledger.
- Preserve durable semantic dependency-failure markers through migration unless
  canonical ownership state proves the marker stale; only successful owned
  embedding plus vector mutation is recovery evidence (#168).
- Refuse reflection ADD over any unresolved disputed premise. Model output may
  not select one side of an existing conflict or discard contradicting and
  qualifying source relations (#172).
- Require every reflection ADD to cite the complete ordered job-input snapshot.
  A model may not create a derived assertion whose durable provenance omits one
  of the premises supplied to that model (#176).
- Revoke any current reflection ADD result in the same atomic lifecycle batch
  when one of its exact premises is superseded, revoked, or expired. A stale
  derived result must not remain recallable or make Titen's own logical export
  impossible to restore.
- Freeze Indonesian, English, and Javanese-in-Indonesian derivation/reflection
  fixtures and replay the same core contract on SQLite and D1.
- Keep the bundled D1 contract self-contained with its tracked multilingual
  fixture and a case timeout that covers measured local workerd execution
  without weakening semantic assertions (#174).
- Expose only content-free categorical enrichment health on unauthenticated
  readiness; do not expose deployment-wide job counts or add a new numeric
  operator endpoint without a requirement (#177).
- Keep current operator and contributor documentation aligned on implemented
  opt-in behavior versus uncompleted production activation, including the
  external scheduler drain command and an explicit supersession note on the
  historical model-evaluation record (#175).
- Maintain the Ponytail debt ledger as an exact local/manual inventory of live
  tracked marker locations and their source-owned ceilings, triggers, or
  explicit no-trigger status, without adding hosted automation (#173).

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
- Cloudflare Free allows 50 D1 queries per invocation, while the verified v14
  cold readiness path alone exceeds that ceiling. Free-plan enrichment therefore
  fails configuration closed. Paid activation is bounded from the first D1
  access with headroom below its 1,000-query and 100-parameter limits; local
  Miniflare success alone is not production evidence.
- A logical transfer must either reproduce the complete immutable derivation
  chain or reject it atomically. It may not import a generated claim as if it
  were a caller-authored claim.
- Dependency-topological claim paging currently computes transitive reachability
  before applying the page limit. Correctness is bounded, but a long valid chain
  can make that query quadratic. Production activation remains blocked until a
  real target-plan D1 smoke measures a 2,000-claim chain below the CPU/duration
  budget; failure requires a bounded-seed redesign, not a higher timeout.
- A migration is not dependency recovery. Ambiguous legacy semantic failure
  markers remain fail closed until an owned successful retry proves recovery;
  purge, retirement, delete-only work, and another organization's success do
  not provide that proof.
- Disputed status is canonical conflict evidence. Reflection may abstain or add
  non-authoritative candidate links, but it cannot turn a disputed premise or a
  mixed active/disputed cluster into a clean active assertion.
- A reflection prompt is one immutable snapshot. Accepting only a subset of its
  premises creates provenance that cannot be revoked or ported safely, so ADD
  validation must compare the proposal against the complete ordered input before
  any semantic mutation.
- Readiness is public deployment metadata. Exact enrichment queue counts are
  operational data and must not cross the unauthenticated boundary.
- Migrations 13 and 14 belong to semantic-index readiness work in issue #138;
  this feature owns additive migration 15.

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
  mutation; Free shall remain unsupported and Paid support requires a max-bound
  real-D1 smoke below the explicit invocation budget (#149).
- **AC-ENR-017 — Event-driven:** When Titen exports a generated claim, the
  versioned stream shall include its immutable enrichment job, output hash,
  commit, and generated-claim links; import preflight shall reject missing,
  conflicting, cross-scope, or non-current dependencies atomically, while
  re-import preserves stable IDs and fingerprints. Claim pagination shall place
  every authorized dependency before its dependent, keep a strongly connected
  component atomic, reject an unavailable non-empty cursor without replaying an
  earlier page, and reject incomplete authorized supersession or generated
  provenance without advancing the cursor. Deployment-wide export shall apply
  the same evidence and provenance-integrity checks without principal visibility
  predicates. When a premise lifecycle transition makes a reflection ADD
  snapshot historical, every current result linked to that premise shall become
  revoked atomically before export or retrieval can observe the transition
  (#150).
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
  existing semantic result without another model call, record an explicit
  `reuse` job/result mapping, and append a normal evidence source while the
  bounded source limit permits. Once every matching claim reaches that limit,
  Titen shall start a new bounded claim generation rather than create an
  unexportable evidence graph. Non-identical evidence remains independently eligible.
- **AC-ENR-021 — Unwanted behavior:** If a model proposes a non-null validity
  boundary that is neither a canonical bound nor an exact normalized RFC 3339
  instant present in the cited evidence snapshot, then Titen shall terminally reject
  the output with its hash and no semantic write. Null bounds shall retain the
  canonical default; explicit offset instants and intervals may normalize only
  to their exact cited UTC values (#160).
- **AC-ENR-022 — Unwanted behavior:** If an optional extraction capability is
  malformed, then Titen shall classify it before request handling and keep canonical
  observation writes available without an enrichment job. After a corrected
  capability starts, bounded backfill shall enqueue each eligible locally
  accepted, non-imported observation exactly once and readiness shall remain
  truthful (#161). Logical imports shall remain provenance restores and shall
  not become implicit model inputs.
- **AC-ENR-023 — State-driven:** While a semantic dependency-failure marker has
  no provably stale owner and no later successful owned embed-plus-vector
  mutation, migration and delete-only or cross-organization work shall preserve
  the marker and `/readyz` shall remain dependency-unavailable. When a stale
  loser is provable, Titen may clear only that stale marker without provider
  I/O; migration rollback shall preserve the complete prior state (#168).
- **AC-ENR-024 — Unwanted behavior:** If any cited reflection premise is
  currently `disputed`, or becomes disputed or changes version during the model
  call, then Titen shall reject reflection ADD with zero semantic writes. LINK
  and abstain shall remain idempotent, and no premise ordering or partial
  citation may hide the unresolved supporting, contradicting, or qualifying
  evidence chain (#172).
- **AC-ENR-025 — Event-driven:** When an exact premise of a current reflection
  ADD result is superseded, revoked, or expired, Titen shall revoke every such
  result in the same lifecycle transaction, remove its lexical projection, and
  enqueue vector deletion when vectors are configured. Runtime scheduling and
  logical import/export shall reject reflection-generated claims as nested
  reflection premises, so this bounded direct cascade is complete and the
  resulting historical provenance remains self-restorable.
- **AC-ENR-026 — Unwanted behavior:** If a reflection ADD proposal omits,
  duplicates, reorders, or adds any premise relative to the complete authorized
  job-input snapshot, or if any required premise is foreign, stale, or no longer
  authorized at commit time, then Titen shall terminally reject the proposal
  before semantic mutation. A valid reflection ADD shall persist exactly one
  `derived_from` link for every ordered input premise, and any input lifecycle
  transition shall continue to revoke the result atomically (#176).
- **AC-ENR-027 — Ubiquitous:** The repository-owned bundled D1 contract shall
  include the frozen enrichment fixture without relying on an untracked output
  path and shall declare a per-case timeout above the measured enrichment-case
  duration. Removing the fixture shall fail the build or test deterministically
  on supported Node runtimes (#174).
- **AC-ENR-028 — Ubiquitous:** Unauthenticated `/readyz` shall expose only a
  categorical enrichment state and no pending, leased, failed, due, total, or
  other numeric job count. Changing another organization's queue cardinality
  without changing the category shall not change the public response, and no
  new count-bearing endpoint shall be introduced (#177).
- **AC-ENR-029 — Ubiquitous:** Current repository and deployment documentation
  shall describe enrichment as implemented and opt-in, distinguish that state
  from production activation, document `POST /v1/enrichment/drain` for external
  VPS scheduling, and label the dated pre-implementation research status as
  superseded without rewriting its historical findings (#175).
- **AC-ENR-030 — Ubiquitous:** A local Ponytail debt audit shall map every live
  tracked `ponytail:` marker to exactly one current `file:line` ledger entry,
  derive ceilings and triggers only from source text, identify markers with no
  source trigger explicitly, and require no GitHub Actions or other hosted
  automation (#173).

## Done conditions

Migration replay, frozen dual-runtime contracts, adversarial validator cases,
rollout-compatible lease/retry/crash recovery, hashed exact provenance,
portable round-trip/rejection, D1 query-budget saturation, outage-safe direct
writes/recall, readiness, package/docs, and workflow checks pass. Locked
evaluation and worst-case real Cloudflare D1, including a 2,000-claim dependency
chain export, VPS, and local-computer smoke are recorded before activation.
Every plan item is complete and this pair moves to
`done/` with exact evidence.
