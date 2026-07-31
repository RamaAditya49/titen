import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { serve } from "../../src/runtime/bun/server";
import { TITEN_SDK_TYPED_ROUTES, TitenClient, TitenError } from "../../src/sdk";
import { provisionWith } from "../contract/harness";

/**
 * The published client, driven against a real server over real HTTP.
 *
 * The contract suite proves the service; this proves the client agrees with it.
 * Every method here is one an integrator calls, so a renamed response field or a
 * changed path breaks this file rather than someone's agent.
 */
const directory = mkdtempSync(join(tmpdir(), "titen-sdk-"));
const dbPath = join(directory, "titen.db");

let running: Awaited<ReturnType<typeof serve>>;
let handle: ReturnType<typeof openDatabase>;
let titen: TitenClient;

beforeAll(async () => {
  running = await serve({
    dbPath,
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    revision: "sdk-test",
  });
  handle = openDatabase(dbPath);
  const provisioned = await provisionWith(createSqliteDb(handle), { scopes: ["*"] });
  titen = new TitenClient({ url: running.url, key: provisioned.key });
});

afterAll(async () => {
  handle.close();
  await running.stop();
  rmSync(directory, { recursive: true, force: true });
});

test("health and readiness resolve through the client", async () => {
  const health = await titen.health();
  assert.equal(health.status, "ok");
  const ready = await titen.ready();
  assert.equal(ready.ready, true);
});

test("the client drives the whole Level 5 loop", async () => {
  const project = await titen.resolveProject("github.com/RamaAditya49/titen", true);
  assert.equal(project.reference, "ramaaditya49/titen");

  const observation = await titen.observe({
    subject_id: "user_sdk",
    project_id: project.project_id,
    kind: "tool_result",
    content: "Integration smoke returned 200 for the checkout rollback path.",
    source: { type: "tool", ref: "sdk#1" },
    trust: "verified",
  });
  assert.match(observation.observation_id, /^obs_/);

  const consolidated = await titen.consolidate(
    "user_sdk",
    [
      {
        kind: "procedural",
        statement: "Checkout rollback must be smoke tested before release.",
        confidence: 0.93,
        sources: [{ observation_id: observation.observation_id, relation: "supports" }],
      },
    ],
    project.project_id,
  );
  const claimId = consolidated.claims[0].claim_id as string;
  assert.match(claimId, /^claim_/);

  const context = await titen.compile({
    subject_id: "user_sdk",
    task: "checkout rollback smoke before release",
    max_tokens: 900,
  });
  assert.match(context.context_id, /^ctx_/);
  assert.ok(context.budget.used_tokens <= 900);
  assert.match(context.instructions, /untrusted reference data/i);
  const selected = context.items.find((item: any) => item.claim_id === claimId);
  assert.ok(selected, "the client must receive the claim it just wrote");

  const feedback = await titen.feedback(context.context_id, {
    outcome: "useful",
    claim_id: claimId,
  });
  assert.equal(feedback.outcome, "useful");

  const evidence = await titen.evidence(claimId);
  assert.equal(evidence.evidence.supporting.length, 1);
  assert.equal(
    evidence.evidence.supporting[0].observation_id,
    observation.observation_id,
  );
});

test("checkpoints round-trip through the client", async () => {
  const saved = await titen.saveCheckpoint({
    subject_id: "user_sdk",
    kind: "task_state",
    state: { step: 2, pending: ["verify"] },
    ttl_seconds: 600,
  });
  assert.match(saved.checkpoint_id, /^ckpt_/);

  const loaded = await titen.getCheckpoint("user_sdk", "task_state");
  assert.deepEqual(loaded.state, { step: 2, pending: ["verify"] });

  const removed = await titen.deleteCheckpoint(saved.checkpoint_id);
  assert.equal(removed.deleted, true);
});

