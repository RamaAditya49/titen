import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { serve } from "../../src/runtime/bun/server";
import { provisionWith } from "../contract/harness";

/**
 * Signed webhook delivery against a real HTTP receiver over a real socket.
 *
 * The contract suite proves a delivery row is queued. This proves the request
 * actually leaves the process, arrives with a signature the receiver can verify
 * independently, and that a rejecting receiver is recorded as a failure rather
 * than silently dropped.
 */
const directory = mkdtempSync(join(tmpdir(), "titen-hook-"));
const dbPath = join(directory, "titen.db");
const SECRET = "webhook-shared-secret-value";

interface Received {
  signature: string | null;
  event: string | null;
  delivery: string | null;
  body: string;
}

let titen: Awaited<ReturnType<typeof serve>>;
let receiver: { stop: () => void; port: number };
let received: Received[] = [];
let rejectNext = false;
let key: string;

/** Independent verification: recompute the HMAC the way an integrator would. */
async function hmacHex(secret: string, payload: string): Promise<string> {
  const imported = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", imported, new TextEncoder().encode(payload));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${titen.url}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

beforeAll(async () => {
  titen = await serve({ dbPath, port: 0, hostname: "127.0.0.1", quiet: true, revision: "hook" });
  const provisioned = await provisionWith(createSqliteDb(openDatabase(dbPath)), { scopes: ["*"] });
  key = provisioned.key;

  // @ts-ignore - Bun global is provided by the runtime.
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request: Request) {
      received.push({
        signature: request.headers.get("x-titen-signature"),
        event: request.headers.get("x-titen-event"),
        delivery: request.headers.get("x-titen-delivery"),
        body: await request.text(),
      });
      return new Response(rejectNext ? "no" : "ok", { status: rejectNext ? 500 : 200 });
    },
  });
  receiver = { stop: () => server.stop(true), port: server.port };
});

afterAll(async () => {
  receiver.stop();
  await titen.stop();
  rmSync(directory, { recursive: true, force: true });
});

test("a delivered event arrives signed, and the signature verifies independently", async () => {
  received = [];
  rejectNext = false;

  const hook = await call("POST", "/v1/webhooks", {
    url: `http://127.0.0.1:${receiver.port}/sink`,
    secret: SECRET,
    events: ["*"],
  });
  assert.equal(hook.status, 201);

  // Any canonical write emits an event, which is what gets delivered.
  const observation = await call("POST", "/v1/observations", {
    subject_id: "user_hook",
    kind: "tool_result",
    content: "Webhook delivery integration evidence.",
    source: { type: "tool", ref: "hook#1" },
    trust: "verified",
  });
  assert.equal(observation.status, 201);

  const drained = await call("POST", "/v1/webhooks/deliver", {});
  assert.equal(drained.status, 200);
  assert.ok(drained.body.data.events_drained >= 1);

  assert.ok(received.length >= 1, "the receiver must have been contacted over HTTP");
  const first = received[0]!;
  assert.equal(first.event, "observation.appended");
  assert.ok(first.delivery?.startsWith("dlv_"), "a delivery id must identify the attempt");
  assert.match(first.signature ?? "", /^sha256=[0-9a-f]{64}$/);

  // The receiver can authenticate the payload without trusting the sender.
  const expected = await hmacHex(SECRET, first.body);
  assert.equal(
    first.signature,
    `sha256=${expected}`,
    "the signature must verify against the shared secret and the exact body",
  );

  // A tampered body must not verify, which is the property the header exists for.
  const tampered = await hmacHex(SECRET, `${first.body} `);
  assert.notEqual(first.signature, `sha256=${tampered}`);

  const payload = JSON.parse(first.body);
  assert.ok(payload, "the body must be the JSON event payload");
  assert.ok(
    !first.body.includes(SECRET) && !first.body.includes("titen_sk_"),
    "a delivery must carry no credential",
  );
});

test("a rejecting receiver is recorded as a failure and scheduled for retry", async () => {
  received = [];
  rejectNext = true;

  const hook = await call("POST", "/v1/webhooks", {
    url: `http://127.0.0.1:${receiver.port}/failing`,
    secret: SECRET,
    events: ["claim.materialized"],
  });
  assert.equal(hook.status, 201);
  const hookId = hook.body.data.webhook_id as string;

  const observation = await call("POST", "/v1/observations", {
    subject_id: "user_hook_fail",
    kind: "tool_result",
    content: "Evidence for a delivery that will be refused.",
    source: { type: "tool", ref: "hook#2" },
    trust: "verified",
  });
  await call("POST", "/v1/consolidations", {
    subject_id: "user_hook_fail",
    claims: [
      {
        kind: "procedural",
        statement: "A refused delivery must be retried, not lost.",
        sources: [
          { observation_id: observation.body.data.observation_id, relation: "supports" },
        ],
      },
    ],
  });

  await call("POST", "/v1/webhooks/deliver", {});
  assert.ok(received.length >= 1, "the failing receiver must still have been contacted");

  const deliveries = await call("GET", `/v1/webhooks/${hookId}/deliveries`, undefined);
  assert.equal(deliveries.status, 200);
  const attempted = deliveries.body.data.deliveries;
  assert.ok(attempted.length >= 1, "the attempt must be recorded");
  const record = attempted[0];
  assert.match(
    record.event_id,
    /^evt_/,
    "a delivery must identify the event it attempted, not its kind",
  );
  assert.equal(record.response_status, 500, "the receiver's status must be stored");
  assert.equal(record.attempts, 1);
  assert.ok(record.next_retry_at, "a failed delivery must be scheduled for retry");
  assert.equal(record.status, "pending", "it stays pending until attempts are exhausted");

  rejectNext = false;
});

