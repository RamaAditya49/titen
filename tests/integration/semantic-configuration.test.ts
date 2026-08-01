import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tryCreateVectors } from "../../src/runtime/bun/vectors";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { migrate } from "../../src/core/migrations";
import { serve } from "../../src/runtime/bun/server";
import { tryCreateVectorize } from "../../src/runtime/cloudflare/vectors";
import { embeddingPolicyFingerprint } from "../../src/core/vectors";
import { fakeVectors, TEST_SECRET_CIPHER } from "../contract/harness";

const directory = mkdtempSync(join(tmpdir(), "titen-semantic-config-"));
const rawPolicy = {
  embedRevision: "revision-1",
  embedProfile: "raw-unit-v1",
  embedMinCosine: 0.1,
} as const;
const workerRawPolicy = {
  TITEN_EMBED_REVISION: "revision-1",
  TITEN_EMBED_PROFILE: "raw-unit-v1",
  TITEN_EMBED_MIN_COSINE: "0.1",
} as const;
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("Bun distinguishes absent, partial, unavailable, and healthy semantic configuration", () => {
  assert.deepEqual(tryCreateVectors({}).readiness, {
    embedding: "disabled",
    vector: "disabled",
  });
  assert.deepEqual(
    tryCreateVectors({ embedBaseUrl: "http://127.0.0.1:11434/v1" }).readiness,
    {
      embedding: "configured_error",
      vector: "configured_error",
      diagnostic: "embedding_configuration_invalid",
    },
  );
  assert.deepEqual(
    tryCreateVectors({
      vecDbPath: join(directory, "missing", "vectors.db"),
      embedBaseUrl: "http://127.0.0.1:11434/v1",
      embedModel: "model",
      embedDims: 4,
      ...rawPolicy,
    }).readiness,
    {
      embedding: "enabled",
      vector: "configured_error",
      diagnostic: "vector_initialization_failed",
    },
  );
  const healthy = tryCreateVectors({
    vecDbPath: join(directory, "vectors.db"),
    embedBaseUrl: "http://127.0.0.1:11434/v1",
    embedModel: "model",
    embedDims: 4,
    ...rawPolicy,
  });
  assert.deepEqual(healthy.readiness, { embedding: "enabled", vector: "enabled" });
  assert.equal(statSync(join(directory, "vectors.db")).mode & 0o777, 0o600);
  assert.equal(statSync(join(directory, "vectors.db-wal")).mode & 0o777, 0o600);
  assert.equal(statSync(join(directory, "vectors.db-shm")).mode & 0o777, 0o600);
  assert.equal(healthy.vectors?.indexEmpty, true);
  assert.deepEqual(healthy.vectors?.fingerprint, {
    provider: healthy.vectors.fingerprint.provider,
    model: "model",
    revision: "revision-1",
    dimensions: 4,
    metric: "cosine",
    preprocessing: embeddingPolicyFingerprint("raw-unit-v1", 0.1),
    index_schema: "claims-scope-v1",
  });
  assert.match(
    healthy.vectors!.fingerprint.provider,
    /^openai-compatible:[a-f0-9]{64}$/,
  );
  assert.doesNotMatch(healthy.vectors!.fingerprint.provider, /127\.0\.0\.1/);
  const otherEndpoint = tryCreateVectors({
    vecDbPath: join(directory, "other-endpoint.db"),
    embedBaseUrl: "http://127.0.0.1:11435/v1",
    embedModel: "model",
    embedDims: 4,
    ...rawPolicy,
  });
  assert.notEqual(
    otherEndpoint.vectors?.fingerprint.provider,
    healthy.vectors?.fingerprint.provider,
  );
  const reopened = tryCreateVectors({
    vecDbPath: join(directory, "vectors.db"),
    embedBaseUrl: "http://127.0.0.1:11434/v1",
    embedModel: "model",
    embedDims: 4,
    ...rawPolicy,
  });
  assert.equal(reopened.vectors?.indexEmpty, true);
  const incompatible = tryCreateVectors({
    vecDbPath: join(directory, "vectors.db"),
    embedBaseUrl: "http://127.0.0.1:11434/v1",
    embedModel: "model",
    embedDims: 8,
    ...rawPolicy,
  });
  assert.equal(incompatible.readiness.vector, "configured_error");
  assert.equal(incompatible.readiness.diagnostic, "vector_initialization_failed");
});

