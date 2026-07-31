# ADR-0004: Model-assisted memory enrichment uses two bounded background lanes

- Status: accepted and implemented opt-in; production activation gated
- Date: 2026-07-31
- Decision owners: Titen maintainers

## Context

Titen's verified service stores canonical observations, accepts direct
caller-supplied claims, indexes claims, and compiles context. It classifies
observations or reflects over related claims only when an operator enables the
separately configured background capability.

Embeddings can retrieve similar candidates, but similarity cannot determine a
claim kind, temporal validity, evidence support, conflict, trust, visibility,
or lifecycle action. An LLM can propose those interpretations, but its output
is probabilistic and untrusted. Calling it inside a canonical write would make
memory durability depend on provider latency and availability.

The design must add useful memory management without creating a second source
of truth or separate Cloudflare and Bun semantics.

## Decision

Titen implements optional model-assisted enrichment as two bounded
background lanes backed by durable SQL jobs:

1. **Derivation** turns one accepted observation into zero or more atomic,
   evidence-linked claim proposals.
2. **Reflection** examines a bounded same-scope claim cluster and may propose a
   pattern, procedure, duplicate link, conflict, or supersession candidate.

Both lanes use the same invariants:

- canonical writes, direct claims, FTS, and context remain usable when the
  feature is disabled or degraded;
- authentication-derived organization, scope, subject, maximum visibility,
  and trust ceiling never come from model output;
- embeddings only retrieve authorized candidates;
- a model emits a bounded JSON proposal citing supplied source or premise IDs;
- a valid empty/no-memory proposal completes the job without a claim or retry;
- Titen validates schema, IDs, scope, evidence, size, time, and authority before
  an ADD-only transaction creates claims, links, history, and index work;
- unknown or foreign IDs, malformed output, authority fields, deletion, trust
  elevation, publication, and autonomous dispute resolution produce no
  semantic write;
- a persistent lease, bounded retry/backoff, and pipeline fingerprint make
  replay and crash recovery explicit;
- prompts, raw model responses, private memory, credentials, and embeddings do
  not enter operational logs.

The two lanes have different enqueue boundaries. When derivation is enabled,
an eligible canonical observation and its derivation job commit atomically. A
reflection job is instead created by a scheduler from a bounded authorized
snapshot of premise IDs/immutable versions and a policy-snapshot fingerprint.
Reflection insertion is a separate transaction, idempotent over that snapshot
fingerprint and the pipeline fingerprint; it is not attached to an unrelated
canonical write. An unchanged snapshot reuses the same job identity, while any
premise version or policy-snapshot change produces a new snapshot identity.

The initial job states are `pending`, `leased`, `done`, and terminal `failed`,
with lease expiry, next-attempt time, attempt count, error class, and the
lane-specific identity above. The model proposal exists only in worker memory
during validation. Persistent job state keeps bounded input/output hashes and
committed result row IDs, never a raw or normalized proposal payload. Vector
work also needs `submitted` before `ready` when the backend is eventually
consistent.

The current `POST /v1/consolidations` route remains the deterministic
caller-supplied claim path. Automatic derivation is a separate background
capability; it will not silently change that route's latency or semantics.

## Model and embedding policy

Titen configures an extraction model by immutable provider/model ID and stores
its pipeline metadata, but model names are not product semantics and grant no
authority. The implementation begins with one model contract, not a provider
factory or Luna/Terra/Sol router.

The 2026-07-31 pilot supports **Sol as the sole canary candidate for both
derivation and reflection**. Sol passed 35/36 exact reflection trials, with raw
local-schema conformance of 75/75 derivation and 36/36 reflection responses.
Those schema counts do not prove zero invalid semantic commits; the pilot did
not exercise the canonical commit boundary. Luna violated the derivation schema
on every non-empty trial; Terra did not establish a safe quality or reflection
advantage. No model is a production default until the locked corpus and runtime
gates pass. A smaller model may replace Sol only after versioned
non-inferiority evidence.

The embedding model is independently configurable and fingerprinted. It may
retrieve duplicate, alias, and related-claim candidates, but cosine similarity
never performs classification, merge, conflict resolution, or truth selection.
The embedding pilot is directional only because its fixture, gold, scorer, and
raw-result manifest are not independently reproducible from repository evidence.

The OpenAI-compatible route used in the pilot accepted `json_schema` without
enforcing it. Titen therefore requires local validation even where a provider
advertises strict structured output. Invalid output fails closed; provider
success is not semantic success.

## Runtime mapping

The job contract, validator, and contract tests stay in the shared core.

| Concern | Cloudflare | Bun on VPS or local computer |
| --- | --- | --- |
| Canonical store and durable jobs | D1 | SQLite |
| Trigger | Cron plus manual drain | startup recovery, bounded timer, manual drain |
| Model | Workers AI binding or allowlisted authenticated HTTPS/VPC endpoint | local or remote OpenAI-compatible HTTP |
| Embedding/vector | Workers AI plus Vectorize, or compatible provider | compatible HTTP embedder plus optional `sqlite-vec` |
| Secrets | Worker secrets/native binding | mode-restricted environment or service credential file |

Cloudflare Queue is not a baseline dependency. It may later carry only opaque
job IDs as a wake-up optimization when measured backlog or semantic-ready lag
exceeds an accepted objective. SQL remains the authoritative ledger because
queue delivery is at least once.

## Consequences

- Canonical writes stay portable and provider-independent.
- Titen gains evidence-linked automatic management without becoming an agent
  loop or giving a model lifecycle authority.
- Enrichment and semantic readiness are eventually consistent and require
  explicit observability, retry, versioning, and migration gates.
- Model, prompt, schema, and embedding changes require a frozen evaluation and
  fingerprint change.
- The first implementation uses one model even if a future measured workload
  justifies cheaper routine derivation and stronger scheduled reflection.

## Rejected alternatives

- **Embedding-only classification:** similarity is candidate retrieval, not an
  evidence-grounded memory decision.
- **Synchronous model calls on writes:** couples durability and latency to a
  remote optional dependency.
- **Automatic update, merge, delete, or truth selection:** violates append-only
  evidence and deterministic authority.
- **A three-tier model router now:** the pilot proves no safe Luna/Terra role;
  speculative routing adds failure paths without a measured benefit.
- **Cloudflare Queue, Redis, Workflows, or another worker service now:** a SQL
  outbox and existing Cron/timer trigger cover the required semantics.
- **Separate Cloudflare and Bun enrichment pipelines:** creates semantic and
  recovery drift.

## Rollout gate

Production activation requires a paired spec and plan, a versioned
language-neutral gold corpus, local validator tests, concurrent lease/crash
recovery tests, zero invalid semantic commits from malformed or unauthorized
output, zero fabricated/cross-scope accepted IDs, locked model and embedding
fingerprints, a reproducible embedding corpus, and real smoke tests on
Cloudflare Paid D1, VPS, and a local computer. The runtime path is shipped but
remains disabled by default and must not be presented as production-active until
those gates close.

## Related

- [Level 6 / Level 5 boundary](./0001-level-6-product-level-5-kernel.md)
- [Memory lifecycle](../architecture/memory-lifecycle.md)
- [Evaluation evidence](../research/2026-07-31-memory-model-evaluation.md)
- [Evaluation contract](../testing/EVALS.md)
