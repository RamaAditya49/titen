import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiKey, organizationStatement } from "../../src/core/auth";
import { MIGRATIONS, migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";

test("migration 26 keeps a live api key and adds no fence rows", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-key-fence-"));
  const database = openDatabase(join(directory, "titen.db"));
  const db = createSqliteDb(database);
  try {
    await db.exec(
      `CREATE TABLE titen_migrations (
         version INTEGER PRIMARY KEY,
         applied_at TEXT NOT NULL
       )`,
    );
    for (const migration of MIGRATIONS.filter(({ version }) => version <= 25))
      await db.batch([
        ...migration.statements.map((sql) => ({ sql })),
        {
          sql: `INSERT INTO titen_migrations (version, applied_at) VALUES (?, ?)`,
          params: [migration.version, "2026-10-05T00:00:00.000Z"],
        },
      ]);
    const key = await createApiKey({
      orgId: "org_existing",
      principalId: "agent_existing",
      principalKind: "agent",
      label: "existing",
      scopes: ["observations:write"],
      maxTrust: "asserted",
    });
    await db.batch([
      organizationStatement("org_existing", "Castle"),
      key.statement,
    ]);
    assert.equal(await migrate(db), MIGRATIONS.at(-1)!.version);
    const stored = await db.all<{ id: string; label: string }>(
      `SELECT id, label FROM api_keys WHERE id = ?`,
      [key.id],
    );
    assert.deepEqual(stored, [{ id: key.id, label: "existing" }]);
    const fences = await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM api_key_fences`);
    assert.equal(Number(fences[0]?.n ?? 0), 0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