test("claim lifecycle calls resolve through the client", async () => {
  const observation = await titen.observe({
    subject_id: "user_sdk_lifecycle",
    kind: "user_statement",
    content: "The old retry budget was three attempts.",
    source: { type: "chat" },
    trust: "verified",
  });
  const first = await titen.consolidate("user_sdk_lifecycle", [
    {
      kind: "procedural",
      statement: "Retry budget is three attempts.",
      sources: [{ observation_id: observation.observation_id, relation: "supports" }],
    },
  ]);
  const second = await titen.consolidate("user_sdk_lifecycle", [
    {
      kind: "procedural",
      statement: "Retry budget is two attempts, then escalate.",
      sources: [{ observation_id: observation.observation_id, relation: "supports" }],
    },
  ]);

  const superseded = await titen.supersede(
    first.claims[0].claim_id,
    second.claims[0].claim_id,
    1,
    "measured under load",
  );
  assert.equal(superseded.status, "superseded");

  const revoked = await titen.revoke(second.claims[0].claim_id, 1, "policy change");
  assert.equal(revoked.status, "revoked");
});

test("key management round-trips and a scoped key is enforced", async () => {
  const created = await titen.createKey({
    label: "sdk-reader",
    scopes: ["context:compile", "handoffs:read", "handoffs:write"],
    max_trust: "asserted",
    principal_id: "agent_sdk_reader",
    principal_kind: "agent",
  });
  assert.match(created.api_key, /^titen_sk_/);
  assert.equal(created.principal_id, "agent_sdk_reader");
  assert.equal(created.principal_kind, "agent");

  const reader = new TitenClient({ url: running.url, key: created.api_key });
  const compiled = await reader.compile({
    subject_id: "user_sdk",
    task: "anything at all",
    max_tokens: 300,
  });
  assert.ok(compiled.context_id);

  const handoff = await titen.createHandoff({
    to_principal: created.principal_id,
    subject_id: "user_sdk_handoff",
    message: "Continue with the returned principal identity.",
  });
  const handoffs = await reader.listHandoffs("pending");
  assert.ok(handoffs.handoffs.some((entry: any) => entry.handoff_id === handoff.handoff_id));
  const accepted = await reader.resolveHandoff(handoff.handoff_id, "accepted");
  assert.equal(accepted.status, "accepted");

  // The client must surface a refusal as a typed error, not a silent result.
  await assert.rejects(
    () =>
      reader.observe({
        subject_id: "user_sdk",
        kind: "tool_result",
        content: "This write is not permitted for a compile-only key.",
        source: { type: "tool" },
      }),
    (error: unknown) => {
      assert.ok(error instanceof TitenError, "the SDK must throw TitenError");
      assert.equal(error.status, 403);
      assert.equal(error.code, "FORBIDDEN");
      return true;
    },
  );

  const listed = await titen.listKeys();
  assert.ok(!JSON.stringify(listed).includes(created.api_key), "listing leaks no key");
  const revoked = await titen.revokeKey(created.key_id);
  assert.equal(revoked.revoked, true);

  await assert.rejects(
    () => reader.compile({ subject_id: "user_sdk", task: "after revocation", max_tokens: 300 }),
    (error: unknown) => (error as TitenError).status === 401,
  );
});

test("a validation failure arrives as a typed error", async () => {
  await assert.rejects(
    () =>
      titen.compile({ subject_id: "user_sdk", task: "budget too small", max_tokens: 4 }),
    (error: unknown) => {
      assert.ok(error instanceof TitenError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "VALIDATION_ERROR");
      return true;
    },
  );
});

test("constructor configuration fails early with stable field errors", () => {
  const cases: [unknown, RegExp][] = [
    [undefined, /config is required/],
    [{}, /url is required/],
    [{ url: "", key: "k" }, /url is required/],
    [{ url: "not a url", key: "k" }, /url is required/],
    [{ url: "file:///tmp/titen", key: "k" }, /absolute http\(s\) URL/],
    [{ url: "http://example.test", key: undefined }, /key is required/],
    [{ url: "http://example.test", key: "" }, /key is required/],
    [{ url: "http://example.test", key: "k", fetch: null }, /fetch must be a function/],
    [{ url: "http://example.test", key: "secret-value", fetch: 0 }, /fetch must be a function/],
  ];
  for (const [config, message] of cases)
    assert.throws(
      () => new TitenClient(config as never),
      (error: unknown) => {
        assert.ok(error instanceof TypeError);
        assert.match(error.message, message);
        assert.doesNotMatch(error.message, /secret-value/);
        return true;
      },
    );

  assert.doesNotThrow(
    () => new TitenClient({ url: "https://example.test/", key: "k", fetch }),
  );
});

