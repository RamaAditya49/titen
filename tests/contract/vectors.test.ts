import { afterAll, beforeAll, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/core/app";
import type { Db } from "../../src/core/db";
import { migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { createVectorizeStore } from "../../src/runtime/cloudflare/vectors";
import { clientVia, fakeVectors, provisionWith } from "./harness";
import {
  RANK_WEIGHTS,
  normalizeVectorSimilarity,
  rankCandidates,
  type RankInput,
} from "../../src/core/rank";

/**
 * The optional vector capability, exercised against the shared core.
 *
 * Hybrid retrieval lives entirely in `src/core/context.ts` and `rank.ts`, above
 * the driver boundary, so proving the branch once is sufficient: the two drivers
 * are already covered by the dual-runtime contract suite. What cannot be tested
 * here is a real embedding provider or a real vector index; those are wired in
 * the per-runtime vector adapters and gated on a native extension or a
 * Cloudflare binding.
 */
const directory = mkdtempSync(join(tmpdir(), "titen-vec-"));
const dbPath = join(directory, "titen.db");
const origin = "http://titen.test";

const vectors = fakeVectors();
let db: ReturnType<typeof createSqliteDb>;
let handle: ReturnType<typeof openDatabase>;
let key: string;
let orgId: string;
let subjectId: string;

/** Three claims that all match the query lexically, so only ranking separates them. */
const CLAIMS = [
  "Rollback smoke gates every production release without exception.",
  "Release safety depends on a verified rollback rehearsal.",
  "Rollback ownership for a release sits with the on-call engineer.",
];
const TASK = "rollback release safety";

let claimIds: string[] = [];

const vectorScope = () => ({ org_id: orgId, subject_id: subjectId, project_id: "" });

const rankInput = (id: string, confidence: number, vector_boost?: number): RankInput => ({
  id,
  kind: "procedural",
  trust: "verified",
  confidence,
  status: "active",
  created_at: "2026-07-30T00:00:00.000Z",
  bm25: 0,
  disputed: false,
  feedback_positive: 0,
  feedback_negative: 0,
  feedback_total: 0,
  vector_boost,
});

async function seed(client: ReturnType<typeof clientVia>) {
  const observation = await client.call("POST", "/v1/observations", {
    key,
    body: {
      subject_id: subjectId,
      kind: "tool_result",
      content: "Release audit covering rollback rehearsal, gating, and ownership.",
      source: { type: "tool", ref: "audit#1" },
      trust: "verified",
    },
  });
  assert.equal(observation.status, 201);
  const observationId = observation.body.data.observation_id as string;

  const consolidation = await client.call("POST", "/v1/consolidations", {
    key,
    body: {
      subject_id: subjectId,
      claims: CLAIMS.map((statement) => ({
        kind: "procedural",
        statement,
        sources: [{ observation_id: observationId, relation: "supports" }],
      })),
    },
  });
  assert.equal(consolidation.status, 201);
  claimIds = (consolidation.body.data.claims as { claim_id: string }[]).map(
    (claim) => claim.claim_id,
  );
}

/** One app with the capability, one without, over the same seeded database. */
const withVectors = () =>
  clientVia(createApp({ db, revision: "test", runtime: "bun-sqlite", vectors }), origin);
const withoutVectors = () =>
  clientVia(createApp({ db, revision: "test", runtime: "bun-sqlite" }), origin);

beforeAll(async () => {
  handle = openDatabase(dbPath);
  db = createSqliteDb(handle);
  await migrate(db);
  const provisioned = await provisionWith(db, { scopes: ["*"] });
  key = provisioned.key;
  orgId = provisioned.orgId;
  subjectId = "user_vectors";
  await seed(withVectors());
});

afterAll(() => {
  handle.close();
  rmSync(directory, { recursive: true, force: true });
});

test("readiness reports the vector capability only when one is configured", async () => {
  const off = await withoutVectors().call("GET", "/readyz");
  assert.equal(off.body.data.capabilities.vector, "disabled");
  assert.equal(off.body.data.capabilities.model, "disabled");

  const on = await withVectors().call("GET", "/readyz");
  assert.equal(on.body.data.capabilities.vector, "enabled");
  assert.equal(on.body.data.capabilities.model, "enabled");
});

test("compilation reports vector retrieval as used and calls the embedder", async () => {
  const before = vectors.embedCalls();
  const res = await withVectors().call("POST", "/v1/context/compile", {
    key,
    body: { subject_id: subjectId, task: TASK, max_tokens: 2000 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.meta.degraded.vector, "used");
  assert.ok(vectors.embedCalls() > before, "the query must be embedded once");
  assert.ok(res.body.data.items.length >= 1);
  assert.deepEqual(vectors.lastFilter(), {
    org_id: orgId,
    subject_id: subjectId,
    project_id: "",
  });
});

test("vector retrieval treats missing project as unscoped and broad mode as explicit", async () => {
  const client = withVectors();
  const subject = "user_vector_project_scope_141";
  const project = await client.call("POST", "/v1/projects/resolve", {
    key,
    body: { reference: "scope-fixture/vector-project", create: true },
  });
  assert.equal(project.status, 201);
  const projectId = project.body.data.project_id as string;
  const observed = await client.call("POST", "/v1/observations", {
    key,
    body: {
      subject_id: subject,
      project_id: projectId,
      kind: "tool_result",
      content: "Vector-only scoped canary evidence.",
      source: { type: "test", ref: "scope-141" },
      trust: "verified",
      visibility: "organization",
    },
  });
  assert.equal(observed.status, 201);
  const consolidated = await client.call("POST", "/v1/consolidations", {
    key,
    body: {
      subject_id: subject,
      project_id: projectId,
      claims: [{
        kind: "procedural",
        statement: "Vector-only scoped canary claim.",
        visibility: "organization",
        sources: [{ observation_id: observed.body.data.observation_id, relation: "supports" }],
      }],
    },
  });
  assert.equal(consolidated.status, 201);
  const claimId = consolidated.body.data.claims[0].claim_id as string;
  vectors.setScore(claimId, 1, {
    org_id: orgId,
    subject_id: subject,
    project_id: projectId,
  });

  const request = (body: Record<string, unknown>) =>
    client.call("POST", "/v1/context/compile", {
      key,
      body: { subject_id: subject, task: "semantically adjacent phrase", max_tokens: 900, ...body },
    });
  const omitted = await request({});
  assert.equal(omitted.status, 200);
  assert.equal(omitted.body.data.items.length, 0);
  assert.deepEqual(vectors.lastFilter(), {
    org_id: orgId,
    subject_id: subject,
    project_id: "",
  });

  const exact = await request({ project_id: projectId });
  assert.equal(exact.status, 200);
  assert.equal(exact.body.data.items[0].claim_id, claimId);
  assert.deepEqual(vectors.lastFilter(), {
    org_id: orgId,
    subject_id: subject,
    project_id: projectId,
  });

  const broad = await request({ cross_project: true });
  assert.equal(broad.status, 200);
  assert.equal(broad.body.data.items[0].claim_id, claimId);
  assert.equal(broad.body.data.scope.project_mode, "cross_project");
  assert.deepEqual(vectors.lastFilter(), { org_id: orgId, subject_id: subject });
});

test("Vectorize receives the same canonical metadata and query filter", async () => {
  let upserted: unknown;
  let queried: unknown;
  const store = createVectorizeStore({
    async upsert(records) {
      upserted = records;
    },
    async query(_vector, options) {
      queried = options;
      return { matches: [] };
    },
    async deleteByIds() {},
  });
  const scope = { org_id: "org", subject_id: "subject", project_id: "project" };
  await store.upsert([{ id: "claim", vector: new Float32Array([1, 0]), metadata: scope }]);
  await store.query(new Float32Array([1, 0]), { topK: 2, filter: scope });

  assert.deepEqual(upserted, [
    { id: "claim", values: [1, 0], metadata: scope },
  ]);
  assert.deepEqual(queried, { topK: 2, filter: scope });
});

test("a semantic hit lifts a lexically weak claim up the ranking", async () => {
  // With no vector signal, record the order lexical scoring alone produces.
  const lexical = await withoutVectors().call("POST", "/v1/context/compile", {
    key,
    body: { subject_id: subjectId, task: TASK, max_tokens: 2000 },
  });
  assert.equal(lexical.status, 200);
  const lexicalOrder = lexical.body.data.items.map((item: any) => item.claim_id) as string[];
  assert.equal(lexical.body.meta.degraded.vector, "disabled");
  assert.ok(lexicalOrder.length >= 3, "the fixture needs three ranked claims");

  // Pin the weakest lexical match as semantically near: the case FTS cannot see.
  const weakest = lexicalOrder[lexicalOrder.length - 1]!;
  const weakestBefore = lexical.body.data.items.at(-1);
  assert.ok(
    weakestBefore.score_components.relevance < 1,
    "the chosen claim must start below the top relevance",
  );
  vectors.setScore(weakest, 1, vectorScope());

  const hybrid = await withVectors().call("POST", "/v1/context/compile", {
    key,
    body: { subject_id: subjectId, task: TASK, max_tokens: 2000 },
  });
  assert.equal(hybrid.status, 200);
  assert.equal(hybrid.body.meta.degraded.vector, "used");
  const hybridOrder = hybrid.body.data.items.map((item: any) => item.claim_id) as string[];

  // Position must improve. It may reach a tie with the top lexical hit, which
  // within-set normalization already scores at 1, and ties break on id — so the
  // guarantee under test is movement, not an outright win.
  assert.ok(
    hybridOrder.indexOf(weakest) < lexicalOrder.indexOf(weakest),
    `a semantic match must rank higher: was ${lexicalOrder.indexOf(weakest)}, now ${hybridOrder.indexOf(weakest)}`,
  );
  const boosted = hybrid.body.data.items.find((item: any) => item.claim_id === weakest);
  assert.equal(boosted.score_components.relevance, 1, "similarity feeds relevance");
  assert.ok(
    boosted.score > weakestBefore.score,
    "the boosted claim must score higher than it did without the vector signal",
  );

  // Clearing the score restores the original order: the boost is not persisted.
  vectors.setScore(weakest, 0, vectorScope());
  const cleared = await withVectors().call("POST", "/v1/context/compile", {
    key,
    body: { subject_id: subjectId, task: TASK, max_tokens: 2000 },
  });
  assert.deepEqual(
    cleared.body.data.items.map((item: any) => item.claim_id),
    lexicalOrder,
    "with no similarity the ranking must match lexical-only",
  );
});

test("the absolute cosine floor rejects a best bad neighbor before hydration", async () => {
  const subject = "user_absolute_gate_144";
  const observation = await withVectors().call("POST", "/v1/observations", {
    key,
    body: {
      subject_id: subject,
      kind: "tool_result",
      content: "The unrelated archive stores violet telescope calibration notes.",
      source: { type: "test", ref: "absolute-gate-144" },
      trust: "verified",
    },
  });
  assert.equal(observation.status, 201);
  const consolidation = await withVectors().call("POST", "/v1/consolidations", {
    key,
    body: {
      subject_id: subject,
      claims: [{
        kind: "semantic_fact",
        statement: "Violet telescope calibration belongs in the archive.",
        sources: [{
          observation_id: observation.body.data.observation_id,
          relation: "supports",
        }],
      }],
    },
  });
  assert.equal(consolidation.status, 201);
  const claimId = consolidation.body.data.claims[0].claim_id as string;
  vectors.setScore(claimId, 0.099, {
    org_id: orgId,
    subject_id: subject,
    project_id: "",
  });

  let vectorHydrations = 0;
  const trackedDb: Db = {
    all: (sql, params) => {
      if (sql.includes("WHERE c.id IN")) vectorHydrations += 1;
      return db.all(sql, params);
    },
    batch: (statements) => db.batch(statements),
    exec: (sql) => db.exec(sql),
  };
  const client = clientVia(
    createApp({ db: trackedDb, revision: "test", runtime: "bun-sqlite", vectors }),
    origin,
  );
  const compile = () => client.call("POST", "/v1/context/compile", {
    key,
    body: { subject_id: subject, task: "...\u200d...", max_tokens: 900 },
  });

  const rejected = await compile();
  assert.equal(rejected.status, 200);
  assert.deepEqual(rejected.body.data.items, []);
  assert.equal(rejected.body.meta.candidates, 0);
  assert.equal(rejected.body.meta.degraded.vector, "used");
  assert.equal(vectorHydrations, 0, "sub-threshold ids must not reach canonical SQL");
  assert.doesNotMatch(
    JSON.stringify(rejected.body),
    /min_cosine|raw-unit-v1|0\.099/,
  );

  vectors.setScore(claimId, 0.1, {
    org_id: orgId,
    subject_id: subject,
    project_id: "",
  });
  const accepted = await compile();
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.items[0].claim_id, claimId);
  assert.equal(vectorHydrations, 1, "an eligible vector id is hydrated once");
});

test("narrow-band vector similarity is normalized before ranking", () => {
  const candidates = [rankInput("near", 0.8, 0.991), rankInput("exact", 0.8, 0.993)];
  const normalized = normalizeVectorSimilarity(candidates);
  assert.equal(normalized.get("near"), 0);
  assert.equal(normalized.get("exact"), 1);
  const ranked = rankCandidates(candidates, new Date("2026-07-30T00:00:00.000Z"));
  assert.equal(ranked[0]!.candidate.id, "exact");
  assert.equal(ranked[0]!.components.relevance, 1);

  const tied = normalizeVectorSimilarity([rankInput("a", 1, 0.99), rankInput("b", 1, 0.99)]);
  assert.equal(tied.get("a"), 1);
  assert.equal(tied.get("b"), 1);

  const absent = normalizeVectorSimilarity([rankInput("none", 1, 0)]);
  assert.equal(absent.has("none"), false);
});

test("confidence is an explicit weighted and auditable ranking factor", () => {
  const weightSum = Object.values(RANK_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  assert.ok(Math.abs(weightSum - 1) < Number.EPSILON * 2);
  const ranked = rankCandidates(
    [rankInput("low", 0.2), rankInput("high", 0.9)],
    new Date("2026-07-30T00:00:00.000Z"),
  );
  assert.equal(ranked[0]!.candidate.id, "high");
  assert.equal(ranked[0]!.components.confidence, 0.9);
  assert.equal(ranked[1]!.components.confidence, 0.2);
  assert.equal(ranked[0]!.score - ranked[1]!.score, 0.07);
});

async function pendingCount() {
  const rows = await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM index_outbox WHERE state = 'pending'`,
  );
  return Number(rows[0]!.count);
}

test("index drain reports embedder outages as retryable and preserves pending rows", async () => {
  const broken = fakeVectors();
  broken.breakEmbedder();
  const app = clientVia(createApp({ db, revision: "test", runtime: "bun-sqlite", vectors: broken }), origin);
  const before = await pendingCount();
  const failed = await app.call("POST", "/v1/index/drain", { key });
  assert.equal(failed.status, 503);
  assert.equal(failed.body.error.code, "UNAVAILABLE");
  assert.equal(failed.body.meta.dependency, "embedder");
  assert.equal(failed.body.meta.retryable, true);
  assert.equal(failed.body.meta.pending, before);
  assert.equal(await pendingCount(), before);
  const unavailable = await app.call("GET", "/readyz");
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.meta.capabilities.embedding, "configured_error");
  assert.equal(unavailable.body.meta.capabilities.vector, "enabled");
  assert.equal(unavailable.body.meta.checks.semantic_index, "embedding_dependency_unavailable");

  const other = await provisionWith(db, { scopes: ["*"] });
  const otherObservation = await app.call("POST", "/v1/observations", {
    key: other.key,
    body: {
      subject_id: "other_org_recovery",
      kind: "tool_result",
      content: "One tenant cannot clear another tenant's dependency outage.",
      source: { type: "tool", ref: "cross-org-recovery" },
      trust: "verified",
    },
  });
  assert.equal(otherObservation.status, 201);
  assert.equal(
    (
      await app.call("POST", "/v1/consolidations", {
        key: other.key,
        body: {
          subject_id: "other_org_recovery",
          claims: [{
            kind: "procedural",
            statement: "Cross-organization recovery remains isolated.",
            sources: [{
              observation_id: otherObservation.body.data.observation_id,
              relation: "supports",
            }],
          }],
        },
      })
    ).status,
    201,
  );
  broken.restoreEmbedder();
  const otherRecovery = await app.call("POST", "/v1/index/drain", { key: other.key });
  assert.equal(otherRecovery.status, 200);
  assert.ok(otherRecovery.body.data.indexed > 0);
  assert.equal((await app.call("GET", "/readyz")).status, 503);

  const retiring = await db.all<{ id: string; record_id: string; status: string }>(
    `SELECT queued.id, queued.record_id, c.status
       FROM (
         SELECT id, record_id FROM index_outbox
          WHERE org_id = ? AND state = 'pending'
          ORDER BY created_at, id LIMIT 50
       ) queued
       JOIN claims c ON c.id = queued.record_id
      WHERE c.status IN ('active', 'disputed')`,
    [orgId],
  );
  assert.ok(retiring.length > 0);
  await db.batch(
    [...new Set(retiring.map(({ record_id }) => record_id))].map((id) => ({
      sql: `UPDATE claims SET status = 'expired' WHERE id = ?`,
      params: [id],
    })),
  );
  const deleteOnly = await app.call("POST", "/v1/index/drain", { key });
  assert.equal(deleteOnly.status, 200);
  assert.equal(deleteOnly.body.data.indexed, 0);
  assert.equal((await app.call("GET", "/readyz")).status, 503);

  const originalStatus = new Map(retiring.map(({ record_id, status }) => [record_id, status]));
  await db.batch([
    ...[...originalStatus].map(([id, status]) => ({
      sql: `UPDATE claims SET status = ? WHERE id = ?`,
      params: [status, id],
    })),
    ...retiring.map(({ id }) => ({
      sql: `UPDATE index_outbox SET state = 'pending' WHERE id = ?`,
      params: [id],
    })),
  ]);
  broken.restoreEmbedder();
  const recovered = await app.call("POST", "/v1/index/drain", { key });
  assert.equal(recovered.status, 200);
  assert.ok(recovered.body.data.indexed > 0);
  assert.ok((await pendingCount()) < before);
  assert.equal((await app.call("GET", "/readyz")).status, 200);
  assert.deepEqual(broken.metadataFor(claimIds[0]!), {
    org_id: orgId,
    subject_id: subjectId,
    project_id: "",
  });
});

test("index drain reports vector-store outages as retryable and preserves pending rows", async () => {
  await seed(withVectors());
  const broken = fakeVectors();
  const upsert = broken.store.upsert.bind(broken.store);
  let mutationCalls = 0;
  broken.store.upsert = async (records) => {
    mutationCalls += 1;
    await upsert(records);
  };
  broken.breakStore();
  const app = clientVia(createApp({ db, revision: "test", runtime: "bun-sqlite", vectors: broken }), origin);
  const before = await pendingCount();
  const repairsBefore = Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM index_outbox
      WHERE state = 'pending' AND operation = 'reconcile'`,
  ))[0]?.count ?? 0);
  const failed = await app.call("POST", "/v1/index/drain", { key });
  assert.equal(failed.status, 503);
  assert.equal(failed.body.error.code, "UNAVAILABLE");
  assert.equal(failed.body.meta.dependency, "vector_store");
  assert.equal(failed.body.meta.retryable, true);
  assert.equal(failed.body.meta.pending, before);
  const after = await pendingCount();
  const repairsAfter = Number((await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM index_outbox
      WHERE state = 'pending' AND operation = 'reconcile'`,
  ))[0]?.count ?? 0);
  assert.ok(repairsAfter > repairsBefore, "ambiguous external writes retain canonical repair");
  assert.equal(after - before, repairsAfter - repairsBefore);
  for (let attempt = 2; attempt <= 6; attempt += 1) {
    const repeated = await app.call("POST", "/v1/index/drain", { key });
    assert.equal(repeated.status, 503);
    assert.equal(await pendingCount(), after);
    assert.equal(Number((await db.all<{ count: number }>(
      `SELECT COUNT(*) AS count FROM index_outbox
        WHERE state = 'pending' AND operation = 'reconcile'`,
    ))[0]?.count ?? 0), repairsAfter);
  }
  assert.equal(mutationCalls, 6, "one vector mutation is attempted per bounded retry");
  const unavailable = await app.call("GET", "/readyz");
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.meta.capabilities.embedding, "enabled");
  assert.equal(unavailable.body.meta.capabilities.vector, "configured_error");
  assert.equal(unavailable.body.meta.checks.semantic_index, "vector_dependency_unavailable");

  broken.restoreStore();
  const recovered = await app.call("POST", "/v1/index/drain", { key });
  assert.equal(recovered.status, 200);
  assert.ok(recovered.body.data.indexed > 0);
  assert.ok((await pendingCount()) < before);
  assert.equal((await app.call("GET", "/readyz")).status, 200);
});

test("purge drain removes an already indexed claim", async () => {
  const client = withVectors();
  const observation = await client.call("POST", "/v1/observations", {
    key,
    body: {
      subject_id: "purge-vector",
      kind: "tool_result",
      content: "Vector purge canary evidence.",
      source: { type: "tool", ref: "vector-purge" },
      trust: "verified",
    },
  });
  assert.equal(observation.status, 201);
  const consolidated = await client.call("POST", "/v1/consolidations", {
    key,
    body: {
      subject_id: "purge-vector",
      claims: [{
        kind: "procedural",
        statement: "Vector purge canary claim.",
        sources: [{ observation_id: observation.body.data.observation_id, relation: "supports" }],
      }],
    },
  });
  assert.equal(consolidated.status, 201);
  const claimId = consolidated.body.data.claims[0].claim_id as string;

  const indexed = await client.call("POST", "/v1/index/drain?limit=100", { key });
  assert.equal(indexed.status, 200);
  assert.ok(vectors.metadataFor(claimId), "fixture must prove the vector existed first");

  const purged = await client.call("DELETE", `/v1/observations/${observation.body.data.observation_id}`, { key });
  assert.equal(purged.status, 200);
  const repeated = await client.call("DELETE", `/v1/observations/${observation.body.data.observation_id}`, { key });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.data.already_purged, true);
  const remove = vectors.store.remove.bind(vectors.store);
  let removalUnavailable = true;
  vectors.store.remove = async (ids) => {
    if (removalUnavailable) throw new Error("controlled vector removal outage");
    await remove(ids);
  };
  const failed = await client.call("POST", "/v1/index/drain?limit=100", { key });
  assert.equal(failed.status, 503);
  assert.deepEqual(await db.all(
    `SELECT embedder_failure_at IS NOT NULL AS embedder_failed,
            vector_store_failure_at IS NOT NULL AS vector_failed
       FROM semantic_index_metadata WHERE id = 'claims'`,
  ), [{ embedder_failed: 0, vector_failed: 1 }]);
  await db.batch([{
    sql: `UPDATE semantic_index_metadata SET embedder_failure_at = ?
           WHERE id = 'claims'`,
    params: ["2026-07-31T00:00:00.000Z"],
  }]);
  removalUnavailable = false;
  const removed = await client.call("POST", "/v1/index/drain?limit=100", { key });
  vectors.store.remove = remove;
  assert.equal(removed.status, 200);
  assert.ok(removed.body.data.removed >= 1);
  assert.equal(vectors.metadataFor(claimId), undefined);
  assert.deepEqual(await db.all(
    `SELECT embedder_failure_at, vector_store_failure_at
       FROM semantic_index_metadata WHERE id = 'claims'`,
  ), [{
    embedder_failure_at: "2026-07-31T00:00:00.000Z",
    vector_store_failure_at: null,
  }]);
  assert.equal((await client.call("GET", "/readyz")).status, 503);
  await db.batch([{
    sql: `UPDATE semantic_index_metadata SET embedder_failure_at = NULL
           WHERE id = 'claims'`,
  }]);
  assert.equal((await client.call("GET", "/readyz")).status, 200);
});

test("an unavailable embedder degrades to lexical retrieval instead of failing", async () => {
  const lexicalOnly = await withoutVectors().call("POST", "/v1/context/compile", {
    key,
    body: { subject_id: subjectId, task: TASK, max_tokens: 2000 },
  });

  const broken = fakeVectors();
  broken.breakEmbedder();
  const app = clientVia(
    createApp({ db, revision: "test", runtime: "bun-sqlite", vectors: broken }),
    origin,
  );
  const res = await app.call("POST", "/v1/context/compile", {
    key,
    body: { subject_id: subjectId, task: TASK, max_tokens: 2000 },
  });

  assert.equal(res.status, 200, "a vector outage must not fail the request");
  assert.equal(res.body.meta.degraded.vector, "error");
  assert.deepEqual(
    res.body.data.items.map((item: any) => item.claim_id),
    lexicalOnly.body.data.items.map((item: any) => item.claim_id),
    "the pack must match lexical-only retrieval",
  );
});

test("scoping still runs before retrieval when vectors are enabled", async () => {
  // The vector index is deliberately told every claim is a perfect match. Scope
  // is enforced in SQL before ranking, so a foreign reader must still see none.
  for (const id of claimIds) vectors.setScore(id, 1, vectorScope());

  const intruder = await provisionWith(db, { scopes: ["*"] });
  const res = await withVectors().call("POST", "/v1/context/compile", {
    key: intruder.key,
    body: { subject_id: subjectId, task: TASK, max_tokens: 2000 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.items.length, 0, "a vector hit cannot bypass scope");
  assert.equal(res.body.meta.candidates, 0);

  for (const id of claimIds) vectors.setScore(id, 0, vectorScope());
});
