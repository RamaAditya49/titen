import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { serve } from "../../src/runtime/bun/server";
import { signPayload } from "../../src/core/webhooks";
import { provisionWith, TEST_SECRET_CIPHER } from "../contract/harness";

/**
 * Federation between two independent deployments, over real HTTP.
 *
 * Each side is its own process-level service with its own database and its own
 * credentials, exactly as two regions would be. Titen ships no transport of its
 * own: an operator's scheduler pulls from one deployment and pushes into the
 * other. This exercises that composition end to end, which is the part the
 * contract suite cannot reach because it runs against a single deployment.
 */
const directory = mkdtempSync(join(tmpdir(), "titen-fed-"));
const PEER_SECRET = "federation-shared-secret-value";

interface Node {
  server: Awaited<ReturnType<typeof serve>>;
  key: string;
  orgId: string;
}

let west: Node;
let east: Node;
/** Registered once: a peer is unique per endpoint, as a real pairing is. */
let outbound: string;
let inbound: string;

async function boot(name: string): Promise<Node> {
  const dbPath = join(directory, `${name}.db`);
  const server = await serve({
    dbPath,
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    revision: name,
    maintenanceIntervalMs: 0,
    secretCipher: TEST_SECRET_CIPHER,
  });
  const provisioned = await provisionWith(createSqliteDb(openDatabase(dbPath)), {
    scopes: ["*"],
  });
  return { server, key: provisioned.key, orgId: provisioned.orgId };
}