test("empty and non-JSON responses never leak parser or gateway details", async () => {
  const call = async (response: Response) =>
    new TitenClient({
      url: "http://example.test",
      key: "test",
      fetch: async () => response,
    }).health();

  assert.equal(await call(new Response(null, { status: 204 })), undefined);
  assert.equal(await call(new Response(null, { status: 200 })), undefined);

  const failures: [Response, number, string][] = [
    [new Response(null, { status: 500 }), 500, "HTTP_ERROR"],
    [
      new Response("<h1>private upstream detail</h1>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
      502,
      "HTTP_ERROR",
    ],
    [
      new Response("{bad", {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
      503,
      "HTTP_ERROR",
    ],
    [
      Response.json(
        { error: { code: "UPSTREAM_DOWN", message: "Dependency unavailable." } },
        { status: 503 },
      ),
      503,
      "UPSTREAM_DOWN",
    ],
  ];
  for (const [response, status, code] of failures)
    await assert.rejects(
      () => call(response),
      (error: unknown) => {
        assert.ok(error instanceof TitenError);
        assert.equal(error.status, status);
        assert.equal(error.code, code);
        assert.doesNotMatch(error.message, /private upstream detail|Unexpected token|JSON/);
        return true;
      },
    );

  await assert.rejects(
    () =>
      call(
        new Response("{bad", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    (error: unknown) =>
      error instanceof TitenError && error.status === 200 && error.code === "INVALID_RESPONSE",
  );
});

test("mutation idempotency reaches the server and preserves replay semantics", async () => {
  const idempotencyKey = `sdk-retry-${crypto.randomUUID()}`;
  const observation = {
    subject_id: `user_sdk_retry_${crypto.randomUUID()}`,
    kind: "tool_result" as const,
    content: "Retry-safe SDK observation.",
    source: { type: "tool", ref: "sdk-retry" },
  };
  const first = await titen.observe(observation, { idempotencyKey });
  const replay = await titen.observe(observation, { idempotencyKey });
  assert.equal(replay.observation_id, first.observation_id);

  await assert.rejects(
    () =>
      titen.observe(
        { ...observation, content: "Changed retry body." },
        { idempotencyKey },
      ),
    (error: unknown) =>
      error instanceof TitenError && error.status === 409 && error.code === "CONFLICT",
  );
});

test("generic JSON and raw access preserve auth without allowing overrides", async () => {
  const events = await titen.request<any>("GET", "/v1/events?limit=1");
  assert.ok(Array.isArray(events.events));

  const exported = await titen.requestRaw(
    "GET",
    "/v1/export?type=observations&limit=1",
  );
  assert.match(exported.headers.get("content-type") ?? "", /application\/x-ndjson/);
  const firstLine = (await exported.text()).split("\n")[0]!;
  assert.equal(JSON.parse(firstLine).type, "titen.export.header");

  let called = false;
  const local = new TitenClient({
    url: "http://example.test",
    key: "configured-key",
    fetch: async () => {
      called = true;
      return Response.json({ data: {} });
    },
  });
  await assert.rejects(
    () =>
      local.request("GET", "/v1/events", {
        headers: { authorization: "Bearer attacker-selected" },
      }),
    /authorization cannot be overridden/,
  );
  await assert.rejects(
    () => local.request("GET", "//attacker.example/v1/events"),
    /path must be an absolute API path/,
  );
  assert.equal(called, false, "an invalid generic request must fail before network I/O");
});

test("typed mutation sends one idempotency header and the capability matrix stays live", async () => {
  let headers = new Headers();
  const local = new TitenClient({
    url: "http://example.test",
    key: "configured-key",
    fetch: async (_input, init) => {
      headers = new Headers(init?.headers);
      return Response.json({ data: { observation_id: "obs_test" } });
    },
  });
  await local.observe(
    {
      subject_id: "subject",
      kind: "tool_result",
      content: "captured",
      source: { type: "test" },
    },
    { idempotencyKey: "retry-one" },
  );
  assert.equal(headers.get("authorization"), "Bearer configured-key");
  assert.equal(headers.get("idempotency-key"), "retry-one");
  assert.equal(
    [...headers.keys()].filter((name) => name === "idempotency-key").length,
    1,
  );

  for (const [method] of TITEN_SDK_TYPED_ROUTES)
    assert.equal(
      typeof (TitenClient.prototype as unknown as Record<string, unknown>)[method],
      "function",
      `${method} is documented but missing`,
    );
});
