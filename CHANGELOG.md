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

The published npm package is [`titen-memory`](https://www.npmjs.com/package/titen-memory).
The **CLI command is `titen`** regardless; see [Package name](#package-name).

## [Unreleased]

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

## [0.2.0] — 2026-07-30

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

[Unreleased]: https://github.com/RamaAditya49/titen/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/RamaAditya49/titen/releases/tag/v0.4.0
[0.3.0]: https://github.com/RamaAditya49/titen/releases/tag/v0.3.0
[0.2.1]: https://github.com/RamaAditya49/titen/releases/tag/v0.2.1
[0.2.0]: https://github.com/RamaAditya49/titen/releases/tag/v0.2.0
[0.1.2]: https://github.com/RamaAditya49/titen/releases/tag/v0.1.2
[0.1.1]: https://github.com/RamaAditya49/titen/releases/tag/v0.1.1
[0.1.0]: https://www.npmjs.com/package/titen-memory/v/0.1.0
