import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  ExtractionProviderError,
  configureHttpExtraction,
  createHttpExtraction,
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
    fetch: (async (input, init) => {
      request = { input: String(input), init };
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ action: "abstain" }) } }],
      });
    }) as typeof fetch,
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
    fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: '{"action":"abstain"}' } }],
      });
    }) as typeof fetch,
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
    fetch: (async (_input, init) => {
      redirect = init?.redirect;
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
        status: 302,
        headers: { location: "https://elsewhere.example.test/" },
      });
    }) as typeof fetch,
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
        fetch: (async () => Response.json({
          choices: [{
            ...(reason === null ? {} : { finish_reason: reason }),
            message: { content: '{"action":"abstain"}' },
          }],
        })) as typeof fetch,
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
    fetch: (async () => new Response(new ReadableStream({
      cancel() { cancelled = true; },
    }), { status: 429 })) as typeof fetch,
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
    fetch: (async () => new Response(new ReadableStream({
      cancel() { cancelled = true; },
    }), { headers: { "content-length": String(128 * 1024 + 1) } })) as typeof fetch,
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
    fetch: (async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    }))) as typeof fetch,
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
