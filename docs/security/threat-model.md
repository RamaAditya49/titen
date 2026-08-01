# Threat model

Status: design baseline for P0. Review whenever a trust boundary, data class,
runtime, or externally reachable operation changes.

## Scope

This model covers the Titen HTTP service, canonical SQL store, FTS projection,
optional vector/model integrations, background repair, export/import, the
stateless MCP adapter, planned agent lifecycle hooks, signed webhook/event
delivery, Memory Atlas compiler, and optional per-principal operator dashboard.
It covers personal, company, and enterprise deployments while features are
enabled according to their release phase.

The host, Cloudflare account, VPS operating system, reverse proxy, and model
provider remain deployment responsibilities, but Titen must fail safely when
their inputs or capabilities are untrusted or unavailable.

## Protected assets

- private observation and claim content;
- provenance, source links, trust, and temporal history;
- organization, workspace, project, subject, agent, and run boundaries;
- API keys and authority mappings;
- checkpoints, leases, handoffs, and their ownership;
- audit metadata and retention/legal-hold state;
- authorized relationship topology, counts, and policy-preview results;
- backups, exports, and migration state;
- availability and cost budgets.

Vectors, FTS rows, summaries, and compiled context packs are derived data. They
still require confidentiality and integrity controls, but they never outrank
canonical SQL.

## Actors

- an authorized human, agent, service, administrator, or auditor;
- an authorized actor attempting to exceed its scope;
- a compromised or incorrectly configured agent/client;
- an attacker with control over imported content, tool output, or a remote page;
- a malicious or unreliable model/vector provider;
- an operator with host/database access;
- an external customer or partner interacting through a CRM/chatbot gateway;
- a compromised or over-privileged channel gateway/publisher;
- a remote attacker without valid credentials.

## Trust boundaries

```text
caller / MCP client
        |
        v
HTTP validation -> authentication -> authorization/policy
        |                              |
        |                              v
        |                       canonical SQL + FTS
        |                              |
        +------ untrusted data --------+
                       |
                context compiler
                 /             \
       optional model       optional vector index

operator boundary: config, migrations, backups, logs, runtime account
exchange boundary: JSONL import/export and future federation
agent edge: host plugin/hooks and MCP/REST credential
event edge: signed outbound webhook to an allowlisted orchestrator
channel edge: external user -> CRM/chatbot gateway -> scoped Titen service key
dashboard edge: browser -> loopback session adapter -> authenticated API -> policy
ingress edge: Tailscale Serve or Cloudflare Tunnel + Access -> loopback adapter
```

Rules at every boundary:

1. identity and tenant authority come from authentication, never request data;
2. authorization happens before FTS/vector retrieval;
3. model, vector, imported, checkpoint, and stored text are untrusted data;
4. canonical records are hydrated and re-authorized after derived-index lookup;
5. optional-service failure degrades capability without inventing success;
6. claim trust, internal visibility, and external release approval are checked
   independently; no one signal implies another.
7. Memory Atlas authorizes before traversal and both endpoints of every edge;
   hidden records cannot influence returned labels, topology, or counts.
8. Dashboard capability hiding is never authorization; every API request is
   authenticated and authorized again.

## Security invariants

- Cross-organization data must not be returned or existence-disclosed.
- Another agent's private memory is never eligible through semantic similarity.
- A claim cannot exceed the trust of its visible evidence and caller authority.
- An LLM cannot create a source link to an unknown or unauthorized observation.
- Retrieved text cannot grant Titen authority. Responses mark each item as
  untrusted; callers remain responsible for preserving prompt boundaries.
- Revoked, expired, superseded, or deleted rows cannot return through a stale
  vector hit.
- Checkpoints, leases, and handoffs are execution state, not factual evidence.
- Secrets, raw prompts, private content, embeddings, and full private IDs stay
  out of normal logs and audit events.
- Recoverable webhook and federation signing secrets are versioned AES-GCM
  ciphertext bound to their record ID; keyrings remain outside canonical SQL.
- Export, import, backup, and restore preserve scope and provenance.
- External users never receive Titen credentials or direct canonical-memory
  access.
- Only an active release snapshot for the authenticated channel/audience may
  enter channel context; `verified` source memory is not enough.
- Anonymous context cannot select a customer subject, and customer-specific
  memory never enters release indexes.
- A Memory Atlas projection cannot grant authority, become evidence, or expose
  hidden existence through topology, labels, aggregate counts, caches, or scope
  preview.
- A dashboard API key exists only in adapter memory, never Web Storage, HTML,
  URL, response payload, or normal logs; its session is opaque, bounded, and
  invalid after logout, expiry, restart, or key revocation.

