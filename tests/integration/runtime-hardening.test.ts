import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db, Stmt } from "../../src/core/db";
import { backgroundRepairState, runMaintenance } from "../../src/core/maintenance";
import { MIGRATIONS, migrate, SCHEMA_VERSION } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { serve } from "../../src/runtime/bun/server";
import { assertPopulatedV11IntegrityMigration } from "../contract/integrity-migration";
import { fakeVectors } from "../contract/harness";

const directories: string[] = [];
const temporary = () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-runtime-"));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("a failed migration version rolls back fully and succeeds on retry", async () => {
  const statements = MIGRATIONS.at(-1)!.statements;
  for (let failureAfter = 0; failureAfter < statements.length; failureAfter += 1) {
    const database = openDatabase(join(temporary(), "titen.db"));
    const db = createSqliteDb(database);
    let inject = true;
    const injected: Db = {
      ...db,
      async batch(batch: Stmt[]) {
        const marker = batch.at(-1);
        if (inject && marker?.params?.[0] === SCHEMA_VERSION) {
          inject = false;
          await db.batch([
            ...batch.slice(0, failureAfter + 1),
            { sql: "INSERT INTO deliberately_missing_table(value) VALUES (1)" },
          ]);
          return;
        }
        await db.batch(batch);
      },
    };

    await assert.rejects(() => migrate(injected));
    const version = await db.all<{ version: number }>("SELECT MAX(version) AS version FROM titen_migrations");
    assert.equal(Number(version[0]!.version), SCHEMA_VERSION - 1);
    const integrity = await db.all<{ name: string; sql: string }>(
      `SELECT name, sql FROM sqlite_master
        WHERE name IN ('checkpoints_scope', 'event_order', 'semantic_index_metadata')
        ORDER BY name`,
    );
    assert.deepEqual(
      integrity.map(({ name }) => name),
      ["checkpoints_scope", "event_order", "semantic_index_metadata"],
      `migration must roll back after statement ${failureAfter + 1}`,
    );
    assert.match(integrity.find(({ name }) => name === "checkpoints_scope")!.sql, /UNIQUE/);
    assert.deepEqual(
      (await db.all<{ name: string }>("PRAGMA table_info(semantic_index_metadata)"))
        .filter(({ name }) => name.endsWith("_failure_at")),
      [],
    );
    assert.equal(await migrate(db), SCHEMA_VERSION);
    database.close();
  }
});

test("concurrent migration callers converge on one complete schema", async () => {
  const database = openDatabase(join(temporary(), "titen.db"));
  const db = createSqliteDb(database);
  assert.deepEqual(await Promise.all([migrate(db), migrate(db)]), [SCHEMA_VERSION, SCHEMA_VERSION]);
  const rows = await db.all<{ version: number; count: number }>(
    "SELECT MAX(version) AS version, COUNT(*) AS count FROM titen_migrations",
  );
  assert.deepEqual(rows[0], { version: SCHEMA_VERSION, count: SCHEMA_VERSION });
  database.close();
});

