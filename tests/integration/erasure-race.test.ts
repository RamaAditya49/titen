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

test("purge wins against consolidation and import after evidence preflight", async () => {
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

    const importObserved = await normal.call("POST", "/v1/observations", {
      key: principal.key,
      body: {
        subject_id: "race-import-subject",
        kind: "tool_result",
        content: "Import race purge canary.",
        source: { type: "tool", ref: "import-race" },
        trust: "verified",
      },
    });
    assert.equal(importObserved.status, 201);
    const observationId = importObserved.body.data.observation_id as string;
    const projectId = "project_import_race_rollback";
    const claimId = "claim_import_race_guard";
    const now = "2026-07-31T00:00:00.000Z";
    const project = {
      type: "project",
      id: projectId,
      reference: "race/import-rollback",
      created_at: now,
    };
    const currentClaim = {
      type: "claim",
      id: claimId,
      subject_id: "race-import-subject",
      project_id: null,
      kind: "procedural",
      statement: "A current imported claim must not survive evidence purge.",
      confidence: 0.8,
      trust: "verified",
      visibility: "private",
      status: "active",
      version: 1,
      valid_from: now,
      created_at: now,
      sources: [{ observation_id: observationId, relation: "supports", created_at: now }],
    };

    let releaseImport!: () => void;
    let enteredImport!: () => void;
    const importReleased = new Promise<void>((resolve) => { releaseImport = resolve; });
    const importBlocked = new Promise<void>((resolve) => { enteredImport = resolve; });
    let importHeld = false;
    const gatedImport: Db = {
      all: <Row>(sql: string, params = []) => db.all<Row>(sql, params),
      exec: (sql: string) => db.exec(sql),
      async batch(statements: Stmt[]) {
        if (!importHeld && statements.some((statement) => /INSERT INTO claims\s/u.test(statement.sql))) {
          importHeld = true;
          enteredImport();
          await importReleased;
        }
        await db.batch(statements);
      },
    };
    const importer = clientVia(createApp({ db: gatedImport, runtime: "bun-sqlite" }), "http://titen.test");
    const importing = importer.callRaw("POST", "/v1/import", {
      key: principal.key,
      body: `${JSON.stringify(project)}\n${JSON.stringify(currentClaim)}\n`,
    });

    await importBlocked;
    const importPurged = await normal.call("DELETE", `/v1/observations/${observationId}`, {
      key: principal.key,
    });
    assert.equal(importPurged.status, 200);
    releaseImport();

    const rejectedImport = await importing;
    assert.equal(rejectedImport.status, 409);
    const rolledBack = await db.all<{ projects: number; claims: number; sources: number; fts: number }>(
      `SELECT
         (SELECT COUNT(*) FROM projects WHERE id = ?) AS projects,
         (SELECT COUNT(*) FROM claims WHERE id = ?) AS claims,
         (SELECT COUNT(*) FROM claim_sources WHERE claim_id = ?) AS sources,
         (SELECT COUNT(*) FROM claims_fts WHERE claim_id = ?) AS fts`,
      [projectId, claimId, claimId, claimId],
    );
    assert.deepEqual(rolledBack.map((row) => Object.values(row).map(Number)), [[0, 0, 0, 0]]);

    const tombstone = await normal.callRaw("POST", "/v1/import", {
      key: principal.key,
      body: `${JSON.stringify(project)}\n${JSON.stringify({
        ...currentClaim,
        statement: "[redacted: purged evidence]",
        status: "revoked",
        version: 2,
      })}\n`,
    });
    assert.equal(tombstone.status, 200);
    const restored = await db.all<{ status: string; statement: string; fts: number }>(
      `SELECT c.status, c.statement,
              (SELECT COUNT(*) FROM claims_fts f WHERE f.claim_id = c.id) AS fts
         FROM claims c WHERE c.id = ?`,
      [claimId],
    );
    assert.deepEqual(restored, [{
      status: "revoked",
      statement: "[redacted: purged evidence]",
      fts: 0,
    }]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