## Threat register

| ID    | Threat and path                                                                                              | Required controls                                                                                                                                                                                    | Verification                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| TM-01 | stolen, shared, or replayed API key                                                                          | high-entropy secrets, hash at rest, narrow scope, labels, revocation, bounded rotation overlap, TLS at ingress                                                                                       | revoked key fails next request; raw key absent from SQL/log/export                                                   |
| TM-02 | request supplies another tenant, subject, trust, or visibility                                               | derive authority from credential and membership; validate requested scope against it                                                                                                                 | valid foreign IDs return non-disclosing `404`; invalid trust write fails before mutation                             |
| TM-03 | stored prompt injection becomes an instruction on recall                                                     | label context as untrusted reference data; separate instructions from retrieved items; never execute memory content inside Titen                                                                     | malicious observation is returned only as quoted data and grants no operation                                        |
| TM-04 | poisoned import, webpage, tool result, or agent message creates durable false memory                         | preserve immutable source, source type, trust, observer, and derivation metadata; require stronger approval for procedural/org memory                                                                | untrusted source cannot become verified; poison fixtures remain traceable and revocable                              |
| TM-05 | model hallucinates facts or evidence IDs during consolidation                                                | structured bounded output, schema validation, authorized source lookup, atomic commit, no autonomous evidence deletion                                                                               | fabricated/foreign source ID creates no claim                                                                        |
| TM-06 | vector poisoning or stale projection bypasses canonical state                                                | store opaque IDs/minimal scope metadata; hydrate SQL; check tenant, version, status, validity, and tombstone; durable repair outbox                                                                  | revoked/deleted/version-mismatched hit returns no content                                                            |
| TM-07 | conflicting perspectives are merged into false consensus                                                     | observer-specific claims, explicit disputes, evidence-backed resolution, append-only history                                                                                                         | opposing authorized claims coexist and appear as conflict when relevant                                              |
| TM-08 | feedback manipulation promotes harmful content                                                               | feedback cannot alter evidence/trust/auth; threshold and cap ranking influence; retain negative labels                                                                                               | repeated feedback cannot expose an ineligible record or make it verified                                             |
| TM-09 | checkpoint/handoff payload injects facts or leaks private evidence                                           | separate execution tables; explicit visibility; recipient authorization; completed findings must become observations                                                                                 | checkpoint text alone cannot support a claim; invalid handoff is rejected                                            |
| TM-10 | lease/checkpoint race duplicates destructive work                                                            | idempotency keys, optimistic versions, bounded TTL, atomic acquisition, `409` on conflict                                                                                                            | concurrent fixture yields one active lease and no silent overwrite                                                   |
| TM-11 | log, health, error, telemetry, or audit leaks content/secrets                                                | allowlisted metadata, opaque/short identifiers, generic external errors, no raw prompts/content/embeddings                                                                                           | synthetic canary never appears in captured operational output                                                        |
| TM-12 | crafted JSONL import escapes scope or corrupts history                                                       | versioned schema, dry-run, destination mapping, record limits, full validation before mutation, idempotency                                                                                          | foreign mapping and unknown version fail with zero writes                                                            |
| TM-13 | resource exhaustion or model-cost amplification                                                              | size/token/candidate limits, bounded retries/batches, rate limits at ingress, no unbounded model/tool loop                                                                                           | oversized input fails predictably; degraded mode avoids retry storms                                                 |
| TM-14 | backup theft, partial restore, or rollback revives deleted data or externally serves imported releases       | mode `0600`, encryption by deployment policy, checksums, restore to new DB, integrity/scope smoke, rebuild projections, suspend imported releases until channel security rebind                      | recovery drill verifies history/tombstones and no channel release is eligible before rebind                          |
| TM-15 | migration drift changes authorization or loses evidence                                                      | ordered versioned migrations, readiness gate, transactional changes when supported, compatible rollback plan                                                                                         | old/new fixture and cross-scope suite pass before deploy                                                             |
| TM-16 | federation sends unauthorized data, spoofs provenance, bypasses local approval, or accepts forged/replayed events or memory | explicit source/destination claim filters, export/import scopes, owned peer HMAC over raw body, immutable first-use source-org binding plus SQL race fence, organization visibility/trust/domain validation, remote `policy_approved` rejection, immutable remote-ID payload hashes, atomic canonical batch, no credentials | dual-runtime fixtures reject cross-org, unsigned, tampered, private/team, policy-approved, changed-source, changed-ID, and replay attempts; concurrent source binding has one winner; valid disputed evidence is recalled |
| TM-17 | agent hook leaks a transcript/secret, recursively captures its own Titen calls, or blocks the host on outage | typed allowlisted capture, no raw transcript/chain-of-thought capture, secret scanning, recursion marker, bounded timeout, fail-open optional assistance                                             | canary secret absent; one host event yields at most the declared calls; outage returns within hook budget            |
| TM-18 | webhook enables SSRF, DNS rebinding, forged/replayed orchestration, or synchronous availability failure      | explicit hostname allowlist, HTTPS-only address-pinned transport, pre-connect DNS/IP checks, no redirects, HMAC, stable delivery ID, atomic lease, bounded timeout/retry                              | private, mapped IPv4, special IPv6, redirect, rebind, timeout, concurrent claim, and expired-lease fixtures pass      |
| TM-19 | verified, tagged, similar, or model-generated content is published without disclosure approval               | exact claim-version release, separate approval capability, immutable released snapshot, no automatic activation, audit                                                                               | verified-but-unreleased and model-proposed records never enter channel context                                       |
| TM-20 | channel/gateway query leaks internal, wrong-audience, or another customer's memory                           | gateway credential bound to channel/audience, short-lived signed customer assertion with issuer/audience/expiry/replay validation, subject-aware cache keys, release-only index, canonical hydration | anonymous/raw-subject, replayed assertion, and cross-channel/customer fixtures return no content or existence signal |
| TM-21 | stale cache/vector hit continues serving a revoked, expired, replaced, or source-invalidated release         | canonical release and exact source-claim version/status/dispute/validity check after every candidate lookup; commit-time eligibility invalidation; rebuildable projections                           | revoked or source-invalidated release is absent from the next compile despite injected stale candidates              |
| TM-22 | Memory Atlas traversal, cache, layout, or scope preview leaks hidden records/topology or grants authority     | authorize before expansion; authorize both edge endpoints; principal/policy-scoped cache; canonical hydration; no hidden counts; explicit preview capability; bounded depth/nodes/edges/time/bytes | foreign focus/edge and stale-cache fixtures reveal no node, label, edge, count, or timing-dependent expansion; preview grants no access |
| TM-23 | mixed-tenant or mixed-visibility records enter one extraction/reflection batch                               | authorize and minimize the source set before serialization; bind job to organization/scope; rehydrate every cited ID                                                                                | foreign canary never enters provider request/output and no hidden existence is disclosed                             |
| TM-24 | provider accepts JSON mode/schema but returns malformed, oversized, or authority-bearing output                | exact local schema/key/enum/size validation; output is untrusted; fail closed before semantic transaction                                                                                           | valid JSON with extra authority field and invalid enum creates no claim/action                                       |
| TM-25 | model/prompt drift changes decisions without an auditable boundary                                             | immutable provider/model/prompt/schema/source-set fingerprint; locked evaluation and explicit rollout/reindex                                                                                       | fingerprint change cannot reuse a completed job or silently become production default                               |
| TM-26 | remote model egress exposes more memory than required or leaks a credential                                    | minimum authorized source content, TLS/VPC endpoint policy, secret store, no redirects/logging, per-deployment processing disclosure                                                                | captured request contains only allowlisted fields; keys/prompts/raw output absent from logs/export                   |
| TM-27 | duplicate drain, crash, or retry creates duplicate claims or unbounded spend                                   | persistent lease/expiry, unique job fingerprint, bounded timeout/attempt/backoff/concurrency, atomic result-plus-done transaction                                                                    | concurrent/expired-lease/crash fixtures create at most one semantic result and terminate within declared bounds      |
| TM-28 | omitted project scope silently broadens context across otherwise-visible projects                              | treat omission as unscoped-only in FTS, vector filter, and hydration; require explicit `cross_project` plus `context:compile:all`; return effective scope and grant reason                            | two-org/two-project REST/MCP fixture proves omission, foreign substitution, visibility, membership, and broad-grant isolation |
| TM-29 | dashboard login, cookie replay, CSRF, Host confusion, or stale browser state exposes another principal's data   | exact Host/Origin checks; HTTPS remote origin; opaque HttpOnly SameSite cookie; absolute TTL; process-local key isolation; clear state on denial/logout/restart; fixed routes and bounded bodies       | integration and browser tests prove two-session isolation, invalid/revoked key rejection, origin/body limits, logout/restart invalidation, and stale-state clearing |
| TM-30 | a public tunnel bypasses intended identity controls or exposes the loopback API                                  | keep API and adapter on loopback; Tailscale grants or Cloudflare Access default-deny before routing; separate API hostname/policy when required; retain Titen bearer auth; no Funnel                   | remote ingress reaches only the adapter hostname; direct ports deny; unauthenticated dashboard/API operations fail |

