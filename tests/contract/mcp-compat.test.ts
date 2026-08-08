import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseReferenceGraph, type ReferenceGraph } from "../../src/core/portability";
import {
  importReferenceMemory,
  openLocalStore,
  referenceMemoryCandidates,
} from "../../src/runtime/bun/mcp-stdio";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { provisionWith } from "./harness";

/**
 * Drop-in substitution for `@modelcontextprotocol/server-memory`.
 *
 * The claim being tested is that a user switches by editing one line of MCP
 * configuration: the same nine tool names, the same arguments, the same
 * response shapes, and their existing `memory.json` still there afterwards.
 * So every assertion here is written from the client's side of the wire, and
 * the fixture is that server's own on-disk format rather than a Titen export.
 */
const directory = mkdtempSync(join(tmpdir(), "titen-mcp-compat-"));
const memoryFile = join(directory, "memory.json");
const dbPath = join(directory, "memory.db");

/** Exactly what the reference server writes: one JSON object per line. */
const FIXTURE_LINES = [
  {
    type: "entity",
    name: "billing-service",
    entityType: "service",
    observations: [
      "Handles refund processing and invoice generation for enterprise customers",
      "Owned by the payments team",
    ],
  },
  {
    type: "entity",
    name: "Ada Lovelace",
    entityType: "person",
    observations: ["Leads the payments team", "Prefers asynchronous design reviews"],
  },
  {
    type: "entity",
    name: "checkout-api",
    entityType: "service",
    observations: ["Calls billing-service when an order is cancelled"],
  },
  { type: "entity", name: "quiet-worker", entityType: "service", observations: [] },
  { type: "relation", from: "Ada Lovelace", to: "billing-service", relationType: "maintains" },
  { type: "relation", from: "checkout-api", to: "billing-service", relationType: "depends_on" },
];

const FIXTURE: ReferenceGraph = parseReferenceGraph(
  FIXTURE_LINES.map((line) => JSON.stringify(line)).join("\n"),
);

/**
 * The reference server's entire search: lower-case substring containment over a
 * graph re-read from disk. Reimplemented here so the comparison in the search
 * test is against the real thing rather than against a description of it.
 */
function referenceSearch(graph: ReferenceGraph, query: string): ReferenceGraph {
  const entities = graph.entities.filter((entity) =>
    entity.name.toLowerCase().includes(query.toLowerCase())
    || entity.entityType.toLowerCase().includes(query.toLowerCase())
    || entity.observations.some((observation) =>
      observation.toLowerCase().includes(query.toLowerCase())));
  const names = new Set(entities.map((entity) => entity.name));
  return {
    entities,
    relations: graph.relations.filter((relation) =>
      names.has(relation.from) || names.has(relation.to)),
  };
}

let local: Awaited<ReturnType<typeof openLocalStore>>;
let restrictedKey: string;
let messageId = 0;

interface ToolReply {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent: any;
}

async function rpc(method: string, params: unknown, key?: string) {
  const response = await local.app(new Request("http://127.0.0.1/mcp", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${key ?? local.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: (messageId += 1), method, params }),
  }));
  return await response.json() as { result?: any; error?: { code: number; message: string } };
}

async function callTool(name: string, args: unknown = {}, key?: string): Promise<ToolReply> {
  const reply = await rpc("tools/call", { name, arguments: args }, key);
  assert.equal(reply.error, undefined, `${name} returned a JSON-RPC error`);
  return reply.result as ToolReply;
}

/** Every reference tool reports its result twice; a client may read either. */
function toolResult(reply: ToolReply): any {
  assert.equal(reply.content[0]!.type, "text");
  return JSON.parse(reply.content[0]!.text);
}

const readGraph = async (): Promise<ReferenceGraph> =>
  (await callTool("read_graph")).structuredContent;

