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
  assert.equal(ready.capabilities.extraction_response_mode, "disabled");
  assert.equal(ready.checks.enrichment_jobs?.state, "disabled");
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
    project_id: project.project_id,
    task: "checkout rollback smoke before release",
    max_tokens: 900,
  });
  assert.match(context.context_id, /^ctx_/);
  assert.ok(context.budget.used_tokens <= 900);
  assert.match(context.instructions, /untrusted reference data/i);
  assert.deepEqual(context.scope, {
    subject_id: "user_sdk",
    project_id: project.project_id,
    project_mode: "project",
    broad_access_reason: null,
  });
  const selected = context.items.find((item) => item.claim_id === claimId);
  assert.ok(selected, "the client must receive the claim it just wrote");

  const broad = await titen.compile({
    subject_id: "user_sdk",
    task: "checkout rollback smoke before release",
    max_tokens: 900,
    cross_project: true,
  });
  assert.equal(broad.scope.project_mode, "cross_project");
  assert.equal(broad.scope.broad_access_reason, "credential_scope:context:compile:all");
  assert.ok(broad.items.some((item) => item.claim_id === claimId));

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
  assert.ok(handoffs.handoffs.some((entry) => entry.handoff_id === handoff.handoff_id));
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
    [{ url: "http://example.test", key: "k", timeoutMs: 0 }, /timeoutMs must be a positive/],
    [{ url: "http://example.test", key: "k", timeoutMs: 1.5 }, /timeoutMs must be a positive/],
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