## Memory-poisoning controls by lifecycle

### Write

- Record who supplied content, what source produced it, and when it occurred.
- Default external/model-derived material to unverified.
- Validate extraction against existing authorized observation IDs.
- Require explicit authority for verified, procedural, or organization-visible
  claims.

### Enrich and reflect

- Keep source evidence immutable.
- Preserve contradictions instead of allowing last-write-wins synthesis.
- Version prompts/models and bound each batch.
- Treat proposed lifecycle changes as validated data, never direct commands.
- Authorize before provider serialization and use only supplied source/premise
  IDs; embeddings shortlist candidates but never cross a scope boundary.
- Keep extraction degradation separate from embedding degradation and preserve
  retryable work without a retry storm.

### Recall

- Filter scope and visibility before retrieval and after canonical hydration.
- Include provenance, trust, temporal validity, and conflict metadata.
- Pack the smallest relevant context under budget.
- Tell callers that every memory item is untrusted reference data.
- For channel context, query release projections only and hydrate active
  channel/audience-eligible snapshots; never fall back to their source claims.
- Resolve authenticated customer subjects at the trusted gateway boundary and
  keep customer context separate from released items/caches.
- Compile Memory Atlas views only after policy filtering; re-authorize every
  projected record/edge during hydration and report limits using authorized
  results only.

