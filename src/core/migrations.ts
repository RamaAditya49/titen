import type { Db } from "./db";

/**
 * Forward-only migrations, identical on D1 and bun:sqlite.
 *
 * Rules for new entries: append only, one statement per array item, no PRAGMA
 * (D1 rejects most), parents before children so foreign keys hold, and no
 * destructive statement without its own work item.
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
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

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

/** Apply pending migrations. Safe to call repeatedly and concurrently-ish. */
export async function migrate(db: Db): Promise<number> {
  const current = await appliedVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    for (const statement of migration.statements) await db.exec(statement);
    await db.batch([
      {
        sql: `INSERT INTO titen_migrations (version, applied_at) VALUES (?, ?)`,
        params: [migration.version, new Date().toISOString()],
      },
    ]);
  }
  return SCHEMA_VERSION;
}

/** Readiness needs the applied version without creating anything. */
export async function schemaState(
  db: Db,
): Promise<{ applied: number; expected: number }> {
  try {
    const rows = await db.all<{ version: number | null }>(
      `SELECT MAX(version) AS version FROM titen_migrations`,
    );
    return { applied: rows[0]?.version ?? 0, expected: SCHEMA_VERSION };
  } catch {
    return { applied: 0, expected: SCHEMA_VERSION };
  }
}