test("requests compose caller cancellation with a timeout and never auto-retry", async () => {
  let calls = 0;
  const waitingFetch: typeof fetch = async (_input, init) => {
    calls += 1;
    const signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(signal?.reason);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  };
  const local = new TitenClient({
    url: "http://example.test",
    key: "test",
    fetch: waitingFetch,
    timeoutMs: 1_000,
  });
  const controller = new AbortController();
  const reason = new Error("caller stopped");
  const pending = local.request("GET", "/healthz", { signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(() => pending, (error: unknown) => error === reason);
  assert.equal(calls, 1);

  calls = 0;
  const timed = new TitenClient({
    url: "http://example.test",
    key: "test",
    fetch: waitingFetch,
    timeoutMs: 5,
  });
  await assert.rejects(
    () => timed.health(),
    (error: unknown) => error instanceof DOMException && error.name === "TimeoutError",
  );
  assert.equal(calls, 1, "a timeout must not retry the request");

  let unavailableCalls = 0;
  const unavailable = new TitenClient({
    url: "http://example.test",
    key: "test",
    fetch: async () => {
      unavailableCalls += 1;
      return Response.json(
        { error: { code: "UNAVAILABLE", message: "Try later." } },
        { status: 503 },
      );
    },
  });
  await assert.rejects(
    () => unavailable.health(),
    (error: unknown) => error instanceof TitenError && error.code === "UNAVAILABLE",
  );
  assert.equal(unavailableCalls, 1, "503 responses are returned without an SDK retry");
});

test("object-style consolidate misuse fails locally before fetch", async () => {
  let called = false;
  const local = new TitenClient({
    url: "http://example.test",
    key: "test",
    fetch: async () => {
      called = true;
      return Response.json({ data: {} });
    },
  });
  const consolidate = local.consolidate.bind(local) as unknown as (
    value: unknown,
  ) => Promise<unknown>;
  await assert.rejects(
    () => consolidate({ subject_id: "subject", claims: [] }),
    /consolidate\(\) takes \(subject_id, claims\)/,
  );
  assert.equal(called, false);
});

test("TitenError preserves safe metadata and request ids", async () => {
  const local = new TitenClient({
    url: "http://example.test",
    key: "test",
    fetch: async () => Response.json(
      {
        error: {
          code: "UNAVAILABLE",
          message: "Dependency unavailable.",
          meta: { retryable: true, operation: "index_drain" },
        },
        meta: { request_id: "req_body", dependency: "embedder", retryable: true },
      },
      { status: 503, headers: { "x-request-id": "req_header" } },
    ),
  });
  await assert.rejects(
    () => local.health(),
    (error: unknown) => {
      assert.ok(error instanceof TitenError);
      assert.equal(error.requestId, "req_body");
      assert.deepEqual(error.meta, {
        request_id: "req_body",
        dependency: "embedder",
        retryable: true,
        operation: "index_drain",
      });
      return true;
    },
  );

  const headerOnly = new TitenClient({
    url: "http://example.test",
    key: "test",
    fetch: async () => Response.json(
      { error: { code: "FORBIDDEN", message: "No." } },
      { status: 403, headers: { "x-request-id": "req_header_only" } },
    ),
  });
  await assert.rejects(
    () => headerOnly.health(),
    (error: unknown) => {
      assert.ok(error instanceof TitenError);
      assert.equal(error.requestId, "req_header_only");
      assert.deepEqual(error.meta, { request_id: "req_header_only" });
      return true;
    },
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

test("successful JSON responses require an object envelope", async () => {
  const invalid: Array<[string, unknown]> = [
    ["array", []],
    ["null", null],
    ["string", "ok"],
    ["number", 1],
    ["boolean", true],
  ];
  const calls: Array<[
    string,
    (client: TitenClient) => Promise<unknown>,
  ]> = [
    ["requestWithMeta", (client) => client.requestWithMeta("GET", "/healthz")],
    ["health", (client) => client.health()],
  ];

  for (const [shape, value] of invalid) {
    for (const [method, call] of calls) {
      const requestId = `req-${shape}-${method}`;
      const client = new TitenClient({
        url: "http://example.test",
        key: "test",
        fetch: async () =>
          Response.json(value, { headers: { "x-request-id": requestId } }),
      });
      await assert.rejects(
        () => call(client),
        (error: unknown) => {
          assert.ok(error instanceof TitenError, `${method} accepted ${shape}`);
          assert.equal(error.code, "INVALID_RESPONSE");
          assert.equal(error.status, 200);
          assert.equal(error.requestId, requestId);
          assert.deepEqual(error.meta, { request_id: requestId });
          return true;
        },
      );
    }
  }

  const client = new TitenClient({
    url: "http://example.test",
    key: "test",
    fetch: async () =>
      Response.json(
        {
          data: { status: "ok", runtime: "test", revision: "valid" },
          meta: { replayed: true },
        },
        { headers: { "x-request-id": "req-valid" } },
      ),
  });
  assert.deepEqual(await client.requestWithMeta("GET", "/healthz"), {
    data: { status: "ok", runtime: "test", revision: "valid" },
    meta: { replayed: true, request_id: "req-valid" },
  });
  assert.deepEqual(await client.health(), {
    status: "ok",
    runtime: "test",
    revision: "valid",
  });
});

test("mutation idempotency reaches the server and preserves replay semantics", async () => {
  const idempotencyKey = `sdk-retry-${crypto.randomUUID()}`;
  const observation = {
    subject_id: `user_sdk_retry_${crypto.randomUUID()}`,
    kind: "tool_result" as const,
    content: "Retry-safe SDK observation.",
    source: { type: "tool", ref: "sdk-retry" },
  };
  const first = await titen.requestWithMeta<{ observation_id: string }>(
    "POST",
    "/v1/observations",
    { json: observation, idempotencyKey },
  );
  const replay = await titen.requestWithMeta<{ observation_id: string }>(
    "POST",
    "/v1/observations",
    { json: observation, idempotencyKey },
  );
  assert.equal(replay.data.observation_id, first.data.observation_id);
  assert.equal(first.meta.replayed, false);
  assert.equal(replay.meta.replayed, true);
  assert.match(first.meta.request_id as string, /^req_/);

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
  const events = await titen.listEvents({ limit: 1 });
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

test("typed event iteration stops on empty pages and rejects broken cursors", async () => {
  const event = (id: string) => ({
    id,
    kind: "claim.materialized",
    actor_id: "agent_test",
    resource_type: "claim",
    resource_id: `claim_${id}`,
    payload: {},
    created_at: "2026-08-01T00:00:00.000Z",
  });
  const collect = async (client: TitenClient) => {
    const rows = [];
    for await (const row of client.iterateEvents({ limit: 1 })) rows.push(row);
    return rows;
  };
  const pages = [
    { events: [event("evt_1")], cursor: "evt_1" },
    { events: [event("evt_2")], cursor: "evt_2" },
    // The service deliberately echoes the incoming cursor when exhausted.
    { events: [], cursor: "evt_2" },
  ];
  let calls = 0;
  const local = new TitenClient({
    url: "http://example.test",
    key: "test",
    fetch: async () => Response.json({ data: pages[calls++] }),
  });
  assert.deepEqual((await collect(local)).map(({ id }) => id), ["evt_1", "evt_2"]);
  assert.equal(calls, 3, "an exact page boundary needs one terminal empty poll");

  for (const brokenPages of [
    [{ events: [event("evt_same")], cursor: "evt_same" }, { events: [event("evt_next")], cursor: "evt_same" }],
    [{ events: [event("evt_duplicate")], cursor: "cursor_1" }, { events: [event("evt_duplicate")], cursor: "cursor_2" }],
  ]) {
    let index = 0;
    const broken = new TitenClient({
      url: "http://example.test",
      key: "test",
      fetch: async () => Response.json({ data: brokenPages[index++] }),
    });
    await assert.rejects(
      () => collect(broken),
      (error: unknown) => error instanceof TitenError && error.code === "INVALID_RESPONSE",
    );
  }

  const controller = new AbortController();
  controller.abort();
  // A caller can cancel before the iterator's first list request.
  const aborted = (async () => {
    for await (const _event of local.iterateEvents({ signal: controller.signal })) void _event;
  })();
  await assert.rejects(() => aborted, (error: unknown) => error === controller.signal.reason);
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
