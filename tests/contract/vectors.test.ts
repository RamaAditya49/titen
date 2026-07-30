import { afterAll, beforeAll, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/core/app";
import { migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
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
let subjectId: string;

/** Three claims that all match the query lexically, so only ranking separates them. */
const CLAIMS = [
  "Rollback smoke gates every production release without exception.",
  "Release safety depends on a verified rollback rehearsal.",
  "Rollback ownership for a release sits with the on-call engineer.",
];
const TASK = "rollback release safety";

let claimIds: string[] = [];

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
  subjectId = "user_vectors";
  await seed(withoutVectors());
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
  vectors.setScore(weakest, 1);

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
  vectors.setScore(weakest, 0);
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
});

test("confidence is an explicit weighted and auditable ranking factor", () => {
  assert.equal(Object.values(RANK_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 1);
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

  broken.restoreEmbedder();
  const recovered = await app.call("POST", "/v1/index/drain", { key });
  assert.equal(recovered.status, 200);
  assert.ok(recovered.body.data.indexed > 0);
  assert.ok((await pendingCount()) < before);
});

test("index drain reports vector-store outages as retryable and preserves pending rows", async () => {
  await seed(withoutVectors());
  const broken = fakeVectors();
  broken.breakStore();
  const app = clientVia(createApp({ db, revision: "test", runtime: "bun-sqlite", vectors: broken }), origin);
  const before = await pendingCount();
  const failed = await app.call("POST", "/v1/index/drain", { key });
  assert.equal(failed.status, 503);
  assert.equal(failed.body.error.code, "UNAVAILABLE");
  assert.equal(failed.body.meta.dependency, "vector_store");
  assert.equal(failed.body.meta.retryable, true);
  assert.equal(failed.body.meta.pending, before);
  assert.equal(await pendingCount(), before);

  broken.restoreStore();
  const recovered = await app.call("POST", "/v1/index/drain", { key });
  assert.equal(recovered.status, 200);
  assert.ok(recovered.body.data.indexed > 0);
  assert.ok((await pendingCount()) < before);
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
  for (const id of claimIds) vectors.setScore(id, 1);

  const intruder = await provisionWith(db, { scopes: ["*"] });
  const res = await withVectors().call("POST", "/v1/context/compile", {
    key: intruder.key,
    body: { subject_id: subjectId, task: TASK, max_tokens: 2000 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.items.length, 0, "a vector hit cannot bypass scope");
  assert.equal(res.body.meta.candidates, 0);

  for (const id of claimIds) vectors.setScore(id, 0);
});
