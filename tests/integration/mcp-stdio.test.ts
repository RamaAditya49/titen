import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { runMcpStdio } from "../../src/runtime/bun/mcp-stdio";
import { serve } from "../../src/runtime/bun/server";
import { provisionWith } from "../contract/harness";

const directory = mkdtempSync(join(tmpdir(), "titen-mcp-stdio-"));
const cli = join(import.meta.dir, "../../src/runtime/bun/cli.ts");
let running: Awaited<ReturnType<typeof serve>>;
let key: string;

beforeAll(async () => {
  const dbPath = join(directory, "titen.db");
  running = await serve({ dbPath, port: 0, hostname: "127.0.0.1", quiet: true });
  const database = openDatabase(dbPath);
  key = (await provisionWith(createSqliteDb(database), { scopes: ["*"] })).key;
  database.close();
});

afterAll(async () => {
  await running.stop();
  rmSync(directory, { recursive: true, force: true });
});

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "stdio-test", version: "1" } },
};
const initialized = { jsonrpc: "2.0", method: "notifications/initialized" };
const tools = { jsonrpc: "2.0", id: 2, method: "tools/list" };

async function http(message: unknown): Promise<string> {
  const response = await fetch(`${running.url}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(message),
  });
  return response.text();
}

test("the installed CLI bridges requests, drops notification replies, and exits on EOF", async () => {
  const process = Bun.spawn(["bun", cli, "mcp"], {
    env: { ...globalThis.process.env, TITEN_MCP_URL: `${running.url}/mcp`, TITEN_API_KEY: key },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  process.stdin.write(`${JSON.stringify(initialize)}\n${JSON.stringify(initialized)}\n${JSON.stringify(tools)}`);
  process.stdin.end();

  const [exitCode, stdout, stderr] = await Promise.all([
    Promise.race([process.exited, Bun.sleep(1_000).then(() => -1)]),
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  assert.equal(exitCode, 0, stderr);
  assert.equal(stderr, "");
  assert.deepEqual(stdout.trim().split("\n"), [await http(initialize), await http(tools)]);
  assert.doesNotMatch(`${stdout}${stderr}`, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("parse and network failures are sanitized without ending the bridge", async () => {
  async function* input() {
    yield new TextEncoder().encode([
      JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }),
      JSON.stringify(initialized),
      "{",
      JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/list" }),
    ].join("\n"));
  }
  const output: string[] = [];
  const secret = "never-print-this-key";
  await runMcpStdio({
    endpoint: "http://127.0.0.1:9/mcp",
    apiKey: secret,
    input: input(),
    write: (line) => output.push(line),
  });
  assert.deepEqual(output.map((line) => JSON.parse(line)), [
    { jsonrpc: "2.0", id: 7, error: { code: -32000, message: "Titen MCP request failed." } },
    { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } },
    { jsonrpc: "2.0", id: 8, error: { code: -32000, message: "Titen MCP request failed." } },
  ]);
  assert.doesNotMatch(output.join(""), new RegExp(secret));
});

test("the API key reaches only the authorization header and is redacted upstream", async () => {
  async function* input() {
    yield new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }));
  }
  const output: string[] = [];
  const secret = "header-only-key";
  await runMcpStdio({
    endpoint: "https://titen.example/mcp",
    apiKey: secret,
    input: input(),
    fetcher: async (_input, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${secret}`);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 9, result: { echo: secret } }));
    },
    write: (line) => output.push(line),
  });
  assert.deepEqual(JSON.parse(output[0]!), {
    jsonrpc: "2.0",
    id: 9,
    result: { echo: "[redacted]" },
  });
  assert.doesNotMatch(output.join(""), new RegExp(secret));
});

test("unsafe endpoints fail before fetch", async () => {
  async function* empty() {}
  for (const endpoint of [
    "file:///tmp/mcp",
    "http://user:pass@localhost/mcp",
    "http://localhost/mcp?token=secret",
    "http://localhost/mcp#secret",
    "http://localhost/not-mcp",
  ]) {
    let fetched = false;
    await assert.rejects(runMcpStdio({
      endpoint,
      apiKey: "safe-key",
      input: empty(),
      fetcher: async () => {
        fetched = true;
        return new Response();
      },
    }), /credential-free HTTP \/mcp endpoint/);
    assert.equal(fetched, false);
  }
});
