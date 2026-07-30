import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { serve } from "../../src/runtime/bun/server";
import { fakeVectors, provisionWith } from "../contract/harness";

/**
 * Indexing has to happen on its own.
 *
 * Before the maintenance timer existed, a deployment with a vector capability
 * searched an index nothing ever populated: every write queued an outbox row and
 * no code consumed it, so semantic retrieval silently returned nothing forever
 * unless an operator remembered to call the drain endpoint. This asserts the
 * service closes that loop itself, and that a caller never has to know.
 */
const directory = mkdtempSync(join(tmpdir(), "titen-maint-"));
const vectors = fakeVectors();

let running: Awaited<ReturnType<typeof serve>>;
let key: string;

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${running.url}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json.data;
}

const pendingCount = async (db: ReturnType<typeof createSqliteDb>) => {
  const rows = await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM index_outbox WHERE state = 'pending'`,
  );
  return Number(rows[0]!.count);
};

let db: ReturnType<typeof createSqliteDb>;

beforeAll(async () => {
  const dbPath = join(directory, "titen.db");
  // A short interval so the test observes real elapsed behavior, not a mock clock.
  running = await serve({
    dbPath,
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    revision: "maint",
    maintenanceIntervalMs: 250,
    vectors,
  });
  db = createSqliteDb(openDatabase(dbPath));
  const provisioned = await provisionWith(db, { scopes: ["*"] });
  key = provisioned.key;
});

afterAll(async () => {
  await running.stop();
  rmSync(directory, { recursive: true, force: true });
});

test("a written claim is indexed without anyone calling the drain endpoint", async () => {
  const observation = await api("POST", "/v1/observations", {
    subject_id: "user_maint",
    kind: "tool_result",
    content: "Evidence whose claim must be indexed automatically.",
    source: { type: "tool", ref: "maint#1" },
    trust: "verified",
  });
  const consolidated = await api("POST", "/v1/consolidations", {
    subject_id: "user_maint",
    claims: [
      {
        kind: "procedural",
        statement: "Automatic indexing must require no operator action.",
        sources: [{ observation_id: observation.observation_id, relation: "supports" }],
      },
    ],
  });
  const claimId = consolidated.claims[0].claim_id as string;

  // The write queued outbox rows. Nothing below calls /v1/index/drain.
  assert.ok((await pendingCount(db)) > 0, "the write must queue indexing work");

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && (await pendingCount(db)) > 0)
    await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(
    await pendingCount(db),
    0,
    "the maintenance pass must drain the queue on its own",
  );

  // Drained is not the same as indexed: the claim must be searchable by vector.
  const hits = await vectors.store.query(new Float32Array([1, 0, 0, 0]), { topK: 10 });
  assert.ok(
    hits.some((hit) => hit.id === claimId),
    "the claim must be present in the vector index",
  );
});

test("readiness reports the maintenance timer that is actually running", async () => {
  const response = await fetch(`${running.url}/readyz`);
  const body = (await response.json()) as any;
  assert.equal(response.status, 200);
  assert.equal(body.data.capabilities.background_repair, "enabled");
});

test("a claim that stopped being retrievable is retired, not embedded forever", async () => {
  const observation = await api("POST", "/v1/observations", {
    subject_id: "user_maint_retire",
    kind: "tool_result",
    content: "Evidence for a claim that gets revoked before indexing settles.",
    source: { type: "tool", ref: "maint#2" },
    trust: "verified",
  });
  const consolidated = await api("POST", "/v1/consolidations", {
    subject_id: "user_maint_retire",
    claims: [
      {
        kind: "procedural",
        statement: "This claim will be revoked.",
        sources: [{ observation_id: observation.observation_id, relation: "supports" }],
      },
    ],
  });
  await api("POST", `/v1/claims/${consolidated.claims[0].claim_id}/revoke`, {
    reason: "no longer applicable",
  });

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && (await pendingCount(db)) > 0)
    await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(await pendingCount(db), 0, "the queue must not stall on an ineligible claim");
});

test("the queue drains again after new work arrives", async () => {
  const before = vectors.embedCalls();
  const observation = await api("POST", "/v1/observations", {
    subject_id: "user_maint_again",
    kind: "tool_result",
    content: "A second batch of evidence arriving later.",
    source: { type: "tool", ref: "maint#3" },
    trust: "verified",
  });
  await api("POST", "/v1/consolidations", {
    subject_id: "user_maint_again",
    claims: [
      {
        kind: "procedural",
        statement: "Later work is picked up by a later pass.",
        sources: [{ observation_id: observation.observation_id, relation: "supports" }],
      },
    ],
  });

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && (await pendingCount(db)) > 0)
    await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(await pendingCount(db), 0, "a later pass must drain later work");
  assert.ok(
    vectors.embedCalls() > before,
    "the embedder must have been called again for the new batch",
  );
});
