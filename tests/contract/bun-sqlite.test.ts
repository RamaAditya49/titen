import { afterAll, beforeAll, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { serve } from "../../src/runtime/bun/server";
import { CASES, assertBatchAtomicity } from "./cases";
import { clientVia, provisionWith, revokeWith, type Fixture } from "./harness";

const directory = mkdtempSync(join(tmpdir(), "titen-bun-"));
const dbPath = join(directory, "titen.db");

let running: Awaited<ReturnType<typeof serve>>;
let handle: ReturnType<typeof openDatabase>;
let db: ReturnType<typeof createSqliteDb>;

async function start() {
  running = await serve({ dbPath, port: 0, hostname: "127.0.0.1", quiet: true, revision: "test" });
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

for (const contractCase of CASES)
  test(`bun-sqlite: ${contractCase.name}`, async () => {
    await contractCase.run(fixture);
  });
