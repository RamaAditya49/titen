import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/core/app";
import { MAX_BODY_BYTES } from "../../src/core/http";
import { migrate } from "../../src/core/migrations";
import { serve } from "../../src/runtime/bun/server";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { provisionWith, TEST_SECRET_CIPHER } from "../contract/harness";

test("a chunked body above the limit is refused without reading it all", async () => {
  const handle = openDatabase(":memory:");
  const db = createSqliteDb(handle);
  try {
    await migrate(db);
    const provisioned = await provisionWith(db, { scopes: ["observations:write"] });
    const app = createApp({ db, runtime: "test" });
    // No Content-Length: the stream ends only after 16 MiB, far above the limit.
    const chunk = new Uint8Array(64 * 1024).fill(0x41);
    const total = 16 * 1024 * 1024;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= total) return controller.close();
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const response = await app(new Request("http://titen.test/v1/observations", {
      method: "POST",
      headers: { authorization: `Bearer ${provisioned.key}`, "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit));
    assert.equal(response.status, 413);
    assert.equal((await response.json() as any).error.code, "PAYLOAD_TOO_LARGE");
    assert.ok(
      pulled <= MAX_BODY_BYTES + 4 * chunk.byteLength,
      `the app read ${pulled} bytes; it must stop near the ${MAX_BODY_BYTES}-byte limit`,
    );
  } finally {
    handle.close();
  }
});

test("the Bun server refuses a body far above the limit before the app reads it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-body-"));
  const titen = await serve({
    dbPath: join(directory, "titen.db"),
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    revision: "body-limit",
    maintenanceIntervalMs: 0,
    secretCipher: TEST_SECRET_CIPHER,
  });
  try {
    // Just over the app limit: the app answers with its own envelope.
    const near = await fetch(`${titen.url}/v1/observations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "A".repeat(MAX_BODY_BYTES + 1),
    });
    assert.equal(near.status, 401, "the app authenticates before it reads the body");
    assert.ok(near.headers.get("x-request-id"), "the app answered");

    // Above twice the limit: the runtime refuses it, so the app never runs.
    const far = await fetch(`${titen.url}/v1/observations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "A".repeat(2 * MAX_BODY_BYTES + 1),
    });
    assert.equal(far.status, 413);
    assert.equal(far.headers.get("x-request-id"), null, "the runtime limit must answer before the app");
  } finally {
    await titen.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
