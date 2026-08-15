import assert from "node:assert/strict";
import { createApp } from "../../src/core/app";
import type { Db } from "../../src/core/db";
import { runMaintenance } from "../../src/core/maintenance";
import {
  claimSemanticIndexWork,
  completeSemanticIndexWork,
  embeddingPolicyFingerprint,
  recordSemanticDependencyFailure,
  SEMANTIC_INDEX_LEASE_MS,
} from "../../src/core/vectors";
import { clientVia, fakeVectors, provisionWith } from "./harness";

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
  const persistent = clientVia(
    createApp({ db, runtime, revision: "semantic-readiness", vectors }),
    "http://titen.test",
  );
  const pendingProjection = await persistent.call("GET", "/readyz");
  assert.equal(pendingProjection.status, 200);
  assert.equal(pendingProjection.body.data.ready, true);
  assert.equal(
    pendingProjection.body.data.checks.semantic_index,
    "index_projection_pending",
  );
  assert.equal(pendingProjection.body.data.capabilities.vector, "enabled");
  await db.batch([{
    sql: `UPDATE index_outbox SET state = 'done'
           WHERE id = 'idx_semantic_backfill'`,
  }]);
  const healthy = await persistent.call("GET", "/readyz");
  assert.equal(healthy.status, 200);
  assert.equal(healthy.body.data.capabilities.version, 1);
  assert.equal(healthy.body.data.capabilities.embedding, "enabled");
  assert.equal(healthy.body.data.capabilities.vector, "enabled");
  assert.equal(healthy.body.data.capabilities.extraction, "disabled");
  assert.equal(healthy.body.data.capabilities.background_enrichment, "disabled");
  assert.equal(healthy.body.data.capabilities.model, "enabled");
  assert.equal(vectors.embedCalls(), 0, "readiness must remain local");
  await db.batch([
    {
      sql: `INSERT INTO claims
              (id, org_id, subject_id, project_id, workspace_id, observer_id,
               actor_id, kind, statement, confidence, trust, visibility, status,
               version, valid_from, valid_to, created_at)
            VALUES ('clm_semantic_repeated_write', 'org_semantic_backfill', 'subject',
                    NULL, NULL, NULL, 'agent', 'semantic_fact', 'Repeated write',
                    1, 'asserted', 'private', 'active', 1,
                    '2026-07-31T00:00:00.000Z', NULL, '2026-07-31T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO index_outbox
              (id, org_id, record_type, record_id, operation, state, attempts, created_at)
            VALUES ('idx_semantic_repeated_write', 'org_semantic_backfill', 'claim',
                    'clm_semantic_repeated_write', 'upsert', 'pending', 0,
                    '2026-07-31T00:00:00.000Z')`,
    },
  ]);
  const repeatedWrite = await persistent.call("GET", "/readyz");
  assert.equal(repeatedWrite.status, 200);
  assert.equal(repeatedWrite.body.data.checks.semantic_index, "index_projection_pending");
  await db.batch([
    { sql: `DELETE FROM index_outbox WHERE id = 'idx_semantic_repeated_write'` },
    { sql: `DELETE FROM claims WHERE id = 'clm_semantic_repeated_write'` },
  ]);
  assert.equal((await persistent.call("GET", "/readyz")).status, 200);
  const persisted = await db.all<Record<string, unknown>>(
    `SELECT provider, model, revision, dimensions, metric, preprocessing, index_schema
       FROM semantic_index_metadata WHERE id = 'claims'`,
  );
  assert.deepEqual(persisted, [{ ...vectors.fingerprint }]);

  // #250. The model-convention guard stays: a bare raw profile on an
  // EmbeddingGemma model is a configuration error, not a slow quality decay.
  const refusedProfile = fakeVectors();
  refusedProfile.embedder.model = "tuf/embeddinggemma";
  refusedProfile.fingerprint.model = "tuf/embeddinggemma";
  const refused = await readyWith(db, runtime, refusedProfile);
  assert.equal(refused.status, 503);
  assert.equal(
    refused.body.meta.checks.semantic_index,
    "embedding_configuration_invalid",
  );

  // The deliberate opt-out clears that check and lands on a rebuild instead,
  // because the profile is part of the persisted fingerprint. Every other
  // fingerprint field is byte-identical to what is stored, so the profile is
  // the only thing that can be demanding the rebuild.
  const acknowledged = fakeVectors();
  acknowledged.fingerprint.preprocessing = embeddingPolicyFingerprint(
    "raw-unit-v1-model-mismatch-acknowledged",
    0.1,
  );
  const rebuild = await readyWith(db, runtime, acknowledged);
  assert.equal(rebuild.status, 503);
  assert.equal(
    rebuild.body.meta.checks.semantic_index,
    "index_fingerprint_mismatch",
    "switching preprocessing convention must force a rebuild, never mix silently",
  );
  assert.equal(acknowledged.embedCalls(), 0, "the opt-out must not add provider I/O");

  await db.batch([{ sql: `DELETE FROM semantic_index_metadata WHERE id = 'claims'` }]);
  const lostMetadata = await persistent.call("GET", "/readyz");
  assert.equal(lostMetadata.status, 503);
  assert.equal(lostMetadata.body.meta.checks.semantic_index, "index_metadata_unavailable");
  assert.equal(vectors.embedCalls(), 0, "metadata loss readiness stays local");
  const missingFingerprint = await readyWith(db, runtime, vectors);
  assert.equal(missingFingerprint.status, 503);
  assert.equal(
    missingFingerprint.body.meta.checks.semantic_index,
    "index_fingerprint_missing",
  );
  await db.batch([{
    sql: `INSERT INTO semantic_index_metadata
            (id, provider, model, revision, dimensions, metric,
             preprocessing, index_schema, created_at)
          VALUES ('claims', ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      vectors.fingerprint.provider,
      vectors.fingerprint.model,
      vectors.fingerprint.revision,
      vectors.fingerprint.dimensions,
      vectors.fingerprint.metric,
      vectors.fingerprint.preprocessing,
      vectors.fingerprint.index_schema,
      "2026-07-31T00:00:00.000Z",
    ],
  }]);

  for (const dependency of ["embedder", "vector_store"] as const) {
    await db.batch([
      {
        sql: `UPDATE semantic_index_metadata
                 SET ${dependency === "embedder" ? "embedder_failure_at" : "vector_store_failure_at"} = ?
               WHERE id = 'claims'`,
        params: ["2026-07-31T00:00:01.000Z"],
      },
    ]);
    const observedFailure = await readyWith(db, runtime, vectors);
    assert.equal(observedFailure.status, 503);
    assert.equal(
      observedFailure.body.meta.checks.semantic_index,
      dependency === "embedder"
        ? "embedding_dependency_unavailable"
        : "vector_dependency_unavailable",
    );
    assert.equal(vectors.embedCalls(), 0, "observed failure readiness stays local");
    await db.batch([
      {
        sql: `UPDATE semantic_index_metadata
                 SET ${dependency === "embedder" ? "embedder_failure_at" : "vector_store_failure_at"} = NULL
               WHERE id = 'claims'`,
      },
    ]);
    assert.equal((await readyWith(db, runtime, vectors)).status, 200);
  }
  await db.batch([
    {
      sql: `UPDATE semantic_index_metadata
               SET embedder_failure_at = '2026-07-31T00:00:02.000Z',
                   vector_store_failure_at = '2026-07-31T00:00:03.000Z'
             WHERE id = 'claims'`,
    },
  ]);
  const dualFailure = await readyWith(db, runtime, vectors);
  assert.equal(dualFailure.status, 503);
  assert.equal(
    dualFailure.body.meta.checks.semantic_index,
    "semantic_dependencies_unavailable",
  );
  assert.equal(dualFailure.body.meta.capabilities.embedding, "configured_error");
  assert.equal(dualFailure.body.meta.capabilities.vector, "configured_error");
  await db.batch([
    {
      sql: `UPDATE semantic_index_metadata
               SET embedder_failure_at = NULL, vector_store_failure_at = NULL
             WHERE id = 'claims'`,
    },
  ]);

  await db.batch([
    {
      sql: `INSERT INTO organizations (id, name, created_at)
            VALUES ('org_semantic_recovery_other', 'Other recovery org',
                    '2026-07-31T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO index_outbox
              (id, org_id, record_type, record_id, operation, state, attempts, created_at)
            VALUES ('idx_semantic_recovery_other', 'org_semantic_recovery_other',
                    'claim', 'clm_semantic_recovery_other', 'upsert', 'pending', 0,
                    '2026-07-31T00:00:00.000Z')`,
    },
  ]);
  await db.batch([{
    sql: `UPDATE index_outbox SET state = 'pending'
           WHERE id = 'idx_semantic_backfill'`,
  }]);
  const failedLease = await claimSemanticIndexWork(
    db,
    ["idx_semantic_backfill"],
  );
  await recordSemanticDependencyFailure(
    db,
    "embedder",
    "2026-07-31T00:00:04.000Z",
    ["idx_semantic_backfill"],
    failedLease.token,
  );
  assert.deepEqual(
    await db.all(`SELECT attempts FROM index_outbox WHERE id = 'idx_semantic_backfill'`),
    [{ attempts: 1 }],
  );
  assert.equal((await readyWith(db, runtime, vectors)).status, 503);
  const otherLease = await claimSemanticIndexWork(
    db,
    ["idx_semantic_recovery_other"],
  );
  await completeSemanticIndexWork(
    db,
    ["idx_semantic_recovery_other"],
    true,
    otherLease.token,
  );
  assert.equal(
    (await readyWith(db, runtime, vectors)).status,
    503,
    "another organization cannot clear unresolved failure evidence",
  );
  const recoveryLease = await claimSemanticIndexWork(
    db,
    ["idx_semantic_backfill"],
  );
  await completeSemanticIndexWork(
    db,
    ["idx_semantic_backfill"],
    true,
    recoveryLease.token,
  );
  assert.equal((await readyWith(db, runtime, vectors)).status, 200);
  await db.batch([
    { sql: `DELETE FROM index_outbox WHERE id = 'idx_semantic_recovery_other'` },
    { sql: `DELETE FROM organizations WHERE id = 'org_semantic_recovery_other'` },
  ]);

  await db.batch([
    {
      sql: `UPDATE semantic_index_metadata
               SET embedder_failure_at = '2026-07-31T00:00:05.000Z'
             WHERE id = 'claims'`,
    },
    {
      sql: `INSERT INTO organizations (id, name, created_at)
            VALUES ('org_semantic_unowned_recovery', 'Unowned recovery org',
                    '2026-07-31T00:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO index_outbox
              (id, org_id, record_type, record_id, operation, state, attempts, created_at)
            VALUES
              ('idx_semantic_superseded_failure', 'org_semantic_backfill',
               'claim', 'clm_semantic_superseded_failure', 'upsert', 'done', 1,
               '2026-07-31T00:00:00.000Z'),
              ('idx_semantic_delete_only', 'org_semantic_backfill',
               'claim', 'clm_semantic_superseded_failure', 'delete', 'pending', 0,
               '2026-07-31T00:00:01.000Z'),
              ('idx_semantic_unowned_success', 'org_semantic_unowned_recovery',
               'claim', 'clm_semantic_unowned_success', 'upsert', 'pending', 0,
               '2026-07-31T00:00:02.000Z')`,
    },
  ]);
  const deleteOnlyLease = await claimSemanticIndexWork(
    db,
    ["idx_semantic_delete_only"],
  );
  await completeSemanticIndexWork(
    db,
    ["idx_semantic_delete_only"],
    false,
    deleteOnlyLease.token,
  );
  assert.equal((await readyWith(db, runtime, vectors)).status, 503,
    "delete-only completion is not dependency recovery");
  const unownedSuccessLease = await claimSemanticIndexWork(
    db,
    ["idx_semantic_unowned_success"],
  );
  await completeSemanticIndexWork(
    db,
    ["idx_semantic_unowned_success"],
    true,
    unownedSuccessLease.token,
  );
  assert.equal((await readyWith(db, runtime, vectors)).status, 503,
    "unowned success without a failed attempt cannot erase outage evidence");
  await db.batch([{
    sql: `INSERT INTO index_outbox
            (id, org_id, record_type, record_id, operation, state, attempts, created_at)
          VALUES ('idx_semantic_owned_retry', 'org_semantic_backfill', 'claim',
                  'clm_semantic_owned_retry', 'upsert', 'pending', 1,
                  '2026-07-31T00:00:03.000Z')`,
  }]);
  const ownedRetryLease = await claimSemanticIndexWork(
    db,
    ["idx_semantic_owned_retry"],
  );
  await completeSemanticIndexWork(
    db,
    ["idx_semantic_owned_retry"],
    true,
    ownedRetryLease.token,
  );
  assert.equal((await readyWith(db, runtime, vectors)).status, 200,
    "a successful retry of previously failed work proves recovery");
  await db.batch([
    {
      sql: `DELETE FROM index_outbox
             WHERE id IN ('idx_semantic_superseded_failure',
                          'idx_semantic_delete_only',
                          'idx_semantic_unowned_success',
                          'idx_semantic_owned_retry')`,
    },
    { sql: `DELETE FROM organizations WHERE id = 'org_semantic_unowned_recovery'` },
  ]);

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
  const queuedProjection = await readyWith(db, runtime, vectors);
  assert.equal(queuedProjection.status, 200);
  assert.equal(
    queuedProjection.body.data.checks.semantic_index,
    "index_projection_pending",
  );
  assert.equal(queuedProjection.body.data.capabilities.vector, "enabled");

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
  assert.equal(recovered.body.data.checks.semantic_index, "index_projection_pending");
  assert.equal(recovered.body.data.capabilities.vector, "enabled");
  assert.equal(changed.embedCalls(), 0);

  await db.batch([
    { sql: `DELETE FROM semantic_index_metadata` },
    {
      sql: `DELETE FROM index_outbox WHERE org_id = 'org_semantic_backfill'`,
    },
    {
      sql: `DELETE FROM claims
             WHERE id IN ('clm_semantic_backfill', 'clm_semantic_interim')`,
    },
    { sql: `DELETE FROM organizations WHERE id = 'org_semantic_backfill'` },
  ]);
}

/** Same owner-fence race against bun:sqlite and D1. */
export async function assertSemanticIndexOwnership(db: Db, runtime: string) {
  for (const winner of ["manual", "background"] as const) {
    const provisioned = await provisionWith(db, { scopes: ["*"] });
    const claimId = `clm_index_owner_${winner}`;
    const outboxId = `idx_index_owner_${winner}`;
    const base = new Date("2026-07-31T01:00:00.000Z");
    const takeover = new Date(base.getTime() + SEMANTIC_INDEX_LEASE_MS + 1);
    const vectors = fakeVectors();
    const embed = vectors.embedder.embed.bind(vectors.embedder);
    let providerCalls = 0;
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vectors.embedder.embed = async (texts) => {
      providerCalls += 1;
      if (providerCalls === 1) {
        markStarted();
        await firstRelease;
        throw new Error("controlled late embedder failure");
      }
      return embed(texts);
    };

    await db.batch([
      {
        sql: `INSERT OR IGNORE INTO semantic_index_metadata
                (id, provider, model, revision, dimensions, metric,
                 preprocessing, index_schema, created_at)
              VALUES ('claims', ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          vectors.fingerprint.provider,
          vectors.fingerprint.model,
          vectors.fingerprint.revision,
          vectors.fingerprint.dimensions,
          vectors.fingerprint.metric,
          vectors.fingerprint.preprocessing,
          vectors.fingerprint.index_schema,
          base.toISOString(),
        ],
      },
      {
        sql: `UPDATE semantic_index_metadata
                 SET embedder_failure_at = NULL, vector_store_failure_at = NULL
               WHERE id = 'claims'`,
      },
      {
        sql: `INSERT INTO claims
                (id, org_id, subject_id, project_id, workspace_id, observer_id,
                 actor_id, kind, statement, confidence, trust, visibility, status,
                 version, valid_from, valid_to, created_at)
              VALUES (?, ?, 'subject_index_owner', NULL, NULL, NULL, ?,
                      'semantic_fact', 'Owner fencing keeps readiness truthful.',
                      1, 'verified', 'private', 'active', 1, ?, NULL, ?)`,
        params: [
          claimId,
          provisioned.orgId,
          provisioned.principalId,
          base.toISOString(),
          base.toISOString(),
        ],
      },
      {
        sql: `INSERT INTO index_outbox
                (id, org_id, record_type, record_id, operation, state, attempts, created_at)
              VALUES (?, ?, 'claim', ?, 'upsert', 'pending', 0, ?)`,
        params: [outboxId, provisioned.orgId, claimId, base.toISOString()],
      },
    ]);

    const manualAt = (at: Date) => clientVia(
      createApp({
        db,
        runtime,
        revision: "index-owner",
        vectors,
        semanticPrepared: true,
        now: () => at,
      }),
      "http://titen.test",
    );
    const late = manualAt(base).call("POST", "/v1/index/drain?limit=1", {
      key: provisioned.key,
    });
    await firstStarted;
    assert.deepEqual(
      await db.all(
        `SELECT state, attempts, lease_token IS NOT NULL AS owned
           FROM index_outbox WHERE id = ?`,
        [outboxId],
      ),
      [{ state: "pending", attempts: 0, owned: 1 }],
    );

    const contend = async (at: Date): Promise<number> => {
      if (winner === "manual") {
        const result = await manualAt(at).call("POST", "/v1/index/drain?limit=1", {
          key: provisioned.key,
        });
        assert.equal(result.status, 200);
        return result.body.data.indexed;
      }
      const result = await runMaintenance({
        db,
        vectors,
        limit: 1,
        now: at,
        deliverWebhooks: false,
      });
      assert.deepEqual(result.errors, []);
      return result.indexed;
    };
    assert.equal(await contend(new Date(base.getTime() + 1)), 0);
    assert.equal(providerCalls, 1, "an active owner excludes an overlapping drain");
    await db.batch([{
      sql: `UPDATE index_outbox
               SET lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second')
             WHERE id = ?`,
      params: [outboxId],
    }]);
    assert.equal(await contend(takeover), 1);

    releaseFirst();
    const stale = await late;
    assert.equal(stale.status, 503);
    assert.equal(stale.body.meta.dependency, "embedder");
    assert.deepEqual(
      await db.all(
        `SELECT state, attempts, lease_token, lease_expires_at
           FROM index_outbox WHERE id = ?`,
        [outboxId],
      ),
      [{ state: "done", attempts: 1, lease_token: null, lease_expires_at: null }],
    );
    assert.deepEqual(
      await db.all(
        `SELECT embedder_failure_at, vector_store_failure_at
           FROM semantic_index_metadata WHERE id = 'claims'`,
      ),
      [{ embedder_failure_at: null, vector_store_failure_at: null }],
    );

    const callsBeforeReadiness = providerCalls;
    const ready = await manualAt(takeover).call("GET", "/readyz");
    assert.equal(ready.status, 200);
    assert.equal(providerCalls, callsBeforeReadiness);
    const idle = await manualAt(takeover).call("POST", "/v1/index/drain?limit=1", {
      key: provisioned.key,
    });
    assert.equal(idle.status, 200);
    assert.equal(idle.body.data.drained, 0);
    assert.equal(idle.body.data.remaining, 0);

    await db.batch([
      { sql: `DELETE FROM index_outbox WHERE id = ?`, params: [outboxId] },
      { sql: `DELETE FROM claims WHERE id = ?`, params: [claimId] },
      { sql: `DELETE FROM api_keys WHERE org_id = ?`, params: [provisioned.orgId] },
      { sql: `DELETE FROM organizations WHERE id = ?`, params: [provisioned.orgId] },
    ]);
  }
}