test("migration retires unowned federation peers and releases their endpoint", async () => {
  const database = openDatabase(join(temporary(), "titen.db"));
  const db = createSqliteDb(database);
  await db.exec(
    `CREATE TABLE titen_migrations (
       version INTEGER PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  );
  for (const migration of MIGRATIONS.filter(({ version }) => version < 10)) {
    await db.batch([
      ...migration.statements.map((sql) => ({ sql })),
      {
        sql: `INSERT INTO titen_migrations (version, applied_at) VALUES (?, ?)`,
        params: [migration.version, "2026-07-30T00:00:00.000Z"],
      },
    ]);
  }
  await db.batch([
    { sql: `INSERT INTO organizations (id, name, created_at) VALUES ('org_legacy', 'Legacy', '2026-07-30T00:00:00.000Z')` },
    {
      sql: `INSERT INTO federation_peers
              (id, org_id, name, endpoint, shared_secret_hash, direction, status, created_at)
            VALUES ('fpeer_legacy', 'org_legacy', 'Legacy', 'https://peer.example.test', 'hash', 'pull', 'active', '2026-07-30T00:00:00.000Z')`,
    },
  ]);

  assert.equal(await migrate(db), SCHEMA_VERSION);
  assert.deepEqual(
    await db.all("SELECT principal_id, endpoint, status FROM federation_peers WHERE id = 'fpeer_legacy'"),
    [{
      principal_id: null,
      endpoint: "https://peer.example.test#titen-legacy-peer=fpeer_legacy",
      status: "suspended",
    }],
  );
  await db.batch([{
    sql: `INSERT INTO federation_peers
            (id, org_id, principal_id, name, endpoint, shared_secret_hash, direction, status, created_at)
          VALUES ('fpeer_replacement', 'org_legacy', 'agent_owner', 'Replacement', 'https://peer.example.test', 'hash', 'pull', 'active', '2026-07-30T00:00:01.000Z')`,
  }]);
  database.close();
});

test("a populated schema-v11 SQLite database repairs collaboration integrity", async () => {
  const database = openDatabase(join(temporary(), "titen.db"));
  const db = createSqliteDb(database);
  await assertPopulatedV11IntegrityMigration(db);
  database.close();
});

test("a stale schema exposes diagnostics but blocks API traffic", async () => {
  const running = await serve({
    dbPath: join(temporary(), "titen.db"),
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    autoMigrate: false,
    maintenanceIntervalMs: 0,
  });
  assert.equal((await fetch(`${running.url}/healthz`)).status, 200);
  const readiness = await fetch(`${running.url}/readyz`);
  assert.equal(readiness.status, 503);
  const readinessBody = (await readiness.json()) as any;
  assert.equal(readinessBody.meta.schema.applied, 0);
  assert.equal(readinessBody.meta.schema.expected, SCHEMA_VERSION);
  const blocked = await fetch(`${running.url}/v1/observations`, { method: "POST" });
  assert.equal(blocked.status, 503);
  assert.equal(((await blocked.json()) as any).error.code, "UNAVAILABLE");
  await running.stop();
});

test("a pre-v14 schema with vectors still returns sanitized migration readiness", async () => {
  const path = join(temporary(), "titen.db");
  const database = openDatabase(path);
  const db = createSqliteDb(database);
  await db.exec(
    `CREATE TABLE titen_migrations (
       version INTEGER PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  );
  for (const migration of MIGRATIONS.filter(({ version }) => version < SCHEMA_VERSION))
    await db.batch([
      ...migration.statements.map((sql) => ({ sql })),
      {
        sql: `INSERT INTO titen_migrations (version, applied_at) VALUES (?, ?)`,
        params: [migration.version, "2026-07-31T00:00:00.000Z"],
      },
    ]);
  database.close();

  const running = await serve({
    dbPath: path,
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    autoMigrate: false,
    maintenanceIntervalMs: 0,
    vectors: fakeVectors(),
  });
  try {
    const readiness = await fetch(`${running.url}/readyz`);
    assert.equal(readiness.status, 503);
    const body = (await readiness.json()) as any;
    assert.equal(body.error.code, "NOT_READY");
    assert.equal(body.meta.schema.applied, SCHEMA_VERSION - 1);
    assert.equal(body.meta.schema.expected, SCHEMA_VERSION);
    assert.equal(body.meta.checks.migrations, "failed");
  } finally {
    await running.stop();
  }
});

test("background repair reports enabled, stale, and disabled from canonical evidence", async () => {
  const database = openDatabase(join(temporary(), "titen.db"));
  const db = createSqliteDb(database);
  await migrate(db);
  const passAt = new Date("2026-07-30T10:00:00.000Z");

  assert.equal(await backgroundRepairState({ db, configured: true, now: passAt, staleAfterMs: 1_000 }), "stale");
  await runMaintenance({ db, now: passAt, deliverWebhooks: false, expectedIntervalMs: 1_000 });
  assert.equal(await backgroundRepairState({ db, configured: true, now: new Date(passAt.getTime() + 999), staleAfterMs: 1_000 }), "enabled");
  assert.equal(await backgroundRepairState({ db, configured: true, now: new Date(passAt.getTime() + 3_001), staleAfterMs: 1_000 }), "stale");
  assert.equal(await backgroundRepairState({ db, configured: false, now: passAt, staleAfterMs: 1_000 }), "disabled");
  database.close();
});

test("the explicit WAL checkpoint policy stays bounded and survives restart", async () => {
  const path = join(temporary(), "titen.db");
  const database = openDatabase(path);
  assert.equal(database.query("PRAGMA wal_autocheckpoint").get()?.wal_autocheckpoint, 1_000);
  assert.equal(database.query("PRAGMA synchronous").get()?.synchronous, 2);
  database.run("CREATE TABLE writes (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  const insert = database.query("INSERT INTO writes(value) VALUES (?)");
  const writeBatch = database.transaction((start: number) => {
    for (let offset = 0; offset < 100; offset += 1)
      insert.run(`${start + offset}:${"x".repeat(256)}`);
  });
  const walPath = `${path}-wal`;
  let maximumWalBytes = 0;
  for (let start = 0; start < 30_000; start += 100) {
    writeBatch(start);
    maximumWalBytes = Math.max(maximumWalBytes, statSync(walPath).size);
  }
  assert.ok(existsSync(walPath));
  assert.ok(maximumWalBytes <= 5 * 1024 * 1024, `WAL peaked at ${maximumWalBytes} bytes`);
  database.close();

  const reopened = openDatabase(path);
  assert.equal((reopened.query("SELECT COUNT(*) AS count FROM writes").get() as { count: number }).count, 30_000);
  reopened.close();
});
