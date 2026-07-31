import assert from "node:assert/strict";
import type { Db } from "../../src/core/db";
import { MIGRATIONS, migrate, SCHEMA_VERSION } from "../../src/core/migrations";
import { observedSemanticReadiness } from "../../src/core/vectors";

/** A schema upgrade cannot manufacture semantic dependency recovery. */
export async function assertPopulatedV14SemanticOutageMigration(db: Db): Promise<void> {
  await db.exec(
    `CREATE TABLE titen_migrations (
       version INTEGER PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  );
  for (const migration of MIGRATIONS.filter(({ version }) => version <= 14)) {
    await db.batch([
      ...migration.statements.map((sql) => ({ sql })),
      {
        sql: `INSERT INTO titen_migrations (version, applied_at) VALUES (?, ?)`,
        params: [migration.version, "2026-07-31T00:00:00.000Z"],
      },
    ]);
  }
  await db.batch([
    {
      sql: `INSERT INTO organizations (id, name, created_at)
            VALUES ('org_semantic_outage', 'Semantic outage', '2026-07-31T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO semantic_index_metadata
              (id, provider, model, revision, dimensions, metric, preprocessing,
               index_schema, created_at, embedder_failure_at,
               vector_store_failure_at)
            VALUES ('claims', 'contract', 'contract-stub', 'v1', 4, 'cosine',
                    'text-v1', 'claims-scope-v1', '2026-07-31T00:00:00.000Z',
                    '2026-07-31T00:01:00.000Z', NULL)`,
    },
    {
      sql: `INSERT INTO index_outbox
              (id, org_id, record_type, record_id, operation, state, attempts,
               created_at)
            VALUES
              ('idx_outage_failed', 'org_semantic_outage', 'claim',
               'claim_outage', 'upsert', 'done', 1,
               '2026-07-31T00:00:00.000Z'),
              ('idx_outage_delete', 'org_semantic_outage', 'claim',
               'claim_outage', 'delete', 'pending', 0,
               '2026-07-31T00:02:00.000Z')`,
    },
  ]);

  assert.equal(await migrate(db), SCHEMA_VERSION);
  assert.deepEqual(await db.all(
    `SELECT embedder_failure_at, vector_store_failure_at
       FROM semantic_index_metadata WHERE id = 'claims'`,
  ), [{
    embedder_failure_at: "2026-07-31T00:01:00.000Z",
    vector_store_failure_at: null,
  }]);
  assert.deepEqual(await db.all(
    `SELECT operation, state, attempts FROM index_outbox ORDER BY id`,
  ), [
    { operation: "delete", state: "pending", attempts: 0 },
    { operation: "upsert", state: "done", attempts: 1 },
  ]);
  assert.deepEqual(await observedSemanticReadiness(db, {
    embedding: "enabled",
    vector: "enabled",
  }), {
    embedding: "configured_error",
    vector: "enabled",
    diagnostic: "embedding_dependency_unavailable",
  });
}

/** Runs the same populated-v11 integrity upgrade against either SQL adapter. */
export async function assertPopulatedV11IntegrityMigration(db: Db): Promise<void> {
  await db.exec(
    `CREATE TABLE titen_migrations (
       version INTEGER PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  );
  for (const migration of MIGRATIONS.filter(({ version }) => version <= 11)) {
    await db.batch([
      ...migration.statements.map((sql) => ({ sql })),
      {
        sql: `INSERT INTO titen_migrations (version, applied_at) VALUES (?, ?)`,
        params: [migration.version, "2026-07-31T00:00:00.000Z"],
      },
    ]);
  }

  await db.batch([
    { sql: `INSERT INTO organizations (id, name, created_at) VALUES ('org_integrity_a', 'A', '2026-07-31T00:00:00.000Z')` },
    { sql: `INSERT INTO organizations (id, name, created_at) VALUES ('org_integrity_b', 'B', '2026-07-31T00:00:00.000Z')` },
    {
      sql: `INSERT INTO api_keys
              (id, org_id, principal_id, principal_kind, key_hash, label, scopes,
               max_trust, created_at)
            VALUES
              ('key_integrity_old', 'org_integrity_a', 'agent_integrity_a', 'agent',
               'credential_hash_old', 'old', '*', 'verified', '2026-07-31T00:00:00.000Z'),
              ('key_integrity_new', 'org_integrity_a', 'agent_integrity_a', 'agent',
               'credential_hash_new', 'new', '*', 'verified', '2026-07-31T00:00:01.000Z')`,
    },
    {
      sql: `INSERT INTO checkpoints
              (id, org_id, subject_id, agent_id, kind, state, state_hash,
               ttl_seconds, expires_at, created_at, updated_at)
            VALUES
              ('ckpt_integrity_old', 'org_integrity_a', 'subject_integrity',
               'agent_integrity_a', 'task_state', '{"winner":"old"}', 'old', 600,
               '2099-01-01T00:00:00.000Z', '2026-07-31T00:00:00.000Z',
               '2026-07-31T00:00:00.000Z'),
              ('ckpt_integrity_new', 'org_integrity_a', 'subject_integrity',
               'agent_integrity_a', 'task_state', '{"winner":"new"}', 'new', 600,
               '2099-01-01T00:00:00.000Z', '2026-07-31T00:00:01.000Z',
               '2026-07-31T00:00:01.000Z'),
              ('ckpt_integrity_foreign', 'org_integrity_b', 'subject_integrity',
               'agent_integrity_b', 'task_state', '{}', 'foreign', 600,
               '2099-01-01T00:00:00.000Z', '2026-07-31T00:00:00.000Z',
               '2026-07-31T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO context_runs
              (id, org_id, actor_id, subject_id, task_hash, max_tokens,
               used_tokens, policy_snapshot, degraded, created_at)
            VALUES
              ('ctx_integrity_a', 'org_integrity_a', 'agent_integrity_a',
               'subject_integrity', 'hash_a', 256, 0, 'policy', '{}',
               '2026-07-31T00:00:00.000Z'),
              ('ctx_integrity_foreign_item', 'org_integrity_a', 'agent_integrity_a',
               'subject_integrity', 'hash_foreign_item', 256, 1, 'policy', '{}',
               '2026-07-31T00:00:00.000Z'),
              ('ctx_integrity_missing_item', 'org_integrity_a', 'agent_integrity_a',
               'subject_integrity', 'hash_missing_item', 256, 1, 'policy', '{}',
               '2026-07-31T00:00:00.000Z'),
              ('ctx_integrity_foreign', 'org_integrity_b', 'agent_integrity_b',
               'subject_integrity', 'hash_b', 256, 0, 'policy', '{}',
               '2026-07-31T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO claims
              (id, org_id, subject_id, actor_id, kind, statement, confidence,
               trust, visibility, status, valid_from, created_at)
            VALUES
              ('claim_integrity_private', 'org_integrity_a', 'subject_integrity',
               'agent_integrity_secret', 'procedural', 'Private migration marker.',
               0.9, 'verified', 'private', 'active',
               '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
              ('claim_integrity_foreign', 'org_integrity_b', 'subject_integrity',
               'agent_integrity_b', 'procedural', 'Foreign migration marker.',
               0.9, 'verified', 'organization', 'active',
               '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO context_runs
              (id, org_id, actor_id, subject_id, task_hash, max_tokens,
               used_tokens, policy_snapshot, degraded, created_at)
            VALUES ('ctx_integrity_private', 'org_integrity_a',
                    'agent_integrity_secret', 'subject_integrity', 'hash_private',
                    256, 10, 'policy', '{}', '2026-07-31T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO context_run_items
              (context_id, claim_id, position, score, score_components)
            VALUES
              ('ctx_integrity_private', 'claim_integrity_private', 0, 1.0, '{}'),
              ('ctx_integrity_foreign_item', 'claim_integrity_foreign', 0, 1.0, '{}')`,
    },
    {
      sql: `INSERT INTO handoffs
              (id, org_id, from_principal, to_principal, subject_id, context_id,
               checkpoint_id, status, created_at)
            VALUES
              ('hoff_integrity_duplicate', 'org_integrity_a', 'agent_integrity_a',
               'agent_receiver', 'subject_integrity', 'ctx_integrity_a',
               'ckpt_integrity_old', 'pending', '2026-07-31T00:00:00.000Z'),
              ('hoff_integrity_cross_scope', 'org_integrity_a', 'agent_integrity_a',
               'agent_receiver', 'subject_integrity', 'ctx_integrity_foreign',
               'ckpt_integrity_foreign', 'pending', '2026-07-31T00:00:00.000Z'),
              ('hoff_integrity_dangling', 'org_integrity_a', 'agent_integrity_a',
               'agent_receiver', 'subject_integrity', NULL,
               'ckpt_integrity_missing', 'pending', '2026-07-31T00:00:00.000Z'),
              ('hoff_integrity_private', 'org_integrity_a', 'agent_integrity_secret',
               'agent_receiver', 'subject_integrity', 'ctx_integrity_private',
               NULL, 'pending', '2026-07-31T00:00:00.000Z'),
              ('hoff_integrity_foreign_item', 'org_integrity_a', 'agent_integrity_a',
               'agent_receiver', 'subject_integrity', 'ctx_integrity_foreign_item',
               NULL, 'pending', '2026-07-31T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO idempotency_v2
              (org_id, key_id, request_identity, key_hash, request_hash, status,
               response, created_at, expires_at)
            VALUES
              ('org_integrity_a', 'key_integrity_old', 'POST /v1/observations',
               'mutation_hash', 'request_old', 201, '{"winner":"old"}',
               '2026-07-31T00:00:00.000Z', '2099-01-01T00:00:00.000Z'),
              ('org_integrity_a', 'key_integrity_new', 'POST /v1/observations',
               'mutation_hash', 'request_new', 201, '{"winner":"new"}',
               '2026-07-31T00:00:01.000Z', '2099-01-01T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO events
              (id, org_id, kind, actor_id, resource_type, resource_id, payload, created_at)
            VALUES
              ('evt_integrity_z', 'org_integrity_a', 'probe', 'agent_integrity_a',
               'probe', 'z', '{}', '2026-07-31T00:00:00.000Z'),
              ('evt_integrity_a', 'org_integrity_a', 'probe', 'agent_integrity_a',
               'probe', 'a', '{}', '2026-07-31T00:00:00.000Z')`,
    },
  ]);

  // A v11 database could contain an orphan created while FK enforcement was
  // disabled. Migration must retire its handoff pointer instead of overlooking
  // the missing claim through an inner join.
  let orphanSeeded = false;
  await db.exec("PRAGMA foreign_keys = OFF");
  try {
    await db.batch([
      {
        sql: `INSERT INTO context_run_items
                (context_id, claim_id, position, score, score_components)
              VALUES ('ctx_integrity_missing_item', 'claim_integrity_missing', 0, 1.0, '{}')`,
      },
      {
        sql: `INSERT INTO handoffs
                (id, org_id, from_principal, to_principal, subject_id, context_id,
                 checkpoint_id, status, created_at)
              VALUES ('hoff_integrity_missing_item', 'org_integrity_a',
                      'agent_integrity_a', 'agent_receiver', 'subject_integrity',
                      'ctx_integrity_missing_item', NULL, 'pending',
                      '2026-07-31T00:00:00.000Z')`,
      },
    ]);
    orphanSeeded = true;
  } catch (error) {
    if (!/FOREIGN KEY/i.test(String(error))) throw error;
  } finally {
    await db.exec("PRAGMA foreign_keys = ON");
  }

  assert.equal(await migrate(db), SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 16);
  assert.deepEqual(
    await db.all(`SELECT name FROM sqlite_master WHERE name = 'semantic_index_metadata'`),
    [{ name: "semantic_index_metadata" }],
  );
  assert.deepEqual(await db.all(
    `SELECT id, state FROM checkpoints
      WHERE org_id = 'org_integrity_a' AND subject_id = 'subject_integrity'`,
  ), [{ id: "ckpt_integrity_new", state: '{"winner":"new"}' }]);
  assert.deepEqual(await db.all(
    `SELECT id, context_id, checkpoint_id FROM handoffs ORDER BY id`,
  ), [
    { id: "hoff_integrity_cross_scope", context_id: null, checkpoint_id: null },
    { id: "hoff_integrity_dangling", context_id: null, checkpoint_id: null },
    { id: "hoff_integrity_duplicate", context_id: "ctx_integrity_a", checkpoint_id: "ckpt_integrity_new" },
    { id: "hoff_integrity_foreign_item", context_id: null, checkpoint_id: null },
    ...(orphanSeeded ? [{ id: "hoff_integrity_missing_item", context_id: null, checkpoint_id: null }] : []),
    { id: "hoff_integrity_private", context_id: null, checkpoint_id: null },
  ]);
  await assert.rejects(() => db.batch([{
    sql: `INSERT INTO checkpoints
            (id, org_id, subject_id, agent_id, kind, state, state_hash,
             ttl_seconds, expires_at, created_at, updated_at)
          VALUES ('ckpt_integrity_duplicate', 'org_integrity_a', 'subject_integrity',
                  'agent_integrity_a', 'task_state', '{}', 'duplicate', 600,
                  '2099-01-01T00:00:00.000Z', '2026-07-31T00:00:02.000Z',
                  '2026-07-31T00:00:02.000Z')`,
  }]));

  const foreignKeys = await db.all<{ table: string }>("PRAGMA foreign_key_list(handoffs)");
  assert.ok(foreignKeys.some((entry) => entry.table === "checkpoints"));
  assert.ok(foreignKeys.some((entry) => entry.table === "context_runs"));
  assert.deepEqual(await db.all(
    `SELECT principal_id, key_id, request_hash, response FROM idempotency_v3`,
  ), [{
    principal_id: "agent_integrity_a",
    key_id: "key_integrity_new",
    request_hash: "request_new",
    response: '{"winner":"new"}',
  }]);
  assert.deepEqual(await db.all(
    `SELECT e.id, eo.seq FROM event_order eo JOIN events e ON e.id = eo.event_id
      ORDER BY eo.seq`,
  ), [
    { id: "evt_integrity_a", seq: 1 },
    { id: "evt_integrity_z", seq: 2 },
  ]);
  await db.batch([{
    sql: `INSERT INTO events
            (id, org_id, kind, actor_id, resource_type, resource_id, payload, created_at)
          VALUES ('evt_integrity_new', 'org_integrity_a', 'probe',
                  'agent_integrity_a', 'probe', 'new', '{}',
                  '2026-07-31T00:00:00.000Z')`,
  }]);
  assert.deepEqual(await db.all(
    `SELECT seq FROM event_order WHERE event_id = 'evt_integrity_new'`,
  ), [{ seq: 3 }]);
}
