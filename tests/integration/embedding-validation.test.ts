import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/core/app";
import { migrate } from "../../src/core/migrations";
import {
  validateEmbeddingResponse,
  type EmbeddingProvider,
  type VectorStore,
} from "../../src/core/vectors";
import { createHttpEmbedder } from "../../src/runtime/bun/vectors";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { createWorkersAiEmbedder } from "../../src/runtime/cloudflare/vectors";
import { clientVia, provisionWith } from "../contract/harness";

const dimensions = 4;
const dense = () => [1, 0, 0, 0];
const sparse = () => {
  const values = dense();
  delete values[1];
  return values;
};

const invalid = [
  ["null response", () => null, 1],
  ["missing data", () => ({}), 1],
  ["missing output", () => ({ data: [] }), 1],
  ["extra output", () => ({ data: [dense(), dense()] }), 1],
  ["sparse output list", () => ({ data: Array(1) }), 1],
  ["sparse vector", () => ({ data: [sparse()] }), 1],
  ["null coordinate", () => ({ data: [[1, null, 0, 0]] }), 1],
  ["string coordinate", () => ({ data: [[1, "0", 0, 0]] }), 1],
  ["NaN coordinate", () => ({ data: [[1, Number.NaN, 0, 0]] }), 1],
  ["infinite coordinate", () => ({ data: [[1, Number.POSITIVE_INFINITY, 0, 0]] }), 1],
  ["float32 overflow", () => ({ data: [[1, Number.MAX_VALUE, 0, 0]] }), 1],
  ["wrong dimensions", () => ({ data: [[1, 0]] }), 1],
  [
    "missing provider index",
    () => ({
      data: [
        { index: 0, embedding: dense() },
        { embedding: dense() },
      ],
    }),
    2,
  ],
  [
    "duplicate provider index",
    () => ({
      data: [
        { index: 0, embedding: dense() },
        { index: 0, embedding: dense() },
      ],
    }),
    2,
  ],
  [
    "non-contiguous provider index",
    () => ({
      data: [
        { index: 0, embedding: dense() },
        { index: 2, embedding: dense() },
      ],
    }),
    2,
  ],
  [
    "out-of-order provider indices",
    () => ({
      data: [
        { index: 1, embedding: dense() },
        { index: 0, embedding: dense() },
      ],
    }),
    2,
  ],
] as const;

for (const [name, response, expectedCount] of invalid)
  test(`shared embedding validator rejects ${name}`, () => {
    assert.throws(
      () => validateEmbeddingResponse(response(), expectedCount, dimensions),
      /^Error: Invalid embedding response\.$/,
    );
  });

test("shared embedding validator accepts both provider shapes in input order", () => {
  assert.deepEqual(
    validateEmbeddingResponse({ data: [dense(), dense()] }, 2, dimensions),
    [new Float32Array(dense()), new Float32Array(dense())],
  );
  assert.deepEqual(
    validateEmbeddingResponse(
      {
        data: [
          { index: 0, embedding: dense() },
          { index: 1, embedding: dense() },
        ],
      },
      2,
      dimensions,
    ),
    [new Float32Array(dense()), new Float32Array(dense())],
  );
});

const adapters: {
  name: string;
  create: (response: unknown) => {
    embedder: EmbeddingProvider;
    close: () => void | Promise<void>;
  };
}[] = [
  {
    name: "Bun HTTP",
    create(response) {
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => Response.json(response),
      });
      return {
        embedder: createHttpEmbedder({
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
          model: "malformed",
          dimensions,
        }),
        close: () => server.stop(true),
      };
    },
  },
  {
    name: "Cloudflare Workers AI",
    create: (response) => ({
      embedder: createWorkersAiEmbedder(
        { run: async () => response },
        "malformed",
        dimensions,
      ),
      close: () => {},
    }),
  },
];

for (const adapter of adapters)
  for (const [name, response, expectedCount] of invalid)
    test(`${adapter.name} rejects ${name}`, async () => {
      const { embedder, close } = adapter.create(response());
      try {
        await assert.rejects(
          () =>
            embedder.embed(
              Array.from({ length: expectedCount }, () => "input"),
            ),
          /^Error: Invalid embedding response\.$/,
        );
      } finally {
        await close();
      }
    });

for (const adapter of adapters)
  test(`${adapter.name} malformed output stays retryable and degrades to FTS`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "titen-embed-validation-"));
    const handle = openDatabase(join(directory, "titen.db"));
    const db = createSqliteDb(handle);
    const { embedder, close } = adapter.create({ data: [] });
    let vectorWrites = 0;
    let vectorQueries = 0;
    const store: VectorStore = {
      async upsert() {
        vectorWrites += 1;
      },
      async query() {
        vectorQueries += 1;
        return [];
      },
      async remove() {},
    };

    try {
      await migrate(db);
      const provisioned = await provisionWith(db, { scopes: ["*"] });
      const client = clientVia(
        createApp({
          db,
          revision: "embedding-validation",
          runtime: adapter.name,
          vectors: {
            store,
            embedder,
            fingerprint: {
              provider: "test",
              model: embedder.model,
              revision: "test",
              dimensions,
              metric: "cosine",
              preprocessing: "none",
              index_schema: "claims-v1",
            },
          },
        }),
        "http://titen.test",
      );
      const subjectId = `subject_${adapter.name.replaceAll(" ", "_").toLowerCase()}`;
      const statement = "Malformed embedding output must preserve lexical recall.";
      const observation = await client.call("POST", "/v1/observations", {
        key: provisioned.key,
        body: {
          subject_id: subjectId,
          kind: "tool_result",
          content: statement,
          source: { type: "tool", ref: "embedding-validation" },
          trust: "verified",
        },
      });
      assert.equal(observation.status, 201);
      const consolidation = await client.call("POST", "/v1/consolidations", {
        key: provisioned.key,
        body: {
          subject_id: subjectId,
          claims: [
            {
              kind: "procedural",
              statement,
              sources: [
                {
                  observation_id: observation.body.data.observation_id,
                  relation: "supports",
                },
              ],
            },
          ],
        },
      });
      assert.equal(consolidation.status, 201);
      const claimId = consolidation.body.data.claims[0].claim_id as string;
      const pending = async () =>
        Number(
          (
            await db.all<{ count: number }>(
              `SELECT COUNT(*) AS count FROM index_outbox WHERE state = 'pending'`,
            )
          )[0]!.count,
        );
      const before = await pending();

      const failed = await client.call("POST", "/v1/index/drain", {
        key: provisioned.key,
      });
      assert.equal(failed.status, 503);
      assert.equal(failed.body.error.code, "UNAVAILABLE");
      assert.equal(failed.body.error.message, "Indexing dependency is unavailable.");
      assert.equal(failed.body.meta.dependency, "embedder");
      assert.equal(failed.body.meta.retryable, true);
      assert.equal(failed.body.meta.pending, before);
      assert.doesNotMatch(JSON.stringify(failed.body), /Invalid embedding response/);
      assert.equal(await pending(), before);
      assert.equal(vectorWrites, 0);

      const compiled = await client.call("POST", "/v1/context/compile", {
        key: provisioned.key,
        body: { subject_id: subjectId, task: statement, max_tokens: 900 },
      });
      assert.equal(compiled.status, 200);
      assert.equal(compiled.body.meta.degraded.vector, "error");
      assert.ok(
        compiled.body.data.items.some((item: { claim_id: string }) => item.claim_id === claimId),
      );
      assert.equal(vectorQueries, 0);
      assert.equal(vectorWrites, 0);
    } finally {
      await close();
      handle.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
