import assert from "node:assert/strict";
import type { Db } from "../../src/core/db";
import { MIGRATIONS, migrate, SCHEMA_VERSION } from "../../src/core/migrations";

/** Runs the same populated-v10 rebuild assertion against either SQL adapter. */
export async function assertPopulatedV10RetrievalMigration(db: Db): Promise<void> {
  await db.exec(
    `CREATE TABLE titen_migrations (
       version INTEGER PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  );
  for (const migration of MIGRATIONS.filter(({ version }) => version <= 10)) {
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
            VALUES ('org_v10', 'V10', '2026-07-31T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO observations
              (id, org_id, subject_id, actor_id, kind, content, content_hash,
               source_type, trust, visibility, ingested_at)
            VALUES ('obs_v10', 'org_v10', 'subject_v10', 'agent_v10', 'tool_result',
                    'Caching responses is disabled.', 'hash', 'tool', 'verified',
                    'private', '2026-07-31T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO claims
              (id, org_id, subject_id, actor_id, kind, statement, confidence,
               trust, visibility, status, valid_from, created_at)
            VALUES ('claim_v10', 'org_v10', 'subject_v10', 'agent_v10', 'procedural',
                    'Tests live next to their source files.', 0.9, 'verified',
                    'private', 'active', '2026-07-31T00:00:00.000Z',
                    '2026-07-31T00:00:00.000Z')`,
    },
    { sql: `INSERT INTO observations_fts (content, observation_id) VALUES ('stale only', 'ghost_obs')` },
    { sql: `INSERT INTO claims_fts (statement, claim_id) VALUES ('stale only', 'ghost_claim')` },
  ]);

  assert.equal(await migrate(db), SCHEMA_VERSION);
  assert.ok(MIGRATIONS.some(({ version }) => version === 11));
  const schemas = await db.all<{ name: string; sql: string }>(
    `SELECT name, sql FROM sqlite_master
      WHERE name IN ('observations_fts', 'claims_fts') ORDER BY name`,
  );
  assert.equal(schemas.length, 2);
  for (const schema of schemas) {
    assert.match(schema.sql, /porter unicode61 remove_diacritics 2/);
    assert.match(schema.sql, /org_scope/);
    assert.match(schema.sql, /subject_scope/);
  }
  assert.deepEqual(await db.all(
    `SELECT claim_id FROM claims_fts
      WHERE claims_fts MATCH (
        'org_scope : "' || lower(hex(?)) || '0" AND '
        || 'subject_scope : "' || lower(hex(?)) || '0" AND '
        || 'statement : ("testing")'
      )`,
    ["org_v10", "subject_v10"],
  ), [{ claim_id: "claim_v10" }]);
  assert.deepEqual(await db.all(
    `SELECT observation_id FROM observations_fts
      WHERE observations_fts MATCH (
        'org_scope : "' || lower(hex(?)) || '0" AND '
        || 'subject_scope : "' || lower(hex(?)) || '0" AND '
        || 'content : ("cached")'
      )`,
    ["org_v10", "subject_v10"],
  ), [{ observation_id: "obs_v10" }]);
  assert.deepEqual(await db.all(
    `SELECT
       (SELECT COUNT(*) FROM observations_fts) AS observations,
       (SELECT COUNT(*) FROM claims_fts) AS claims,
       (SELECT COUNT(*) FROM observations) AS canonical_observations,
       (SELECT COUNT(*) FROM claims) AS canonical_claims`,
  ), [{ observations: 1, claims: 1, canonical_observations: 1, canonical_claims: 1 }]);
}