### Act and learn

- The calling agent remains responsible for authorizing real-world actions.
- Outcome feedback tunes utility only; it cannot rewrite evidence or policy.
- Harmful/incorrect feedback remains available for evaluation after revocation.

## Operational controls

- Cloudflare secrets or mode-`0600` VPS configuration hold credentials.
- VPS binds to loopback by default and runs as a dedicated non-root user.
- `/healthz` reveals liveness only; `/readyz` reports capabilities without paths,
  credentials, record counts, or private identifiers.
- Production release checks unauthenticated `401`, authenticated content type,
  deployed revision, migration compatibility, rollback, and cross-scope denial.
- Remote dashboard access uses Tailscale Serve or Cloudflare Tunnel protected
  by Cloudflare Access; Tunnel alone and Tailscale Funnel are not approved
  authentication boundaries.
- Backups are verified by restore, integrity check, and functional smoke—not by
  file existence alone.
- Observation erasure is an explicitly scoped, audited tombstone that removes
  readable canonical and derived text while retaining hashes and provenance.
  Backups predating the tombstone can restore that text and require separate
  operator expiry or replacement.
- The optional dashboard receives no direct database/binding access, applies a
  restrictive CSP, uses fixed adapter routes, and is omitted without affecting
  service readiness.

## Residual risks

- A caller may still act unsafely on accurately returned untrusted content.
- A CRM/chatbot gateway or response model may disclose, transform, or combine
  correctly released context unsafely; application response controls and
  monitoring remain required outside Titen.
- Model-based extraction may produce subtle false claims that pass structural
  validation; provenance and approval reduce impact but do not prove truth.
- A fully compromised host/account can read canonical data available to that
  deployment. Host hardening and encryption policy remain necessary.
- Traffic analysis and provider metadata may reveal usage patterns even when
  content is excluded.
- Authorized Atlas topology may still reveal sensitive organizational patterns
  to an over-privileged operator; capability scoping and audit remain required.
- An adapter process crash logs users out; durable or distributed sessions are
  deferred until a deployment needs multiple adapter replicas.

## Review triggers

Review this model before merging a change that adds:

- a new externally reachable endpoint or credential type;
- a new model, vector, telemetry, import, or export provider;
- wider visibility or policy semantics;
- background execution outside the current bounded outbox model;
- an agent plugin/hook event, webhook event type, or outbound destination class;
- storage of raw prompts, conversations, tool traces, or new sensitive fields;
- SSO/SCIM, a new channel/audience/public-serving mode, or a hosted
  control plane;
- a new dashboard mutation, session backend, Memory Atlas lens, renderer,
  cache, stored layout, or traversal backend.

## Research references

- [Bad Memory: Evaluating Prompt Injection Risks from Memory in Agentic Systems](https://arxiv.org/abs/2607.14611)
- [Hidden in Memory: Sleeper Memory Poisoning in LLM Agents](https://arxiv.org/abs/2605.15338)
- [From Untrusted Input to Trusted Memory](https://arxiv.org/abs/2606.04329)
- [Anthropic: effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
