import { afterAll, beforeAll, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { createD1Db } from "../../src/runtime/cloudflare/d1";
import type { Db } from "../../src/core/db";
import { CASES, assertBatchAtomicity } from "./cases";
import { clientVia, provisionWith, revokeWith, type Fixture } from "./harness";

const scriptPath = join(process.cwd(), "dist/worker/worker.js");
if (!existsSync(scriptPath))
  throw new Error(
    "dist/worker/worker.js is missing. Run: pnpm build:worker (wrangler deploy --dry-run --outdir dist/worker)",
  );

const persist = mkdtempSync(join(tmpdir(), "titen-d1-"));
const origin = "http://titen.test";

let mf: Miniflare;
let db: Db;

/** Real workerd with a real local D1 database, the same bundle wrangler deploys. */
async function start() {
  mf = new Miniflare({
    modules: true,
    scriptPath,
    compatibilityDate: "2026-07-01",
    d1Databases: { DB: "titen-contract" },
    d1Persist: persist,
    bindings: { TITEN_REVISION: "test", TITEN_AUTO_MIGRATE: "1" },
  });
  await mf.ready;
  db = createD1Db((await mf.getD1Database("DB")) as never);
  // Force the isolate to apply migrations before any case runs.
  await mf.dispatchFetch(`${origin}/readyz`);
}

const client = () =>
  clientVia(async (request) => {
    const body = request.method === "GET" ? undefined : await request.text();
    const response = await mf.dispatchFetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body: body === "" ? undefined : body,
    });
    return response as unknown as Response;
  }, origin);

const fixture: Fixture = {
  runtime: "cloudflare-d1",
  call: (method, path, options) => client().call(method, path, options),
  callRaw: (method, path, options) => client().callRaw(method, path, options),
  provision: (options) => provisionWith(db, options),
  revoke: (keyId) => revokeWith(db, keyId),
  query: (sql, params) => db.all(sql, params),
  async restart() {
    await mf.dispose();
    await start();
  },
};

beforeAll(start);
afterAll(async () => {
  await mf.dispose();
  rmSync(persist, { recursive: true, force: true });
});

test("batch writes are atomic on D1", async () => {
  await assertBatchAtomicity(db);
});

for (const contractCase of CASES)
  test(`cloudflare-d1: ${contractCase.name}`, async () => {
    await contractCase.run(fixture);
  });