async function call(
  node: Node,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(`${node.server.url}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${node.key}`,
      ...extraHeaders,
    },
    body: serialized,
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** What an operator's scheduler does: sign the batch as the registered peer. */
async function signedPush(node: Node, payload: unknown) {
  const serialized = JSON.stringify(payload);
  const signature = await signPayload(PEER_SECRET, serialized);
  const res = await fetch(`${node.server.url}/v1/federation/push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${node.key}`,
      "x-titen-peer-signature": `sha256=${signature}`,
    },
    body: serialized,
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function registerPeer(node: Node, other: Node, direction: string) {
  const res = await call(node, "POST", "/v1/federation/peers", {
    name: `peer-${direction}`,
    endpoint: other.server.url,
    shared_secret: PEER_SECRET,
    direction,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.peer_id as string;
}

beforeAll(async () => {
  west = await boot("west");
  east = await boot("east");
  outbound = await registerPeer(west, east, "pull");
  inbound = await registerPeer(east, west, "push");
});

afterAll(async () => {
  await west.server.stop();
  await east.server.stop();
  rmSync(directory, { recursive: true, force: true });
});

test("the two deployments are genuinely separate services", async () => {
  assert.notEqual(west.server.url, east.server.url, "each side listens on its own port");
  assert.notEqual(west.orgId, east.orgId, "each side has its own organization");

  // A credential from one deployment is meaningless at the other.
  const crossed = await fetch(`${east.server.url}/v1/events`, {
    headers: { authorization: `Bearer ${west.key}` },
  });
  assert.equal(crossed.status, 401, "a foreign credential must not authenticate");
});

test("events cross the network from one deployment into the other", async () => {
  // Write real memory on the west side.
  const observation = await call(west, "POST", "/v1/observations", {
    subject_id: "user_fed",
    kind: "tool_result",
    content: "Regional rollout evidence recorded in the west deployment.",
    source: { type: "tool", ref: "fed#1" },
    trust: "verified",
  });
  assert.equal(observation.status, 201);

  // East holds nothing yet.
  const before = await call(east, "GET", "/v1/events");
  assert.equal(before.body.data.events.length, 0, "the east side starts empty");

  // The operator pulls from west over HTTP, then pushes into east over HTTP.
  const pulled = await call(west, "POST", "/v1/federation/pull", { peer_id: outbound });
  assert.equal(pulled.status, 200);
  assert.ok(pulled.body.data.events.length >= 1, "west must offer its events");

  const pushed = await signedPush(east, {
    peer_id: inbound,
    events: pulled.body.data.events,
  });
  assert.equal(pushed.status, 200, JSON.stringify(pushed.body));
  const applied = pushed.body.data.results.filter((r: any) => r.status === "success");
  assert.ok(
    applied.length >= 1,
    `expected accepted events, got ${JSON.stringify(pushed.body.data.results)}`,
  );

  // Remote identity and canonical pointers remain untrusted. The receiving
  // principal sees local wrappers, never remote rows with local authority.
  const after = await call(east, "GET", "/v1/events");
  assert.equal(after.body.data.events.length, applied.length);
  const remoteById = new Map(pulled.body.data.events.map((event: any) => [event.id, event]));
  for (const wrapper of after.body.data.events) {
    assert.equal(wrapper.kind, "federation.received");
    assert.equal(wrapper.resource_type, "federated_event");
    assert.equal(wrapper.resource_id, wrapper.id);
    assert.deepEqual(wrapper.payload.untrusted_remote_event, remoteById.get(wrapper.id));
  }

  // Both sides recorded the exchange.
  const sent = await call(west, "GET", `/v1/federation/log?peer_id=${outbound}`);
  assert.ok((sent.body.data.entries ?? []).length >= 1, "the sender logged the exchange");
  const got = await call(east, "GET", `/v1/federation/log?peer_id=${inbound}`);
  assert.ok((got.body.data.entries ?? []).length >= 1, "the receiver logged the exchange");
  assert.ok(
    got.body.data.entries.some((entry: any) => entry.status === "success"),
    "the receiver must durably record a successful signed exchange",
  );
});

test("a replayed batch is preserved as a conflict rather than duplicated", async () => {
  await call(west, "POST", "/v1/observations", {
    subject_id: "user_fed_replay",
    kind: "tool_result",
    content: "Evidence that will be delivered twice on purpose.",
    source: { type: "tool", ref: "fed#replay" },
    trust: "verified",
  });

  const pulled = await call(west, "POST", "/v1/federation/pull", { peer_id: outbound });
  const batch = pulled.body.data.events;
  assert.ok(batch.length >= 1);

  const first = await signedPush(east, { peer_id: inbound, events: batch });
  assert.equal(first.status, 200);

  const countAfterFirst = (await call(east, "GET", "/v1/events?limit=200")).body.data.events
    .length;

  // The same batch again: nothing new, and the collision is reported, not hidden.
  const second = await signedPush(east, { peer_id: inbound, events: batch });
  assert.equal(second.status, 200);
  assert.ok(
    second.body.data.results.every((r: any) => r.status === "conflict"),
    `a replay must report conflicts, got ${JSON.stringify(second.body.data.results)}`,
  );

  const countAfterSecond = (await call(east, "GET", "/v1/events?limit=200")).body.data.events
    .length;
  assert.equal(countAfterSecond, countAfterFirst, "a replay must not duplicate records");
});

test("an unsigned or wrongly signed batch is refused", async () => {
  const payload = {
    peer_id: inbound,
    events: [
      {
        id: "evt_forged00000000000000000000000",
        kind: "observation.appended",
        actor_id: "attacker",
        resource_type: "observation",
        resource_id: "obs_forged00000000000000000000000",
        payload: {},
        created_at: new Date().toISOString(),
      },
    ],
  };

  // No signature at all.
  const unsigned = await call(east, "POST", "/v1/federation/push", payload);
  assert.equal(unsigned.status, 403, "an unsigned batch must be refused");

  // A signature computed with the wrong key.
  const serialized = JSON.stringify(payload);
  const wrong = await signPayload("not-the-shared-secret-value", serialized);
  const forged = await fetch(`${east.server.url}/v1/federation/push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${east.key}`,
      "x-titen-peer-signature": `sha256=${wrong}`,
    },
    body: serialized,
  });
  assert.equal(forged.status, 403, "a batch signed with the wrong key must be refused");

  // Nothing was written by either attempt.
  const events = await call(east, "GET", "/v1/events?limit=200");
  assert.ok(
    !events.body.data.events.some((e: any) => e.actor_id === "attacker"),
    "a refused batch must write nothing",
  );
});

test("a filter keeps a peer's scope narrower than the sender's", async () => {
  // Only claim events may leave for this peer.
  const filter = await call(west, "POST", `/v1/federation/peers/${outbound}/filters`, {
    resource_type: "claim",
  });
  assert.equal(filter.status, 201);

  await call(west, "POST", "/v1/observations", {
    subject_id: "user_fed_filter",
    kind: "tool_result",
    content: "Observation that policy keeps inside the west deployment.",
    source: { type: "tool", ref: "fed#filter" },
    trust: "verified",
  });

  const pulled = await call(west, "POST", "/v1/federation/pull", { peer_id: outbound });
  assert.equal(pulled.status, 200);
  assert.ok(
    pulled.body.data.events.every((e: any) => e.resource_type === "claim"),
    `a filtered pull must exclude other resource types, got ${JSON.stringify(
      pulled.body.data.events.map((e: any) => e.resource_type),
    )}`,
  );
});