test("Bun refuses canonical database aliases before vector schema mutation", () => {
  const canonicalPath = join(directory, "canonical.db");
  const canonical = openDatabase(canonicalPath);
  canonical.run("CREATE TABLE canonical_marker(value TEXT)");
  canonical.close();
  const aliasPath = join(directory, "canonical-alias.db");
  symlinkSync(canonicalPath, aliasPath);

  for (const vecDbPath of [canonicalPath, aliasPath]) {
    const result = tryCreateVectors({
      canonicalDbPath: canonicalPath,
      vecDbPath,
      embedBaseUrl: "http://127.0.0.1:11434/v1",
      embedModel: "model",
      embedDims: 4,
      ...rawPolicy,
    });
    assert.deepEqual(result.readiness, {
      embedding: "enabled",
      vector: "configured_error",
      diagnostic: "vector_storage_conflict",
    });
  }

  const reopened = openDatabase(canonicalPath);
  assert.equal(
    reopened.query("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'vec_claims'").get()?.count,
    0,
  );
  reopened.close();
});

test("Bun rejects plain and wrong-module vec_claims lookalikes", () => {
  const schemas = [
    `CREATE TABLE vec_claims(
       id TEXT PRIMARY KEY, embedding float[4], org_id TEXT, subject_id TEXT, project_id TEXT
     )`,
    `CREATE VIRTUAL TABLE vec_claims USING fts5(
       id, embedding, org_id, subject_id, project_id
     )`,
    `CREATE VIRTUAL TABLE vec_claims USING vec0(
       id TEXT PRIMARY KEY, embedding float[4], org_id TEXT,
       subject_id TEXT, project_id TEXT
     )`,
  ];
  for (const [index, schema] of schemas.entries()) {
    const vecDbPath = join(directory, `lookalike-${index}.db`);
    const handle = openDatabase(vecDbPath);
    if (schema.includes("USING vec0")) {
      const sqliteVec = require("sqlite-vec") as { load(db: unknown): void };
      sqliteVec.load(handle);
    }
    handle.run(schema);
    const before = handle.query("SELECT sql FROM sqlite_master WHERE name = 'vec_claims'").get()?.sql;
    handle.close();

    const result = tryCreateVectors({
      vecDbPath,
      embedBaseUrl: "http://127.0.0.1:11434/v1",
      embedModel: "model",
      embedDims: 4,
      ...rawPolicy,
    });
    assert.equal(result.readiness.vector, "configured_error");
    assert.equal(result.readiness.diagnostic, "vector_initialization_failed");

    const reopened = openDatabase(vecDbPath);
    assert.equal(
      reopened.query("SELECT sql FROM sqlite_master WHERE name = 'vec_claims'").get()?.sql,
      before,
    );
    reopened.close();
  }
});

test("Cloudflare validates binding completeness without calling either binding", () => {
  let calls = 0;
  const ai = { run: async () => { calls += 1; return { data: [] }; } };
  const vectorize = {
    upsert: async () => { calls += 1; },
    query: async () => { calls += 1; return { matches: [] }; },
    deleteByIds: async () => { calls += 1; },
  };
  assert.deepEqual(tryCreateVectorize({}).readiness, {
    embedding: "disabled",
    vector: "disabled",
  });
  assert.deepEqual(tryCreateVectorize({ AI: ai, ...workerRawPolicy }).readiness, {
    embedding: "enabled",
    vector: "configured_error",
    diagnostic: "vector_initialization_failed",
  });
  assert.equal(
    tryCreateVectorize({
      AI: ai,
      VECTORIZE: vectorize,
      TITEN_EMBED_DIMS: "nope",
      ...workerRawPolicy,
    })
      .readiness.diagnostic,
    "embedding_configuration_invalid",
  );
  const healthy = tryCreateVectorize({
    AI: ai,
    VECTORIZE: vectorize,
    TITEN_EMBED_MODEL: "@cf/example/model",
    TITEN_EMBED_DIMS: "4",
    ...workerRawPolicy,
  });
  assert.equal(healthy.readiness.vector, "enabled");
  assert.equal(healthy.vectors?.fingerprint.provider, "workers-ai");
  assert.equal(
    healthy.vectors?.fingerprint.preprocessing,
    embeddingPolicyFingerprint("raw-unit-v1", 0.1),
  );
  assert.equal(calls, 0, "configuration and readiness must not call remote bindings");
});