beforeAll(async () => {
  writeFileSync(memoryFile, `${FIXTURE_LINES.map((line) => JSON.stringify(line)).join("\n")}\n`);
  local = await openLocalStore(dbPath);
  const database = createSqliteDb(openDatabase(dbPath));
  const [organization] = await database.all<{ id: string }>(`SELECT id FROM organizations`);
  const provisioned = await provisionWith(database, {
    orgId: organization!.id,
    scopes: ["mcp:call"],
  });
  restrictedKey = provisioned.key;
});

afterAll(() => {
  local.close();
  rmSync(directory, { recursive: true, force: true });
});

test("the search covers where the reference server actually writes", () => {
  const previous = process.env.MEMORY_FILE_PATH;
  delete process.env.MEMORY_FILE_PATH;
  try {
    const candidates = referenceMemoryCandidates("/work");
    const pkg = "node_modules/@modelcontextprotocol/server-memory/dist";

    // The cwd is a guess — an MCP server launched by a desktop client inherits
    // the client's directory — so it must not be the only place we look.
    assert.ok(candidates.includes("/work/memory.jsonl"));
    assert.ok(candidates.includes("/work/memory.json"));

    // Where the reference server writes with MEMORY_FILE_PATH unset: beside its
    // own module. Missing this is what made a switch import zero and say nothing.
    assert.ok(candidates.includes(`/work/${pkg}/memory.jsonl`));
    assert.ok(candidates.includes(`/work/${pkg}/memory.json`));

    // Explicit configuration still wins outright, relative or absolute.
    process.env.MEMORY_FILE_PATH = "graph.jsonl";
    assert.deepEqual(referenceMemoryCandidates("/work"), ["/work/graph.jsonl"]);
    process.env.MEMORY_FILE_PATH = "/elsewhere/graph.jsonl";
    assert.deepEqual(referenceMemoryCandidates("/work"), ["/elsewhere/graph.jsonl"]);
  } finally {
    if (previous === undefined) delete process.env.MEMORY_FILE_PATH;
    else process.env.MEMORY_FILE_PATH = previous;
  }
});

test("an existing memory.json is imported without data loss", async () => {
  const imported = await importReferenceMemory(local, memoryFile, `${dbPath}.imported`);
  assert.deepEqual(imported, { entities: 4, relations: 2 });

  // Byte-for-byte the same graph: names, types, observation text and order.
  assert.deepEqual(await readGraph(), FIXTURE);

  // A second start must not re-import: that would resurrect deleted entities.
  assert.equal(
    await importReferenceMemory(local, memoryFile, `${dbPath}.imported`),
    undefined,
  );
  assert.deepEqual(await readGraph(), FIXTURE);
});

test("the installed entry point adopts a memory.json in the working directory", async () => {
  const home = join(directory, "adopt-home");
  const work = join(directory, "adopt-work");
  mkdirSync(home);
  mkdirSync(work);
  writeFileSync(join(work, "memory.json"), [
    JSON.stringify({
      type: "entity",
      name: "billing-service",
      entityType: "service",
      observations: ["Handles refunds"],
    }),
    JSON.stringify({ type: "relation", from: "checkout-api", to: "billing-service", relationType: "depends_on" }),
  ].join("\n"));

  const child = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "../../src/runtime/bun/cli.ts"), "mcp"],
    cwd: work,
    // Deliberately not `...process.env`: this is the no-configuration case.
    env: { PATH: process.env.PATH ?? "", HOME: home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "compat", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_graph", arguments: {} } },
  ].map((message) => `${JSON.stringify(message)}\n`).join(""));
  child.stdin.end();
  const [exitCode, stdout, stderr] = await Promise.all([
    Promise.race([child.exited, Bun.sleep(30_000).then(() => -1)]),
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  assert.equal(exitCode, 0, stderr);
  // Progress belongs on stderr; stdout is the MCP transport and must stay JSON.
  assert.match(stderr, /imported 1 entities and 1 relations/);
  const replies = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(replies.at(-1).result.structuredContent, {
    entities: [{ name: "billing-service", entityType: "service", observations: ["Handles refunds"] }],
    relations: [{ from: "checkout-api", to: "billing-service", relationType: "depends_on" }],
  });
}, 60_000);

