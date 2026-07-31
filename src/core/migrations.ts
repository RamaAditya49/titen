import type { Db } from "./db";

/**
 * Forward-only migrations, identical on D1 and bun:sqlite.
 *
 * Rules for new entries: append only, one statement per array item, no PRAGMA
 * (D1 rejects most), parents before children so foreign keys hold, and no
 * destructive statement without its own work item.
 *
 * ponytail: forward-only, with no `down` statements. The ceiling is that
 * recovery from a bad upgrade is restore-from-snapshot, which makes a verified
 * backup a precondition of every deploy rather than a convenience. Upgrade
 * path: none planned — instead, document the snapshot runbook and add a
 * `migrate --dry-run` so the pending statements can be reviewed first (#116).
 */
export const MIGRATIONS: { version: number; statements: string[] }[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE organizations (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`,
      `CREATE TABLE api_keys (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         principal_id TEXT NOT NULL,
         principal_kind TEXT NOT NULL CHECK (principal_kind IN ('human', 'agent', 'service')),
         key_hash TEXT NOT NULL UNIQUE,
         label TEXT NOT NULL,
         scopes TEXT NOT NULL,
         max_trust TEXT NOT NULL CHECK (max_trust IN ('unverified', 'asserted', 'verified', 'policy_approved')),
         created_at TEXT NOT NULL,
         revoked_at TEXT
       )`,
      `CREATE INDEX api_keys_org ON api_keys (org_id)`,
      `CREATE TABLE projects (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         reference TEXT NOT NULL,
         created_at TEXT NOT NULL,
         UNIQUE (org_id, reference)
       )`,
      `CREATE TABLE observations (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         subject_id TEXT NOT NULL,
         project_id TEXT REFERENCES projects(id),
         agent_id TEXT,
         run_id TEXT,
         actor_id TEXT NOT NULL,
         kind TEXT NOT NULL CHECK (kind IN ('user_statement', 'tool_result', 'imported_source', 'decision', 'system_event')),
         content TEXT NOT NULL,
         content_hash TEXT NOT NULL,
         source_type TEXT NOT NULL,
         source_ref TEXT,
         trust TEXT NOT NULL CHECK (trust IN ('unverified', 'asserted', 'verified', 'policy_approved')),
         visibility TEXT NOT NULL CHECK (visibility IN ('private', 'team', 'organization')),
         occurred_at TEXT,
         ingested_at TEXT NOT NULL
       )`,
      `CREATE INDEX observations_scope ON observations (org_id, subject_id, ingested_at)`,
      // Historical v1 projection; migration 11 rebuilds it with Porter and
      // indexed scope terms without changing canonical observations.
      `CREATE VIRTUAL TABLE observations_fts USING fts5 (
         content,
         observation_id UNINDEXED,
         tokenize = 'unicode61 remove_diacritics 2'
       )`,
      `CREATE TABLE claims (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         subject_id TEXT NOT NULL,
         project_id TEXT REFERENCES projects(id),
         observer_id TEXT,
         actor_id TEXT NOT NULL,
         kind TEXT NOT NULL CHECK (kind IN ('semantic_fact', 'episodic_event', 'preference', 'procedural', 'decision', 'relationship')),
         statement TEXT NOT NULL,
         confidence REAL NOT NULL CHECK (confidence > 0 AND confidence <= 1),
         trust TEXT NOT NULL CHECK (trust IN ('unverified', 'asserted', 'verified', 'policy_approved')),
         visibility TEXT NOT NULL CHECK (visibility IN ('private', 'team', 'organization')),
         status TEXT NOT NULL CHECK (status IN ('active', 'disputed', 'superseded', 'expired', 'revoked')),
         version INTEGER NOT NULL DEFAULT 1,
         valid_from TEXT NOT NULL,
         valid_to TEXT,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX claims_scope ON claims (org_id, subject_id, status)`,
      // Historical v1 projection; migration 11 rebuilds both FTS tables
      // together so observation and claim tokenization cannot drift.
      `CREATE VIRTUAL TABLE claims_fts USING fts5 (
         statement,
         claim_id UNINDEXED,
         tokenize = 'unicode61 remove_diacritics 2'
       )`,
      `CREATE TABLE claim_sources (
         claim_id TEXT NOT NULL REFERENCES claims(id),
         observation_id TEXT NOT NULL REFERENCES observations(id),
         relation TEXT NOT NULL CHECK (relation IN ('supports', 'contradicts', 'qualifies')),
         created_at TEXT NOT NULL,
         PRIMARY KEY (claim_id, observation_id, relation)
       )`,
      `CREATE INDEX claim_sources_observation ON claim_sources (observation_id)`,
      `CREATE TABLE record_history (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL,
         record_type TEXT NOT NULL,
         record_id TEXT NOT NULL,
         version INTEGER NOT NULL,
         change_kind TEXT NOT NULL,
         actor_id TEXT NOT NULL,
         snapshot_hash TEXT NOT NULL,
         changed_at TEXT NOT NULL
       )`,
      `CREATE INDEX record_history_record ON record_history (record_type, record_id, version)`,
      `CREATE TABLE index_outbox (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL,
         record_type TEXT NOT NULL,
         record_id TEXT NOT NULL,
         operation TEXT NOT NULL,
         state TEXT NOT NULL CHECK (state IN ('pending', 'done', 'failed')),
         attempts INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX index_outbox_pending ON index_outbox (state, created_at)`,
      `CREATE TABLE context_runs (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL,
         actor_id TEXT NOT NULL,
         subject_id TEXT NOT NULL,
         project_id TEXT,
         task_hash TEXT NOT NULL,
         max_tokens INTEGER NOT NULL,
         used_tokens INTEGER NOT NULL,
         policy_snapshot TEXT NOT NULL,
         degraded TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`,
      `CREATE TABLE context_run_items (
         context_id TEXT NOT NULL REFERENCES context_runs(id),
         claim_id TEXT NOT NULL REFERENCES claims(id),
         position INTEGER NOT NULL,
         score REAL NOT NULL,
         score_components TEXT NOT NULL,
         PRIMARY KEY (context_id, claim_id)
       )`,
      `CREATE TABLE context_feedback (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL,
         context_id TEXT NOT NULL REFERENCES context_runs(id),
         claim_id TEXT REFERENCES claims(id),
         actor_id TEXT NOT NULL,
         outcome TEXT NOT NULL CHECK (outcome IN ('used', 'useful', 'irrelevant', 'incorrect', 'harmful')),
         reason_code TEXT,
         client_mutation_id TEXT,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX context_feedback_claim ON context_feedback (claim_id, outcome)`,
      `CREATE UNIQUE INDEX context_feedback_mutation
         ON context_feedback (org_id, client_mutation_id)
         WHERE client_mutation_id IS NOT NULL`,
      `CREATE TABLE idempotency (
         org_id TEXT NOT NULL,
         endpoint TEXT NOT NULL,
         key_hash TEXT NOT NULL,
         request_hash TEXT NOT NULL,
         status INTEGER NOT NULL,
         response TEXT NOT NULL,
         created_at TEXT NOT NULL,
         PRIMARY KEY (org_id, endpoint, key_hash)
       )`,
    ],
  },
  {
    version: 2,
    statements: [
      // Temporal supersession: track which claim replaced another.
      `ALTER TABLE claims ADD COLUMN superseded_by TEXT REFERENCES claims(id)`,
      // Checkpoints: resumable agent task state, separate from semantic memory.
      `CREATE TABLE checkpoints (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         subject_id TEXT NOT NULL,
         agent_id TEXT NOT NULL,
         run_id TEXT,
         kind TEXT NOT NULL,
         state TEXT NOT NULL,
         state_hash TEXT NOT NULL,
         ttl_seconds INTEGER NOT NULL,
         expires_at TEXT NOT NULL,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
      `CREATE INDEX checkpoints_scope ON checkpoints (org_id, subject_id, agent_id, kind)`,
      `CREATE INDEX checkpoints_expires ON checkpoints (expires_at)`,
    ],
  },
  {
    version: 3,
    statements: [
      // Collaboration plane: workspaces, memberships, leases, handoffs, events.
      `CREATE TABLE workspaces (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         name TEXT NOT NULL,
         created_at TEXT NOT NULL,
         UNIQUE (org_id, name)
       )`,
      `CREATE TABLE memberships (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         workspace_id TEXT REFERENCES workspaces(id),
         principal_id TEXT NOT NULL,
         principal_kind TEXT NOT NULL CHECK (principal_kind IN ('human', 'agent', 'service')),
         role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'reader')),
         created_at TEXT NOT NULL,
         removed_at TEXT,
         UNIQUE (org_id, workspace_id, principal_id)
       )`,
      `CREATE TABLE leases (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         resource_type TEXT NOT NULL,
         resource_id TEXT NOT NULL,
         holder_id TEXT NOT NULL,
         purpose TEXT NOT NULL,
         ttl_seconds INTEGER NOT NULL,
         expires_at TEXT NOT NULL,
         created_at TEXT NOT NULL,
         released_at TEXT
       )`,
      `CREATE TABLE handoffs (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         from_principal TEXT NOT NULL,
         to_principal TEXT NOT NULL,
         subject_id TEXT NOT NULL,
         context_id TEXT REFERENCES context_runs(id),
         checkpoint_id TEXT,
         message TEXT,
         status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
         created_at TEXT NOT NULL,
         resolved_at TEXT
       )`,
      `CREATE TABLE events (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         kind TEXT NOT NULL,
         actor_id TEXT NOT NULL,
         resource_type TEXT NOT NULL,
         resource_id TEXT NOT NULL,
         payload TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX memberships_org ON memberships (org_id, principal_id)`,
      `CREATE INDEX leases_resource ON leases (org_id, resource_type, resource_id) WHERE released_at IS NULL`,
      `CREATE INDEX handoffs_to ON handoffs (org_id, to_principal, status)`,
      `CREATE INDEX events_cursor ON events (org_id, created_at, id)`,
    ],
  },
  {
    version: 4,
    statements: [
      // Enterprise governance: policies, channel releases, customer assertions, audit log.
      // ponytail: `policies` accepts a 'retention' kind that no code reads yet.
      // Current maintenance removes expired execution bookkeeping only;
      // canonical evidence, history, and events remain append-only. The ceiling
      // is a governance adopter that needs table-specific retention or a legal
      // hold. Upgrade path: accept per-table policy semantics plus erasure and
      // recovery tests; never add one generic age delete (#105).
      `CREATE TABLE policies (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         kind TEXT NOT NULL CHECK (kind IN ('retention', 'approval_required', 'visibility_default', 'trust_ceiling')),
         target_type TEXT NOT NULL,
         target_id TEXT,
         config TEXT NOT NULL,
         enabled INTEGER NOT NULL DEFAULT 1,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
      `CREATE TABLE channel_releases (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         channel TEXT NOT NULL,
         audience TEXT NOT NULL,
         version INTEGER NOT NULL,
         status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'revoked')),
         approved_by TEXT,
         published_at TEXT,
         revoked_at TEXT,
         created_at TEXT NOT NULL,
         UNIQUE(org_id, channel, audience, version)
       )`,
      `CREATE TABLE channel_release_items (
         release_id TEXT NOT NULL REFERENCES channel_releases(id),
         claim_id TEXT NOT NULL REFERENCES claims(id),
         redacted_statement TEXT,
         PRIMARY KEY(release_id, claim_id)
       )`,
      `CREATE TABLE customer_assertions (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         channel TEXT NOT NULL,
         audience TEXT NOT NULL,
         customer_id TEXT NOT NULL,
         assertion_hash TEXT NOT NULL,
         expires_at TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`,
      `CREATE TABLE audit_log (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         actor_id TEXT NOT NULL,
         action TEXT NOT NULL,
         resource_type TEXT NOT NULL,
         resource_id TEXT,
         detail TEXT,
         ip_hint TEXT,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX policies_org ON policies (org_id, kind, enabled)`,
      `CREATE INDEX channel_releases_active ON channel_releases (org_id, channel, audience, status)`,
      `CREATE INDEX customer_assertions_lookup ON customer_assertions (org_id, channel, customer_id, expires_at)`,
      `CREATE INDEX audit_log_org ON audit_log (org_id, created_at, id)`,
    ],
  },
  {
    version: 5,
    statements: [
      // Federation: authorized event exchange between Titen deployments.
      `CREATE TABLE federation_peers (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         name TEXT NOT NULL,
         endpoint TEXT NOT NULL,
         shared_secret_hash TEXT NOT NULL,
         direction TEXT NOT NULL CHECK (direction IN ('push', 'pull', 'bidirectional')),
         status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
         last_cursor TEXT,
         last_sync_at TEXT,
         created_at TEXT NOT NULL,
         UNIQUE(org_id, endpoint)
       )`,
      `CREATE TABLE federation_filters (
         id TEXT PRIMARY KEY,
         peer_id TEXT NOT NULL REFERENCES federation_peers(id),
         resource_type TEXT NOT NULL,
         include_kinds TEXT,
         exclude_subjects TEXT,
         min_trust TEXT CHECK (min_trust IN ('unverified', 'asserted', 'verified', 'policy_approved')),
         created_at TEXT NOT NULL
       )`,
      `CREATE TABLE federation_log (
         id TEXT PRIMARY KEY,
         peer_id TEXT NOT NULL REFERENCES federation_peers(id),
         direction TEXT NOT NULL CHECK (direction IN ('sent', 'received')),
         resource_type TEXT NOT NULL,
         resource_id TEXT NOT NULL,
         status TEXT NOT NULL CHECK (status IN ('success', 'conflict', 'rejected', 'error')),
         detail TEXT,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX federation_peers_org ON federation_peers (org_id, status)`,
      `CREATE INDEX federation_filters_peer ON federation_filters (peer_id)`,
      `CREATE INDEX federation_log_peer ON federation_log (peer_id, created_at)`,
    ],
  },
  {
    version: 6,
    statements: [
      `CREATE TABLE webhooks (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         url TEXT NOT NULL,
         secret_hash TEXT NOT NULL,
         events TEXT NOT NULL,
         status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'disabled')),
         failure_count INTEGER NOT NULL DEFAULT 0,
         last_delivery_at TEXT,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX webhooks_org ON webhooks (org_id, status)`,
      `CREATE TABLE webhook_deliveries (
         id TEXT PRIMARY KEY,
         webhook_id TEXT NOT NULL REFERENCES webhooks(id),
         event_id TEXT NOT NULL,
         status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'expired')),
         attempts INTEGER NOT NULL DEFAULT 0,
         last_attempt_at TEXT,
         next_retry_at TEXT,
         response_status INTEGER,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX webhook_deliveries_pending ON webhook_deliveries (webhook_id, status, next_retry_at)`,
    ],
  },
  {
    version: 7,
    statements: [
      // HMAC is symmetric: the receiver verifies with the same shared secret it
      // was given, so the signing key cannot be a hash. Stored alongside the
      // fingerprint, which stays useful for confirming which secret is
      // configured without revealing it.
      //
      // This historical column is rewrapped into an AES-GCM envelope during
      // startup before protected traffic is accepted.
      `ALTER TABLE webhooks ADD COLUMN secret TEXT`,
    ],
  },
  {
    version: 8,
    statements: [
      // A receiving deployment must be able to prove a push came from the peer
      // it registered. That needs the shared key itself, for the same reason a
      // webhook signature does: HMAC is symmetric.
      //
      // This historical column is rewrapped like the webhook secret above.
      `ALTER TABLE federation_peers ADD COLUMN shared_secret TEXT`,
    ],
  },
  {
    version: 9,
    statements: [
      // webhook_deliveries.event_id held the event *kind*, so delivery dedup
      // matched on kind and only the first event of each kind was ever sent. The
      // existing rows are therefore semantically wrong, and this is an
      // operational delivery log rather than canonical evidence, so clearing it
      // loses nothing that can be reconstructed from `events`.
      `DELETE FROM webhook_deliveries`,
      // One attempt row per webhook per event, enforced by the database so a
      // replayed drain cannot double-deliver.
      `CREATE UNIQUE INDEX webhook_deliveries_event
         ON webhook_deliveries (webhook_id, event_id)`,
    ],
  },
  {
    version: 10,
    statements: [
      // Team visibility is a real workspace boundary. Legacy team rows remain
      // fail-closed until an explicit future rebinding migration can prove scope.
      `ALTER TABLE observations ADD COLUMN workspace_id TEXT REFERENCES workspaces(id)`,
      `ALTER TABLE claims ADD COLUMN workspace_id TEXT REFERENCES workspaces(id)`,
      `CREATE INDEX observations_workspace_scope
         ON observations (org_id, workspace_id, subject_id, ingested_at)`,
      `CREATE INDEX claims_workspace_scope
         ON claims (org_id, workspace_id, subject_id, status)`,
      // Preserve every lease row while deterministically retiring duplicate
      // unreleased losers before the database starts enforcing one winner.
      `UPDATE leases AS losing
          SET released_at = losing.expires_at
        WHERE losing.released_at IS NULL
          AND EXISTS (
            SELECT 1 FROM leases winning
             WHERE winning.org_id = losing.org_id
               AND winning.resource_type = losing.resource_type
               AND winning.resource_id = losing.resource_id
               AND winning.released_at IS NULL
               AND (
                 winning.expires_at > losing.expires_at
                 OR (winning.expires_at = losing.expires_at AND winning.created_at > losing.created_at)
                 OR (winning.expires_at = losing.expires_at AND winning.created_at = losing.created_at AND winning.id > losing.id)
               )
          )`,
      `CREATE UNIQUE INDEX leases_one_unreleased_resource
         ON leases (org_id, resource_type, resource_id) WHERE released_at IS NULL`,
      // A claim/version fence makes concurrent lifecycle batches choose one
      // winner without requiring an interactive transaction unavailable in D1.
      `CREATE TABLE lifecycle_fences (
         claim_id TEXT NOT NULL REFERENCES claims(id),
         expected_version INTEGER NOT NULL,
         created_at TEXT NOT NULL,
         PRIMARY KEY (claim_id, expected_version)
       )`,
      `CREATE TABLE idempotency_v2 (
         org_id TEXT NOT NULL,
         key_id TEXT NOT NULL,
         request_identity TEXT NOT NULL,
         key_hash TEXT NOT NULL,
         request_hash TEXT NOT NULL,
         status INTEGER NOT NULL,
         response TEXT NOT NULL,
         created_at TEXT NOT NULL,
         expires_at TEXT NOT NULL,
         PRIMARY KEY (org_id, key_id, key_hash)
       )`,
      `CREATE INDEX idempotency_v2_expiry ON idempotency_v2 (expires_at)`,
      `DROP INDEX context_feedback_mutation`,
      `CREATE UNIQUE INDEX context_feedback_mutation
         ON context_feedback (org_id, actor_id, client_mutation_id)
         WHERE client_mutation_id IS NOT NULL`,
      // Existing subscriptions have no attributable principal and therefore
      // receive no private/team events until re-registered.
      `ALTER TABLE webhooks ADD COLUMN principal_id TEXT`,
      // Federation cursors are mutable authorization state. Legacy peers have
      // no attributable owner and therefore stay fail-closed until re-created.
      `ALTER TABLE federation_peers ADD COLUMN principal_id TEXT`,
      // Keep legacy logs and filters, but retire the unusable peer and release
      // its public endpoint so an attributable replacement can be registered.
      `UPDATE federation_peers
          SET endpoint = endpoint || '#titen-legacy-peer=' || id,
              status = 'suspended'
        WHERE principal_id IS NULL`,
      `CREATE TABLE maintenance_state (
         id TEXT PRIMARY KEY CHECK (id = 'background'),
         last_attempt_at TEXT NOT NULL,
         last_success_at TEXT,
         last_error_at TEXT,
         indexed INTEGER NOT NULL DEFAULT 0,
         delivered INTEGER NOT NULL DEFAULT 0,
         expected_interval_ms INTEGER NOT NULL
       )`,
      `ALTER TABLE webhook_deliveries ADD COLUMN lease_token TEXT`,
      `ALTER TABLE webhook_deliveries ADD COLUMN lease_expires_at TEXT`,
      `ALTER TABLE webhook_deliveries ADD COLUMN attempt_id TEXT`,
      `CREATE INDEX webhook_deliveries_due
         ON webhook_deliveries (status, next_retry_at, lease_expires_at)`,
      // Vector schemas now enforce subject/project metadata before top-k. The
      // projection is rebuildable, so every canonical claim is safely requeued.
      `UPDATE index_outbox SET state = 'pending', attempts = 0 WHERE record_type = 'claim'`,
    ],
  },
  {
    version: 11,
    statements: [
      // FTS is derived data: rebuild it once with stemming and scope terms that
      // the MATCH expression can apply before ranking. The trailing digit keeps
      // Porter from stemming the reversible hexadecimal scope token.
      `DROP TABLE observations_fts`,
      `CREATE VIRTUAL TABLE observations_fts USING fts5 (
         content,
         observation_id UNINDEXED,
         org_scope,
         subject_scope,
         tokenize = 'porter unicode61 remove_diacritics 2'
       )`,
      `INSERT INTO observations_fts
         (content, observation_id, org_scope, subject_scope)
       SELECT content, id, lower(hex(org_id)) || '0', lower(hex(subject_id)) || '0'
         FROM observations`,
      `DROP TABLE claims_fts`,
      `CREATE VIRTUAL TABLE claims_fts USING fts5 (
         statement,
         claim_id UNINDEXED,
         org_scope,
         subject_scope,
         tokenize = 'porter unicode61 remove_diacritics 2'
       )`,
      `INSERT INTO claims_fts
         (statement, claim_id, org_scope, subject_scope)
       SELECT statement, id, lower(hex(org_id)) || '0', lower(hex(subject_id)) || '0'
         FROM claims`,
    ],
  },
  {
    version: 12,
    statements: [
      // A checkpoint scope has one current head. Point handoffs at the newest
      // duplicate before retiring older rows, then let SQLite arbitrate every
      // future upsert on both runtimes.
      `UPDATE handoffs
          SET checkpoint_id = (
            SELECT winning.id
              FROM checkpoints losing
              JOIN checkpoints winning
                ON winning.org_id = losing.org_id
               AND winning.subject_id = losing.subject_id
               AND winning.agent_id = losing.agent_id
               AND winning.kind = losing.kind
             WHERE losing.id = handoffs.checkpoint_id
             ORDER BY winning.updated_at DESC, winning.created_at DESC, winning.id DESC
             LIMIT 1
          )
        WHERE checkpoint_id IS NOT NULL
          AND EXISTS (
            SELECT 1
              FROM checkpoints losing
              JOIN checkpoints winning
                ON winning.org_id = losing.org_id
               AND winning.subject_id = losing.subject_id
               AND winning.agent_id = losing.agent_id
               AND winning.kind = losing.kind
             WHERE losing.id = handoffs.checkpoint_id
               AND winning.id <> losing.id
          )`,
      `DELETE FROM checkpoints
        WHERE EXISTS (
          SELECT 1 FROM checkpoints newer
           WHERE newer.org_id = checkpoints.org_id
             AND newer.subject_id = checkpoints.subject_id
             AND newer.agent_id = checkpoints.agent_id
             AND newer.kind = checkpoints.kind
             AND (
               newer.updated_at > checkpoints.updated_at
               OR (newer.updated_at = checkpoints.updated_at AND newer.created_at > checkpoints.created_at)
               OR (newer.updated_at = checkpoints.updated_at AND newer.created_at = checkpoints.created_at AND newer.id > checkpoints.id)
             )
        )`,
      `DROP INDEX checkpoints_scope`,
      `CREATE UNIQUE INDEX checkpoints_scope
         ON checkpoints (org_id, subject_id, agent_id, kind)`,
      // Composite parent keys make the handoff foreign keys organization-safe,
      // even for direct SQL clients that bypass the HTTP preflight.
      `CREATE UNIQUE INDEX context_runs_org_identity ON context_runs (id, org_id)`,
      `CREATE UNIQUE INDEX checkpoints_org_identity ON checkpoints (id, org_id)`,
      `ALTER TABLE handoffs RENAME TO handoffs_legacy`,
      `CREATE TABLE handoffs (
         id TEXT PRIMARY KEY,
         org_id TEXT NOT NULL REFERENCES organizations(id),
         from_principal TEXT NOT NULL,
         to_principal TEXT NOT NULL,
         subject_id TEXT NOT NULL,
         context_id TEXT,
         checkpoint_id TEXT,
         message TEXT,
         status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
         created_at TEXT NOT NULL,
         resolved_at TEXT,
         FOREIGN KEY (context_id, org_id) REFERENCES context_runs(id, org_id),
         FOREIGN KEY (checkpoint_id, org_id) REFERENCES checkpoints(id, org_id)
       )`,
      // Existing dangling or cross-organization decorations never granted
      // access. Preserve the handoff itself and retire only the unsafe pointer.
      `INSERT INTO handoffs
         (id, org_id, from_principal, to_principal, subject_id, context_id,
          checkpoint_id, message, status, created_at, resolved_at)
       SELECT h.id, h.org_id, h.from_principal, h.to_principal, h.subject_id,
              CASE WHEN EXISTS (
                SELECT 1 FROM context_runs r
                 WHERE r.id = h.context_id AND r.org_id = h.org_id
                   AND r.subject_id = h.subject_id
                   AND NOT EXISTS (
                     SELECT 1
                       FROM context_run_items i
                       JOIN claims c ON c.id = i.claim_id
                      WHERE i.context_id = r.id AND c.org_id = h.org_id
                        AND (
                          NOT (
                            c.visibility = 'organization'
                            OR (c.visibility = 'private' AND c.actor_id = h.from_principal)
                            OR (c.visibility = 'team' AND c.workspace_id IS NOT NULL AND EXISTS (
                              SELECT 1 FROM memberships m
                               WHERE m.org_id = c.org_id
                                 AND m.workspace_id = c.workspace_id
                                 AND m.principal_id = h.from_principal
                                 AND m.removed_at IS NULL
                            ))
                          )
                          OR NOT (
                            c.visibility = 'organization'
                            OR (c.visibility = 'private' AND c.actor_id = h.to_principal)
                            OR (c.visibility = 'team' AND c.workspace_id IS NOT NULL AND EXISTS (
                              SELECT 1 FROM memberships m
                               WHERE m.org_id = c.org_id
                                 AND m.workspace_id = c.workspace_id
                                 AND m.principal_id = h.to_principal
                                 AND m.removed_at IS NULL
                            ))
                          )
                        )
                   )
              ) THEN h.context_id ELSE NULL END,
              CASE WHEN EXISTS (
                SELECT 1 FROM checkpoints c
                 WHERE c.id = h.checkpoint_id AND c.org_id = h.org_id
                   AND c.agent_id = h.from_principal
                   AND c.subject_id = h.subject_id
              ) THEN h.checkpoint_id ELSE NULL END,
              h.message, h.status, h.created_at, h.resolved_at
         FROM handoffs_legacy h`,
      `DROP TABLE handoffs_legacy`,
      `CREATE INDEX handoffs_to ON handoffs (org_id, to_principal, status)`,
      `CREATE TABLE handoff_resolutions (
         handoff_id TEXT PRIMARY KEY REFERENCES handoffs(id),
         org_id TEXT NOT NULL REFERENCES organizations(id),
         actor_id TEXT NOT NULL,
         status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
         resolved_at TEXT NOT NULL
       )`,
      // Principal scope survives credential rotation. key_id remains the
      // credential that created the replay record and is never rewritten.
      `CREATE TABLE idempotency_v3 (
         org_id TEXT NOT NULL REFERENCES organizations(id),
         principal_id TEXT NOT NULL,
         key_id TEXT NOT NULL REFERENCES api_keys(id),
         request_identity TEXT NOT NULL,
         key_hash TEXT NOT NULL,
         request_hash TEXT NOT NULL,
         status INTEGER NOT NULL,
         response TEXT NOT NULL,
         created_at TEXT NOT NULL,
         expires_at TEXT NOT NULL,
         PRIMARY KEY (org_id, principal_id, key_hash)
       )`,
      `INSERT INTO idempotency_v3
         (org_id, principal_id, key_id, request_identity, key_hash, request_hash,
          status, response, created_at, expires_at)
       SELECT i.org_id, a.principal_id, i.key_id, i.request_identity, i.key_hash,
              i.request_hash, i.status, i.response, i.created_at, i.expires_at
         FROM idempotency_v2 i
         JOIN api_keys a ON a.id = i.key_id AND a.org_id = i.org_id
        WHERE NOT EXISTS (
          SELECT 1
            FROM idempotency_v2 newer
            JOIN api_keys newer_key
              ON newer_key.id = newer.key_id AND newer_key.org_id = newer.org_id
           WHERE newer.org_id = i.org_id
             AND newer_key.principal_id = a.principal_id
             AND newer.key_hash = i.key_hash
             AND (
               newer.created_at > i.created_at
               OR (newer.created_at = i.created_at AND newer.key_id > i.key_id)
             )
        )`,
      `CREATE INDEX idempotency_v3_expiry ON idempotency_v3 (expires_at)`,
      // Event IDs stay stable public replay keys; this local sequence supplies
      // the commit order UUIDs cannot encode.
      `CREATE TABLE event_order (
         seq INTEGER PRIMARY KEY AUTOINCREMENT,
         event_id TEXT NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE
       )`,
      `INSERT INTO event_order (event_id)
       SELECT id FROM events ORDER BY created_at, id`,
      `CREATE TRIGGER events_assign_order
         AFTER INSERT ON events
         BEGIN
           INSERT INTO event_order (event_id) VALUES (NEW.id);
         END`,
    ],
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

const REQUIRED_OBJECTS = MIGRATIONS.flatMap(({ statements }) => statements).flatMap((sql) => {
  const match = sql.match(/^CREATE\s+(?:VIRTUAL\s+)?(?:UNIQUE\s+)?(TABLE|INDEX|TRIGGER)\s+([a-z0-9_]+)/i);
  return match ? [{ type: match[1]!.toLowerCase(), name: match[2]! }] : [];
});
const REQUIRED_COLUMNS = MIGRATIONS.flatMap(({ statements }) => statements).flatMap((sql) => {
  const match = sql.match(/^ALTER\s+TABLE\s+([a-z0-9_]+)\s+ADD\s+COLUMN\s+([a-z0-9_]+)/i);
  return match ? [{ table: match[1]!, column: match[2]! }] : [];
});

async function appliedVersion(db: Db): Promise<number> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS titen_migrations (
       version INTEGER PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  );
  const rows = await db.all<{ version: number | null }>(
    `SELECT MAX(version) AS version FROM titen_migrations`,
  );
  return rows[0]?.version ?? 0;
}

/** Read the pending forward-only plan without creating or changing schema. */
export async function pendingMigrations(db: Db): Promise<typeof MIGRATIONS> {
  try {
    const rows = await db.all<{ version: number | null }>(
      `SELECT MAX(version) AS version FROM titen_migrations`,
    );
    const current = rows[0]?.version ?? 0;
    if (current > SCHEMA_VERSION)
      throw new Error(`Database schema version ${current} is newer than this binary (${SCHEMA_VERSION}).`);
    return MIGRATIONS.filter(({ version }) => version > current);
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(error.message)) return [...MIGRATIONS];
    throw error;
  }
}

/** Apply pending migrations as one cross-runtime atomic batch per version. */
export async function migrate(db: Db): Promise<number> {
  let current = await appliedVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    try {
      await db.batch([
        ...migration.statements.map((sql) => ({ sql })),
        {
          sql: `INSERT INTO titen_migrations (version, applied_at) VALUES (?, ?)`,
          params: [migration.version, new Date().toISOString()],
        },
      ]);
      current = migration.version;
    } catch (error) {
      // Another isolate may have committed the same atomic migration first.
      // Accept only a durable winner; every other failure remains fail-closed.
      current = await appliedVersion(db);
      if (current < migration.version) throw error;
    }
  }
  const state = await schemaState(db);
  if (state.applied !== state.expected || !state.verified)
    throw new Error("Database schema verification failed after migration.");
  return SCHEMA_VERSION;
}

/** Readiness needs the applied version without creating anything. */
export async function schemaState(
  db: Db,
): Promise<{ applied: number; expected: number; verified: boolean }> {
  try {
    const rows = await db.all<{ version: number | null }>(
      `SELECT MAX(version) AS version FROM titen_migrations`,
    );
    const applied = rows[0]?.version ?? 0;
    if (applied !== SCHEMA_VERSION)
      return { applied, expected: SCHEMA_VERSION, verified: false };
    for (const object of REQUIRED_OBJECTS) {
      const found = await db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = ? AND name = ?",
        [object.type, object.name],
      );
      if (!found.length) return { applied, expected: SCHEMA_VERSION, verified: false };
    }
    for (const required of REQUIRED_COLUMNS) {
      const columns = await db.all<{ name: string }>(`PRAGMA table_info(${required.table})`);
      if (!columns.some(({ name }) => name === required.column))
        return { applied, expected: SCHEMA_VERSION, verified: false };
    }
    return { applied, expected: SCHEMA_VERSION, verified: true };
  } catch {
    return { applied: 0, expected: SCHEMA_VERSION, verified: false };
  }
}
