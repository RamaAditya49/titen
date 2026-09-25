import { fakeFetch } from "../helpers/fetch";
import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  ExtractionProviderError,
  configureHttpExtraction,
  createHttpDecisionGate,
  createHttpExtraction,
  type ExtractionCapability,
} from "../../src/core/extraction";
import { backgroundEnrichment } from "../../src/runtime/cloudflare/worker";

const fingerprint = "c".repeat(64);

test("HTTP extraction is explicit, bounded, and schema-shaped", async () => {
  let request: { input: string; init?: RequestInit } | undefined;
  const capability = createHttpExtraction({
    baseUrl: "https://models.example.test/v1",
    model: "sol-locked",
    modelFingerprint: fingerprint,
    apiKey: "test-secret",
    fetch: fakeFetch((async (input, init) => {
      request = { input: String(input), init };
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ action: "abstain" }) } }],
      });
    })),
  });
  const proposal = await capability.generate({
    lane: "derivation",
    system: "system contract",
    input: { observation: { observation_id: "obs_1", content: "untrusted" } },
    schema: { type: "object" },
  });
  assert.deepEqual(proposal, { action: "abstain" });
  assert.equal(request!.input, "https://models.example.test/v1/chat/completions");
  assert.equal(request!.init!.redirect, "manual");
  assert.equal((request!.init!.headers as Record<string, string>).authorization, "Bearer test-secret");
  const body = JSON.parse(String(request!.init!.body));
  assert.equal(body.model, "sol-locked");
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 2_048);
  assert.equal(body.response_format.json_schema.strict, true);
  assert.match(body.messages[1].content, /^UNTRUSTED_INPUT_JSON/u);
  assert.doesNotMatch(String(request!.init!.body), /test-secret/u);
});

test("HTTP extraction exposes explicit JSON-object compatibility without weakening local validation", async () => {
  let body: any;
  const schema = { type: "object", required: ["action"], additionalProperties: false };
  const capability = createHttpExtraction({
    baseUrl: "https://models.example.test/v1",
    model: "compat",
    modelFingerprint: fingerprint,
    responseMode: "json_object",
    fetch: fakeFetch((async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: '{"action":"abstain"}' } }],
      });
    })),
  });

  assert.deepEqual(await capability.generate({
    lane: "derivation",
    system: "unchanged safety contract",
    input: { bounds: { max_claims: 1 }, observation: { content: "untrusted" } },
    schema,
  }), { action: "abstain" });
  assert.equal(capability.responseMode, "json_object");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.messages[0].content, "unchanged safety contract");
  assert.match(body.messages[1].content, /^REQUIRED_OUTPUT_SCHEMA_JSON/u);
  assert.match(body.messages[1].content, new RegExp(JSON.stringify(schema).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.match(body.messages[1].content, /"max_claims":1/u);
  assert.match(body.messages[1].content, /UNTRUSTED_INPUT_JSON/u);
});

test("HTTP extraction rejects redirects before reading their body", async () => {
  let redirect: RequestRedirect | undefined;
  let cancelled = false;
  const capability = createHttpExtraction({
    baseUrl: "https://models.example.test/v1",
    model: "redirect",
    modelFingerprint: fingerprint,
    fetch: fakeFetch((async (_input, init) => {
      redirect = init?.redirect;
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
        status: 302,
        headers: { location: "https://elsewhere.example.test/" },
      });
    })),
  });
  await assert.rejects(
    () => capability.generate({ lane: "derivation", system: "contract", input: {}, schema: {} }),
    (error: unknown) => {
      assert.ok(error instanceof ExtractionProviderError);
      assert.equal(error.failureClass, "provider_rejected");
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(redirect, "manual");
  assert.equal(cancelled, true);
});

test("HTTP extraction accepts only explicitly complete derivation and reflection responses", async () => {
  const reasons = ["length", "content_filter", "tool_calls", "function_call", "unknown", null] as const;
  for (const lane of ["derivation", "reflection"] as const) {
    for (const reason of reasons) {
      const capability = createHttpExtraction({
        baseUrl: "https://models.example.test/v1",
        model: "completion-state",
        modelFingerprint: fingerprint,
        fetch: fakeFetch((async () => Response.json({
          choices: [{
            ...(reason === null ? {} : { finish_reason: reason }),
            message: { content: '{"action":"abstain"}' },
          }],
        }))),
      });
      await assert.rejects(
        () => capability.generate({ lane, system: "contract", input: {}, schema: {} }),
        (error: unknown) => {
          assert.ok(error instanceof ExtractionProviderError);
          assert.equal(error.failureClass, "provider_protocol");
          assert.equal(error.retryable, false);
          return true;
        },
      );
    }
  }
});

