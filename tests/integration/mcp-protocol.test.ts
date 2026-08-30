import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { serve } from "../../src/runtime/bun/server";
import { provisionWith } from "../contract/harness";
import { TITEN_VERSION } from "../../src/core/version";

/**
 * MCP protocol compliance, driven the way a client drives it.
 *
 * These assertions deliberately read the raw HTTP body rather than any Titen
 * helper. An earlier version of the endpoint returned the JSON-RPC object nested
 * inside Titen's `{ data, meta }` envelope, which no MCP client can parse, and the
 * contract test at the time asserted that nested shape and so agreed with the
 * bug. Reading the wire is what makes this test able to catch it.
 */
const directory = mkdtempSync(join(tmpdir(), "titen-mcp-"));

let running: Awaited<ReturnType<typeof serve>>;
let key: string;

/** Speaks JSON-RPC over HTTP and returns the parsed body plus the status. */
async function rpc(payload: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${running.url}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${key}`,
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return {
    status: res.status,
    requestId: res.headers.get("x-request-id"),
    text,
    body: text === "" ? null : (JSON.parse(text) as any),
  };
}

beforeAll(async () => {
  const dbPath = join(directory, "titen.db");
  running = await serve({ dbPath, port: 0, hostname: "127.0.0.1", quiet: true, revision: "mcp" });
  const provisioned = await provisionWith(createSqliteDb(openDatabase(dbPath)), {
    scopes: ["*"],
  });
  key = provisioned.key;
});

afterAll(async () => {
  await running.stop();
  rmSync(directory, { recursive: true, force: true });
});

test("the response body is a JSON-RPC object, not a wrapped payload", async () => {
  const res = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(res.status, 200);

  // The three properties a client actually depends on.
  assert.equal(res.body.jsonrpc, "2.0", "jsonrpc must be a top-level field");
  assert.equal(res.body.id, 1, "the id must be echoed at the top level");
  assert.ok(res.body.result, "the result must be a top-level field");

  // The envelope that used to wrap this must be absent.
  assert.equal(res.body.data, undefined, "an MCP reply must not carry Titen's data field");
  assert.equal(res.body.meta, undefined, "an MCP reply must not carry Titen's meta field");
});

test("initialize negotiates a protocol revision and names the server", async () => {
  const current = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "0" } },
  });
  assert.equal(current.body.result.protocolVersion, "2025-06-18", "a supported revision is echoed");
  assert.equal(current.body.result.serverInfo.name, "titen");
  assert.equal(current.body.result.serverInfo.version, TITEN_VERSION);
  assert.ok(current.body.result.capabilities.tools, "tools capability must be declared");
  assert.match(current.body.result.instructions, /titen_project_resolve/);
  assert.match(current.body.result.instructions, /titen_compile once/);
  assert.match(current.body.result.instructions, /new task or repository scope/);
  assert.match(current.body.result.instructions, /untrusted reference data/);
  assert.match(current.body.result.instructions, /never capture transcripts or secrets/);
  assert.ok(current.body.result.instructions.length <= 512);

  const latest = await rpc({
    jsonrpc: "2.0",
    id: 4,
    method: "initialize",
    params: { protocolVersion: "2025-11-25" },
  });
  assert.equal(latest.body.result.protocolVersion, "2025-11-25");

  // An older client must not be forced onto a newer revision.
  const older = await rpc({
    jsonrpc: "2.0",
    id: 2,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  });
  assert.equal(older.body.result.protocolVersion, "2024-11-05");

  // An unknown revision falls back to one this server actually implements.
  const unknown = await rpc({
    jsonrpc: "2.0",
    id: 3,
    method: "initialize",
    params: { protocolVersion: "1999-01-01" },
  });
  assert.ok(
    ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"].includes(
      unknown.body.result.protocolVersion,
    ),
    "the fallback must be a revision this server implements",
  );
});

test("a notification receives no response body", async () => {
  // Sent by every compliant client right after initialize. Answering it is what
  // makes a client hang or report a protocol violation.
  const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(res.status, 202, "a notification must be accepted, not answered");
  assert.equal(res.text, "", "a notification must receive an empty body");
});

test("ping answers, and the full handshake completes in order", async () => {
  await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });

  const pong = await rpc({ jsonrpc: "2.0", id: 2, method: "ping" });
  assert.equal(pong.body.jsonrpc, "2.0");
  assert.deepEqual(pong.body.result, {}, "ping returns an empty result");

  const tools = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  assert.ok(Array.isArray(tools.body.result.tools), "tools must be an array");
  // Nine native `titen_*` tools plus the nine @modelcontextprotocol/server-memory
  // names served for drop-in substitution (#279).
  assert.equal(tools.body.result.tools.length, 18, "every ordinary-agent tool must be advertised");
  for (const tool of tools.body.result.tools) {
    assert.ok(typeof tool.name === "string" && tool.name.length > 0);
    assert.ok(typeof tool.description === "string" && tool.description.length > 0);
    assert.equal(tool.inputSchema.type, "object", "each tool needs an object schema");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(Array.isArray(tool.inputSchema.required));
    for (const property of Object.values(tool.inputSchema.properties) as Array<Record<string, unknown>>)
      assert.equal(typeof property.description, "string", `${tool.name} property lacks a description`);
    assert.equal(typeof tool.annotations.readOnlyHint, "boolean");
    assert.equal(typeof tool.annotations.destructiveHint, "boolean");
    assert.equal(typeof tool.annotations.idempotentHint, "boolean");
    assert.equal(tool.annotations.openWorldHint, false);
  }
  const compile = tools.body.result.tools.find((tool: any) => tool.name === "titen_compile");
  assert.equal(compile.annotations.readOnlyHint, false, "compile records a context run");
  assert.equal(compile.annotations.idempotentHint, false, "compile creates a new context run");
  assert.equal(compile.inputSchema.properties.cross_project.type, "boolean");
  assert.match(compile.inputSchema.properties.cross_project.description, /context:compile:all/);
  const remember = tools.body.result.tools.find((tool: any) => tool.name === "titen_remember");
  assert.deepEqual(remember.inputSchema.properties.kind.enum, [
    "user_statement", "tool_result", "imported_source", "decision", "system_event",
  ]);
  assert.deepEqual(remember.inputSchema.properties.trust.enum, [
    "unverified", "asserted", "verified", "policy_approved",
  ]);
  assert.deepEqual(remember.inputSchema.properties.visibility.enum, [
    "private", "team", "organization",
  ]);
  assert.equal(
    remember.annotations.idempotentHint,
    false,
    "remember is idempotent only when the optional idempotency key is present",
  );
  const consolidate = tools.body.result.tools.find((tool: any) => tool.name === "titen_consolidate");
  assert.equal(consolidate.inputSchema.properties.claims.type, "array");
  assert.equal(consolidate.inputSchema.properties.claims.items.additionalProperties, false);
  assert.deepEqual(consolidate.inputSchema.properties.claims.items.properties.kind.enum, [
    "semantic_fact", "episodic_event", "preference", "procedural", "decision", "relationship",
  ]);
  assert.equal(consolidate.annotations.idempotentHint, false);
  const resolve = tools.body.result.tools.find((tool: any) => tool.name === "titen_project_resolve");
  assert.equal(resolve.inputSchema.properties.create.type, "boolean");
  assert.equal(resolve.annotations.readOnlyHint, false, "project resolution may create when authorized");
  const checkpointGet = tools.body.result.tools.find(
    (tool: any) => tool.name === "titen_checkpoint_get",
  );
  assert.equal(checkpointGet.annotations.readOnlyHint, true);
  assert.equal(checkpointGet.annotations.idempotentHint, true);
});

test("the HTTP transport rejects unsafe origins and unsupported revisions", async () => {
  const crossOrigin = await rpc(
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { origin: "https://attacker.example" },
  );
  assert.equal(crossOrigin.status, 403);

  const sameOrigin = await rpc(
    { jsonrpc: "2.0", id: 2, method: "ping" },
    { origin: running.url },
  );
  assert.equal(sameOrigin.status, 200);

  const unsupported = await rpc(
    { jsonrpc: "2.0", id: 3, method: "ping" },
    { "mcp-protocol-version": "1999-01-01" },
  );
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.body.error.code, -32600);

  const noStream = await fetch(`${running.url}/mcp`, {
    headers: {
      accept: "text/event-stream",
      authorization: `Bearer ${key}`,
    },
  });
  assert.equal(noStream.status, 405);
});

test("a TLS proxy origin is trusted only through explicit configuration", async () => {
  const dbPath = join(directory, "external-origin.db");
  const externalOrigin = "https://titen.example.com";
  const proxied = await serve({
    dbPath,
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    revision: "mcp-proxy",
    mcpOrigin: externalOrigin,
  });
  const database = openDatabase(dbPath);
  const provisioned = await provisionWith(createSqliteDb(database), { scopes: ["*"] });
  database.close();

  const call = (origin: string) =>
    fetch(`${proxied.url}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provisioned.key}`,
        origin,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });

  try {
    assert.equal((await call(externalOrigin)).status, 200);
    assert.equal((await call(proxied.url)).status, 403, "the internal HTTP origin is no longer trusted");
    assert.equal((await call("https://attacker.example")).status, 403);
  } finally {
    await proxied.stop();
  }

  assert.equal(
    (
      await rpc(
        { jsonrpc: "2.0", id: 11, method: "ping" },
        { origin: externalOrigin, "x-forwarded-proto": "https" },
      )
    ).status,
    403,
    "forwarded protocol does not make an unconfigured external origin trusted",
  );
});

test("invalid configured MCP origins fail before the server starts", async () => {
  for (const [index, mcpOrigin] of [
    "ftp://titen.example.com",
    "https://user@titen.example.com",
    "https://titen.example.com/path",
    "https://titen.example.com/",
  ].entries()) {
    await assert.rejects(
      serve({
        dbPath: join(directory, `invalid-origin-${index}.db`),
        port: 0,
        hostname: "127.0.0.1",
        quiet: true,
        mcpOrigin,
      }),
      /TITEN_MCP_ORIGIN must be an exact HTTP\(S\) origin/,
    );
  }
});

test("a tool call returns MCP content and a failure stays readable", async () => {
  const called = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "titen_remember",
      arguments: {
        subject_id: "user_mcp_compliance",
        kind: "tool_result",
        content: "Evidence appended through the MCP transport.",
        source_type: "tool",
        source_ref: "mcp#1",
        trust: "verified",
      },
    },
  });
  assert.equal(called.body.jsonrpc, "2.0");
  const content = called.body.result.content;
  assert.ok(Array.isArray(content) && content[0].type === "text");
  const remembered = JSON.parse(content[0].text);
  assert.match(remembered.data.observation_id, /^obs_/);
  assert.equal(remembered.meta.replayed, false);
  assert.notEqual(called.body.result.isError, true);

  const checkpoint = await rpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "titen_checkpoint_save",
      arguments: {
        subject_id: "user_mcp_compliance",
        kind: "task_state",
        state: { step: 1 },
        ttl_seconds: 600,
      },
    },
  });
  const checkpointPayload = JSON.parse(checkpoint.body.result.content[0].text);
  assert.match(checkpointPayload.data.checkpoint_id, /^ckpt_/);
  assert.deepEqual(
    Object.keys(checkpointPayload),
    ["data"],
    "every successful tool result keeps the same data envelope",
  );

  // A bad argument is a readable tool result, not a transport error: the model
  // has to be able to see what it got wrong.
  const failed = await rpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "titen_remember", arguments: { subject_id: "only-this" } },
  });
  assert.equal(failed.body.jsonrpc, "2.0");
  assert.equal(failed.body.result.isError, true, "a tool failure is flagged in the result");
  assert.ok(failed.body.result.content[0].text.length > 0, "the reason must be readable");
  assert.equal(failed.body.error, undefined, "a tool failure is not a JSON-RPC error");

  const missingProject = await rpc({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "titen_project_resolve",
      arguments: { reference: "Rama/MCP-Missing" },
    },
  });
  const missingPayload = JSON.parse(missingProject.body.result.content[0].text);
  assert.equal(missingProject.body.result.isError, true);
  assert.equal(missingPayload.code, "NOT_FOUND");
  assert.equal(missingPayload.meta.request_id, missingProject.requestId);
  assert.equal(missingPayload.meta.reason, "project_not_registered");
  assert.equal(missingPayload.meta.reference, "rama/mcp-missing");
  assert.equal(missingPayload.meta.can_create, true);
  assert.equal(missingPayload.meta.support.classification, "expected");
  assert.match(missingPayload.meta.support.action, /create=true/);
});

test("protocol-level errors use JSON-RPC error codes", async () => {
  // `resources/list` used to stand in for "unknown method" here; it is served
  // now, so this needs a method that genuinely is not implemented.
  const unknownMethod = await rpc({ jsonrpc: "2.0", id: 1, method: "completion/complete" });
  assert.equal(unknownMethod.body.error.code, -32601, "unknown method is -32601");
  const served = await rpc({ jsonrpc: "2.0", id: 1, method: "resources/list" });
  assert.equal(served.body.error, undefined, "resources/list is implemented, not unknown");

  const unknownTool = await rpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "titen_not_a_tool", arguments: {} },
  });
  assert.equal(unknownTool.body.error.code, -32602, "unknown tool is -32602");

  const badVersion = await rpc({ id: 3, method: "ping" });
  assert.equal(badVersion.body.error.code, -32600, "a missing jsonrpc field is -32600");

  const malformed = await fetch(`${running.url}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: "{not json",
  });
  const parseError = (await malformed.json()) as any;
  assert.equal(parseError.error.code, -32700, "unparseable input is -32700");

  const emptyBatch = await rpc([]);
  assert.equal(emptyBatch.body.error.code, -32600, "an empty batch is one invalid request");
});

test("null ids are answered and missing ids are notifications", async () => {
  const nullId = await rpc({ jsonrpc: "2.0", id: null, method: "ping" });
  assert.equal(nullId.status, 200);
  assert.equal(nullId.body.id, null, "an explicit null id is echoed in the response");
  assert.deepEqual(nullId.body.result, {});

  const notification = await rpc({ jsonrpc: "2.0", method: "tools/list" });
  assert.equal(notification.status, 202);
  assert.equal(notification.text, "", "tools/list without an id must not be answered");
});

test("a batch answers only the requests in it", async () => {
  const res = await rpc([
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ]);
  assert.ok(Array.isArray(res.body), "a batch request returns an array");
  assert.equal(res.body.length, 2, "the notification contributes no response");
  assert.deepEqual(
    res.body.map((entry: any) => entry.id).sort(),
    [1, 2],
    "each request is answered by id",
  );
});

test("the transport is authenticated", async () => {
  const anonymous = await fetch(`${running.url}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(anonymous.status, 401, "MCP must not be reachable without a credential");
});
