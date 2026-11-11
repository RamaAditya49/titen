import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";

test("migration 32 clears the output hash of pending and leased jobs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-retry-hash-"));
  const database = openDatabase(join(directory, "titen.db"));
  const db = createSqliteDb(database);
  try {
    await db.exec(
      `CREATE TABLE titen_migrations (
         version INTEGER PRIMARY KEY,
         applied_at TEXT NOT NULL
       )`,
    );
    for (const migration of MIGRATIONS.filter(({ version }) => version <= 31))
      await db.batch([
        ...migration.statements.map((sql) => ({ sql })),
        {
          sql: `INSERT INTO titen_migrations (version, applied_at) VALUES (?, ?)`,
          params: [migration.version, "2026-11-01T00:00:00.000Z"],
        },
      ]);
    database.run("PRAGMA foreign_keys = OFF");
    const hash = "a".repeat(64);
    const insert = (id: string, state: string, outputHash: string | null) =>
      db.batch([{
        sql: `INSERT INTO enrichment_jobs
                (id, org_id, lane, derivation_key, input_ids, input_hash, subject_id, actor_id,
                 model_id, model_fingerprint, prompt_fingerprint, schema_fingerprint,
                 policy_fingerprint, state, attempts, next_attempt_at, lease_token,
                 lease_expires_at, output_hash, created_at, updated_at)
              VALUES (?, 'org_existing', 'reflection', NULL, '[]', ?, 'subject_existing',
                      'actor_existing', 'model', 'm', 'p', 's', 'y', ?, 1,
                      '2026-11-01T00:00:00.000Z', ?, ?, ?,
                      '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`,
        params: [
          id,
          `input_${id}`,
          state,
          state === "leased" ? "lease_token" : null,
          state === "leased" ? "2026-11-02T00:00:00.000Z" : null,
          outputHash,
        ],
      }]);
    await insert("job_pending", "pending", hash);
    await insert("job_leased", "leased", hash);
    await insert("job_failed", "failed", hash);
    await insert("job_done", "done", hash);
    await insert("job_pending_empty", "pending", null);
    assert.equal(await migrate(db), MIGRATIONS.at(-1)!.version);
    const rows = await db.all<{ id: string; output_hash: string | null }>(
      `SELECT id, output_hash FROM enrichment_jobs ORDER BY id`,
    );
    assert.deepEqual(rows, [
      { id: "job_done", output_hash: hash },
      { id: "job_failed", output_hash: hash },
      { id: "job_leased", output_hash: null },
      { id: "job_pending", output_hash: null },
      { id: "job_pending_empty", output_hash: null },
    ]);
    await assert.rejects(
      () => db.batch([{
        sql: `UPDATE enrichment_jobs SET output_hash = ? WHERE id = 'job_done'`,
        params: ["b".repeat(64)],
      }]),
      /ENRICHMENT_OUTPUT_IMMUTABLE/u,
    );
    await db.batch([{
      sql: `UPDATE enrichment_jobs
               SET state = 'pending', attempts = 0, output_hash = NULL
             WHERE id = 'job_failed'`,
    }]);
    assert.deepEqual(
      await db.all(`SELECT state, output_hash FROM enrichment_jobs WHERE id = 'job_failed'`),
      [{ state: "pending", output_hash: null }],
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