test("HTTP extraction configuration fails closed without stopping canonical SQL", () => {
  assert.deepEqual(configureHttpExtraction({}), { state: "disabled" });
  assert.deepEqual(configureHttpExtraction({ baseUrl: "https://models.example.test/v1" }), {
    state: "configured_error",
  });
  assert.deepEqual(configureHttpExtraction({ apiKey: "orphan-secret" }), {
    state: "configured_error",
  });
  assert.deepEqual(configureHttpExtraction({ timeoutMs: 1_000 }), {
    state: "configured_error",
  });
  assert.deepEqual(configureHttpExtraction({
    baseUrl: "https://models.example.test/v1",
    model: "sol",
    modelFingerprint: fingerprint,
    responseMode: "automatic",
  }), { state: "configured_error" });
  assert.deepEqual(configureHttpExtraction({
    baseUrl: "http://models.example.test/v1",
    model: "sol",
    modelFingerprint: fingerprint,
  }), { state: "configured_error" });
  assert.deepEqual(configureHttpExtraction({
    baseUrl: "https://models.example.test/v1",
    model: "sol",
    modelFingerprint: fingerprint,
    timeoutMs: 60_000,
  }), { state: "configured_error" });
  assert.throws(() => createHttpExtraction({
    baseUrl: "https://user:secret@models.example.test/v1",
    model: "sol",
    modelFingerprint: fingerprint,
  }), /without credentials/u);
});

test("Cloudflare background enrichment treats an explicit flag as operator intent", () => {
  assert.equal(backgroundEnrichment({} as any, "disabled"), "disabled");
  assert.equal(backgroundEnrichment({ TITEN_ENRICHMENT_BACKGROUND: "0" } as any, "disabled"), "disabled");
  assert.equal(backgroundEnrichment({ TITEN_ENRICHMENT_BACKGROUND: "1" } as any, "disabled"), "configured_error");
  assert.equal(backgroundEnrichment({ TITEN_ENRICHMENT_BACKGROUND: "invalid" } as any, "disabled"), "configured_error");
  assert.equal(backgroundEnrichment({ TITEN_ENRICHMENT_BACKGROUND: "1" } as any, "enabled"), "enabled");
  assert.equal(backgroundEnrichment({} as any, "configured_error"), "configured_error");
});

test("HTTP extraction classifies provider failures without response text", async () => {
  let cancelled = false;
  const capability = createHttpExtraction({
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "sol",
    modelFingerprint: fingerprint,
    fetch: fakeFetch((async () => new Response(new ReadableStream({
      cancel() { cancelled = true; },
    }), { status: 429 }))),
  });
  await assert.rejects(
    () => capability.generate({
      lane: "reflection",
      system: "contract",
      input: {},
      schema: {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof ExtractionProviderError);
      assert.equal(error.failureClass, "provider_unavailable");
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /private provider failure/u);
      return true;
    },
  );
  assert.equal(cancelled, true);
});

test("HTTP extraction cancels a response whose declared size exceeds the ceiling", async () => {
  let cancelled = false;
  const capability = createHttpExtraction({
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "sol",
    modelFingerprint: fingerprint,
    fetch: fakeFetch((async () => new Response(new ReadableStream({
      cancel() { cancelled = true; },
    }), { headers: { "content-length": String(128 * 1024 + 1) } }))),
  });
  await assert.rejects(
    () => capability.generate({ lane: "derivation", system: "contract", input: {}, schema: {} }),
    (error: unknown) => {
      assert.ok(error instanceof ExtractionProviderError);
      assert.equal(error.failureClass, "provider_protocol");
      return true;
    },
  );
  assert.equal(cancelled, true);
});

