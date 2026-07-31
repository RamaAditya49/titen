import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Stmt } from "../../src/core/db";
import { runMaintenance } from "../../src/core/maintenance";
import { migrate } from "../../src/core/migrations";
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
    expected_version: 1,
  });

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && (await pendingCount(db)) > 0)
    await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(await pendingCount(db), 0, "the queue must not stall on an ineligible claim");
});

test("background repair removes vectors queued by evidence purge", async () => {
  const observation = await api("POST", "/v1/observations", {
    subject_id: "user_maint_purge",
    kind: "tool_result",
    content: "Evidence whose indexed claim will be purged.",
    source: { type: "tool", ref: "maint#purge" },
    trust: "verified",
  });
  const consolidated = await api("POST", "/v1/consolidations", {
    subject_id: "user_maint_purge",
    claims: [{
      kind: "procedural",
      statement: "Background repair must remove this vector after purge.",
      sources: [{ observation_id: observation.observation_id, relation: "supports" }],
    }],
  });
  const claimId = consolidated.claims[0].claim_id as string;
  let deadline = Date.now() + 5_000;
  while (Date.now() < deadline && !vectors.metadataFor(claimId))
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(vectors.metadataFor(claimId), "fixture must observe the indexed vector before purge");

  await api("DELETE", `/v1/observations/${observation.observation_id}`);
  deadline = Date.now() + 5_000;
  while (Date.now() < deadline && vectors.metadataFor(claimId))
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(vectors.metadataFor(claimId), undefined);
  assert.equal(await pendingCount(db), 0);
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

test("maintenance deletes only one bounded page of expired execution state", async () => {
  const handle = openDatabase(join(directory, "ephemeral.db"));
  const isolated = createSqliteDb(handle);
  await migrate(isolated);
  const actor = await provisionWith(isolated, { scopes: ["*"] });
  const now = new Date("2026-07-31T12:00:00.000Z");
  const expired = [
    "2026-07-30T00:00:00.000Z",
    "2026-07-30T00:01:00.000Z",
    "2026-07-30T00:02:00.000Z",
  ];
  const future = "2026-08-01T00:00:00.000Z";
  const statements: Stmt[] = [];
  for (let index = 0; index < expired.length; index += 1) {
    statements.push(
      {
        sql: `INSERT INTO idempotency_v3
                (org_id, principal_id, key_id, request_identity, key_hash, request_hash, status, response, created_at, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, 201, '{}', ?, ?)`,
        params: [
          actor.orgId, actor.principalId, actor.keyId, `POST /expired/${index}`, `expired-key-${index}`,
          `request-${index}`, expired[index]!, expired[index]!,
        ],
      },
      {
        sql: `INSERT INTO checkpoints
                (id, org_id, subject_id, agent_id, kind, state, state_hash, ttl_seconds,
                 expires_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'cursor', '{}', 'hash', 60, ?, ?, ?)`,
        params: [
          `ckpt_expired_${index}`, actor.orgId, `cleanup-subject-${index}`, actor.principalId,
          expired[index]!, expired[index]!, expired[index]!,
        ],
      },
    );
  }
  statements.push(
    {
      sql: `INSERT INTO idempotency_v3
              (org_id, principal_id, key_id, request_identity, key_hash, request_hash, status, response, created_at, expires_at)
            VALUES (?, ?, ?, 'POST /active', 'active-key', 'active-request', 201, '{}', ?, ?)`,
      params: [actor.orgId, actor.principalId, actor.keyId, now.toISOString(), future],
    },
    {
      sql: `INSERT INTO checkpoints
              (id, org_id, subject_id, agent_id, kind, state, state_hash, ttl_seconds,
               expires_at, created_at, updated_at)
            VALUES ('ckpt_active', ?, 'cleanup-subject-active', ?, 'cursor', '{}', 'hash', 60, ?, ?, ?)`,
      params: [actor.orgId, actor.principalId, future, now.toISOString(), now.toISOString()],
    },
    {
      sql: `INSERT INTO leases
              (id, org_id, resource_type, resource_id, holder_id, purpose, ttl_seconds,
               expires_at, created_at, released_at)
            VALUES ('lease_released_first', ?, 'task', 'released-first', ?, 'test', 60, ?, ?, ?)`,
      params: [actor.orgId, actor.principalId, future, expired[0]!, expired[0]!],
    },
    {
      sql: `INSERT INTO leases
              (id, org_id, resource_type, resource_id, holder_id, purpose, ttl_seconds,
               expires_at, created_at, released_at)
            VALUES ('lease_expired', ?, 'task', 'expired', ?, 'test', 60, ?, ?, NULL)`,
      params: [actor.orgId, actor.principalId, expired[1]!, expired[1]!],
    },
    {
      sql: `INSERT INTO leases
              (id, org_id, resource_type, resource_id, holder_id, purpose, ttl_seconds,
               expires_at, created_at, released_at)
            VALUES ('lease_released_later', ?, 'task', 'released-later', ?, 'test', 60, ?, ?, ?)`,
      params: [actor.orgId, actor.principalId, future, expired[2]!, expired[2]!],
    },
    {
      sql: `INSERT INTO leases
              (id, org_id, resource_type, resource_id, holder_id, purpose, ttl_seconds,
               expires_at, created_at, released_at)
            VALUES ('lease_active', ?, 'task', 'active', ?, 'test', 60, ?, ?, NULL)`,
      params: [actor.orgId, actor.principalId, future, now.toISOString()],
    },
    {
      sql: `INSERT INTO events
              (id, org_id, kind, actor_id, resource_type, resource_id, payload, created_at)
            VALUES ('evt_cleanup_sentinel', ?, 'cleanup.sentinel', ?, 'test', 'sentinel', '{}', ?)`,
      params: [actor.orgId, actor.principalId, expired[0]!],
    },
    {
      sql: `INSERT INTO record_history
              (id, org_id, record_type, record_id, version, change_kind, actor_id, snapshot_hash, changed_at)
            VALUES ('hist_cleanup_sentinel', ?, 'test', 'sentinel', 1, 'append', ?, 'hash', ?)`,
      params: [actor.orgId, actor.principalId, expired[0]!],
    },
  );
  await isolated.batch(statements);

  const result = await runMaintenance({
    db: isolated,
    now,
    limit: 2,
    deliverWebhooks: false,
  });
  assert.deepEqual(result.errors, []);
  const counts = (await isolated.all<Record<string, number>>(
    `SELECT
       (SELECT COUNT(*) FROM idempotency_v3 WHERE expires_at <= ?) AS expired_idempotency,
       (SELECT COUNT(*) FROM idempotency_v3 WHERE expires_at > ?) AS active_idempotency,
       (SELECT COUNT(*) FROM checkpoints WHERE expires_at <= ?) AS expired_checkpoints,
       (SELECT COUNT(*) FROM checkpoints WHERE expires_at > ?) AS active_checkpoints,
       (SELECT COUNT(*) FROM leases WHERE released_at IS NOT NULL OR expires_at <= ?) AS inactive_leases,
       (SELECT COUNT(*) FROM leases WHERE released_at IS NULL AND expires_at > ?) AS active_leases,
       (SELECT COUNT(*) FROM events WHERE id = 'evt_cleanup_sentinel') AS events,
       (SELECT COUNT(*) FROM record_history WHERE id = 'hist_cleanup_sentinel') AS history`,
    [now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString()],
  ))[0]!;
  assert.deepEqual(
    Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)])),
    {
      expired_idempotency: 1,
      active_idempotency: 1,
      expired_checkpoints: 1,
      active_checkpoints: 1,
      inactive_leases: 1,
      active_leases: 1,
      events: 1,
      history: 1,
    },
  );
  handle.close();
});
