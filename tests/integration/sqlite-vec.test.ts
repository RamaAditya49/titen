import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/core/app";
import { migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { createSqliteVecStore, createHttpEmbedder } from "../../src/runtime/bun/vectors";
import { clientVia, provisionWith } from "../contract/harness";

/**
 * The real sqlite-vec store, not a stub.
 *
 * The contract-level vector test uses an in-memory fake to exercise the shared
 * core's hybrid branch. This one loads the actual extension and runs real
 * nearest-neighbour search, so a change that breaks the native binding, the
 * vector encoding, or the distance-to-score conversion fails here.
 *
 * Skips itself when the platform has no prebuilt extension, which is the same
 * condition under which the service degrades to FTS.
 */
const directory = mkdtempSync(join(tmpdir(), "titen-realvec-"));
const DIMENSIONS = 4;

const store = createSqliteVecStore(join(directory, "vec.db"), DIMENSIONS);
const available = store !== null;

/** Deterministic stand-in for a model: distinct unit vectors per axis. */
const axis = (index: number) => {
  const vector = new Float32Array(DIMENSIONS);
  vector[index % DIMENSIONS] = 1;
  return vector;
};

const metadata = (org_id: string, subject_id = "subject", project_id = "") => ({
  org_id,
  subject_id,
  project_id,
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

test("the prebuilt extension is present on this platform", () => {
  assert.equal(
    available,
    true,
    "sqlite-vec did not load; vector retrieval would degrade to FTS here",
  );
});

test("nearest-neighbour search returns the closest vector first", async () => {
  if (!available) return;
  await store!.upsert([
    { id: "claim_a", vector: axis(0), metadata: metadata("org") },
    { id: "claim_b", vector: axis(1), metadata: metadata("org") },
    { id: "claim_c", vector: axis(2), metadata: metadata("org") },
  ]);

  const hits = await store!.query(axis(1), { topK: 3 });
  assert.equal(hits.length, 3);
  assert.equal(hits[0]!.id, "claim_b", "the exact match must rank first");
  assert.equal(hits[0]!.score, 1, "an exact match scores 1 at distance 0");
  assert.ok(
    hits[1]!.score < hits[0]!.score,
    "score must decrease as distance grows",
  );
});

test("an upsert replaces a vector rather than duplicating its id", async () => {
  if (!available) return;
  await store!.upsert([
    { id: "claim_move", vector: axis(0), metadata: metadata("org") },
  ]);
  const before = await store!.query(axis(0), { topK: 5 });
  const beforeCount = before.filter((h) => h.id === "claim_move").length;
  assert.equal(beforeCount, 1);

  // Same id, different direction: it must move, not appear twice.
  await store!.upsert([
    { id: "claim_move", vector: axis(3), metadata: metadata("org") },
  ]);
  const near = await store!.query(axis(3), { topK: 5 });
  assert.equal(near.filter((h) => h.id === "claim_move").length, 1, "no duplicate id");
  assert.equal(near[0]!.id, "claim_move", "it must now be nearest to its new direction");
});

test("removal takes a vector out of results", async () => {
  if (!available) return;
  await store!.upsert([
    { id: "claim_gone", vector: axis(2), metadata: metadata("org") },
  ]);
  assert.ok((await store!.query(axis(2), { topK: 5 })).some((h) => h.id === "claim_gone"));
  await store!.remove(["claim_gone"]);
  assert.ok(
    !(await store!.query(axis(2), { topK: 5 })).some((h) => h.id === "claim_gone"),
    "a removed vector must not be returned",
  );
});

test("scope metadata filters before the nearest-neighbour limit", async () => {
  if (!available) return;
  const foreign = Array.from({ length: 24 }, (_, index) => ({
    id: `foreign_${index}`,
    vector: axis(0),
    metadata: metadata("foreign", "same-subject"),
  }));
  await store!.upsert([
    ...foreign,
    {
      id: "authorized",
      vector: new Float32Array([0.9, 0.1, 0, 0]),
      metadata: metadata("authorized", "same-subject"),
    },
  ]);

  const hits = await store!.query(axis(0), {
    topK: 1,
    filter: { org_id: "authorized", subject_id: "same-subject" },
  });
  assert.deepEqual(hits.map((hit) => hit.id), ["authorized"]);
});

test("vectors live outside the canonical database", () => {
  if (!available) return;
  assert.ok(
    existsSync(join(directory, "vec.db")),
    "the index must be its own file so it stays rebuildable",
  );
});

test("an embedder whose dimensions disagree fails loudly", async () => {
  // A silent mismatch degrades retrieval quality invisibly, which is worse than
  // an error, so the provider checks what the endpoint actually returned.
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () =>
      new Response(JSON.stringify({ data: [{ embedding: [1, 0] }] }), {
        headers: { "content-type": "application/json" },
      }),
  });
  const embedder = createHttpEmbedder({
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    model: "stub",
    dimensions: DIMENSIONS,
  });
  await assert.rejects(
    () => embedder.embed(["anything"]),
    /dimension mismatch: expected 4, got 2/,
  );
  server.stop(true);
});

test("the real store drives compilation through the shared core", async () => {
  if (!available) return;
  const dbPath = join(directory, "titen.db");
  const handle = openDatabase(dbPath);
  const db = createSqliteDb(handle);
  await migrate(db);
  const provisioned = await provisionWith(db, { scopes: ["*"] });

  // A local embedding endpoint, so no network or model is required.
  const embeddings = new Map<string, Float32Array>();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request: Request) {
      const { input } = (await request.json()) as { input: string[] };
      return Response.json({
        data: input.map((text) => ({
          embedding: [...(embeddings.get(text) ?? axis(0))],
        })),
      });
    },
  });

  const capability = {
    store: store!,
    embedder: createHttpEmbedder({
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      model: "stub",
      dimensions: DIMENSIONS,
    }),
  };
  const client = clientVia(
    createApp({ db, revision: "realvec", runtime: "bun-sqlite", vectors: capability }),
    "http://titen.test",
  );

  const ready = await client.call("GET", "/readyz");
  assert.equal(ready.body.data.capabilities.vector, "enabled");

  const observation = await client.call("POST", "/v1/observations", {
    key: provisioned.key,
    body: {
      subject_id: "user_realvec",
      kind: "tool_result",
      content: "Rollback rehearsal evidence for the release gate.",
      source: { type: "tool", ref: "realvec#1" },
      trust: "verified",
    },
  });
  assert.equal(observation.status, 201);

  const consolidated = await client.call("POST", "/v1/consolidations", {
    key: provisioned.key,
    body: {
      subject_id: "user_realvec",
      claims: [
        {
          kind: "procedural",
          statement: "Release requires a rollback rehearsal.",
          sources: [
            { observation_id: observation.body.data.observation_id, relation: "supports" },
          ],
        },
      ],
    },
  });
  assert.equal(consolidated.status, 201);
  const claimId = consolidated.body.data.claims[0].claim_id as string;

  // Index the claim, and point the query at the same direction.
  const task = "release rollback rehearsal";
  embeddings.set(task, axis(1));
  await store!.upsert([
    {
      id: claimId,
      vector: axis(1),
      metadata: metadata(provisioned.orgId, "user_realvec"),
    },
  ]);

  const compiled = await client.call("POST", "/v1/context/compile", {
    key: provisioned.key,
    body: { subject_id: "user_realvec", task, max_tokens: 900 },
  });
  assert.equal(compiled.status, 200);
  assert.equal(compiled.body.meta.degraded.vector, "used");
  const item = compiled.body.data.items.find((i: any) => i.claim_id === claimId);
  assert.ok(item, "the indexed claim must be compiled");
  assert.equal(
    item.score_components.relevance,
    1,
    "an exact vector match must reach full relevance",
  );

  server.stop(true);
  handle.close();
});
