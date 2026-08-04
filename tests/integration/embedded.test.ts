import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { serve } from "../../src/runtime/bun/server";
import { TitenClient } from "../../src/sdk";
import { provisionWith } from "../contract/harness";

/**
 * In-process use: the handler `serve()` returns is the same one the socket
 * serves, so an embedded consumer reaches the kernel without a loopback hop.
 * The host name below never resolves — if this passes, no packet left.
 */
test("the returned app answers the client without a loopback round trip", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-embedded-"));
  const dbPath = join(directory, "titen.db");
  const running = await serve({ dbPath, port: 0, hostname: "127.0.0.1", quiet: true });
  const handle = openDatabase(dbPath);
  try {
    const provisioned = await provisionWith(createSqliteDb(handle), { scopes: ["*"] });
    const titen = new TitenClient({
      url: "http://embedded.invalid",
      key: provisioned.key,
      fetch: (input, init) => running.app(new Request(input, init)),
    });

    const observation = await titen.observe({
      subject_id: "user_embedded",
      kind: "tool_result",
      content: "Embedded call reached the kernel without opening a connection.",
      source: { type: "tool", ref: "embedded#1" },
      trust: "verified",
    });
    assert.match(observation.observation_id, /^obs_/);

    const consolidated = await titen.consolidate("user_embedded", [{
      kind: "procedural",
      statement: "In-process callers reuse the served handler.",
      confidence: 0.9,
      sources: [{ observation_id: observation.observation_id, relation: "supports" }],
    }]);
    const claimId = consolidated.claims[0]!.claim_id as string;

    const context = await titen.compile({
      subject_id: "user_embedded",
      task: "in-process handler reuse",
      max_tokens: 900,
    });
    assert.match(context.context_id, /^ctx_/);
    assert.ok(
      context.items.some((item) => item.claim_id === claimId),
      "the embedded client must receive the claim it just wrote",
    );
  } finally {
    handle.close();
    await running.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