/** Same stale external-write repair contract against bun:sqlite and D1. */
export async function assertSemanticIndexWriteRepair(db: Db, runtime: string) {
  const fingerprint = fakeVectors().fingerprint;
  await db.batch([
    {
      sql: `INSERT OR IGNORE INTO semantic_index_metadata
              (id, provider, model, revision, dimensions, metric,
               preprocessing, index_schema, created_at)
            VALUES ('claims', ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        fingerprint.provider,
        fingerprint.model,
        fingerprint.revision,
        fingerprint.dimensions,
        fingerprint.metric,
        fingerprint.preprocessing,
        fingerprint.index_schema,
        "2026-07-31T00:00:00.000Z",
      ],
    },
    {
      sql: `UPDATE semantic_index_metadata
               SET embedder_failure_at = NULL, vector_store_failure_at = NULL
             WHERE id = 'claims'`,
    },
  ]);
  const run = async (
    winner: "manual" | "background",
    purge: boolean,
    crashAfterWrite = false,
    applyThenThrow = false,
  ) => {
    const provisioned = await provisionWith(db, { scopes: ["*"] });
    const caseId = `${winner}_${purge}_${crashAfterWrite}_${applyThenThrow}`;
    const base = new Date(
      `2026-07-31T0${winner === "manual" ? 2 : 3}:00:00.000Z`,
    );
    let contenderAt = purge
      ? new Date(base.getTime() + 1)
      : new Date(base.getTime() + SEMANTIC_INDEX_LEASE_MS + 1);
    const vectors = fakeVectors();
    const upsert = vectors.store.upsert.bind(vectors.store);
    const remove = vectors.store.remove.bind(vectors.store);
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => { started = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    let upsertCalls = 0;
    let visibleGeneration = 0;
    vectors.store.upsert = async (records) => {
      upsertCalls += 1;
      const generation = upsertCalls;
      if (upsertCalls === 1) {
        started();
        await resume;
      }
      await upsert(records);
      visibleGeneration = generation;
      if (generation === 1 && applyThenThrow)
        throw new Error("controlled apply-then-throw vector failure");
    };
    let releaseRemoval!: () => void;
    let removalStarted!: () => void;
    const removalBlocked = new Promise<void>((resolve) => { removalStarted = resolve; });
    const removalResume = new Promise<void>((resolve) => { releaseRemoval = resolve; });
    let firstRemoval = !purge;
    vectors.store.remove = async (ids) => {
      if (firstRemoval) {
        firstRemoval = false;
        removalStarted();
        await removalResume;
      }
      await remove(ids);
    };

    let stopAfterWrite = crashAfterWrite;
    const ownerDb: Db = {
      all: (sql, params) => db.all(sql, params),
      async batch(statements) {
        if (
          stopAfterWrite && visibleGeneration > 0 &&
          statements.some(({ sql }) => sql.includes("SET state = 'done'"))
        ) {
          stopAfterWrite = false;
          throw new Error("controlled process stop after external vector write");
        }
        await db.batch(statements);
      },
      exec: (sql) => db.exec(sql),
    };
    const clientAt = (at: Date | (() => Date), targetDb: Db = db) => clientVia(
      createApp({
        db: targetDb,
        runtime,
        revision: "index-write-repair",
        vectors,
        semanticPrepared: true,
        now: typeof at === "function" ? at : () => at,
      }),
      "http://titen.test",
    );
    const seed = clientAt(base);
    const observation = await seed.call("POST", "/v1/observations", {
      key: provisioned.key,
      body: {
        subject_id: `subject_write_repair_${winner}_${purge}`,
        kind: "tool_result",
        content: "Synthetic stale write repair evidence.",
        source: { type: "tool", ref: `write-repair-${winner}-${purge}` },
        trust: "verified",
      },
    });
    assert.equal(observation.status, 201);
    const observationId = observation.body.data.observation_id as string;
    const consolidated = await seed.call("POST", "/v1/consolidations", {
      key: provisioned.key,
      body: {
        subject_id: `subject_write_repair_${winner}_${purge}`,
        claims: [{
          kind: "procedural",
          statement: "A stale vector write must retain durable repair.",
          sources: [{ observation_id: observationId, relation: "supports" }],
        }],
      },
    });
    assert.equal(consolidated.status, 201);
    const claimId = consolidated.body.data.claims[0].claim_id as string;

    if (!purge) await db.batch([{
      sql: `INSERT INTO index_outbox
              (id, org_id, record_type, record_id, operation, state, attempts, created_at)
            VALUES (?, ?, 'claim', ?, 'delete', 'pending', 0, ?)`,
      params: [
        `idx_slow_delete_${caseId}`,
        provisioned.orgId,
        `clm_slow_delete_${caseId}`,
        new Date(base.getTime() - 1).toISOString(),
      ],
    }]);

    let ownerAt = base;
    const staleCall = clientAt(() => ownerAt, ownerDb).call("POST", "/v1/index/drain?limit=100", {
      key: provisioned.key,
    });
    if (!purge) {
      await removalBlocked;
      ownerAt = contenderAt;
      releaseRemoval();
    }
    await blocked;
    const writeAhead = await db.all<{ operation: string; state: string; org_id: string }>(
      `SELECT operation, state, org_id FROM index_outbox
        WHERE record_type = 'claim' AND record_id = ? AND operation = 'reconcile'
          AND state = 'pending' AND lease_token IS NOT NULL`,
      [claimId],
    );
    assert.deepEqual(writeAhead, [{
      operation: "reconcile",
      state: "pending",
      org_id: provisioned.orgId,
    }]);

    if (purge) {
      const purged = await clientAt(contenderAt).call(
        "DELETE",
        `/v1/observations/${observationId}`,
        { key: provisioned.key },
      );
      assert.equal(purged.status, 200);
    }
    const contend = async (at: Date): Promise<number> => {
      if (winner === "manual") {
        const result = await clientAt(at).call(
          "POST",
          "/v1/index/drain?limit=100",
          { key: provisioned.key },
        );
        assert.equal(result.status, 200);
        return result.body.data.indexed;
      }
      const result = await runMaintenance({
        db,
        vectors,
        limit: 100,
        now: at,
        deliverWebhooks: false,
      });
      assert.deepEqual(result.errors, []);
      return result.indexed;
    };
    if (purge) {
      await contend(contenderAt);
    } else {
      const lease = (await db.all<{ lease_expires_at: string; inspected_at: string }>(
        `SELECT lease_expires_at,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS inspected_at
           FROM index_outbox
          WHERE record_type = 'claim' AND record_id = ? AND operation = 'upsert'`,
        [claimId],
      ))[0];
      assert.ok(lease?.lease_expires_at);
      assert.ok(
        Date.parse(lease.lease_expires_at) - Date.parse(lease.inspected_at) >=
          SEMANTIC_INDEX_LEASE_MS - 1_000,
        "later work receives a full database-clock lease",
      );
      assert.equal(await contend(new Date("2099-01-01T00:00:00.000Z")), 0);
      assert.equal(await contend(new Date("2000-01-01T00:00:00.000Z")), 0);
      assert.equal(upsertCalls, 1, "an immediate contender performs no provider write");
      await db.batch([{
        sql: `UPDATE index_outbox
                 SET lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second')
               WHERE record_type = 'claim' AND record_id = ? AND state = 'pending'`,
        params: [claimId],
      }]);
      assert.ok(await contend(contenderAt) >= 1);
    }
    if (purge) assert.equal(vectors.metadataFor(claimId), undefined);
    else assert.ok(vectors.metadataFor(claimId));

    release();
    const stale = await staleCall;
    assert.equal(stale.status, crashAfterWrite ? 500 : applyThenThrow ? 503 : 200);
    if (applyThenThrow) {
      assert.equal(visibleGeneration, 1, "the stale provider result must be externally visible");
      assert.ok(vectors.metadataFor(claimId));
    } else if (!crashAfterWrite) {
      assert.equal(stale.body.data.indexed, 0);
      assert.ok(stale.body.data.remaining > 0);
      assert.equal(vectors.metadataFor(claimId), undefined);
    } else {
      assert.ok(vectors.metadataFor(claimId), "the crash fixture must leave the external write visible");
    }
    const canonical = (await db.all<{ status: string }>(
      `SELECT status FROM claims WHERE id = ? AND org_id = ?`,
      [claimId, provisioned.orgId],
    ))[0];
    assert.equal(canonical?.status, purge ? "revoked" : "active");
    const queued = await db.all<{ org_id: string; operation: string }>(
      `SELECT org_id, operation FROM index_outbox
        WHERE record_type = 'claim' AND record_id = ? AND state = 'pending'`,
      [claimId],
    );
    assert.ok(queued.length > 0);
    assert.ok(queued.every(({ org_id }) => org_id === provisioned.orgId));

    // A fresh app instance against the same SQL and vector stores converges.
    await db.batch([{
      sql: `UPDATE index_outbox
               SET lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second')
             WHERE record_type = 'claim' AND record_id = ? AND state = 'pending'
               AND lease_token IS NOT NULL`,
      params: [claimId],
    }]);
    const repairAt = new Date(contenderAt.getTime() + 1);
    const repaired = await clientAt(repairAt).call(
      "POST",
      "/v1/index/drain?limit=100",
      { key: provisioned.key },
    );
    assert.equal(repaired.status, 200);
    assert.equal(repaired.body.data.remaining, 0);
    if (purge) assert.equal(vectors.metadataFor(claimId), undefined);
    else {
      assert.ok(vectors.metadataFor(claimId));
      if (applyThenThrow)
        assert.ok(visibleGeneration > 1, "fresh repair must overwrite the ambiguous stale generation");
    }
  };

  assert.deepEqual((await claimSemanticIndexWork(db, [])).ids, []);

  await run("manual", true, true);
  await run("background", true);
  await run("manual", false);
  await run("background", false);
  await run("manual", false, false, true);

  const runStaleRemoval = async (
    winner: "manual" | "background",
    applyThenThrow: boolean,
  ) => {
    const provisioned = await provisionWith(db, { scopes: ["*"] });
    const suffix = `${winner}_${applyThenThrow ? "ambiguous" : "success"}`;
    const vectors = fakeVectors();
    const at = (value: Date) => clientVia(createApp({
      db,
      runtime,
      revision: "index-remove-repair",
      vectors,
      semanticPrepared: true,
      now: () => value,
    }), "http://titen.test");
    const base = new Date("2026-07-31T05:00:00.000Z");
    const seed = at(base);
    const observation = await seed.call("POST", "/v1/observations", {
      key: provisioned.key,
      body: {
        subject_id: `subject_remove_repair_${suffix}`,
        kind: "tool_result",
        content: "Synthetic stale removal repair evidence.",
        source: { type: "tool", ref: `remove-repair-${suffix}` },
        trust: "verified",
      },
    });
    assert.equal(observation.status, 201);
    const consolidated = await seed.call("POST", "/v1/consolidations", {
      key: provisioned.key,
      body: {
        subject_id: `subject_remove_repair_${suffix}`,
        claims: [{
          kind: "procedural",
          statement: "Canonical reconciliation repairs a stale vector removal.",
          sources: [{
            observation_id: observation.body.data.observation_id,
            relation: "supports",
          }],
        }],
      },
    });
    assert.equal(consolidated.status, 201);
    const claimId = consolidated.body.data.claims[0].claim_id as string;
    const indexed = await seed.call("POST", "/v1/index/drain?limit=100", {
      key: provisioned.key,
    });
    assert.equal(indexed.status, 200);
    assert.ok(vectors.metadataFor(claimId));

    await db.batch([{
      sql: `INSERT INTO index_outbox
              (id, org_id, record_type, record_id, operation, state, attempts, created_at)
            VALUES (?, ?, 'claim', ?, 'delete', 'pending', 0, ?)`,
      params: [`idx_stale_remove_${suffix}`, provisioned.orgId, claimId, base.toISOString()],
    }]);
    const remove = vectors.store.remove.bind(vectors.store);
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => { started = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    let removeCalls = 0;
    vectors.store.remove = async (ids) => {
      removeCalls += 1;
      const call = removeCalls;
      if (call === 1) {
        started();
        await resume;
      }
      await remove(ids);
      if (call === 1 && applyThenThrow)
        throw new Error("controlled apply-then-throw remove failure");
    };

    const staleCall = at(base).call("POST", "/v1/index/drain?limit=1", {
      key: provisioned.key,
    });
    await blocked;
    assert.equal(Number((await db.all<{ count: number }>(
      `SELECT COUNT(*) AS count FROM index_outbox
        WHERE org_id = ? AND record_id = ? AND operation = 'reconcile'
          AND state = 'pending' AND lease_token IS NOT NULL`,
      [provisioned.orgId, claimId],
    ))[0]?.count ?? 0), 1);
    await db.batch([{
      sql: `UPDATE index_outbox
               SET lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second')
             WHERE org_id = ? AND record_id = ? AND state = 'pending'`,
      params: [provisioned.orgId, claimId],
    }]);

    if (winner === "manual") {
      const takeover = await at(new Date("2099-01-01T00:00:00.000Z")).call(
        "POST",
        "/v1/index/drain?limit=100",
        { key: provisioned.key },
      );
      assert.equal(takeover.status, 200);
      assert.ok(takeover.body.data.indexed >= 1);
    } else {
      const takeover = await runMaintenance({
        db,
        vectors,
        limit: 100,
        now: new Date("2000-01-01T00:00:00.000Z"),
        deliverWebhooks: false,
      });
      assert.deepEqual(takeover.errors, []);
      assert.ok(takeover.indexed >= 1);
    }
    assert.ok(vectors.metadataFor(claimId), "takeover restores the current claim");

    release();
    const stale = await staleCall;
    assert.equal(stale.status, applyThenThrow ? 503 : 200);
    if (!applyThenThrow) assert.equal(stale.body.data.removed, 0);
    assert.equal(vectors.metadataFor(claimId), undefined);
    assert.ok(Number((await db.all<{ count: number }>(
      `SELECT COUNT(*) AS count FROM index_outbox
        WHERE org_id = ? AND record_id = ? AND operation = 'reconcile'
          AND state = 'pending' AND lease_token IS NULL`,
      [provisioned.orgId, claimId],
    ))[0]?.count ?? 0) >= 1);
    assert.deepEqual(await db.all(
      `SELECT embedder_failure_at, vector_store_failure_at
         FROM semantic_index_metadata WHERE id = 'claims'`,
    ), [{ embedder_failure_at: null, vector_store_failure_at: null }]);

    const repaired = await at(base).call("POST", "/v1/index/drain?limit=100", {
      key: provisioned.key,
    });
    assert.equal(repaired.status, 200);
    assert.equal(repaired.body.data.remaining, 0);
    assert.ok(vectors.metadataFor(claimId));
  };

  await runStaleRemoval("manual", false);
  await runStaleRemoval("background", true);

  const early = await provisionWith(db, { scopes: ["*"] });
  const later = await provisionWith(db, { scopes: ["*"] });
  const base = new Date("2026-07-31T04:00:00.000Z");
  const vectors = fakeVectors();
  const seed = clientAt(base);
  function clientAt(at: Date) {
    return clientVia(createApp({
      db,
      runtime,
      revision: "index-cross-org-lease",
      vectors,
      semanticPrepared: true,
      now: () => at,
    }), "http://titen.test");
  }
  const observation = await seed.call("POST", "/v1/observations", {
    key: later.key,
    body: {
      subject_id: "subject_cross_org_lease",
      kind: "tool_result",
      content: "Synthetic later organization lease evidence.",
      source: { type: "tool", ref: "cross-org-lease" },
      trust: "verified",
    },
  });
  assert.equal(observation.status, 201);
  const consolidated = await seed.call("POST", "/v1/consolidations", {
    key: later.key,
    body: {
      subject_id: "subject_cross_org_lease",
      claims: [{
        kind: "procedural",
        statement: "Later organizations receive fresh index leases.",
        sources: [{
          observation_id: observation.body.data.observation_id,
          relation: "supports",
        }],
      }],
    },
  });
  assert.equal(consolidated.status, 201);
  const claimId = consolidated.body.data.claims[0].claim_id as string;
  await db.batch([{
    sql: `INSERT INTO index_outbox
            (id, org_id, record_type, record_id, operation, state, attempts, created_at)
          VALUES ('idx_early_org_delete', ?, 'claim', 'clm_early_org_delete',
                  'delete', 'pending', 0, ?)`,
    params: [early.orgId, new Date(base.getTime() - 1).toISOString()],
  }]);

  const remove = vectors.store.remove.bind(vectors.store);
  let releaseRemoval!: () => void;
  let removalStarted!: () => void;
  const removalBlocked = new Promise<void>((resolve) => { removalStarted = resolve; });
  const removalResume = new Promise<void>((resolve) => { releaseRemoval = resolve; });
  vectors.store.remove = async (ids) => {
    removalStarted();
    await removalResume;
    await remove(ids);
  };
  const upsert = vectors.store.upsert.bind(vectors.store);
  let releaseUpsert!: () => void;
  let upsertStarted!: () => void;
  const upsertBlocked = new Promise<void>((resolve) => { upsertStarted = resolve; });
  const upsertResume = new Promise<void>((resolve) => { releaseUpsert = resolve; });
  let upserts = 0;
  vectors.store.upsert = async (records) => {
    upserts += 1;
    upsertStarted();
    await upsertResume;
    await upsert(records);
  };

  let ownerAt = base;
  const owner = runMaintenance({
    db,
    vectors,
    limit: 100,
    now: () => ownerAt,
    deliverWebhooks: false,
  });
  await removalBlocked;
  ownerAt = new Date(base.getTime() + 86_400_000);
  releaseRemoval();
  await upsertBlocked;
  const lease = (await db.all<{ lease_expires_at: string; inspected_at: string }>(
    `SELECT lease_expires_at,
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS inspected_at
       FROM index_outbox
      WHERE org_id = ? AND record_id = ? AND operation = 'upsert'`,
    [later.orgId, claimId],
  ))[0];
  assert.ok(lease?.lease_expires_at);
  assert.ok(
    Date.parse(lease.lease_expires_at) - Date.parse(lease.inspected_at) >=
      SEMANTIC_INDEX_LEASE_MS - 1_000,
    "a later organization receives a full database-clock lease",
  );
  const providerCalls = vectors.embedCalls();
  const contender = await clientAt(new Date("2000-01-01T00:00:00.000Z")).call("POST", "/v1/index/drain?limit=100", {
    key: later.key,
  });
  assert.equal(contender.status, 200);
  assert.equal(contender.body.data.indexed, 0);
  assert.equal(vectors.embedCalls(), providerCalls);
  assert.equal(upserts, 1);
  releaseUpsert();
  const result = await owner;
  assert.deepEqual(result.errors, []);
  assert.equal(result.indexed, 1);
}
