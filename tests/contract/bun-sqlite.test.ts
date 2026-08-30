import { afterAll, beforeAll, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { serve } from "../../src/runtime/bun/server";
import { CASES, assertBatchAtomicity } from "./cases";
import { clientVia, provisionWith, revokeWith, TEST_SECRET_CIPHER, TEST_WEBHOOK_SECURITY, type Fixture } from "./harness";
import { assertEnrichmentContract } from "./enrichment";
import {
  assertSemanticIndexOwnership,
  assertSemanticIndexWriteRepair,
  assertSemanticReadiness,
} from "./semantic-readiness";
import { assertWebAuthnContract } from "./webauthn";

const directory = mkdtempSync(join(tmpdir(), "titen-bun-"));
const dbPath = join(directory, "titen.db");

let running: Awaited<ReturnType<typeof serve>>;
let handle: ReturnType<typeof openDatabase>;
let db: ReturnType<typeof createSqliteDb>;

async function start() {
  running = await serve({
    dbPath,
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    revision: "test",
    maintenanceIntervalMs: 0,
    secretCipher: TEST_SECRET_CIPHER,
    webhookSecurity: TEST_WEBHOOK_SECURITY,
  });
  handle = openDatabase(dbPath);
  db = createSqliteDb(handle);
}

async function stop() {
  handle.close();
  await running.stop();
}

const client = () => clientVia((request) => fetch(request), running.url);

const fixture: Fixture = {
  runtime: "bun-sqlite",
  call: (method, path, options) => client().call(method, path, options),
  callRaw: (method, path, options) => client().callRaw(method, path, options),
  provision: (options) => provisionWith(db, options),
  revoke: (keyId) => revokeWith(db, keyId),
  query: (sql, params) => db.all(sql, params),
  async restart() {
    await stop();
    await start();
  },
};

beforeAll(start);
afterAll(async () => {
  await stop();
  rmSync(directory, { recursive: true, force: true });
});

test("batch writes are atomic on bun:sqlite", async () => {
  await assertBatchAtomicity(db);
});

test("bun:sqlite semantic readiness persists and compares its fingerprint locally", async () => {
  await assertSemanticReadiness(db, "bun-sqlite");
});

test("bun:sqlite replays bounded model enrichment", async () => {
  await assertEnrichmentContract(db, "bun-sqlite");
}, 20_000);

test("bun:sqlite fences overlapping semantic index attempts", async () => {
  await assertSemanticIndexOwnership(db, "bun-sqlite");
});

test("bun:sqlite repairs stale external semantic index writes", async () => {
  await assertSemanticIndexWriteRepair(db, "bun-sqlite");
});

test("bun:sqlite enforces the WebAuthn and recovery contract", async () => {
  await assertWebAuthnContract(db, "bun-sqlite");
});

for (const contractCase of CASES)
  test(`bun-sqlite: ${contractCase.name}`, async () => {
    await contractCase.run(fixture);
  });