test("both runtimes require the EmbeddingGemma retrieval profile", () => {
  const vecDbPath = join(directory, "embeddinggemma-profile.db");
  const bunBase = {
    vecDbPath,
    embedBaseUrl: "http://127.0.0.1:11434/v1",
    embedModel: "tuf/embeddinggemma",
    embedDims: 4,
    embedRevision: "immutable-test-revision",
    embedMinCosine: 0.7,
  } as const;
  assert.equal(
    tryCreateVectors({ ...bunBase, embedProfile: "raw-unit-v1" }).readiness
      .diagnostic,
    "embedding_configuration_invalid",
  );
  assert.equal(
    tryCreateVectors({
      ...bunBase,
      embedProfile: "embeddinggemma-retrieval-v1",
      embedMinCosine: "   ",
    }).readiness.diagnostic,
    "embedding_configuration_invalid",
  );
  assert.equal(
    tryCreateVectors({
      ...bunBase,
      embedProfile: "embeddinggemma-retrieval-v1",
    }).readiness.vector,
    "enabled",
  );

  const AI = { run: async () => ({ data: [] }) };
  const VECTORIZE = {
    upsert: async () => {},
    query: async () => ({ matches: [] }),
    deleteByIds: async () => {},
  };
  const workerBase = {
    AI,
    VECTORIZE,
    TITEN_EMBED_MODEL: "tuf/embeddinggemma",
    TITEN_EMBED_DIMS: "4",
    TITEN_EMBED_REVISION: "immutable-test-revision",
    TITEN_EMBED_MIN_COSINE: "0.7",
  } as const;
  assert.equal(
    tryCreateVectorize({ ...workerBase, TITEN_EMBED_PROFILE: "raw-unit-v1" })
      .readiness.diagnostic,
    "embedding_configuration_invalid",
  );
  assert.equal(
    tryCreateVectorize({
      ...workerBase,
      TITEN_EMBED_PROFILE: "embeddinggemma-retrieval-v1",
      TITEN_EMBED_MIN_COSINE: "   ",
    }).readiness.diagnostic,
    "embedding_configuration_invalid",
  );
  assert.equal(
    tryCreateVectorize({
      ...workerBase,
      TITEN_EMBED_PROFILE: "embeddinggemma-retrieval-v1",
    }).readiness.vector,
    "enabled",
  );
});

test("Bun serves health but fails readiness for a partial semantic tuple", async () => {
  const running = await serve({
    dbPath: join(directory, "partial.db"),
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    maintenanceIntervalMs: 0,
    embedBaseUrl: "http://127.0.0.1:9/v1",
    secretCipher: TEST_SECRET_CIPHER,
  });
  try {
    assert.equal((await fetch(`${running.url}/healthz`)).status, 200);
    const response = await fetch(`${running.url}/readyz`);
    assert.equal(response.status, 503);
    const body = await response.json() as any;
    assert.equal(body.meta.capabilities.embedding, "configured_error");
    assert.equal(body.meta.capabilities.vector, "configured_error");
    assert.equal(body.meta.checks.semantic_index, "embedding_configuration_invalid");
    assert.doesNotMatch(JSON.stringify(body), /127\.0\.0\.1:9/);
  } finally {
    await running.stop();
  }
});

test("Bun consumes prepared semantic state after pending work drains", async () => {
  const dbPath = join(directory, "prepared-state.db");
  const handle = openDatabase(dbPath);
  const db = createSqliteDb(handle);
  await migrate(db);
  await db.batch([
    {
      sql: `INSERT INTO organizations (id, name, created_at)
            VALUES ('org_prepared', 'Prepared', '2026-07-31T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO claims
              (id, org_id, subject_id, project_id, workspace_id, observer_id,
               actor_id, kind, statement, confidence, trust, visibility, status,
               version, valid_from, valid_to, created_at)
            VALUES ('clm_prepared', 'org_prepared', 'subject', NULL, NULL, NULL,
                    'agent', 'semantic_fact', 'Prepared semantic state', 1,
                    'asserted', 'private', 'active', 1,
                    '2026-07-31T00:00:00.000Z', NULL,
                    '2026-07-31T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO index_outbox
              (id, org_id, record_type, record_id, operation, state, attempts, created_at)
            VALUES ('idx_prepared', 'org_prepared', 'claim', 'clm_prepared',
                    'upsert', 'pending', 0, '2026-07-31T00:00:00.000Z')`,
    },
  ]);
  handle.close();

  const vectors = fakeVectors();
  vectors.indexEmpty = true;
  const running = await serve({
    dbPath,
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    maintenanceIntervalMs: 10,
    vectors,
    secretCipher: TEST_SECRET_CIPHER,
  });
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = running.database
        .query("SELECT state FROM index_outbox WHERE id = 'idx_prepared'")
        .get() as { state: string } | null;
      if (state?.state === "done") break;
      await Bun.sleep(10);
    }
    assert.equal(
      (running.database
        .query("SELECT state FROM index_outbox WHERE id = 'idx_prepared'")
        .get() as { state: string }).state,
      "done",
    );
    const response = await fetch(`${running.url}/readyz`);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).data.capabilities.vector, "enabled");
  } finally {
    await running.stop();
  }
});
