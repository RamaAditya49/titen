import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";

test("migration 25 keeps a v0.10 project and leaves omitted visibility private", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-project-default-"));
  const database = openDatabase(join(directory, "titen.db"));
  const db = createSqliteDb(database);
  try {
    await db.exec(
      `CREATE TABLE titen_migrations (
         version INTEGER PRIMARY KEY,
         applied_at TEXT NOT NULL
       )`,
    );
    for (const migration of MIGRATIONS.filter(({ version }) => version <= 24))
      await db.batch([
        ...migration.statements.map((sql) => ({ sql })),
        {
          sql: `INSERT INTO titen_migrations (version, applied_at) VALUES (?, ?)`,
          params: [migration.version, "2026-10-05T00:00:00.000Z"],
        },
      ]);
    await db.batch([
      {
        sql: `INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)`,
        params: ["org_existing", "Castle", "2026-10-05T00:00:00.000Z"],
      },
      {
        sql: `INSERT INTO projects (id, org_id, reference, created_at) VALUES (?, ?, ?, ?)`,
        params: ["project_shared", "org_existing", "castle/shared", "2026-10-05T00:00:00.000Z"],
      },
    ]);
    assert.equal(await migrate(db), MIGRATIONS.at(-1)!.version);
    const row = await db.all<{ reference: string; default_visibility: string | null }>(
      `SELECT reference, default_visibility FROM projects WHERE id = ?`,
      ["project_shared"],
    );
    assert.deepEqual(row, [{ reference: "castle/shared", default_visibility: null }]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
