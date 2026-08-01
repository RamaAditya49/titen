import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { createD1Db } from "../../src/runtime/cloudflare/d1";
import type { Db } from "../../src/core/db";
import type { Stmt } from "../../src/core/db";
import { MIGRATIONS, migrate, SCHEMA_VERSION } from "../../src/core/migrations";
import { CASES, assertBatchAtomicity } from "./cases";
import { clientVia, provisionWith, revokeWith, TEST_SECRET_KEY, type Fixture } from "./harness";
import { assertPopulatedV10RetrievalMigration } from "./retrieval-migration";
import {
  assertPopulatedV11IntegrityMigration,
  assertPopulatedV14SemanticOutageMigration,
} from "./integrity-migration";
import { acquireD1Lane, D1RunDiagnostics } from "./d1-harness";
import { assertEnrichmentContract } from "./enrichment";
import {
  assertSemanticIndexOwnership,
  assertSemanticIndexWriteRepair,
  assertSemanticReadiness,
} from "./semantic-readiness";

const scriptPath = join(process.cwd(), "dist/worker/worker.js");
if (!existsSync(scriptPath))
  throw new Error(
    "dist/worker/worker.js is missing. Run: pnpm build:worker (wrangler deploy --dry-run --outdir dist/worker)",
  );

const origin = "http://titen.test";
const CASE_TIMEOUT = 20_000;

const lane = await acquireD1Lane();
const diagnostics = new D1RunDiagnostics(lane.owner, [TEST_SECRET_KEY]);
const persist = mkdtempSync(join(tmpdir(), `titen-d1-${lane.owner.run_id}-`));
process.stderr.write(
  `[d1-contract] acquired run=${lane.owner.run_id} pid=${lane.owner.pid} worktree=${lane.owner.worktree} persist=${persist}\n`,
);
let mf: Miniflare;
let db: Db;
let starting: Promise<void> | undefined;
const runtimes = new Set<Miniflare>();

function runtime(options: ConstructorParameters<typeof Miniflare>[0]) {
  const instance = new Miniflare({
    host: "127.0.0.1",
    port: 0,
    handleRuntimeStdio: diagnostics.handleRuntimeStdio,
    ...options,
  });
  runtimes.add(instance);
  return instance;
}

async function dispose(instance: Miniflare) {
  await instance.dispose();
  runtimes.delete(instance);
}

async function disposeAll() {
  await Promise.all([...runtimes].map(dispose));
  assert.equal(runtimes.size, 0, "every Miniflare owned by this D1 lane must be disposed");
}

