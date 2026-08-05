# Changelog

All notable changes to Titen are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Titen is in `0.x`: per SemVer clause 4, the public API is not yet stable. Below
`1.0.0` a **minor** bump carries breaking changes and a **patch** carries
everything else — any breaking entry appears under **Changed** and names the
migration. Released versions live on npm under `latest`; prereleases
(`0.2.0-rc.1`) under `next`. `main` may be ahead of both; see
[versioning and channels](./docs/engineering/release.md#versioning-and-channels).

The word **stable** around Titen — the npm `latest` dist-tag and
`"channel": "stable"` in [`titen.dev/version.json`](https://titen.dev/version.json)
— names the release *channel*, meaning a deliberate release rather than a
prerelease. It never describes API stability; the paragraph above does.

Every release heading below is dated in **UTC**, matching the npm registry
`time` field for that version. A heading date and
`https://registry.npmjs.org/titen-memory` must agree.

The published npm package is [`titen-memory`](https://www.npmjs.com/package/titen-memory).
The **CLI command is `titen`** regardless; see [Package name](#package-name).

## [Unreleased]

## [0.6.1] — 2026-08-05

### Fixed

- Webhooks no longer silently drop events written in their own registration
  millisecond. Eligibility compared `w.created_at < e.created_at`, a strict
  comparison on a millisecond wall-clock string, so on a fast host the
  registration and the next write shared a millisecond and those events were
  never queued, never delivered, and never retried. Delivery now pages on the
  `event_order.seq` watermark that `/v1/events` and federation already use:
  migration 22 adds `webhooks.created_seq`, backfilled to the current head so an
  upgrade delivers only future events rather than replaying history. Both
  eligibility sites are converted — `processWebhooks` and the background
  `deliverPending` selector — because the second one would otherwise leave an
  organization unwoken until another event arrived. Measured on a 16-core host:
  the contract file went from 8 of 12 runs failing to 12 of 12 passing.
  Closes #265.

- Retrieval ranking is now reproducible in the FTS-only lane. Exactly-tied
  scores previously fell through to `claim_id`, a fresh uuid per ingest, so the
  same corpus ranked differently on every run. Ties now break on the claim
  statement — content-derived, and compared by code unit so Bun and Workers
  agree — before falling back to the id. This makes rank reproducible, not
  better: it picks an arbitrary-but-stable winner among genuine ties. What
  causes the ties is untouched and stays open as #227. Closes #226.
- Upgrading a pre-0.2.0 store now refuses instead of succeeding into silence.
  Migration 10 scopes `team` visibility to a workspace and nothing backfills the
  column, so a 0.1.x store migrated cleanly and then answered 404 on every
  claim. `migrate` now counts legacy team rows first and fails closed, naming
  the count and the 0.2.0 data floor. Rebinding is deliberately not attempted: a
  legacy row's real workspace is unknowable, and inventing one would invent an
  authorization boundary. Closes #257.
- The logical export refuses a pre-workspace `team` row rather than writing a
  backup its own importer rejects. `export_import` is advertised as enabled, so
  an artifact that cannot be restored is worse than an error. Closes #258.

### Measured, not built

- The reranking stage recorded as strategic debt was measured before being
  written, and the measurement says do not write it. The oracle ceiling over
  Titen's own top-10 is +10.2 points (recall@1 0.880 to 0.982), but every cheap
  reranking signal tested captured at most 0.6 of those points at p=0.61, and
  two were significantly *worse* than no reranking at all. MemPalace, which
  ships one, scored lower with it than without it in both embedding
  configurations. The gain is real and lexical signals cannot reach it.
  Closes #269.

### Added

- In-process mode for Bun hosts. `serve()` returns the handler it serves, and a
  `titen-memory/bun` subpath exports it, so a benchmark or embedding host can
  drive `TitenClient` through an injected `fetch` with no loopback hop. The
  transport is removed; auth, scopes, and response envelopes are unchanged
  because it is the same handler. An ephemeral socket is still bound and unused,
  tracked in `PONYTAIL-DEBT.md`. Closes #230.

### Documentation

- Measured the memory-agent field on an externally authored corpus
  (LongMemEval-S, MIT) and recorded where Titen actually stands:
  [landscape note](./docs/research/2026-08-04-memory-agent-landscape.md).
  `docs/testing/EVALS.md` now marks recall@5/@10 as saturated on that corpus so
  only recall@1 and MRR@10 are quoted as discriminating, and `blueprint.md` no
  longer plans a LoCoMo run — LoCoMo is CC BY-NC 4.0 and a launch is commercial
  use, which an SPDX check misses because GitHub reports it as `NOASSERTION`.
  Closes #267, #270, #271.

- The single-core throughput ceiling is published as an operator sizing rule in
  [VPS deployment](./docs/deployment/vps.md) and `deploy/README.md`: at and
  above 10,000 claims one client saturates one process, so shard by subject
  across processes rather than adding clients. Cloudflare records that this is a
  `bun:sqlite` property that does not transfer to per-request isolates. Closes
  #259.
- `docs/testing/EVALS.md` carries the FTS-only degradation curve, so no
  FTS-only quality figure is quoted without the corpus size it was measured at.
  Closes #260.
- The `cross_language:en` zero is explained rather than left open: the stratum
  rotates document language past query language, so it is three language pairs,
  and English queries never retrieve a non-English document (2,000 of 2,000
  top-10 hits). A provider embedding property, not a fixture defect. The fixture
  is unchanged because its hashes pin the locked holdout and pre-hoc threshold.
  Closes #245.
- `docs/engineering/release.md` states why the tarball carries no provenance
  attestation — it requires a supported CI's OIDC token and this repository
  publishes by hand on purpose — and gives consumers the registry checks that do
  work, with what they do not prove. Closes #242.
- One product sentence across the GitHub description, README, and
  `package.json`. Closes #225.

## [0.6.0] — 2026-08-04

### Evidence

- First published head-to-head against a comparator on an **externally authored**
  corpus: [neutral head-to-head](./docs/testing/2026-08-04-neutral-head-to-head.md),
  Mr.TyDi Indonesian, 25 queries over 100 documents, 10 repeats, against
  self-hosted `mem0ai` 2.0.13. The result is **parity, not superiority**. Point
  estimates favour Titen on every metric, but both systems are deterministic on
  this harness, so disjoint across-repeat ranges prove nothing; paired sign tests
  over the same 25 queries give p >= 0.500 on every metric, and the whole margin
  is two queries (20 of 25 rank-1 hits against 18). Titen loses one query to both
  Mem0 configurations. What the run does establish: ~1.9x lower query latency
  with vector search and ~400x without it, ~9.6x faster ingest, and deterministic
  ranking **when vector search is enabled**. The FTS-only lane still produces a
  different ordering on every repeat, exactly as 0.5.7 did.
- Correction to the record: the five-repeat figures published earlier the same
  day for 0.5.7 — recall@1 0.680, MRR@10 0.807, query p50 170 ms — were the
  **top** of their ranges, not medians. Re-scoring the same artifact per repeat
  gives a 0.62 median for recall@1. Do not requote them.
- [Scale and concurrency](./docs/testing/2026-08-04-scale-and-concurrency.md):
  the service uses one core at every concurrency level, so a single client
  saturates it at and above 10,000 claims, and retrieval quality falls with
  corpus size on a synthetic corpus (recall@1 1.00 / 0.81 / 0.49 at 10^3 / 10^4 /
  10^5). Cold start stays at ~53 ms and resident memory grows 2.9% across a
  hundredfold corpus. Tracked as #259 and #260.
- [Operational lifecycle](./docs/testing/2026-08-04-operational-lifecycle.md):
  nine published releases rehearsed through in-place upgrade with zero canonical
  rows lost or mutated, plus a real backup, destroy and restore drill and a JSONL
  export/import round trip. The **data-usable upgrade floor is 0.2.0**: a 0.1.x
  store migrates without error and then answers 404 on every claim (#257), and
  its export is rejected by the importer (#258).

### Added

- `POST /v1/context/compile` accepts an optional `top_k`, a hard ceiling of 1
  through 1,000 on returned items, exposed by the TypeScript SDK, the Python
  client, and the `titen_compile` MCP tool. It bounds the answer where
  `max_candidates` bounds what retrieval considers, and is applied to the ranked
  list before the token budget, so a bounded pack costs fewer tokens instead of
  being truncated client-side. Omitting it changes nothing. Closes #229.
- `TITEN_EMBED_PROFILE=raw-unit-v1-model-mismatch-acknowledged` sends raw
  embedding input on a model whose id claims a prompt convention. The forced
  rule that rejects `raw-unit-v1` for an EmbeddingGemma model is unchanged and
  still fails closed; this is the one deliberate way past it, for a model served
  without the prompts and for a fair head-to-head against a system that embeds
  raw text. It is a distinct profile in the index fingerprint, so switching to
  or from it answers `503` with `index_fingerprint_mismatch` until the index is
  rebuilt rather than mixing prefixed and raw vectors. The retrieval harness
  accepts `TITEN_EVAL_EMBED_PROFILE` to use it. Closes #250.

### Documentation

- The README states up front that Titen's default memory model is
  caller-authored claims: `consolidate()` takes explicit statements with explicit
  source links, and model-assisted derivation remains activation-gated with no
  candidate model past the gate.
- The README states the client surface exactly: a TypeScript SDK, the `titen`
  CLI, and the standard-library-only Python client in `clients/python/` that is
  installed from a checkout and is not published to PyPI. Callers in any other
  language are pointed at the REST reference.
- Project status leads with pre-1.0 and defines *stable* as the release channel
  (npm `latest`, `"channel": "stable"` in `version.json`), never as API
  stability. The changelog header and the release guide carry the same wording.
- The SDK quickstart now works by copy-paste from `npm init -y`. `titen-memory`
  is ESM-only, so the quickstart adds `npm pkg set type=module` and names the
  file `titen-example.js`; previously the documented steps ended in
  `SyntaxError: Cannot use import statement outside a module`.
- `TITEN_EMBED_REVISION`, `TITEN_EMBED_PROFILE`, and `TITEN_EMBED_MIN_COSINE`
  are documented in the README and the VPS guide with their absence behavior,
  the model-forced profile rule, and a worked EmbeddingGemma example.
  `TITEN_EMBED_MIN_COSINE` has no shipped default and semantic retrieval fails
  closed without it.
- Vectorize status is stated identically everywhere: verified live only on the
  maintainer's isolated `titen-test-*` stack, which is test production and not
  general availability.

### Fixed

- Hybrid ranking no longer decides a tied top result with a random identifier.
  Because lexical and vector relevance are each min-max normalized inside the
  candidate set, each signal's own best scores exactly `1`; when those are
  different claims the two tie on the whole weighted score, and the tie-break
  was `claim_id` over UUIDs minted at ingest. Equal scores now break on the
  stronger vector similarity first, then on `claim_id`. Two cosines are only
  ever compared with each other, so no constant and no cross-scale comparison
  enters the ordering, no returned score changes, and lexical-only ranking is
  untouched. On the release retrieval harness, 10 repeats, the vector lane's
  recall@1 median rises from 0.7143 to 0.8571, MRR@10 from 0.8333 to 0.9048 and
  nDCG@3 from 0.8758 to 0.9286, and every range collapses to zero width. The
  ceiling is unchanged: this is a higher median with the variance eliminated,
  not a higher best case. Part of #226; #226 and #227 both remain open.
- Temporal polarity reaches lexical retrieval. "Mulai Juli 2026" and "Sebelum
  Juli 2026" previously scored identically for any query that did not repeat one
  of those words verbatim, because a surviving marker matched only a claim using
  the identical word. A marker now expands inside the MATCH to the other markers
  naming the same window boundary **in the same language**, so "sejak Juli 2026"
  reaches "Mulai Juli 2026". Groups never span languages, and markers that are
  also function words (`dari`, `from`) stay in the stoplist and are not
  expanded. `query_terms_used` still counts only the caller's terms, and no
  ranking term was added. On the release retrieval harness, 10 repeats, the
  FTS-only lane's recall@1 median rises from 0.5714 to 0.7143 and nDCG@3 from
  0.7517 to 0.8044, both with the variance eliminated and the maximum unchanged.
  MRR@10 rises from a median of 0.7381 to 0.8061 but keeps a residual range of
  [0.8061, 0.8095] across four independent 10-repeat runs, so its variance is
  reduced rather than removed. Closes #228.
- `budget.omitted_items` counts the ranked candidates a `top_k` bound discarded,
  not only those the token budget dropped. A count-bounded pack previously
  reported zero omissions with `budget_exhausted: false`, so a caller could not
  tell a truncated answer from a complete one.
- Release headings for 0.5.7, 0.5.6, 0.5.5, and 0.2.0 now carry their UTC
  publish dates and agree with the npm registry `time` field; they had recorded
  the maintainer's local (UTC+7) date.
- The full-fit context contract no longer pins an absolute as-of date, so it
  stops passing or failing on the calendar. Shipped code is unchanged: the
  fixture asked for context as of a date that had moved into the past, and
  `valid_from <= at` correctly excluded the claims it had just written.

## [0.5.7] — 2026-08-01

### Documentation

- The npm README now gives one ordered path from CLI install through bootstrap,
  agent-specific keys, service readiness, and verified MCP setup for Codex,
  Claude Code, OpenClaw, Hermes, and generic stdio clients.
- The host guide separates direct Streamable HTTP from the bundled `titen mcp`
  bridge, keeps credentials in host environments, and includes a nine-tool
  connection check.

### Fixed

- Dashboard integration and browser gates no longer share hard-coded port
  ranges with unrelated development servers.

## [0.5.6] — 2026-08-01

### Added

- `titen mcp` bridges newline-delimited stdio MCP clients to an existing
  authenticated Titen `/mcp` endpoint, so hosts without native remote MCP can
  use the same nine tools without another memory implementation.

### Changed

- MCP initialization now tells compatible hosts to resolve the repository and
  compile authorized memory once at each task or scope boundary while keeping
  durable writes explicit and typed.

### Security

- The stdio bridge accepts its endpoint and revocable key only through the
  inherited environment, rejects credential-bearing or ambiguous URLs, emits no
  notification reply, and sanitizes upstream failures without exposing the key.

## [0.5.5] — 2026-08-01

### Upgrade notes

- The canonical schema advances from 20 to 21. Take a verified backup and run
  `titen migrate --dry-run` before starting 0.5.5. The migration is additive;
  rollback restores the backup with the 0.5.4 binary.
- Dashboard replicas that must preserve sessions across restarts share one
  base64url-encoded 32-byte `TITEN_DASHBOARD_SESSION_KEY`. Without it, each
  process uses an ephemeral key and restart signs everyone out.

### Added

- Context compilation accepts an explicit historical `at` instant and a
  bounded `max_candidates` value through REST, MCP, and the TypeScript SDK.
- Stable source IDs and canonical claim hashes converge exact re-ingestion after
  the request idempotency window while changed evidence remains append-only.
- `POST /v1/index/verify` checks a bounded set of active claims against
  Vectorize or `sqlite-vec` and queues repairs without reading embedding values.
- The publishable OpenClaw bundle now includes remote Streamable HTTP MCP, and
  the Cursor package includes the metadata and documentation expected by its
  public plugin repository.

### Changed

- Dashboard login state is an authenticated AES-GCM HttpOnly cookie instead of
  process-local memory, so a shared key supports replicas without a session
  database.
- Confirmed semantic statement hashes avoid duplicate embedding calls; explicit
  reconciliation still forces a provider repair when an index record is absent.
- Context budget units now use deterministic UTF-8 bytes across runtimes, and
  Vectorize queries retain the native 100-result ceiling.
- The README now leads with Titen's Level 6 collaboration model and distinguishes
  evidence-grounded context from storage-only and similarity-only memory.

### Security

- Public Cloudflare login failures consume the canonical account throttle and a
  native Rate Limiting binding. The key contains no password or client IP.
- Password changes reject common and account-context values before a verifier is
  stored, while retaining the 15-character minimum and forced first change.
- Sealed dashboard sessions reject forged, expired, or undecipherable cookies;
  raw short-lived API credentials remain outside browser storage.

## [0.5.4] — 2026-08-01

### Added

- A checked-in `titen-test-*` Wrangler profile provisions the isolated live
  Worker, D1, Vectorize, Workers AI, and Cron contract without storing an
  account API token in the Worker.

### Changed

- Cloudflare schema readiness verifies the complete migration contract in one
  D1 read instead of issuing one remote read per required object and column.
- New dashboard passwords use six serial PBKDF2-HMAC-SHA-256 stages of 100,000
  iterations each, preserving the 600,000-operation work factor within the
  Workers Web Crypto per-call limit. Bun retains legacy verifier compatibility.
- The live semantic verifier uses an explicit bounded index drain; Cron remains
  a separately observed production reconciler instead of a timing dependency.

### Fixed

- The dashboard login username example is now the canonical bootstrap account
  `owner`, not a maintainer-specific placeholder.
- The Cloudflare runbook provisions the three Vectorize metadata indexes needed
  for scope-before-search filtering before the first vector upsert.

### Security

- Live unauthenticated and cross-organization probes fail with non-disclosing
  `401`/`404`, while native D1, Vectorize, and Workers AI bindings require no
  account credential inside the deployed Worker.

## [0.5.3] — 2026-08-01

### Added

- Bootstrap creates default username `owner` with a random temporary password;
  human operators sign in with username/password, and authorized owners/admins
  can atomically add another account, membership, role, and one-time password.
  API keys remain unchanged for agents, services, SDKs, CLI recovery, and
  existing integrations.

### Changed

- Schema 20 adds canonical operator accounts. Temporary-password login is
  restricted to password replacement; established login issues an eight-hour
  revocable API credential only to the server-side adapter.

### Fixed

- The per-principal sign-in state now uses a focused responsive login surface;
  the private product sidebar and operator topbar appear only after a valid
  session instead of framing the unauthenticated form.

### Security

- Password verifiers use unique salts and PBKDF2-HMAC-SHA-256 with 600,000
  iterations on both D1 and Bun/SQLite. Login failures are non-disclosing and
  locally throttled; password change and logout revoke short-lived dashboard
  credentials.

## [0.5.2] — 2026-08-01

### Added

- The operator dashboard now wires Memories, Context, Work, Audit, Governance,
  and Federation to fixed authenticated API routes, with capability-gated
  navigation and no fixture fallback.
- Per-principal dashboard login exchanges an API key for an opaque HttpOnly
  session, and authorized owners/admins can atomically create one human
  membership plus its one-time API key.
- The deployment guide now covers private Tailscale Serve and Cloudflare Tunnel
  protected by Cloudflare Access while both Titen listeners remain loopback-only.

### Changed

- The public SDK now types all six Memory Atlas lenses and the optional Add User
  fields on key creation.

### Security

- Dashboard routes enforce exact Host/Origin, bounded bodies and list results,
  credential isolation, revocation, expiry, logout/restart invalidation, and
  server-side authorization independent of browser navigation.

## [0.5.1] — 2026-08-01

### Fixed

- The dashboard content security policy now permits its bundled Titen mark data
  URI, so the release logo renders without allowing remote image sources.

## [0.5.0] — 2026-08-01

### Upgrade notes

- **Breaking:** the canonical schema advances from 17 to 19. Take a verified
  backup and run `titen migrate --dry-run` before starting 0.5.0; rollback
  restores that snapshot with the previous binary rather than running a down
  migration.
- Configure `TITEN_SECRET_KEYS` only when encrypted channels or federation are
  used. The lexical memory core remains available without it.
- A dashboard principal using governance lenses needs an active organization
  membership as well as the documented bounded key scopes.

### Added

- Enterprise governance now covers organization roles, typed approval and
  retention policies, claim review, encrypted channel assertions, versioned
  channel releases, legal holds, and external identity mappings.
- Opt-in canonical federation exchanges signed, filtered claim bundles with
  their evidence and provenance. Imports bind the source organization, preserve
  disagreement, reject unsafe trust elevation, and remain idempotent on both
  supported runtimes.
- The read-only dashboard now uses the live same-origin adapter for six
  authorized Memory Atlas lenses, including governance scope and knowledge
  release views. It has explicit loading, empty, denied, and disconnected
  states instead of a synthetic fallback.

### Changed

- Context compilation reports selected, omitted, and deduplicated candidate
  counts plus an explicit budget-exhaustion flag without exposing unauthorized
  records.

### Fixed

- Local key commands fail cleanly for a missing database, schema, organization,
  or key and no longer report a false revocation success.
- `titen backup` reapplies owner-only permissions after atomic replacement, so
  container bind mounts cannot leave the finished backup group- or world-readable.
- `titen migrate --dry-run` no longer changes file permissions or requires a
  writable database directory, so it works on a read-only pre-upgrade mount.

### Security

- Governance and federation mutations now enforce role, resource, retention,
  replay, peer-source, and cross-organization boundaries in the shared
  Bun/SQLite and workerd/D1 contract.

## [0.4.1] — 2026-08-01

### Added

- `titen version --check` explicitly reads the stable CLI/plugin release
  manifest from `titen.dev` and points users to the manual install guide without
  background polling or remote command execution.

### Fixed

- MCP initialization now reports the package SemVer as `serverInfo.version`
  instead of mislabeling a deployment revision such as `dev`, `test`, or a Git
  SHA as the server implementation version.
- Published SDK declarations now stay inside the package and exactly type claim
  inputs, readiness diagnostics/capabilities, key lifecycle fields, and a
  bounded event iterator that terminates on preserved cursors.
- Extraction now supports explicit strict-schema, JSON-object, and custom modes,
  rejects redirects and incomplete provider finishes, and uses the same model
  proposal validator as the locked release gate.
- Cloudflare liveness no longer waits on D1 preparation, Vectorize queries stay
  within the platform's `topK` limit, and the documented Wrangler recovery
  command uses a real temporary SQL file.
- Bun allows the documented extraction timeout and releases every semantic
  lease acquired before or during bounded SIGTERM shutdown, so a restart can
  recover work immediately.
- Context packing preserves rank when every item fits, applies diversity only
  under budget pressure, and no longer awards disputed claims a positive score.
- Live semantic verification carries project scope, while historical comparison
  tooling refuses to present a current deployment as the frozen `0.3.0` target.

### Security

- D1 diagnostic redaction now covers secrets split across streamed byte and
  text chunks, and Bun creates the canonical SQLite database plus sidecars with
  owner-only permissions.
- API keys now enforce immutable not-before and expiry windows, update
  `last_used_at` monotonically, preserve lifecycle metadata across supported
  operator surfaces, reject unknown creation fields, and cannot gain authority
  through credential import.

## [0.4.0] — 2026-07-31

### Fixed

- Global CLI installs now run directly on Bun and report `titen --version`
  instead of requiring a Node shim.
- Successful SDK responses now reject array, `null`, and primitive JSON
  envelopes with an `INVALID_RESPONSE` `TitenError` while preserving the HTTP
  status, request ID, and safe response metadata.
- Bun HTTP, Cloudflare Workers AI, and injected embedding-provider results now
  require exact output cardinality, ordered provider indices when present,
  dense configured dimensions, and finite numeric coordinates before vector
  query or indexing.
- Semantic readiness now distinguishes intentional FTS-only operation from
  partial configuration, unavailable vector initialization, legacy untracked
  vectors, missing requeue work, unsafe storage aliasing, empty restored
  projections, incompatible fingerprints, and locally observed indexing
  dependency failures; configured failures return a fixed local diagnostic
  without probing providers.
- Semantic retrieval now discards sub-threshold cosine hits before canonical
  hydration, so relative ranking cannot turn a best bad neighbor into useful
  context. Bun and Cloudflare share the same validated unit-vector boundary.
- Manual and background semantic-index drains now fence each outbox row before
  provider I/O, so an expired losing attempt cannot add stale failure evidence
  after another attempt completes the row. Lease eligibility and expiry now use
  the database clock at each conditional claim, so caller clock skew and earlier
  work cannot create an expired or stranded owner.
- Semantic-index upserts and removals now persist canonical reconciliation
  before external mutation and recreate it after stale or apply-then-throw
  outcomes, so a losing owner cannot resurrect a purged vector, erase a newer
  projection, or report unowned work as complete.

### Changed

- Capability contract version 1 reports embedding, extraction, and background
  enrichment separately while retaining `model` as a deprecated `0.3.x`
  embedding alias. Migration 13 persists the claim-index provider, model,
  revision, dimensions, metric, preprocessing, and schema fingerprint and
  requires an explicit reindex after incompatibility. Migration 14 retains only
  safe embedder/vector-store failure timestamps in semantic metadata until a
  later complete embed/upsert proves recovery.
- `sqlite-vec@0.1.9` is a pinned optional peer: default installs remain
  dependency-light while the documented vector install is machine-verifiable.
- Context compilation now treats a missing `project_id` as unscoped-only;
  explicit cross-project recall requires `cross_project: true` plus the separate
  `context:compile:all` capability and reports its effective scope and grant
  reason across REST, SDK, and MCP.
- **Breaking:** Semantic configuration now requires an immutable model revision, a named
  role-aware preprocessing profile, and an operator-calibrated cosine floor in
  the existing index fingerprint. EmbeddingGemma uses its official asymmetric
  query/document prompts; Titen ships no universal threshold.
- Migration 16 adds nullable owner and expiry fields to the rebuildable semantic
  index outbox; canonical observations and claims are unchanged.

## [0.3.0] — 2026-07-31

### Added

- Native Claude/ZCode and Cursor marketplace bundles, a ClawHub/OpenClaw skill
  bundle plus native MCP config, a Hermes skill plugin, a Pi skill package, and
  OpenCode/Windsurf/TRAE host kits now package the same nine-tool Titen MCP
  contract without duplicating the server or embedding an endpoint or
  credential. The standalone Titen Memory skill is public on ClawHub; its
  bundle-plugin package is staged while an upstream inspector incident blocks
  live package publication.
- The TypeScript SDK now covers project resolution, evidence-linked claims,
  feedback, checkpoints, leases, and handoffs with typed results, bounded
  timeout/signal handling, structured API errors, and mutation retry keys. The
  same nine operations are available through MCP with truthful schemas.
- Handoff recipients can read the exact delegated checkpoint and currently
  authorized context pack; operators can page organization leases and active
  organization-level owners/admins can force-release a failed agent's lease.
- `titen migrate --dry-run` prints the pending forward-only SQL without creating
  or changing the SQLite database.
- `titen serve --quiet`, bounded cleanup of expired execution state, and
  content-free audits for credential, portability, collaboration, webhook, and
  federation changes use the existing runtime and SQL primitives.
- The README is now a concise international open-source entrypoint with a
  runnable SDK example, explicit maturity boundaries, and a prominent link to
  [titen.dev](https://titen.dev).

### Changed

- **Breaking:** JSONL export format v2 adds workspace and membership streams,
  actor mappings, supersession pointers, deployment-scoped export authority,
  and byte-bounded pages. Import remains backward-compatible with v1, but code
  that parses export headers must accept format version 2.
- **Breaking:** MCP now exposes nine tools and uses normalized JSON-RPC tool
  results with structured content. Clients that hard-code the previous
  seven-tool list or result shape must update for `0.3.0`.
- Migration 11 atomically rebuilds the derived observation and claim FTS tables
  with Porter stemming and encoded scope terms; canonical SQL is unchanged.
- Migration 12 repairs unsafe collaboration pointers, adds database fences for
  handoff resolution, scopes idempotency to principals across key rotation, and
  assigns monotonic event order without changing public event IDs.
- The default npm install no longer downloads `sqlite-vec`. SDK and lexical-only
  users install only `titen-memory`; vector-enabled VPS and container paths add
  `sqlite-vec@0.1.9` explicitly.

### Security

- JSON depth, unsafe controls, malformed Unicode, non-sortable timestamps, and
  inverted validity windows now fail before canonical mutation. Each returned
  memory item is marked untrusted, feedback is limited to the context actor or a
  currently authorized intended delegate, and evidence purge removes FTS and
  vector projections without exposing a general MCP deletion tool.
- Whole-organization export now requires the separate `export:all` scope and
  writes a metadata-only audit record. Portable actor ownership survives only
  through explicit, preflighted source-to-destination mappings; importing on
  behalf of another principal additionally requires `keys:manage`.

### Fixed

- Lexical retrieval now stems multilingual terms, removes stopword noise,
  applies organization and subject scope before ranking and candidate limits,
  preserves useful tail terms, and fills token budgets without duplicate
  statements or an arbitrary three-item-per-kind ceiling.
- Context compilation bounds correlated SQL work before evidence hydration, so
  large authorized corpora do not turn small requested result sets into
  unbounded query work.
- Checkpoint saves and handoff resolutions now have database-enforced single
  winners under D1 latency, with deterministic duplicate repair and safe
  handoff foreign keys during migration. Handoff preflight and migration also
  reject incomplete, foreign, mismatched, or unauthorized context packs.
- Idempotent retries now follow the acting principal across API-key rotation
  while retaining the original credential ID for audit and preserving
  cross-principal isolation.
- Event polling and federation pulls now page by a database-assigned monotonic
  sequence without changing public event-ID cursors, preventing equal-timestamp
  UUID ordering from skipping committed events; exhausted polling preserves the
  caller's cursor.
- An explicitly scoped REST tombstone removes readable observation and
  dependent-claim text while retaining hashes, provenance, and audit history.
- Validation errors distinguish missing values, identify nested field paths,
  and keep raced purge/consolidation and lifecycle writes fail-closed on both
  SQLite and D1.
- Versioned JSONL v2 restores workspaces, active memberships, team-scoped
  records, actor provenance, claim evidence, and supersession pointers. Export
  pages are UTF-8 byte-bounded so every emitted page fits the import boundary;
  v1 imports remain supported, and a purge racing current-claim import rolls the
  whole import back while revoked tombstones remain portable.
- `titen backup` refuses a missing source, verifies a non-empty current schema
  plus integrity and foreign keys, and atomically refreshes a fixed output path
  without exposing an internal stack. `titen schema` output is deterministic
  and safely repeatable.
- The installed CLI now explains when Bun is missing, while SDK-only installs
  no longer download the optional `sqlite-vec` native package.
- No-vector deployments avoid unused index-outbox work. Configured vector
  deployments retain claim upserts and purge deletes; SQLite uses explicit
  `synchronous=FULL`, and CLI startup failures are short and actionable.

## [0.2.1] — 2026-07-31

### Fixed

- Key creation now returns the canonical `principal_id`, so SDK callers can use
  a newly generated agent identity for handoffs without confusing it with the
  credential's `key_id`.
- Contributor setup now documents a temporary writable `HOME` and
  `XDG_CONFIG_HOME` for pnpm/Wrangler checks in restricted containers.

## [0.2.0] — 2026-07-31

### Added

- **An authorized reviewer queue in Memory Atlas.** The read-only lens derives
  deterministic review work, counts, ownership, evidence, and opaque pagination
  from canonical state without introducing a second queue database.
- **Durable, signed Bun webhooks and rootless deployment artifacts.** Delivery
  uses bounded leases, stable delivery IDs, retries, terminal failure, TLS
  address pinning, and externally keyed secret encryption; the checked-in
  Quadlet keeps the public binding on loopback by default.
- **Broader SDK and CLI coverage.** Typed claim lifecycle/reviewer operations,
  generic authenticated JSON/raw requests, mutation idempotency, strict flag
  validation, and installed-tarball verification now cover the shipped surface.
- **Current agent integration guidance.** Claude Code, Codex, OpenClaw, Hermes,
  Pi, and generic clients share one MCP/REST contract; deliberately deferred
  native adapters are recorded in `PONYTAIL-DEBT.md`.

### Security

- **Authorization now precedes every protected projection.** Team records are
  workspace-bound and require active membership across context, evidence,
  exports, events, Atlas, vectors, and webhook delivery; checkpoint and webhook
  state is principal-bound within an organization.
- **Signing secrets are no longer canonical plaintext.** Webhook and federation
  secrets use versioned AES-256-GCM envelopes backed by an external keyring;
  missing or wrong key material keeps readiness closed, while unrecoverable
  legacy integrations without a secret are terminalized for safe replacement.
- **The MCP transport validates its trust boundary.** Cross-origin browser
  requests and unsupported protocol revisions fail before tool execution, while
  tool annotations let hosts apply read/write approval policy correctly.

### Fixed

- **Schema and mutation races now have one winner.** Migrations recover from
  faults and concurrent startup, leases and claim lifecycle transitions are
  fenced atomically, and idempotency binds the credential plus full request
  identity on both SQLite and D1.
- **Imports are fully preflighted and atomic.** Orphan evidence, collisions, and
  invalid late rows roll back canonical, history, FTS, event, audit, and outbox
  effects even beyond one database batch.
- **Retrieval cannot lose authorized tail terms or top-K slots.** Lexical term
  selection is position-independent, and vector organization/subject/project
  filters execute before ranking on both runtimes.
- **Webhook delivery survives retries, timeouts, crashes, and restart.** Queue
  claims are atomic, expired leases recover, pending age is observable, and
  caller-visible queue state excludes other principals. Membership revocation
  terminalizes queued delivery before any further outbound request.
- **Federation peers and cursors are principal-bound.** Same-organization
  credentials cannot discover, mutate, advance, or replay another principal's
  peer or private event stream. Signed push data is stored as an owner-visible
  untrusted wrapper, so remote actor and resource pointers grant no local
  authority.
- **Runtime and package gates reflect real operation.** Maintenance freshness,
  bounded WAL checkpoints, isolated workerd contract execution, rootless restart
  behavior, README links, SDK error parsing, CLI help, and npm install smokes are
  checked through the actual runtime paths.

### Changed

- **Breaking:** incomplete policy, channel, release, and caller-selected customer
  context routes were removed until their authorization contracts are ready.
  Pre-`1.0`, this requires the `0.2.0` minor release.
- MCP tools now delegate to the same validated application operations as REST,
  negotiate through protocol `2025-11-25`, and expose seven wire tools across six
  semantic families.

## [0.1.2] — 2026-07-30

### Added

- **A five-minute small-team golden path.** The documented researcher, writer,
  operator, and reviewer flow uses four scoped keys and the public SDK to prove
  evidence, conflicting claims, context, checkpoint, lease, handoff, feedback,
  citations, and freshness against a real Bun/SQLite service.
- **Optional loopback live dashboard data.** Conflict & Freshness can read one
  subject-scoped Atlas view through a same-origin adapter that keeps the Titen
  key server-side. Static serving rejects traversal, encoded/backslash/NUL, and
  symlink escapes; every other dashboard lens stays visibly synthetic.
- **More SDK coverage.** The published client now exposes the shipped
  checkpoint, lease, handoff, evidence, and Atlas-view operations used by the
  golden path.
- **One canonical live verifier.** `pnpm verify:live` replaces the duplicate
  script name and remains explicit about requiring a provisioned deployment.

### Fixed

- **Semantic ranking now works with real narrow-band cosine scores.** Vector
  similarity is normalized inside the authorized candidate set and confidence
  is an explicit weighted component, so a semantically correct lower-confidence
  claim no longer ranks last behind lexical decoys.
- **Index dependency outages are retryable.** Embedder and vector-store failures
  return bounded `503 UNAVAILABLE` metadata while leaving pending outbox work
  intact.
- **Canonical imports are order-independent within a request.** Imports preflight
  missing parents before mutation, accept child-before-parent lines atomically,
  and return `UNRESOLVED_REFERENCE` instead of mislabeling a missing dependency
  as a conflict.
- **Readiness reports background repair honestly.** Bun reports whether its
  maintenance timer was actually created; Cloudflare reports external scheduler
  ownership without pretending the request isolate can observe Cron state.

### Changed

- The API reference is verified against the router's 58 implemented routes and
  clearly separates proposed endpoints from callable ones.
- Dashboard screenshots, mobile disclosure, and the capability matrix identify
  synthetic, locally verified, and planned regions consistently.

## [0.1.1] — 2026-07-30

### Fixed

- **`./package.json` is reachable again.** An `exports` map hides every subpath
  it does not list, so `require("titen-memory/package.json")` failed with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`. Bundlers and tooling read that file. It is
  now listed explicitly, and `scripts/verify-pack.sh` fails if it stops
  resolving.

## [0.1.0] — 2026-07-30

First published release. Titen was previously reachable only by cloning the
repository.

### Added

- **`titen` CLI on the registry.** `bunx titen-memory serve` starts the memory
  service with no clone and no build step. Also `bootstrap`, `migrate`,
  `key create|list|revoke`, `backup`, and `schema`.
- **Agent SDK for every runtime.** `import { TitenClient } from "titen-memory"`
  is plain `fetch` — Node 22+, Bun, Deno, and edge workers. The `titen-memory/sdk`
  subpath resolves to the same client.
- **`scripts/verify-pack.sh`** — the release gate. It installs the real tarball
  into a throwaway directory and exercises bootstrap, serve, and the SDK, because
  every path resolves in a working tree even when `files` forgot to ship it.
- **`docs/engineering/release.md`** — the manual release procedure.
- **`CLAUDE.md`** — agent guidance that points at `AGENTS.md` instead of
  restating it.

### Changed

- **`astro` moved to `devDependencies`.** It only builds the dashboard, but it
  was declared as a runtime dependency, so installing Titen pulled a full build
  toolchain onto every consumer's disk. A consumer tree is now three packages:
  `titen-memory`, `sqlite-vec`, and its platform binary.

### Notes

- The tarball is 41 files / ~73 kB: the Web-Standards kernel, the Bun runtime,
  and a type-stripped SDK for Node. The Astro dashboard, the Cloudflare adapter,
  tests, and docs are not shipped — deploy the Worker from a clone.
- `sqlite-vec` is an `optionalDependency` loaded lazily. Without it retrieval
  degrades to lexical FTS5 and `/readyz` reports the vector capability as
  disabled rather than failing.
- **The CLI requires Bun** — it uses `bun:sqlite`, and the published `bin`
  carries a `#!/usr/bin/env bun` shebang. `npx titen-memory` works only with Bun
  on `PATH`. The SDK has no such constraint.
- 0.1.0 carries no git tag. It was published from a staging tree assembled
  before the packaging work was committed, and was superseded by 0.1.1 the same
  day. Prefer 0.1.1.

## Package name

npm refuses to register `titen`:

```
403 Forbidden - PUT https://registry.npmjs.org/titen
Package name too similar to existing package vite
```

That is npm's typosquat filter, not a collision — `npm view titen` still returns
404. The package is therefore `titen-memory`. The **command stays `titen`**,
because that comes from the `bin` field rather than from the package name:

```console
$ bunx titen-memory serve
titen — self-hosted memory service
```

## Releasing

Releases are cut by hand from a maintainer's machine. GitHub Actions stays
disabled so the repository has no hosted automation cost; manual publication
also keeps the npm token out of repository secrets. See
[`docs/engineering/release.md`](./docs/engineering/release.md).

[Unreleased]: https://github.com/RamaAditya49/titen/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/RamaAditya49/titen/releases/tag/v0.6.1
[0.6.0]: https://github.com/RamaAditya49/titen/releases/tag/v0.6.0
[0.5.7]: https://github.com/RamaAditya49/titen/releases/tag/v0.5.7
[0.5.6]: https://github.com/RamaAditya49/titen/releases/tag/v0.5.6
[0.5.5]: https://github.com/RamaAditya49/titen/releases/tag/v0.5.5
[0.5.4]: https://github.com/RamaAditya49/titen/releases/tag/v0.5.4
[0.5.3]: https://github.com/RamaAditya49/titen/releases/tag/v0.5.3
[0.5.2]: https://github.com/RamaAditya49/titen/releases/tag/v0.5.2
[0.5.1]: https://github.com/RamaAditya49/titen/releases/tag/v0.5.1
[0.5.0]: https://github.com/RamaAditya49/titen/releases/tag/v0.5.0
[0.4.1]: https://github.com/RamaAditya49/titen/releases/tag/v0.4.1
[0.4.0]: https://github.com/RamaAditya49/titen/releases/tag/v0.4.0
[0.3.0]: https://github.com/RamaAditya49/titen/releases/tag/v0.3.0
[0.2.1]: https://github.com/RamaAditya49/titen/releases/tag/v0.2.1
[0.2.0]: https://github.com/RamaAditya49/titen/releases/tag/v0.2.0
[0.1.2]: https://github.com/RamaAditya49/titen/releases/tag/v0.1.2
[0.1.1]: https://github.com/RamaAditya49/titen/releases/tag/v0.1.1
[0.1.0]: https://www.npmjs.com/package/titen-memory/v/0.1.0
