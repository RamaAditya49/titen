import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  ExtractionProviderError,
  configureHttpExtraction,
  createHttpExtraction,
} from "../../src/core/extraction";

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
        choices: [{ message: { content: JSON.stringify({ action: "abstain" }) } }],
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
  assert.equal(request!.init!.redirect, "error");
  assert.equal((request!.init!.headers as Record<string, string>).authorization, "Bearer test-secret");
  const body = JSON.parse(String(request!.init!.body));
  assert.equal(body.model, "sol-locked");
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 2_048);
  assert.equal(body.response_format.json_schema.strict, true);
  assert.match(body.messages[1].content, /^UNTRUSTED_INPUT_JSON/u);
  assert.doesNotMatch(String(request!.init!.body), /test-secret/u);
});

test("HTTP extraction configuration fails closed without stopping canonical SQL", () => {
  assert.deepEqual(configureHttpExtraction({}), { state: "disabled" });
  assert.deepEqual(configureHttpExtraction({ baseUrl: "https://models.example.test/v1" }), {
    state: "configured_error",
  });
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

test("HTTP extraction classifies provider failures without response text", async () => {
  const capability = createHttpExtraction({
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "sol",
    modelFingerprint: fingerprint,
    fetch: (async () => new Response("private provider failure", { status: 429 })) as typeof fetch,
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
