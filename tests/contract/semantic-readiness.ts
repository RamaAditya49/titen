import assert from "node:assert/strict";
import { createApp } from "../../src/core/app";
import type { Db } from "../../src/core/db";
import { clientVia, fakeVectors } from "./harness";

const readyWith = (db: Db, runtime: string, vectors?: ReturnType<typeof fakeVectors>) =>
  clientVia(
    createApp({ db, runtime, revision: "semantic-readiness", vectors }),
    "http://titen.test",
  ).call("GET", "/readyz");

/** Same persisted fingerprint/readiness contract against D1 and bun:sqlite. */
export async function assertSemanticReadiness(db: Db, runtime: string) {
  const diagnosticFree = await clientVia(
    createApp({
      db,
      runtime,
      semanticReadiness: {
        embedding: "configured_error",
        vector: "configured_error",
      },
    }),
    "http://titen.test",
  ).call("GET", "/readyz");
  assert.equal(diagnosticFree.status, 503);

  await db.batch([
    { sql: `DELETE FROM semantic_index_metadata` },
    { sql: `DELETE FROM index_outbox WHERE id = 'idx_semantic_legacy'` },
    {
      sql: `INSERT INTO index_outbox
              (id, org_id, record_type, record_id, operation, state, attempts, created_at)
            VALUES ('idx_semantic_legacy', 'org_test', 'claim', 'clm_test',
                    'upsert', 'done', 1, '2026-07-31T00:00:00.000Z')`,
    },
  ]);

  const legacyVectors = fakeVectors();
  const missing = await readyWith(db, runtime, legacyVectors);
  assert.equal(missing.status, 503);
  assert.equal(missing.body.meta.ready, false);
  assert.equal(missing.body.meta.capabilities.embedding, "enabled");
  assert.equal(missing.body.meta.capabilities.vector, "configured_error");
  assert.equal(missing.body.meta.checks.semantic_index, "index_fingerprint_missing");
  assert.equal(legacyVectors.embedCalls(), 0, "readiness must not call the provider");

  const dishonest = fakeVectors();
  dishonest.embedder.model = "different-runtime-model";
  dishonest.embedder.dimensions = 8;
  const invalid = await readyWith(db, runtime, dishonest);
  assert.equal(invalid.status, 503);
  assert.equal(invalid.body.meta.checks.semantic_index, "embedding_configuration_invalid");
  assert.equal(dishonest.embedCalls(), 0);

  await db.batch([
    { sql: `DELETE FROM index_outbox WHERE id = 'idx_semantic_legacy'` },
    {
      sql: `INSERT OR IGNORE INTO organizations (id, name, created_at)
            VALUES ('org_semantic_backfill', 'Semantic Backfill', '2026-07-31T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO claims
              (id, org_id, subject_id, project_id, workspace_id, observer_id,
               actor_id, kind, statement, confidence, trust, visibility, status,
               version, valid_from, valid_to, created_at)
            VALUES ('clm_semantic_backfill', 'org_semantic_backfill', 'subject',
                    NULL, NULL, NULL, 'agent', 'semantic_fact', 'Backfill me',
                    1, 'asserted', 'private', 'active', 1,
                    '2026-07-31T00:00:00.000Z', NULL, '2026-07-31T00:00:00.000Z')`,
    },
  ]);
  const vectors = fakeVectors();
  const backfillRequired = await readyWith(db, runtime, vectors);
  assert.equal(backfillRequired.status, 503);
  assert.equal(
    backfillRequired.body.meta.checks.semantic_index,
    "index_backfill_required",
  );
  assert.equal(vectors.embedCalls(), 0);
  await db.batch([
    {
      sql: `INSERT INTO index_outbox
              (id, org_id, record_type, record_id, operation, state, attempts, created_at)
            VALUES ('idx_semantic_backfill', 'org_semantic_backfill', 'claim',
                    'clm_semantic_backfill', 'upsert', 'pending', 0,
                    '2026-07-31T00:00:00.000Z')`,
    },
  ]);
  const healthy = await readyWith(db, runtime, vectors);
  assert.equal(healthy.status, 200);
  assert.equal(healthy.body.data.capabilities.version, 1);
  assert.equal(healthy.body.data.capabilities.embedding, "enabled");
  assert.equal(healthy.body.data.capabilities.vector, "enabled");
  assert.equal(healthy.body.data.capabilities.extraction, "disabled");
  assert.equal(healthy.body.data.capabilities.background_enrichment, "disabled");
  assert.equal(healthy.body.data.capabilities.model, "enabled");
  assert.equal(vectors.embedCalls(), 0, "readiness must remain local");
  const persisted = await db.all<Record<string, unknown>>(
    `SELECT provider, model, revision, dimensions, metric, preprocessing, index_schema
       FROM semantic_index_metadata WHERE id = 'claims'`,
  );
  assert.deepEqual(persisted, [{ ...vectors.fingerprint }]);

  await db.batch([
    {
      sql: `INSERT INTO claims
              (id, org_id, subject_id, project_id, workspace_id, observer_id,
               actor_id, kind, statement, confidence, trust, visibility, status,
               version, valid_from, valid_to, created_at)
            VALUES ('clm_semantic_interim', 'org_semantic_backfill', 'subject',
                    NULL, NULL, NULL, 'agent', 'semantic_fact', 'Interim FTS claim',
                    1, 'asserted', 'private', 'active', 1,
                    '2026-07-31T00:00:00.000Z', NULL, '2026-07-31T00:00:00.000Z')`,
    },
  ]);
  const interimGuard = await readyWith(db, runtime, vectors);
  assert.equal(interimGuard.status, 503);
  assert.equal(interimGuard.body.meta.checks.semantic_index, "index_backfill_required");
  await db.batch([
    {
      sql: `INSERT INTO index_outbox
              (id, org_id, record_type, record_id, operation, state, attempts, created_at)
            VALUES ('idx_semantic_interim', 'org_semantic_backfill', 'claim',
                    'clm_semantic_interim', 'upsert', 'pending', 0,
                    '2026-07-31T00:00:00.000Z')`,
    },
  ]);
  assert.equal((await readyWith(db, runtime, vectors)).status, 200);

  await db.batch([
    {
      sql: `UPDATE index_outbox SET state = 'done'
             WHERE id IN ('idx_semantic_backfill', 'idx_semantic_interim')`,
    },
  ]);
  const restoredWithoutProjection = fakeVectors();
  restoredWithoutProjection.indexEmpty = true;
  for (let restart = 0; restart < 2; restart += 1) {
    const restoreGuard = await readyWith(db, runtime, restoredWithoutProjection);
    assert.equal(restoreGuard.status, 503);
    assert.equal(restoreGuard.body.meta.checks.semantic_index, "index_backfill_required");
  }
  assert.equal(restoredWithoutProjection.embedCalls(), 0);

  const changed = fakeVectors();
  changed.fingerprint = { ...changed.fingerprint, model: "contract-stub-v2" };
  changed.embedder.model = "contract-stub-v2";
  const mismatch = await readyWith(db, runtime, changed);
  assert.equal(mismatch.status, 503);
  assert.equal(mismatch.body.meta.capabilities.embedding, "enabled");
  assert.equal(mismatch.body.meta.capabilities.vector, "configured_error");
  assert.equal(mismatch.body.meta.checks.semantic_index, "index_fingerprint_mismatch");
  assert.doesNotMatch(JSON.stringify(mismatch.body), /contract-stub-v2/);
  assert.equal(changed.embedCalls(), 0);

  const lexicalOnly = await readyWith(db, runtime);
  assert.equal(lexicalOnly.status, 200);
  assert.equal(lexicalOnly.body.data.capabilities.embedding, "disabled");
  assert.equal(lexicalOnly.body.data.capabilities.vector, "disabled");

  // Explicit reindex resets metadata and requeues derived work before the new
  // fingerprint can become ready. The vector backend reset is runtime-specific.
  await db.batch([
    { sql: `DELETE FROM semantic_index_metadata WHERE id = 'claims'` },
    {
      sql: `UPDATE index_outbox SET state = 'pending', attempts = 0
             WHERE record_type = 'claim'`,
    },
  ]);
  const recovered = await readyWith(db, runtime, changed);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.data.capabilities.vector, "enabled");
  assert.equal(changed.embedCalls(), 0);

  await db.batch([
    { sql: `DELETE FROM semantic_index_metadata` },
    {
      sql: `DELETE FROM index_outbox
             WHERE id IN ('idx_semantic_backfill', 'idx_semantic_interim')`,
    },
    {
      sql: `DELETE FROM claims
             WHERE id IN ('clm_semantic_backfill', 'clm_semantic_interim')`,
    },
    { sql: `DELETE FROM organizations WHERE id = 'org_semantic_backfill'` },
  ]);
}