test("the graph is readable as a resource, the way the reference server serves it", async () => {
  // A client that reads memory://knowledge-graph instead of calling read_graph
  // used to get -32601 on the switch, which is a broken drop-in however well
  // the tool names line up.
  const listed = (await rpc("resources/list", {})).result.resources as {
    uri: string;
    mimeType: string;
  }[];
  const graphResource = listed.find((r) => r.uri === "memory://knowledge-graph");
  assert.ok(graphResource, "memory://knowledge-graph must be listed");
  assert.equal(graphResource.mimeType, "application/json");

  const read = (await rpc("resources/read", { uri: "memory://knowledge-graph" })).result;
  const contents = read.contents as { uri: string; mimeType: string; text: string }[];
  assert.equal(contents.length, 1);
  assert.equal(contents[0]!.uri, "memory://knowledge-graph");

  // Same bytes the read_graph tool returns, so the two paths cannot drift.
  assert.deepEqual(JSON.parse(contents[0]!.text), await readGraph());

  const unknown = await rpc("resources/read", { uri: "memory://nope" });
  assert.equal(unknown.error.code, -32602, "an unknown uri is a params error, not a 404");
});

test("the nine reference tool names are served with the reference schemas", async () => {
  const listed = (await rpc("tools/list", {})).result.tools as {
    name: string;
    inputSchema: { properties: Record<string, unknown>; required: string[] };
    annotations: Record<string, boolean>;
  }[];
  const byName = new Map(listed.map((tool) => [tool.name, tool]));

  const expected: Record<string, string[]> = {
    create_entities: ["entities"],
    create_relations: ["relations"],
    add_observations: ["observations"],
    delete_entities: ["entityNames"],
    delete_observations: ["deletions"],
    delete_relations: ["relations"],
    read_graph: [],
    search_nodes: ["query"],
    open_nodes: ["names"],
  };
  for (const [name, required] of Object.entries(expected)) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} must be served`);
    assert.deepEqual(tool.inputSchema.required, required, `${name} argument names`);
    assert.deepEqual(Object.keys(tool.inputSchema.properties), required, `${name} properties`);
  }
  assert.equal(byName.get("search_nodes")!.annotations.readOnlyHint, true);
  assert.equal(byName.get("delete_entities")!.annotations.destructiveHint, true);
  // The Titen tools stay where they were; this is an addition, not a swap.
  assert.ok(byName.has("titen_remember"));
});

test("search_nodes finds what the reference server's substring scan cannot", async () => {
  const query = "which service issues refunds to a customer";

  // The incumbent lower-cases the whole query and asks `String.includes`, so a
  // question phrased as a question matches nothing at all.
  assert.deepEqual(referenceSearch(FIXTURE, query).entities, []);

  const found: ReferenceGraph = (await callTool("search_nodes", { query })).structuredContent;
  assert.equal(
    found.entities[0]?.name,
    "billing-service",
    "ranked retrieval must surface the refund-handling service first",
  );
  assert.deepEqual(
    found.entities[0]!.observations,
    FIXTURE.entities[0]!.observations,
    "a hit carries the whole entity, as the reference shape requires",
  );
  // Relations reach outside the matched set, exactly as the reference does.
  assert.ok(found.relations.some((relation) => relation.to === "billing-service"));

  // An unrelated question must not drag the whole graph back.
  const unrelated: ReferenceGraph =
    (await callTool("search_nodes", { query: "kubernetes cluster autoscaling" })).structuredContent;
  assert.deepEqual(unrelated.entities, []);
});

test("create, add, and open behave as the reference server documents them", async () => {
  const created = await callTool("create_entities", {
    entities: [
      { name: "payments-team", entityType: "team", observations: ["Owns billing-service"] },
      { name: "billing-service", entityType: "service", observations: ["ignored duplicate"] },
    ],
  });
  assert.deepEqual(created.structuredContent.entities.map((entity: any) => entity.name), [
    "payments-team",
  ], "an existing name is skipped and never returned");
  assert.deepEqual(toolResult(created), created.structuredContent.entities);

  const relations = await callTool("create_relations", {
    relations: [
      { from: "payments-team", to: "billing-service", relationType: "owns" },
      { from: "Ada Lovelace", to: "billing-service", relationType: "maintains" },
    ],
  });
  assert.deepEqual(relations.structuredContent.relations, [
    { from: "payments-team", to: "billing-service", relationType: "owns" },
  ], "an existing triple is skipped");

  const added = await callTool("add_observations", {
    observations: [{
      entityName: "billing-service",
      contents: ["Owned by the payments team", "Runs on the shared Bun runtime"],
    }],
  });
  assert.deepEqual(added.structuredContent, {
    results: [{
      entityName: "billing-service",
      addedObservations: ["Runs on the shared Bun runtime"],
    }],
  }, "an observation already present is not added twice");

  const missing = await callTool("add_observations", {
    observations: [{ entityName: "no-such-entity", contents: ["x"] }],
  });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0]!.text, /Entity with name no-such-entity not found/);

  const opened: ReferenceGraph =
    (await callTool("open_nodes", { names: ["payments-team", "no-such-entity"] })).structuredContent;
  assert.deepEqual(opened.entities.map((entity) => entity.name), ["payments-team"]);
  assert.deepEqual(opened.relations, [
    { from: "payments-team", to: "billing-service", relationType: "owns" },
  ]);
});

test("deleting requires the purge capability and then really removes the record", async () => {
  const seeded = await callTool("create_entities", {
    entities: [{ name: "temp-entity", entityType: "service", observations: ["short lived"] }],
  }, restrictedKey);
  assert.notEqual(seeded.isError, true, "writing needs no new capability");

  const refused = await callTool("delete_entities", { entityNames: ["temp-entity"] }, restrictedKey);
  assert.equal(refused.isError, true, "purge must fail closed without its scope");
  assert.match(refused.content[0]!.text, /observations:purge/);

  // The restricted principal's own graph is untouched by the refusal.
  const stillThere = (await callTool("read_graph", {}, restrictedKey)).structuredContent;
  assert.deepEqual(stillThere.entities.map((entity: any) => entity.name), ["temp-entity"]);

  const deleted = await callTool("delete_observations", {
    deletions: [{ entityName: "billing-service", observations: ["Runs on the shared Bun runtime"] }],
  });
  assert.deepEqual(deleted.structuredContent, {
    success: true,
    message: "Observations deleted successfully",
  });
  assert.equal(deleted.content[0]!.text, "Observations deleted successfully");

  await callTool("delete_relations", {
    relations: [{ from: "checkout-api", to: "billing-service", relationType: "depends_on" }],
  });
  const afterRelation = await readGraph();
  assert.ok(!afterRelation.relations.some((relation) => relation.relationType === "depends_on"));

  const removed = await callTool("delete_entities", { entityNames: ["checkout-api"] });
  assert.deepEqual(removed.structuredContent, {
    success: true,
    message: "Entities deleted successfully",
  });
  const graph = await readGraph();
  assert.ok(!graph.entities.some((entity) => entity.name === "checkout-api"));
  assert.deepEqual(
    graph.entities.find((entity) => entity.name === "billing-service")!.observations,
    [
      "Handles refund processing and invoice generation for enterprise customers",
      "Owned by the payments team",
    ],
    "only the deleted observation is gone",
  );

  // Purged evidence must also leave retrieval, not just the graph read.
  const found: ReferenceGraph =
    (await callTool("search_nodes", { query: "order cancelled calls" })).structuredContent;
  assert.ok(!found.entities.some((entity) => entity.name === "checkout-api"));

  // A deleted name is free again: the row is gone, not merely hidden.
  const recreated = await callTool("create_entities", {
    entities: [{ name: "checkout-api", entityType: "service", observations: ["rebuilt"] }],
  });
  assert.deepEqual(recreated.structuredContent.entities.map((entity: any) => entity.name), [
    "checkout-api",
  ]);
});
