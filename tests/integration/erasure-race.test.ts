import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/core/app";
import type { Db, Stmt } from "../../src/core/db";
import { migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { clientVia, provisionWith } from "../contract/harness";

test("purge wins against a consolidation that already validated its evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-erasure-race-"));
  const database = openDatabase(join(directory, "titen.db"));
  const db = createSqliteDb(database);
  try {
    await migrate(db);
    const principal = await provisionWith(db, { scopes: ["*"] });
    const normal = clientVia(createApp({ db, runtime: "bun-sqlite" }), "http://titen.test");
    const observed = await normal.call("POST", "/v1/observations", {
      key: principal.key,
      body: {
        subject_id: "race-subject",
        kind: "tool_result",
        content: "Race purge canary.",
        source: { type: "tool", ref: "race" },
        trust: "verified",
      },
    });
    assert.equal(observed.status, 201);

    let release!: () => void;
    let entered!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const blocked = new Promise<void>((resolve) => { entered = resolve; });
    let held = false;
    const gated: Db = {
      all: <Row>(sql: string, params = []) => db.all<Row>(sql, params),
      exec: (sql: string) => db.exec(sql),
      async batch(statements: Stmt[]) {
        if (!held && statements.some((statement) => /INSERT INTO claims\s/u.test(statement.sql))) {
          held = true;
          entered();
          await released;
        }
        await db.batch(statements);
      },
    };
    const writer = clientVia(createApp({ db: gated, runtime: "bun-sqlite" }), "http://titen.test");
    const consolidation = writer.call("POST", "/v1/consolidations", {
      key: principal.key,
      body: {
        subject_id: "race-subject",
        claims: [{
          kind: "procedural",
          statement: "Race purge canary must not survive.",
          sources: [{ observation_id: observed.body.data.observation_id, relation: "supports" }],
        }],
      },
    });

    await blocked;
    const purged = await normal.call("DELETE", `/v1/observations/${observed.body.data.observation_id}`, {
      key: principal.key,
    });
    assert.equal(purged.status, 200);
    release();

    const rejected = await consolidation;
    assert.equal(rejected.status, 404);
    assert.equal(rejected.body.meta.field, "claims[0].sources[0].observation_id");
    const rows = await db.all<{ claims: number; fts: number }>(
      `SELECT (SELECT COUNT(*) FROM claims WHERE org_id = ?) AS claims,
              (SELECT COUNT(*) FROM claims_fts) AS fts`,
      [principal.orgId],
    );
    assert.deepEqual(rows.map((row) => [Number(row.claims), Number(row.fts)]), [[0, 0]]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