/** Real workerd with a real local D1 database, the same bundle wrangler deploys. */
async function start() {
  const next = runtime({
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
    try {
      await next.ready;
      const nextDb = createD1Db((await next.getD1Database("DB")) as never);
      // Force the isolate to apply migrations before any case runs.
      await next.dispatchFetch(`${origin}/readyz`);
      mf = next;
      db = nextDb;
    } catch (error) {
      await dispose(next);
      throw error;
    }
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
    await dispose(mf);
    await start();
  },
};

before(async () => {
  await diagnostics.run("startup", start);
}, { timeout: CASE_TIMEOUT });
after(async () => {
  try {
    await diagnostics.run("teardown", async () => {
      await starting?.catch(() => undefined);
      await disposeAll();
      rmSync(persist, { recursive: true, force: true });
    });
  } finally {
    await lane.release();
  }
}, { timeout: CASE_TIMEOUT });

function d1Test(name: string, run: () => void | Promise<void>, timeout = CASE_TIMEOUT) {
  test(name, { timeout }, () => diagnostics.run(name, run));
}

d1Test("batch writes are atomic on D1", async () => {
  await assertBatchAtomicity(db);
});

d1Test(
  "D1 semantic readiness persists and compares its fingerprint locally",
  async () => {
    await assertSemanticReadiness(db, "cloudflare-d1");
  },
  60_000,
);

d1Test("D1 replays bounded model enrichment", async () => {
  await assertEnrichmentContract(db, "cloudflare-d1");
}, 120_000);

d1Test("workerd dispatches JSON-object extraction without following redirects", async () => {
  const extractionPersist = mkdtempSync(join(tmpdir(), "titen-d1-extraction-"));
  let providerRequests = 0;
  let providerBody: any;
  const extractionRuntime = runtime({
    modules: true,
    scriptPath,
    compatibilityDate: "2026-07-01",
    d1Databases: { DB: "titen-extraction" },
    d1Persist: extractionPersist,
    bindings: {
      TITEN_REVISION: "extraction",
      TITEN_AUTO_MIGRATE: "0",
      TITEN_D1_PLAN: "paid",
      TITEN_ENRICHMENT_BACKGROUND: "1",
      TITEN_EXTRACT_BASE_URL: "https://provider.example.test/v1",
      TITEN_EXTRACT_MODEL: "compat",
      TITEN_EXTRACT_MODEL_FINGERPRINT: "e".repeat(64),
      TITEN_EXTRACT_RESPONSE_MODE: "json_object",
      TITEN_SECRET_KEYS: JSON.stringify({ active: "test-v1", keys: { "test-v1": TEST_SECRET_KEY } }),
    },
    outboundService: async (request) => {
      providerRequests += 1;
      providerBody = await request.json();
      return Response.json({
        choices: [{
          finish_reason: "stop",
          message: { content: '{"action":"abstain","claims":null}' },
        }],
      });
    },
  });
  try {
    await extractionRuntime.ready;
    const extractionDb = createD1Db(
      (await extractionRuntime.getD1Database("DB")) as never,
    );
    await migrate(extractionDb);
    const principal = await provisionWith(extractionDb, { scopes: ["*"] });
    const observation = await extractionRuntime.dispatchFetch(`${origin}/v1/observations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${principal.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        subject_id: "subject_workerd_extraction",
        kind: "user_statement",
        content: "Synthetic workerd extraction evidence.",
        source: { type: "test" },
      }),
    });
    assert.equal(observation.status, 201);

    await (await extractionRuntime.getWorker()).scheduled({
      cron: "* * * * *",
      scheduledTime: Date.now(),
    });
    assert.equal(providerRequests, 1);
    assert.equal(providerBody.response_format.type, "json_object");
    assert.match(providerBody.messages[1].content, /^REQUIRED_OUTPUT_SCHEMA_JSON/u);
    assert.match(providerBody.messages[1].content, /"max_claims":1/u);
    assert.deepEqual(await extractionDb.all(
      `SELECT state, error_class FROM enrichment_jobs`,
    ), [{ state: "done", error_class: null }]);
    const readiness = await extractionRuntime.dispatchFetch(`${origin}/readyz`);
    assert.equal(readiness.status, 200);
    assert.equal(
      (await readiness.json() as any).data.capabilities.extraction_response_mode,
      "json_object",
    );
  } finally {
    await dispose(extractionRuntime);
    rmSync(extractionPersist, { recursive: true, force: true });
  }
}, 60_000);

d1Test("auto-migrate off blocks API traffic on a stale D1 schema", async () => {
  const stalePersist = mkdtempSync(join(tmpdir(), "titen-d1-stale-"));
  const stale = runtime({
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
    await dispose(stale);
    rmSync(stalePersist, { recursive: true, force: true });
  }
});

d1Test("D1 fences overlapping semantic index attempts", async () => {
  await assertSemanticIndexOwnership(db, "cloudflare-d1");
});

d1Test("D1 repairs stale external semantic index writes", async () => {
  await assertSemanticIndexWriteRepair(db, "cloudflare-d1");
});

d1Test("partial Worker semantic configuration fails readiness without leaking it", async () => {
  const partialPersist = mkdtempSync(join(tmpdir(), "titen-d1-partial-semantic-"));
  const partial = runtime({
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
    await dispose(partial);
    rmSync(partialPersist, { recursive: true, force: true });
  }
});

d1Test("a D1 migration batch rolls back on fault and concurrent retries converge", async () => {
  const faultPersist = mkdtempSync(join(tmpdir(), "titen-d1-fault-"));
  const fault = runtime({
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
    assert.equal(
      Number((await real.all<{ version: number }>("SELECT MAX(version) AS version FROM titen_migrations"))[0]!.version),
      MIGRATIONS.at(-2)!.version,
    );
    const integrity = await real.all<{ name: string; sql: string }>(
      `SELECT name, sql FROM sqlite_master
        WHERE name IN ('checkpoints_scope', 'event_order', 'semantic_index_metadata', 'enrichment_jobs')
        ORDER BY name`,
    );
    assert.deepEqual(
      integrity.map(({ name }) => name),
      ["checkpoints_scope", "enrichment_jobs", "event_order", "semantic_index_metadata"],
    );
    assert.match(integrity.find(({ name }) => name === "checkpoints_scope")!.sql, /UNIQUE/);
    assert.deepEqual(
      (await real.all<{ name: string }>("PRAGMA table_info(semantic_index_metadata)"))
        .filter(({ name }) => name.endsWith("_failure_at"))
        .map(({ name }) => name),
      ["embedder_failure_at", "vector_store_failure_at"],
    );
    assert.deepEqual(
      (await real.all<{ name: string }>("PRAGMA table_info(index_outbox)"))
        .filter(({ name }) => name === "lease_token" || name === "lease_expires_at")
        .map(({ name }) => name)
        .sort(),
      ["lease_expires_at", "lease_token"],
    );
    assert.deepEqual(
      (await real.all<{ name: string }>("PRAGMA table_info(api_keys)"))
        .filter(({ name }) => ["not_before", "expires_at", "last_used_at"].includes(name)),
      [],
    );
    assert.deepEqual(await Promise.all([migrate(real), migrate(real)]), [SCHEMA_VERSION, SCHEMA_VERSION]);
    assert.deepEqual(
      (await real.all<{ name: string }>("PRAGMA table_info(index_outbox)"))
        .filter(({ name }) => name === "lease_token" || name === "lease_expires_at")
        .map(({ name }) => name)
        .sort(),
      ["lease_expires_at", "lease_token"],
    );
  } finally {
    await dispose(fault);
    rmSync(faultPersist, { recursive: true, force: true });
  }
});

d1Test("a populated schema-v10 D1 database rebuilds scoped Porter FTS", async () => {
  const migrationPersist = mkdtempSync(join(tmpdir(), "titen-d1-retrieval-migration-"));
  const migrationRuntime = runtime({
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
    await dispose(migrationRuntime);
    rmSync(migrationPersist, { recursive: true, force: true });
  }
});

d1Test("a populated schema-v11 D1 database repairs collaboration integrity", async () => {
  const migrationPersist = mkdtempSync(join(tmpdir(), "titen-d1-integrity-migration-"));
  const migrationRuntime = runtime({
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
    await dispose(migrationRuntime);
    rmSync(migrationPersist, { recursive: true, force: true });
  }
});

test("a populated schema-v14 D1 database preserves genuine semantic outage evidence", async () => {
  const migrationPersist = mkdtempSync(join(tmpdir(), "titen-d1-semantic-outage-migration-"));
  const migrationRuntime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-07-01",
    d1Databases: { DB: "titen-semantic-outage-migration" },
    d1Persist: migrationPersist,
  });
  try {
    await migrationRuntime.ready;
    const migrationDb = createD1Db((await migrationRuntime.getD1Database("DB")) as never);
    await assertPopulatedV14SemanticOutageMigration(migrationDb);
  } finally {
    await migrationRuntime.dispose();
    rmSync(migrationPersist, { recursive: true, force: true });
  }
});

for (const contractCase of CASES) {
  const name = `cloudflare-d1: ${contractCase.name}`;
  const run = async () => contractCase.run(fixture);
  d1Test(name, run);
}
