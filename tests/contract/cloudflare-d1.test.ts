import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { createD1Db } from "../../src/runtime/cloudflare/d1";
import type { Db } from "../../src/core/db";
import type { Stmt } from "../../src/core/db";
import { migrate, SCHEMA_VERSION } from "../../src/core/migrations";
import { CASES, assertBatchAtomicity } from "./cases";
import { clientVia, provisionWith, revokeWith, TEST_SECRET_KEY, type Fixture } from "./harness";
import { assertPopulatedV10RetrievalMigration } from "./retrieval-migration";
import { assertPopulatedV11IntegrityMigration } from "./integrity-migration";
import { assertSemanticReadiness } from "./semantic-readiness";

const scriptPath = join(process.cwd(), "dist/worker/worker.js");
if (!existsSync(scriptPath))
  throw new Error(
    "dist/worker/worker.js is missing. Run: pnpm build:worker (wrangler deploy --dry-run --outdir dist/worker)",
  );

const persist = mkdtempSync(join(tmpdir(), "titen-d1-"));
const origin = "http://titen.test";

let mf: Miniflare;
let db: Db;
let starting: Promise<void> | undefined;

/** Real workerd with a real local D1 database, the same bundle wrangler deploys. */
async function start() {
  const next = new Miniflare({
    modules: true,
    scriptPath,
    compatibilityDate: "2026-07-01",
    d1Databases: { DB: "titen-contract" },
    d1Persist: persist,
    bindings: {
      TITEN_REVISION: "test",
      TITEN_AUTO_MIGRATE: "1",
      TITEN_SECRET_KEYS: JSON.stringify({ active: "test-v1", keys: { "test-v1": TEST_SECRET_KEY } }),
      TITEN_WEBHOOK_ALLOWED_HOSTNAMES: "hooks.example.com",
      TITEN_WEBHOOK_TEST_ADDRESSES: JSON.stringify(["93.184.216.34"]),
    },
  });
  const ready = (async () => {
    await next.ready;
    const nextDb = createD1Db((await next.getD1Database("DB")) as never);
    // Force the isolate to apply migrations before any case runs.
    await next.dispatchFetch(`${origin}/readyz`);
    mf = next;
    db = nextDb;
  })();
  starting = ready;
  try {
    await ready;
  } finally {
    if (starting === ready) starting = undefined;
  }
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

before(start);
after(async () => {
  await starting;
  await mf.dispose();
  rmSync(persist, { recursive: true, force: true });
});

test("batch writes are atomic on D1", async () => {
  await assertBatchAtomicity(db);
});

test(
  "D1 semantic readiness persists and compares its fingerprint locally",
  { timeout: 60_000 },
  async () => {
    await assertSemanticReadiness(db, "cloudflare-d1");
  },
);

test("auto-migrate off blocks API traffic on a stale D1 schema", async () => {
  const stalePersist = mkdtempSync(join(tmpdir(), "titen-d1-stale-"));
  const stale = new Miniflare({
    modules: true,
    scriptPath,
    compatibilityDate: "2026-07-01",
    d1Databases: { DB: "titen-stale" },
    d1Persist: stalePersist,
    bindings: { TITEN_REVISION: "stale", TITEN_AUTO_MIGRATE: "0" },
  });
  try {
    await stale.ready;
    assert.equal((await stale.dispatchFetch(`${origin}/healthz`)).status, 200);
    const readiness = await stale.dispatchFetch(`${origin}/readyz`);
    assert.equal(readiness.status, 503);
    const body = await readiness.json() as any;
    assert.equal(body.meta.schema.applied, 0);
    assert.equal((await stale.dispatchFetch(`${origin}/v1/observations`, { method: "POST" })).status, 503);
  } finally {
    await stale.dispose();
    rmSync(stalePersist, { recursive: true, force: true });
  }
});

test("partial Worker semantic configuration fails readiness without leaking it", async () => {
  const partialPersist = mkdtempSync(join(tmpdir(), "titen-d1-partial-semantic-"));
  const partial = new Miniflare({
    modules: true,
    scriptPath,
    compatibilityDate: "2026-07-01",
    d1Databases: { DB: "titen-partial-semantic" },
    d1Persist: partialPersist,
    bindings: {
      TITEN_AUTO_MIGRATE: "1",
      TITEN_EMBED_MODEL: "must-not-leak",
      TITEN_SECRET_KEYS: JSON.stringify({ active: "test-v1", keys: { "test-v1": TEST_SECRET_KEY } }),
    },
  });
  try {
    await partial.ready;
    assert.equal((await partial.dispatchFetch(`${origin}/healthz`)).status, 200);
    const response = await partial.dispatchFetch(`${origin}/readyz`);
    assert.equal(response.status, 503);
    const body = await response.json() as any;
    assert.equal(body.meta.capabilities.embedding, "configured_error");
    assert.equal(body.meta.capabilities.vector, "configured_error");
    assert.equal(body.meta.checks.semantic_index, "embedding_configuration_invalid");
    assert.doesNotMatch(JSON.stringify(body), /must-not-leak/);
  } finally {
    await partial.dispose();
    rmSync(partialPersist, { recursive: true, force: true });
  }
});

test("a D1 migration batch rolls back on fault and concurrent retries converge", async () => {
  const faultPersist = mkdtempSync(join(tmpdir(), "titen-d1-fault-"));
  const fault = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-07-01",
    d1Databases: { DB: "titen-fault" },
    d1Persist: faultPersist,
  });
  try {
    await fault.ready;
    const real = createD1Db((await fault.getD1Database("DB")) as never);
    let inject = true;
    const injected: Db = {
      ...real,
      async batch(statements: Stmt[]) {
        if (inject && statements.at(-1)?.params?.[0] === SCHEMA_VERSION) {
          inject = false;
          await real.batch([
            ...statements.slice(0, 3),
            { sql: "INSERT INTO deliberately_missing_table(value) VALUES (1)" },
          ]);
          return;
        }
        await real.batch(statements);
      },
    };
    await assert.rejects(() => migrate(injected));
    assert.equal(Number((await real.all<{ version: number }>("SELECT MAX(version) AS version FROM titen_migrations"))[0]!.version), SCHEMA_VERSION - 1);
    const integrity = await real.all<{ name: string; sql: string }>(
      `SELECT name, sql FROM sqlite_master
        WHERE name IN ('checkpoints_scope', 'event_order', 'semantic_index_metadata')
        ORDER BY name`,
    );
    assert.deepEqual(
      integrity.map(({ name }) => name),
      ["checkpoints_scope", "event_order", "semantic_index_metadata"],
    );
    assert.match(integrity.find(({ name }) => name === "checkpoints_scope")!.sql, /UNIQUE/);
    assert.deepEqual(
      (await real.all<{ name: string }>("PRAGMA table_info(semantic_index_metadata)"))
        .filter(({ name }) => name.endsWith("_failure_at")),
      [],
    );
    assert.deepEqual(await Promise.all([migrate(real), migrate(real)]), [SCHEMA_VERSION, SCHEMA_VERSION]);
  } finally {
    await fault.dispose();
    rmSync(faultPersist, { recursive: true, force: true });
  }
});

