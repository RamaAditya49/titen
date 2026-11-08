import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";

test("migration 30 indexes releases that were already active", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-release-fts-"));
  const database = openDatabase(join(directory, "titen.db"));
  const db = createSqliteDb(database);
  try {
    await db.exec(
      `CREATE TABLE titen_migrations (
         version INTEGER PRIMARY KEY,
         applied_at TEXT NOT NULL
       )`,
    );
    for (const migration of MIGRATIONS.filter(({ version }) => version <= 27))
      await db.batch([
        ...migration.statements.map((sql) => ({ sql })),
        {
          sql: `INSERT INTO titen_migrations (version, applied_at) VALUES (?, ?)`,
          params: [migration.version, "2026-11-01T00:00:00.000Z"],
        },
      ]);
    database.run("PRAGMA foreign_keys = OFF");
    const insert = (id: string, version: number, status: string, content: string) =>
      db.batch([{
        sql: `INSERT INTO channel_releases
                (id, org_id, channel, audience, version, status, created_at,
                 channel_id, claim_id, claim_version, released_content,
                 lifecycle_status, valid_from, activated_at, updated_at)
              VALUES (?, 'org_existing', 'chn_existing', 'anonymous', ?, 'active',
                      '2026-11-01T00:00:00.000Z', 'chn_existing', 'clm_existing', 1,
                      ?, ?, '2025-01-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z',
                      '2026-11-01T00:00:00.000Z')`,
        params: [id, version, content, status],
      }]);
    await insert("rel_active", 1, "active", "Returns are accepted within thirty days.");
    await insert("rel_draft", 2, "draft", "Returns draft wording that is not live.");
    assert.equal(await migrate(db), MIGRATIONS.at(-1)!.version);
    const hits = await db.all<{ release_id: string }>(
      `SELECT release_id FROM channel_release_fts
        WHERE channel_release_fts MATCH ('org_scope : "' || lower(hex(?)) || '0" AND '
              || 'channel_scope : "' || lower(hex(?)) || '0" AND released_content : ("returns")')`,
      ["org_existing", "chn_existing"],
    );
    assert.deepEqual(hits.map((row) => row.release_id), ["rel_active"]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
