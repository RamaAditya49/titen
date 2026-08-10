import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocalStore } from "../../src/runtime/bun/mcp-stdio";
import { serve } from "../../src/runtime/bun/server";
import { openDatabase } from "../../src/runtime/bun/sqlite";

const root = mkdtempSync(join(tmpdir(), "titen-local-mode-"));
const cli = join(import.meta.dir, "../../src/runtime/bun/cli.ts");

/**
 * Zero-config local mode claims it never reaches the network. Preloading a
 * throwing `fetch` turns that claim into something the run can fail on: the
 * bridge path would call it, the in-process path must not.
 */
const preload = join(root, "no-network.ts");
writeFileSync(preload, `
globalThis.fetch = () => {
  throw new Error("local mode attempted a network call");
};
`);

afterAll(() => rmSync(root, { recursive: true, force: true }));

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "local-mode-test", version: "1" },
  },
};
const initialized = { jsonrpc: "2.0", method: "notifications/initialized" };

const call = (id: number, name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

/** Drives the installed entry point over stdio with no Titen environment at all. */
async function stdio(home: string, messages: unknown[], env: Record<string, string> = {}) {
  const child = Bun.spawn({
    cmd: ["bun", "--preload", preload, cli, "mcp"],
    // Deliberately not `...process.env`: this is the no-configuration case.
    env: { PATH: process.env.PATH ?? "", HOME: home, ...env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(messages.map((message) => `${JSON.stringify(message)}\n`).join(""));
  child.stdin.end();
  const [exitCode, stdout, stderr] = await Promise.all([
    Promise.race([child.exited, Bun.sleep(20_000).then(() => -1)]),
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const lines = stdout.split("\n").filter((line) => line.trim() !== "");
  return { exitCode, stderr, stdout, replies: lines.map((line) => JSON.parse(line)) };
}

const toolResult = (reply: any) => JSON.parse(reply.result.content[0].text);

test("with no environment set, the stdio entry point serves memory from ~/.titen", async () => {
  const home = join(root, "fresh");
  mkdirSync(home);
  const statement = "Titen local mode needs no API key and no server.";

  const first = await stdio(home, [
    initialize,
    initialized,
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    call(3, "titen_project_resolve", { reference: "local" }),
    call(4, "titen_remember", {
      subject_id: "local-mode",
      kind: "user_statement",
      content: statement,
      source_type: "chat",
      source_ref: "local-mode-test#1",
      // Above the default, so it passes assertTrustCeiling only because the
      // provisioned owner is a real credential row carrying a real ceiling.
      // (`policy_approved` is reserved for the claim-approval workflow.)
      trust: "verified",
    }),
  ]);
  assert.equal(first.exitCode, 0, first.stderr);
  // Which store answered is exactly what a silent fallback hides. A client
  // config that shadows the bridge entry with an env-less one sends `titen mcp`
  // here instead of to the served instance; every lookup then truthfully
  // returns nothing, and without this line neither stream says why.
  assert.equal(
    first.stderr,
    "titen: no TITEN_MCP_URL/TITEN_API_KEY set; serving the local store "
      + `${join(home, ".titen", "memory.db")}\n`,
    "local mode names the store it opened, and says nothing else",
  );
  assert.equal(first.replies.length, 4, "the notification gets no reply");

  const [handshake, tools, project, remembered] = first.replies;
  assert.equal(handshake.result.serverInfo.name, "titen");
  assert.equal(handshake.result.protocolVersion, "2025-06-18");
  // stderr reaches a host log file; `instructions` reaches the model, which is
  // the reader who would otherwise take an empty pack for an empty memory.
  assert.ok(
    handshake.result.instructions.includes(join(home, ".titen", "memory.db")),
    "the handshake names the store, in band",
  );
  assert.match(handshake.result.instructions, /neither TITEN_MCP_URL nor TITEN_API_KEY was set/);
  assert.ok(
    tools.result.tools.some((tool: { name: string }) => tool.name === "titen_remember"),
    "the same MCP tool surface is served locally",
  );
  // The provisioned project resolves without `create`, so it is a real row.
  assert.equal(toolResult(project).data.project_id, "project_local");
  assert.notEqual(remembered.result.isError, true, remembered.result.content?.[0]?.text);
  const observation = toolResult(remembered).data;
  assert.match(observation.observation_id, /^obs_/);
  assert.equal(observation.trust, "verified");
  const observationId = observation.observation_id;

  // A second process proves the store persists and that startup is idempotent.
  const second = await stdio(home, [
    initialize,
    initialized,
    call(2, "titen_consolidate", {
      subject_id: "local-mode",
      claims: [{
        kind: "semantic_fact",
        statement,
        confidence: 0.9,
        sources: [{ observation_id: observationId, relation: "supports" }],
      }],
    }),
    call(3, "titen_compile", {
      subject_id: "local-mode",
      task: "does local mode need an API key",
      max_tokens: 500,
    }),
  ]);
  assert.equal(second.exitCode, 0, second.stderr);
  const [, consolidated, compiled] = second.replies;
  assert.notEqual(consolidated.result.isError, true, consolidated.result.content?.[0]?.text);
  const pack = toolResult(compiled);
  assert.deepEqual(pack.data.items.map((item: { claim: string }) => item.claim), [statement]);
  // FTS only: no embedding provider is configured, so nothing can call out.
  assert.equal(pack.meta.degraded.vector, "disabled");
  assert.equal(pack.meta.degraded.embedding, "disabled");
  assert.equal(pack.meta.degraded.lexical, "used");
}, 60_000);

test("the local store holds real organization, workspace, project and owner rows", async () => {
  const home = join(root, "records");
  mkdirSync(home);
  await stdio(home, [initialize]);
  await stdio(home, [initialize]);

  const dbPath = join(home, ".titen", "memory.db");
  assert.equal(statSync(dbPath).mode & 0o777, 0o600, "the store is not world readable");
  assert.equal(statSync(`${dbPath}.key`).mode & 0o777, 0o600, "the owner key is not world readable");

  const database = openDatabase(dbPath, { create: false, readonly: true });
  try {
    const rows = (sql: string) => database.query(sql).all() as Record<string, string>[];
    assert.deepEqual(
      rows("SELECT id, name FROM organizations"),
      [{ id: "org_local", name: "Local" }],
      "a second run adopts the first run's organization instead of adding another",
    );
    assert.deepEqual(rows("SELECT id, name FROM workspaces"), [{ id: "ws_local", name: "Local" }]);
    assert.deepEqual(
      rows("SELECT id, reference FROM projects"),
      [{ id: "project_local", reference: "local" }],
    );
    assert.deepEqual(
      rows(`SELECT principal_id, role, workspace_id FROM memberships ORDER BY workspace_id`),
      [
        { principal_id: "owner", role: "owner", workspace_id: null as unknown as string },
        { principal_id: "owner", role: "owner", workspace_id: "ws_local" },
      ],
    );
    assert.deepEqual(rows("SELECT principal_id, username FROM operator_accounts"), [
      { principal_id: "owner", username: "owner" },
    ]);
    // One reusable credential row, not one per process: the key file is reused.
    assert.deepEqual(
      rows(`SELECT org_id, principal_id, scopes, max_trust, revoked_at FROM api_keys`),
      [{
        org_id: "org_local",
        principal_id: "owner",
        scopes: "*",
        max_trust: "policy_approved",
        revoked_at: null as unknown as string,
      }],
    );
  } finally {
    database.close();
  }
}, 60_000);

test("local mode authenticates for real and never downgrades a partial configuration", async () => {
  const dbPath = join(root, "predicates", "memory.db");
  const local = await openLocalStore(dbPath);
  try {
    const mcp = (headers: Record<string, string>) =>
      local.app(new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }));

    assert.equal((await mcp({})).status, 401, "the in-process app still requires a credential");
    assert.equal(
      (await mcp({ authorization: "Bearer titen_sk_not-a-real-key" })).status,
      401,
      "an unissued key is rejected by the same core predicate",
    );
    assert.equal((await mcp({ authorization: `Bearer ${local.apiKey}` })).status, 200);
  } finally {
    local.close();
  }

  // Half a configuration is a mistake, not an invitation to open a local store.
  const partial = await stdio(join(root, "predicates"), [initialize], {
    TITEN_MCP_URL: "http://127.0.0.1:8787/mcp",
  });
  assert.notEqual(partial.exitCode, 0);
  assert.match(partial.stderr, /TITEN_MCP_URL and TITEN_API_KEY/);
  assert.equal(partial.replies.length, 0);
}, 60_000);

test("the served entry point still rejects an unauthenticated request", async () => {
  const running = await serve({
    dbPath: join(root, "served.db"),
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    maintenanceIntervalMs: 0,
  });
  try {
    const response = await fetch(`${running.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(response.status, 401);
  } finally {
    await running.stop();
  }
});
