import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpExtraction, type ExtractionCapability } from "../../src/core/extraction";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { serve } from "../../src/runtime/bun/server";
import { provisionWith, TEST_SECRET_CIPHER } from "../contract/harness";

test("the Bun timer derives recallable memory without an operator drain", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-enrichment-runtime-"));
  const dbPath = join(directory, "titen.db");
  const capability: ExtractionCapability = {
    modelId: "runtime-fixture",
    modelFingerprint: "d".repeat(64),
    async generate(request) {
      if (request.lane === "reflection")
        return { action: "abstain", claims: null, links: null };
      return {
        action: "add",
        claims: [{
          kind: "semantic_fact",
          statement: "Background enrichment runs from the native Bun timer.",
          evidence_ids: [(request.input as any).observation.observation_id],
          valid_from: null,
          valid_to: null,
        }],
      };
    },
  };
  const running = await serve({
    dbPath,
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    revision: "enrichment-runtime",
    maintenanceIntervalMs: 50,
    extraction: capability,
    secretCipher: TEST_SECRET_CIPHER,
  });
  const database = openDatabase(dbPath);
  const db = createSqliteDb(database);
  try {
    const actor = await provisionWith(db, { scopes: ["*"] });
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${running.url}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${actor.key}`,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { response, body: await response.json() as any };
    };
    const observation = await call("POST", "/v1/observations", {
      subject_id: "subject_runtime",
      kind: "user_statement",
      content: "The Bun timer should enrich this raw conversation.",
      source: { type: "runtime_fixture" },
    });
    assert.equal(observation.response.status, 201);

    let recalled = false;
    const deadline = Date.now() + 5_000;
    while (!recalled && Date.now() < deadline) {
      const context = await call("POST", "/v1/context/compile", {
        subject_id: "subject_runtime",
        task: "background enrichment native Bun timer",
        max_tokens: 400,
      });
      assert.equal(context.response.status, 200);
      recalled = context.body.data.items.some(
        (item: any) => item.claim === "Background enrichment runs from the native Bun timer.",
      );
      if (!recalled) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(recalled, true);
  } finally {
    database.close();
    await running.stop();
    rmSync(directory, { recursive: true, force: true });
  }
}, 10_000);

test("an embedded Bun caller can explicitly disable a supplied extractor", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-enrichment-disabled-"));
  const dbPath = join(directory, "titen.db");
  const running = await serve({
    dbPath,
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    maintenanceIntervalMs: 0,
    extractionState: "disabled",
    extraction: {
      modelId: "unused-fixture",
      modelFingerprint: "e".repeat(64),
      async generate() {
        throw new Error("disabled extractor must not run");
      },
    },
    secretCipher: TEST_SECRET_CIPHER,
  });
  try {
    const response = await fetch(`${running.url}/readyz`);
    const body = await response.json() as any;
    assert.equal(response.status, 200);
    assert.equal(body.data.capabilities.extraction, "disabled");
    assert.equal(body.data.capabilities.background_enrichment, "disabled");
  } finally {
    await running.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Bun readiness exposes the configured extraction response mode", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-enrichment-mode-"));
  const running = await serve({
    dbPath: join(directory, "titen.db"),
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    maintenanceIntervalMs: 0,
    extraction: createHttpExtraction({
      baseUrl: "https://models.example.test/v1",
      model: "compat",
      modelFingerprint: "f".repeat(64),
      responseMode: "json_object",
      fetch: (async () => { throw new Error("readiness must not call the provider"); }) as typeof fetch,
    }),
    extractionState: "enabled",
    secretCipher: TEST_SECRET_CIPHER,
  });
  try {
    const response = await fetch(`${running.url}/readyz`);
    const body = await response.json() as any;
    assert.equal(response.status, 200);
    assert.equal(body.data.capabilities.extraction, "enabled");
    assert.equal(body.data.capabilities.extraction_response_mode, "json_object");
  } finally {
    await running.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an incomplete HTTP completion leaves no durable semantic output", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-enrichment-incomplete-"));
  const dbPath = join(directory, "titen.db");
  const running = await serve({
    dbPath,
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    maintenanceIntervalMs: 0,
    extraction: createHttpExtraction({
      baseUrl: "https://models.example.test/v1",
      model: "incomplete",
      modelFingerprint: "a".repeat(64),
      fetch: (async () => Response.json({
        choices: [{
          finish_reason: "length",
          message: { content: '{"action":"add","claims":[]}' },
        }],
      })) as typeof fetch,
    }),
    extractionState: "enabled",
    secretCipher: TEST_SECRET_CIPHER,
  });
  const database = openDatabase(dbPath);
  const db = createSqliteDb(database);
  try {
    const actor = await provisionWith(db, { scopes: ["*"] });
    const headers = {
      authorization: `Bearer ${actor.key}`,
      "content-type": "application/json",
    };
    const observation = await fetch(`${running.url}/v1/observations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        subject_id: "subject_incomplete",
        kind: "user_statement",
        content: "Synthetic incomplete completion evidence.",
        source: { type: "test" },
      }),
    });
    assert.equal(observation.status, 201);
    const drain = await fetch(`${running.url}/v1/enrichment/drain?limit=1`, {
      method: "POST",
      headers,
    });
    assert.equal(drain.status, 200);
    assert.equal((await drain.json() as any).data.failed, 1);
    assert.deepEqual(await db.all(
      `SELECT state, error_class, output_hash FROM enrichment_jobs`,
    ), [{ state: "failed", error_class: "provider_protocol", output_hash: null }]);
    assert.deepEqual(await db.all(
      `SELECT (SELECT COUNT(*) FROM claims) AS claims,
              (SELECT COUNT(*) FROM claim_sources) AS sources,
              (SELECT COUNT(*) FROM enrichment_commits) AS commits,
              (SELECT COUNT(*) FROM claims_fts) AS fts_rows`,
    ), [{ claims: 0, sources: 0, commits: 0, fts_rows: 0 }]);
  } finally {
    database.close();
    await running.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
