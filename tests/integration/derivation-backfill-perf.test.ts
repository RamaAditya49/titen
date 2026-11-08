/**
 * AC-ENR-002: a steady-state derivation backfill must not grow with the
 * square of the store. Every observation already has a done job, so the pass
 * schedules nothing and only proves that fact.
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scheduleDerivationBackfill } from "../../src/core/enrichment";
import type { ExtractionCapability } from "../../src/core/extraction";
import { migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";

const COUNT = 20_000;
const BOUND_MS = 500;

test("a steady-state backfill over 20,000 observations stays fast", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-backfill-perf-"));
  const database = openDatabase(join(directory, "titen.db"));
  try {
    const db = createSqliteDb(database);
    await migrate(db);
    const at = "2026-11-08T00:00:00.000Z";
    database.exec(`INSERT INTO organizations (id, name, created_at) VALUES ('org_perf', 'Perf', '${at}')`);
    database.exec(`
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${COUNT})
      INSERT INTO observations
        (id, org_id, subject_id, actor_id, kind, content, content_hash, source_type,
         trust, visibility, ingested_at)
      SELECT 'obs_' || i, 'org_perf', 'subject_perf', 'actor_perf', 'user_statement',
             'content ' || i, printf('%064x', i), 'perf', 'unverified', 'private',
             '${at}'
        FROM n`);
    database.exec(`
      INSERT INTO enrichment_jobs
        (id, org_id, lane, derivation_key, input_ids, input_hash, subject_id, actor_id,
         model_id, model_fingerprint, prompt_fingerprint, schema_fingerprint,
         policy_fingerprint, state, max_attempts, next_attempt_at, created_at, updated_at,
         source_observation_id)
      SELECT 'job_' || id, org_id, 'derivation', printf('%064x', rowid),
             json_array(json_object('id', id, 'content_hash', content_hash)),
             content_hash, subject_id, actor_id, 'perf', 'a', 'b', 'c', 'd', 'done', 4,
             ingested_at, ingested_at, ingested_at, id
        FROM observations`);
    database.exec("ANALYZE");
    const capability = {
      modelId: "perf-model",
      modelFingerprint: "a".repeat(64),
      providerIdentity: "https://models.example.test/v1",
      async generate() {
        return { action: "abstain" };
      },
    } as unknown as ExtractionCapability;
    const started = performance.now();
    const scheduled = await scheduleDerivationBackfill({
      db,
      capability,
      now: new Date(at),
      limit: 5,
    });
    const elapsed = performance.now() - started;
    console.log(`derivation backfill over ${COUNT} observations: ${elapsed.toFixed(1)} ms`);
    assert.equal(scheduled, 0);
    assert.ok(elapsed < BOUND_MS, `backfill took ${elapsed.toFixed(1)} ms, bound ${BOUND_MS} ms`);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
