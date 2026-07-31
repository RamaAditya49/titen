import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/core/app";
import { runMaintenance } from "../../src/core/maintenance";
import { migrate } from "../../src/core/migrations";
import {
  eligibleVectorMatches,
  embedForRetrieval,
  embeddingInput,
  embeddingPolicyFingerprint,
  embeddingProfileMatchesModel,
  parseEmbeddingPolicy,
  validateEmbeddingResponse,
  validateEmbeddingVectors,
  type EmbeddingProvider,
  type VectorCapability,
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

test("embedding policies are canonical, role-aware, and model-specific", () => {
  const fingerprint = embeddingPolicyFingerprint(
    "embeddinggemma-retrieval-v1",
    0.737307171,
  );
  assert.equal(
    fingerprint,
    "embeddinggemma-retrieval-v1;min_cosine=0.737307171",
  );
  assert.deepEqual(parseEmbeddingPolicy(fingerprint), {
    profile: "embeddinggemma-retrieval-v1",
    minimumCosine: 0.737307171,
  });
  assert.equal(
    embeddingInput("embeddinggemma-retrieval-v1", "query", "release gate"),
    "task: search result | query: release gate",
  );
  assert.equal(
    embeddingInput("embeddinggemma-retrieval-v1", "document", "release gate"),
    "title: none | text: release gate",
  );
  assert.equal(embeddingInput("raw-unit-v1", "query", "release gate"), "release gate");
  assert.deepEqual(
    parseEmbeddingPolicy(embeddingPolicyFingerprint("raw-unit-v1", 0)),
    { profile: "raw-unit-v1", minimumCosine: 0 },
  );
  assert.equal(
    embeddingProfileMatchesModel(
      "embeddinggemma-retrieval-v1",
      "google/embedding-gemma-300m",
    ),
    true,
  );
  assert.equal(
    embeddingProfileMatchesModel("raw-unit-v1", "tuf/embeddinggemma"),
    false,
  );
  assert.equal(parseEmbeddingPolicy("raw-unit-v1;min_cosine=0.10"), undefined);
});

test("both runtime adapters receive identical role prompts and return unit vectors", async () => {
  const seen: string[][] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request: Request) {
      const body = await request.json() as { input: string[] };
      seen.push(body.input);
      return Response.json({
        data: body.input.map(() => ({ embedding: [3, 4, 0, 0] })),
      });
    },
  });
  const providers = [
    createHttpEmbedder({
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      model: "tuf/embeddinggemma",
      dimensions,
    }),
    createWorkersAiEmbedder(
      {
        async run(_model, input) {
          seen.push(input.text);
          return { data: input.text.map(() => [3, 4, 0, 0]) };
        },
      },
      "tuf/embeddinggemma",
      dimensions,
    ),
  ];
  const store: VectorStore = {
    async upsert() {},
    async query() { return []; },
    async remove() {},
  };

  try {
    for (const embedder of providers) {
      const capability: VectorCapability = {
        store,
        embedder,
        fingerprint: {
          provider: "test",
          model: embedder.model,
          revision: "immutable-test-revision",
          dimensions,
          metric: "cosine",
          preprocessing: embeddingPolicyFingerprint(
            "embeddinggemma-retrieval-v1",
            0.7,
          ),
          index_schema: "claims-scope-v1",
        },
      };
      const [query] = await embedForRetrieval(capability, "query", ["release gate"]);
      const [document] = await embedForRetrieval(capability, "document", ["release gate"]);
      assert.deepEqual([...query!], [0.6000000238418579, 0.800000011920929, 0, 0]);
      assert.deepEqual([...document!], [...query!]);
    }
    assert.deepEqual(seen, [
      ["task: search result | query: release gate"],
      ["title: none | text: release gate"],
      ["task: search result | query: release gate"],
      ["title: none | text: release gate"],
    ]);
  } finally {
    server.stop(true);
  }
});

