---
work_id: portability-backup-safety-20260731
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-07-31
updated: 2026-07-31
owner: CADIS
---
# Portability and backup safety

## Problem

The Bun backup command could create and verify an empty database after a source
path typo, failed on a fixed output filename with an internal stack, and did not
prove that a copy contained the current Titen schema. Logical export/import also
lost team authority, actor ownership, and claim supersession, could emit pages
larger than its own import boundary, and had no separately authorized whole-org
export. Migration SQL lacked a read-only preview and deterministic schema output.

## Scope

- Make Bun/SQLite backup refuse missing sources, verify a current non-empty copy,
  and replace a fixed destination only after an adjacent temporary copy passes.
- Ship logical JSONL format v2 for exactly five streams in dependency order:
  `workspaces`, active `memberships`, `projects`, `observations`, and `claims`.
- Preserve claim sources, `superseded_by`, mapped canonical actor ownership, team
  dependencies, self-authenticating redaction markers, and safe projection state.
- Keep ordinary export principal-scoped; add separately scoped, metadata-audited
  whole-organization export without weakening tenant authority.
- Bound export pages by record count and UTF-8 bytes so each page fits import.
- Preserve v1 import compatibility, preflight all v2 references before mutation,
  and reuse shared string/timestamp validation.
- Add read-only migration preview, deterministic repeatable schema SQL, and exact
  VPS/Cloudflare rollback and logical-versus-physical backup documentation.

## Deferred and out of scope

- A `titen export` or `titen import` CLI is deferred. Safe command-line actor-map
  input, multi-page resumption, partial-file recovery, and remote authentication
  need their own spec instead of a thin wrapper around the HTTP handlers.
- Incremental export, `changed_after`, UUIDv7 conversion, and any change-feed
  guarantee are deferred. The existing opaque ID cursor is pagination only.
- Logical export does not add checkpoints, leases, handoffs, context runs or
  feedback, audit/event/history rows, credentials, integration bindings, index
  outboxes, FTS, vectors, or derived Atlas state. Physical/provider snapshots are
  the disaster-recovery boundary for that state.
- Metrics, structured logging, purge implementation, schema changes, README,
  versioning, npm publication, production deployment, and issue closure belong
  to their respective work lanes.

## Constraints and risks

- SQL remains canonical, vectors and text indexes remain rebuildable, and no new
  dependency or database migration is introduced.
- Organization authority comes only from the authenticated key. The current
  role model has no separate organization-owner flag, so `export:all` and
  `keys:manage` are the explicit administrative capabilities.
- Format v2 cannot treat a source actor ID as destination authority. Mappings to
  a different destination principal require `keys:manage`; import history still
  records the authenticated importer.
- Tombstones retain only the original hash and exact redaction marker. They must
  not be reinserted into FTS/vector projections.
- Forward-only database rollback is snapshot restore. A logical five-stream
  export is migration evidence, not a complete operational backup.

## Acceptance criteria

- **AC-PBS-001 — Unwanted behavior:** If `titen backup` receives a source path
  that does not exist, then Titen shall exit nonzero without creating a source or
  output database and without printing an internal stack.
- **AC-PBS-002 — Event-driven:** When `titen backup` copies an existing current
  database, Titen shall verify SQLite integrity, foreign keys, a non-empty schema,
  and the exact current schema version before atomically replacing the requested
  output with a mode-`0600` file.
- **AC-PBS-003 — Unwanted behavior:** If verification of a new backup copy fails,
  then Titen shall remove only its adjacent temporary file and leave any prior
  output file unchanged.
- **AC-POR-001 — Ubiquitous:** Titen shall emit JSONL format v2 headers for the
  five supported streams with deterministic dependency order, source org,
  export scope, count, completion state, and opaque next cursor.
- **AC-POR-002 — State-driven:** While export uses ordinary principal scope,
  Titen shall expose only the caller's authorized private, team, workspace, and
  membership records under the authenticated organization.
- **AC-POR-003 — Optional feature:** Where `all=true` is requested, Titen shall
  require both ordinary export authority and `export:all`, bypass only
  principal-level visibility inside the authenticated organization, and append
  one metadata-only audit entry per emitted page.
- **AC-POR-004 — Event-driven:** When an export query can return up to 2,000
  records, Titen shall stop before the complete UTF-8 NDJSON response exceeds
  1,048,576 bytes and shall return a cursor that resumes after the last emitted
  record.
- **AC-POR-005 — Event-driven:** When a v2 import contains valid records in any
  line order, Titen shall preflight and atomically restore workspace, active
  membership, project, evidence, claim-source, and supersession dependencies in
  canonical order on both D1 and Bun/SQLite.
- **AC-POR-006 — Unwanted behavior:** If a v2 actor or membership principal is
  not the importer and lacks an explicit source-org actor mapping, or if a map
  is conflicting, foreign, or unused, then Titen shall reject the request before
  mutation; mapping to another destination principal shall require
  `keys:manage`.
- **AC-POR-007 — Unwanted behavior:** If an imported ID belongs to another
  organization or any workspace, project, evidence, or replacement-claim
  dependency is absent, then Titen shall fail closed with no partial canonical,
  history, FTS, event, audit, or outbox write.
- **AC-POR-008 — State-driven:** While importing format v1, Titen shall retain
  the previous compatibility behavior in which imported observations and claims
  are owned by the authenticated importer.
- **AC-POR-009 — Event-driven:** When an observation contains the exact
  self-authenticating redaction marker for its lowercase 64-hex content hash,
  Titen shall preserve that hash without recomputing it, omit FTS insertion, and
  enqueue projection deletion; a mismatched marker shall fail validation.
- **AC-POR-010 — Unwanted behavior:** If imported strings contain values rejected
  by shared validation, a timestamp does not use a four-digit canonical year, or
  claim `valid_to` is not later than `valid_from`, then Titen shall reject the
  complete import before mutation.
- **AC-OPS-001 — Optional feature:** Where `titen migrate --dry-run` is used,
  Titen shall print only pending forward migration SQL and leave an existing or
  missing database path unchanged.
- **AC-OPS-002 — Ubiquitous:** Titen shall emit deterministic, safely repeatable
  `titen schema` SQL with a fixed migration timestamp sentinel and
  `INSERT OR IGNORE` version marker.
- **AC-DOC-001 — Ubiquitous:** Titen shall document physical snapshot rollback,
  `/readyz` as the post-restore gate, D1 Time Travel, the five logical streams,
  actor mapping authority, and every excluded logical state class without
  presenting JSONL as complete disaster recovery.

## Done conditions

Every criterion has shared or integration evidence; Bun and D1 exercise the
portable contract; CLI failure, repeat-output, dry-run, and schema behavior are
covered; package, route, workflow, and diff checks pass; no production, registry,
version, changelog, README, or unrelated implementation mutation is included in
the workflow-correction commit.

## Closure evidence

Implementation commit `dc3d4cd` completed the bounded slice. Shared runtime
contracts passed for v2 team restore, actor maps, supersession, UTF-8 page
limits, temporal preflight, and redaction projection behavior. CLI integration
passed missing-source, failed-refresh preservation, fixed-target replacement,
mode, schema, dry-run, and deterministic-output checks. The API reference and
deployment guides now state the exact five-stream boundary and snapshot
rollback. No logical CLI, change feed, production deploy, or npm publish was
performed by this lane. This terminal pair is a retrospective workflow
correction after the missing pre-implementation artifacts were detected; it
does not claim that the pair existed before implementation.