test("HTTP extraction stops a chunked response at the byte ceiling", async () => {
  const chunk = new Uint8Array(70 * 1024).fill(65);
  const capability = createHttpExtraction({
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "sol",
    modelFingerprint: fingerprint,
    fetch: fakeFetch((async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    })))),
  });
  await assert.rejects(
    () => capability.generate({
      lane: "derivation",
      system: "contract",
      input: {},
      schema: {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof ExtractionProviderError);
      assert.equal(error.failureClass, "provider_protocol");
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

function countingInner(): ExtractionCapability & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    modelId: "sol-locked",
    modelFingerprint: fingerprint,
    providerIdentity: "https://models.example.test/v1",
    async generate(request) {
      calls.push(request.lane);
      return { action: "add", claims: [] };
    },
  };
}

function gateAnswering(yes: unknown, seen: { url?: string; init?: RequestInit }[] = []) {
  return fakeFetch((async (input, init) => {
    seen.push({ url: String(input), init });
    return Response.json({ answers: { durable: { type: "noul", noul: yes } } });
  }));
}

const derivation = {
  lane: "derivation" as const,
  system: "system contract",
  input: { observation: { observation_id: "obs_1", content: "untrusted" } },
  schema: { type: "object" },
};

test("Decision gate turns only a confident no into an abstain without the generative call", async () => {
  const inner = countingInner();
  const seen: { url?: string; init?: RequestInit }[] = [];
  const gated = createHttpDecisionGate(inner, {
    url: "https://api.typesafe.example.test/v1/systemone",
    model: "jev-1.13.0",
    apiKey: "gate-secret",
    fetch: gateAnswering(0.02, seen),
  });
  assert.deepEqual(await gated.generate(derivation), { action: "abstain", claims: null });
  assert.deepEqual(inner.calls, []);
  assert.equal(seen[0]!.url, "https://api.typesafe.example.test/v1/systemone");
  assert.equal(seen[0]!.init!.redirect, "manual");
  assert.equal((seen[0]!.init!.headers as Record<string, string>).authorization, "Bearer gate-secret");
  const body = JSON.parse(String(seen[0]!.init!.body));
  assert.equal(body.model, "jev-1.13.0");
  assert.deepEqual(body.state, derivation.input);
  assert.equal(body.questions.durable.type, "noul");
  assert.doesNotMatch(String(seen[0]!.init!.body), /gate-secret/u);
  assert.notEqual(gated.providerIdentity, inner.providerIdentity);
});

test("Decision gate delegates uncertain yes answers, reflection, and every gate failure", async () => {
  for (const fetch of [
    gateAnswering(0.1),
    gateAnswering(0.5),
    gateAnswering("0.01"),
    gateAnswering(-0.1),
    fakeFetch((async () => new Response("down", { status: 503 }))),
    fakeFetch((async () => new Response("not json"))),
    fakeFetch((async () => { throw new TypeError("offline"); })),
  ]) {
    const inner = countingInner();
    const gated = createHttpDecisionGate(inner, {
      url: "https://openrouter.example.test/api/v1/systemone",
      model: "typesafe/jev-1.13",
      fetch,
    });
    assert.deepEqual(await gated.generate(derivation), { action: "add", claims: [] });
    assert.deepEqual(inner.calls, ["derivation"]);
  }
  const inner = countingInner();
  let gateCalls = 0;
  const gated = createHttpDecisionGate(inner, {
    url: "https://api.typesafe.example.test/v1/systemone",
    model: "jev-1.13.0",
    fetch: fakeFetch((async () => { gateCalls += 1; return Response.json({}); })),
  });
  await gated.generate({ ...derivation, lane: "reflection" });
  assert.equal(gateCalls, 0);
  assert.deepEqual(inner.calls, ["reflection"]);
});

test("Decision gate configuration fails closed and never enables without extraction", () => {
  const extraction = {
    baseUrl: "https://models.example.test/v1",
    model: "sol",
    modelFingerprint: fingerprint,
  };
  const gate = { gateUrl: "https://api.typesafe.example.test/v1/systemone", gateModel: "jev-1.13.0" };
  assert.equal(configureHttpExtraction({ ...extraction, ...gate }).state, "enabled");
  assert.match(configureHttpExtraction({ ...extraction, ...gate }).capability!.providerIdentity!, /gate=/u);
  assert.doesNotMatch(configureHttpExtraction(extraction).capability!.providerIdentity!, /gate=/u);
  for (const config of [
    gate,
    { gateApiKey: "orphan-secret" },
    { ...extraction, gateUrl: gate.gateUrl },
    { ...extraction, gateApiKey: "orphan-secret" },
    { ...extraction, ...gate, gateModel: "jev-latest" },
    { ...extraction, ...gate, gateModel: "~typesafe/jev-latest" },
    { ...extraction, ...gate, gateUrl: "http://api.typesafe.example.test/v1/systemone" },
    { ...extraction, ...gate, gateAbstainBelow: 0.5 },
    { ...extraction, ...gate, gateAbstainBelow: Number.NaN },
    { ...extraction, ...gate, gateTimeoutMs: 45_000 },
  ]) assert.deepEqual(configureHttpExtraction(config), { state: "configured_error" }, JSON.stringify(config));
});