test("shared retrieval boundary rejects zero vectors and invalid vector matches", async () => {
  const capability: VectorCapability = {
    store: {
      async upsert() {},
      async query() { return []; },
      async remove() {},
    },
    embedder: {
      dimensions: 2,
      model: "test-model",
      async embed() { return [new Float32Array([0, 0])]; },
    },
    fingerprint: {
      provider: "test",
      model: "test-model",
      revision: "immutable-test-revision",
      dimensions: 2,
      metric: "cosine",
      preprocessing: embeddingPolicyFingerprint("raw-unit-v1", 0.5),
      index_schema: "claims-scope-v1",
    },
  };
  await assert.rejects(
    () => embedForRetrieval(capability, "query", ["query"]),
    /^Error: Invalid embedding response\.$/,
  );
  assert.deepEqual(
    eligibleVectorMatches(
      [
        { id: "below", score: 0.499 },
        { id: "equal", score: 0.5 },
        { id: "above", score: 1 },
      ],
      0.5,
    ),
    [
      { id: "equal", score: 0.5 },
      { id: "above", score: 1 },
    ],
  );
  for (const matches of [
    [{ id: "duplicate", score: 0.9 }, { id: "duplicate", score: 0.8 }],
    [{ id: "outside-cosine", score: 1.01 }],
    [{ id: "not-finite", score: Number.NaN }],
  ])
    assert.throws(
      () => eligibleVectorMatches(matches, 0.5),
      /^Error: Invalid vector response\.$/,
    );
  assert.throws(
    () => eligibleVectorMatches([], -1.01),
    /^Error: Invalid vector response\.$/,
  );
});

const invalidNormalized = [
  ["missing output", () => []],
  ["extra output", () => [new Float32Array(dense()), new Float32Array(dense())]],
  ["sparse output list", () => Array(1)],
  ["plain numeric array", () => [dense()]],
  ["wrong dimensions", () => [new Float32Array(2)]],
  ["NaN coordinate", () => [new Float32Array([1, Number.NaN, 0, 0])]],
  ["infinite coordinate", () => [new Float32Array([1, Number.POSITIVE_INFINITY, 0, 0])]],
] as const;

for (const [name, response] of invalidNormalized)
  test(`normalized embedding boundary rejects ${name}`, () => {
    assert.throws(
      () => validateEmbeddingVectors(response(), 1, dimensions),
      /^Error: Invalid embedding response\.$/,
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

const consumers: typeof adapters = [
  ...adapters,
  {
    name: "Injected provider",
    create: () => ({
      embedder: {
        dimensions,
        model: "malformed",
        async embed(): Promise<Float32Array[]> {
          return [];
        },
      },
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

for (const adapter of consumers)
  test(`${adapter.name} malformed output stays retryable and degrades to FTS`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "titen-embed-validation-"));
    const handle = openDatabase(join(directory, "titen.db"));
    const db = createSqliteDb(handle);
    const { embedder, close } = adapter.create({ data: [] });
    let providerRecovered = false;
    const recoverableEmbedder: EmbeddingProvider = {
      dimensions: embedder.dimensions,
      model: embedder.model,
      embed: (texts) =>
        providerRecovered
          ? Promise.resolve(texts.map(() => new Float32Array(dense())))
          : embedder.embed(texts),
    };
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
      const vectors = {
        store,
        embedder: recoverableEmbedder,
        fingerprint: {
          provider: "test",
          model: recoverableEmbedder.model,
          revision: "test",
          dimensions,
          metric: "cosine",
          preprocessing: embeddingPolicyFingerprint("raw-unit-v1", 0.1),
          index_schema: "claims-v1",
        },
      };
      const client = clientVia(
        createApp({
          db,
          revision: "embedding-validation",
          runtime: adapter.name,
          vectors,
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

      const background = await runMaintenance({
        db,
        vectors,
        limit: 50,
        now: new Date("2026-07-31T00:00:00.000Z"),
        deliverWebhooks: false,
      });
      assert.equal(background.indexed, 0);
      assert.deepEqual(background.errors, [`index:${provisioned.orgId.slice(0, 12)}`]);
      assert.equal(await pending(), before);
      assert.equal(vectorWrites, 0);
      const notReady = await client.call("GET", "/readyz");
      assert.equal(notReady.status, 503);
      assert.equal(notReady.body.meta.capabilities.embedding, "configured_error");
      assert.equal(notReady.body.meta.checks.semantic_index, "embedding_dependency_unavailable");

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

      providerRecovered = true;
      const recovered = await runMaintenance({
        db,
        vectors,
        limit: 50,
        now: new Date("2026-07-31T00:01:00.000Z"),
        deliverWebhooks: false,
      });
      assert.ok(recovered.indexed > 0);
      assert.deepEqual(recovered.errors, []);
      assert.equal((await client.call("GET", "/readyz")).status, 200);
    } finally {
      await close();
      handle.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