test("an unreachable destination fails without taking down the request", async () => {
  received = [];
  // Port 9 discards traffic, so the connection cannot complete.
  const hook = await call("POST", "/v1/webhooks", {
    url: "http://127.0.0.1:9/unreachable",
    secret: SECRET,
    events: ["*"],
  });
  assert.equal(hook.status, 201);
  const hookId = hook.body.data.webhook_id as string;

  await call("POST", "/v1/observations", {
    subject_id: "user_hook_unreachable",
    kind: "tool_result",
    content: "Evidence whose delivery target does not answer.",
    source: { type: "tool", ref: "hook#3" },
    trust: "verified",
  });

  const drained = await call("POST", "/v1/webhooks/deliver", {});
  assert.equal(drained.status, 200, "a network failure must not fail the drain request");

  const deliveries = await call("GET", `/v1/webhooks/${hookId}/deliveries`, undefined);
  assert.ok(deliveries.body.data.deliveries.length >= 1, "the attempt is still recorded");
  assert.equal(
    deliveries.body.data.deliveries[0].response_status,
    null,
    "no status exists when the connection never completed",
  );
});

test("a second event of the same kind is also delivered", async () => {
  // The regression this file exists to prevent. Delivery dedup once matched on
  // event kind, so the first observation.appended was sent and every later one was
  // silently skipped forever.
  received = [];
  rejectNext = false;

  const hook = await call("POST", "/v1/webhooks", {
    url: `http://127.0.0.1:${receiver.port}/repeat`,
    secret: SECRET,
    events: ["observation.appended"],
  });
  assert.equal(hook.status, 201);
  const hookId = hook.body.data.webhook_id as string;

  const write = async (marker: string) => {
    const res = await call("POST", "/v1/observations", {
      subject_id: "user_hook_repeat",
      kind: "tool_result",
      content: `Repeat delivery evidence ${marker}.`,
      source: { type: "tool", ref: `repeat#${marker}` },
      trust: "verified",
    });
    assert.equal(res.status, 201);
    return res.body.data.observation_id as string;
  };

  await write("first");
  await call("POST", "/v1/webhooks/deliver", {});
  const afterFirst = (
    await call("GET", `/v1/webhooks/${hookId}/deliveries`, undefined)
  ).body.data.deliveries.length;
  assert.ok(afterFirst >= 1, "the first event of this kind must be delivered");

  await write("second");
  await call("POST", "/v1/webhooks/deliver", {});
  const afterSecond = (
    await call("GET", `/v1/webhooks/${hookId}/deliveries`, undefined)
  ).body.data.deliveries;

  assert.ok(
    afterSecond.length > afterFirst,
    `a later event of the same kind must also be delivered; had ${afterFirst}, now ${afterSecond.length}`,
  );
  // Each attempt names a distinct event, which is what makes dedup correct.
  const ids = afterSecond.map((d: any) => d.event_id);
  assert.equal(new Set(ids).size, ids.length, "each delivery must target one event");
});

test("draining twice does not deliver the same event twice", async () => {
  received = [];
  rejectNext = false;

  const hook = await call("POST", "/v1/webhooks", {
    url: `http://127.0.0.1:${receiver.port}/once`,
    secret: SECRET,
    events: ["*"],
  });
  const hookId = hook.body.data.webhook_id as string;

  await call("POST", "/v1/observations", {
    subject_id: "user_hook_once",
    kind: "tool_result",
    content: "Evidence that must be delivered exactly once.",
    source: { type: "tool", ref: "once#1" },
    trust: "verified",
  });

  await call("POST", "/v1/webhooks/deliver", {});
  const first = (await call("GET", `/v1/webhooks/${hookId}/deliveries`, undefined)).body.data
    .deliveries.length;
  await call("POST", "/v1/webhooks/deliver", {});
  const second = (await call("GET", `/v1/webhooks/${hookId}/deliveries`, undefined)).body.data
    .deliveries.length;

  assert.equal(second, first, "a repeated drain must not re-deliver an event");
});