test("a populated schema-v10 D1 database rebuilds scoped Porter FTS", async () => {
  const migrationPersist = mkdtempSync(join(tmpdir(), "titen-d1-retrieval-migration-"));
  const migrationRuntime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-07-01",
    d1Databases: { DB: "titen-retrieval-migration" },
    d1Persist: migrationPersist,
  });
  try {
    await migrationRuntime.ready;
    const migrationDb = createD1Db((await migrationRuntime.getD1Database("DB")) as never);
    await assertPopulatedV10RetrievalMigration(migrationDb);
  } finally {
    await migrationRuntime.dispose();
    rmSync(migrationPersist, { recursive: true, force: true });
  }
});

test("a populated schema-v11 D1 database repairs collaboration integrity", async () => {
  const migrationPersist = mkdtempSync(join(tmpdir(), "titen-d1-integrity-migration-"));
  const migrationRuntime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-07-01",
    d1Databases: { DB: "titen-integrity-migration" },
    d1Persist: migrationPersist,
  });
  try {
    await migrationRuntime.ready;
    const migrationDb = createD1Db((await migrationRuntime.getD1Database("DB")) as never);
    await assertPopulatedV11IntegrityMigration(migrationDb);
  } finally {
    await migrationRuntime.dispose();
    rmSync(migrationPersist, { recursive: true, force: true });
  }
});

for (const contractCase of CASES) {
  const name = `cloudflare-d1: ${contractCase.name}`;
  const run = async () => contractCase.run(fixture);
  test(name, run);
}
