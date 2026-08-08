import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "../../src/core/db";
import {
  authenticate,
  createApiKey,
  LAST_USED_RESOLUTION_MS,
  organizationStatement,
} from "../../src/core/auth";
import { migrate } from "../../src/core/migrations";
import {
  createSecretCipher,
  migrateSigningSecrets,
  prepareSigningSecrets,
} from "../../src/core/secrets";
import {
  dispatchWebhook,
  isUnsafeWebhookAddress,
  validateWebhookDestination,
  type WebhookSecurity,
} from "../../src/core/webhook-security";
import { drainWebhookQueue } from "../../src/core/webhooks";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { pinnedLookup } from "../../src/runtime/bun/webhooks";

const KEY_ONE = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const KEY_TWO = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const directories: string[] = [];

function database(): { db: Db; close(): void } {
  const directory = mkdtempSync(join(tmpdir(), "titen-security-"));
  directories.push(directory);
  const handle = openDatabase(join(directory, "titen.db"));
  return { db: createSqliteDb(handle), close: () => handle.close() };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("last_used_at is coarsened so a read does not cost a durable write", async () => {
  const { db, close } = database();
  await migrate(db);
  const issued = new Date("2026-08-01T09:00:00.000Z");
  const key = await createApiKey({
    orgId: "org_key_coarsen",
    principalId: "agent_key_coarsen",
    principalKind: "agent",
    label: "coarsened key",
    scopes: ["context:compile"],
    maxTrust: "asserted",
    notBefore: issued,
    expiresAt: null,
  }, issued);
  await db.batch([organizationStatement("org_key_coarsen", "Coarsen", issued), key.statement]);
  const request = new Request("http://titen.test/v1/context/compile", {
    headers: { authorization: `Bearer ${key.key}` },
  });
  const stored = async () => (await db.all<{ last_used_at: string | null }>(
    "SELECT last_used_at FROM api_keys WHERE id = ?", [key.id],
  ))[0]!.last_used_at;

  const first = new Date("2026-08-01T10:00:00.000Z");
  await authenticate(db, request, first);
  assert.equal(await stored(), first.toISOString(), "the first use records itself");

  // Anything inside the interval leaves the row untouched, which is what keeps
  // the UPDATE from writing a WAL frame: SQLite skips the page when the CASE
  // resolves to the value already stored.
  await authenticate(db, request, new Date(first.getTime() + LAST_USED_RESOLUTION_MS - 1));
  assert.equal(await stored(), first.toISOString(), "a use inside the interval writes nothing");

  const later = new Date(first.getTime() + LAST_USED_RESOLUTION_MS + 1);
  await authenticate(db, request, later);
  assert.equal(await stored(), later.toISOString(), "a use past the interval refreshes it");

  // Monotonic under a backwards clock step larger than the interval.
  await authenticate(db, request, new Date(first.getTime() - LAST_USED_RESOLUTION_MS * 10));
  assert.equal(await stored(), later.toISOString(), "it never moves into the past");
  close();
});

test("API key lifecycle uses exact boundaries and monotonic atomic usage", async () => {
  const { db, close } = database();
  await migrate(db);
  const issued = new Date("2026-08-01T09:00:00.000Z");
  const key = await createApiKey({
    orgId: "org_key_lifecycle",
    principalId: "agent_key_lifecycle",
    principalKind: "agent",
    label: "bounded key",
    scopes: ["context:compile"],
    maxTrust: "asserted",
    notBefore: new Date("2026-08-01T10:00:00.000Z"),
    expiresAt: new Date("2026-08-01T11:00:00.000Z"),
  }, issued);
  await db.batch([organizationStatement("org_key_lifecycle", "Lifecycle", issued), key.statement]);
  const request = new Request("http://titen.test/v1/context/compile", {
    headers: { authorization: `Bearer ${key.key}` },
  });

  await assert.rejects(() => authenticate(db, request, new Date("2026-08-01T09:59:59.999Z")));
  assert.equal((await authenticate(db, request, new Date("2026-08-01T10:00:00.000Z"))).keyId, key.id);
  await authenticate(db, request, new Date("2026-08-01T10:30:00.000Z"));
  await authenticate(db, request, new Date("2026-08-01T10:20:00.000Z"));
  assert.equal((await db.all<{ last_used_at: string }>(
    "SELECT last_used_at FROM api_keys WHERE id = ?", [key.id],
  ))[0]!.last_used_at, "2026-08-01T10:30:00.000Z");
  await assert.rejects(() => authenticate(db, request, new Date("2026-08-01T11:00:00.000Z")));
  await assert.rejects(() => db.batch([{
    sql: "UPDATE api_keys SET expires_at = ? WHERE id = ?",
    params: ["2026-08-01T12:00:00.000Z", key.id],
  }]), /API_KEY_LIFECYCLE_IMMUTABLE/u);
  await db.batch([{
    sql: "UPDATE api_keys SET revoked_at = ? WHERE id = ?",
    params: ["2026-08-01T10:31:00.000Z", key.id],
  }]);
  await assert.rejects(() => authenticate(db, request, new Date("2026-08-01T10:32:00.000Z")));
  close();
});

test("signing secrets migrate from plaintext, rotate, and fail closed without the key", async () => {
  const { db, close } = database();
  await migrate(db);
  await db.batch([
    { sql: "INSERT INTO organizations(id, name, created_at) VALUES ('org_1', 'Org', '2026-07-30T00:00:00Z')" },
    {
      sql: `INSERT INTO webhooks(id, org_id, url, secret_hash, secret, events, status, created_at)
            VALUES ('whk_1', 'org_1', 'https://hooks.example.com/a', 'hash', ?, '*', 'active', '2026-07-30T00:00:00Z')`,
      params: ['{"legacy":"plaintext-secret"}'],
    },
    {
      sql: `INSERT INTO federation_peers(id, org_id, name, endpoint, shared_secret_hash, shared_secret, direction, status, created_at)
            VALUES ('fpeer_1', 'org_1', 'Peer', 'https://peer.example.com', 'hash', ?, 'push', 'active', '2026-07-30T00:00:00Z')`,
      params: ["federation-plaintext-secret"],
    },
    ...Array.from({ length: 55 }, (_, index) => ({
      sql: `INSERT INTO webhooks(id, org_id, url, secret_hash, secret, events, status, created_at)
            VALUES (?, 'org_1', ?, 'hash', ?, '*', 'paused', '2026-07-30T00:00:00Z')`,
      params: [
        `whk_page_${String(index).padStart(2, "0")}`,
        `https://hooks.example.com/page/${index}`,
        `page-plaintext-secret-${index}`,
      ],
    })),
  ]);

  assert.equal(await prepareSigningSecrets(db, undefined), false);
  const first = createSecretCipher({ active: "v1", keys: { v1: KEY_ONE } });
  assert.equal(await migrateSigningSecrets(db, first), 57);
  const encrypted = await db.all<{ secret: string }>("SELECT secret FROM webhooks WHERE id = 'whk_1'");
  assert.match(encrypted[0]!.secret, /^titen-secret:v1:/);
  assert.ok(!encrypted[0]!.secret.includes("plaintext-secret"));
  assert.equal(await first.decrypt(encrypted[0]!.secret, "webhook:whk_1"), '{"legacy":"plaintext-secret"}');
  await assert.rejects(() => first.decrypt(encrypted[0]!.secret, "webhook:other"));

  const rotating = createSecretCipher({ active: "v2", keys: { v1: KEY_ONE, v2: KEY_TWO } });
  assert.equal(await migrateSigningSecrets(db, rotating), 57);
  const rotated = await db.all<{ secret: string }>("SELECT secret FROM webhooks WHERE id = 'whk_1'");
  assert.match(rotated[0]!.secret, /"kid":"v2"/);
  const wrong = createSecretCipher({ active: "v2", keys: { v2: KEY_ONE } });
  assert.equal(await prepareSigningSecrets(db, wrong), false);
  assert.equal(await prepareSigningSecrets(db, createSecretCipher({ active: "v2", keys: { v2: KEY_TWO } })), true);
  await db.batch([{
    sql: `INSERT INTO webhooks(id, org_id, url, secret_hash, secret, events, status, created_at)
          VALUES ('whk_null', 'org_1', 'https://hooks.example.com/null', 'hash', NULL, '*', 'active', '2026-07-30T00:00:00Z')`,
  }, {
    sql: `INSERT INTO webhooks(id, org_id, url, secret_hash, secret, events, status, created_at)
          VALUES ('whk_paused_null', 'org_1', 'https://hooks.example.com/paused-null', 'hash', NULL, '*', 'paused', '2026-07-30T00:00:00Z')`,
  }, {
    sql: `INSERT INTO federation_peers(id, org_id, name, endpoint, shared_secret_hash, shared_secret, direction, status, created_at)
          VALUES ('fpeer_null', 'org_1', 'Null Peer', 'https://null-peer.example.com', 'hash', NULL, 'push', 'active', '2026-07-30T00:00:00Z')`,
  }, {
    sql: `INSERT INTO federation_peers(id, org_id, name, endpoint, shared_secret_hash, shared_secret, direction, status, created_at)
          VALUES ('fpeer_suspended_null', 'org_1', 'Suspended Null Peer', 'https://suspended-null-peer.example.com', 'hash', NULL, 'push', 'suspended', '2026-07-30T00:00:00Z')`,
  }]);
  assert.equal(await prepareSigningSecrets(db, rotating), true, "unrecoverable active NULL secrets are terminalized");
  assert.deepEqual(
    await db.all<{ id: string; status: string }>("SELECT id, status FROM webhooks WHERE id LIKE 'whk_%null' ORDER BY id"),
    [
      { id: "whk_null", status: "disabled" },
      { id: "whk_paused_null", status: "paused" },
    ],
  );
  assert.deepEqual(
    await db.all<{ id: string; status: string }>("SELECT id, status FROM federation_peers WHERE id LIKE 'fpeer_%null' ORDER BY id"),
    [
      { id: "fpeer_null", status: "suspended" },
      { id: "fpeer_suspended_null", status: "suspended" },
    ],
  );
  assert.equal((await db.all<{ status: string }>("SELECT status FROM webhooks WHERE id = 'whk_1'"))[0]!.status, "active");
  assert.equal((await db.all<{ status: string }>("SELECT status FROM federation_peers WHERE id = 'fpeer_1'"))[0]!.status, "active");
  close();
});

test("webhook validation rejects local addresses, rebinding, redirects, and unpinned connections", async () => {
  for (const address of ["127.0.0.1", "169.254.169.254", "10.0.0.1", "::1", "::ffff:127.0.0.1", "2001:db8::1"])
    assert.equal(isUnsafeWebhookAddress(address), true, address);

  let answers = ["93.184.216.34"];
  let dispatches = 0;
  const security: WebhookSecurity = {
    allowedHostnames: ["hooks.example.com"],
    resolve: async () => answers,
    dispatch: async ({ addresses }) => {
      dispatches += 1;
      return { response: new Response(null, { status: 200 }), connectedAddress: addresses[0]! };
    },
  };
  for (const url of ["https://127.0.0.1/x", "https://2130706433/x", "https://[::ffff:127.0.0.1]/x"])
    await assert.rejects(() => validateWebhookDestination(url, security));
  await assert.rejects(() => validateWebhookDestination("https://other.example.com/x", security));
  answers = ["169.254.169.254"];
  await assert.rejects(() => dispatchWebhook("https://hooks.example.com/x", security, {}));
  assert.equal(dispatches, 0, "rebinding must be rejected before outbound I/O");

  answers = ["93.184.216.34"];
  security.dispatch = async ({ addresses }) => ({
    response: new Response(null, { status: 302 }),
    connectedAddress: addresses[0]!,
  });
  await assert.rejects(() => dispatchWebhook("https://hooks.example.com/x", security, {}));
  security.dispatch = async () => ({ response: new Response(null, { status: 200 }), connectedAddress: "1.1.1.1" });
  await assert.rejects(() => dispatchWebhook("https://hooks.example.com/x", security, {}));
});

test("the production pinned lookup supports Node's all-address callback contract", () => {
  const lookup = pinnedLookup("93.184.216.34");
  lookup("hooks.example.com", { all: true }, (error, addresses) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]);
  });
  lookup("hooks.example.com", {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, "93.184.216.34");
    assert.equal(family, 4);
  });
});

async function seededDelivery(db: Db, secret: string, ids = ["dlv_1"]): Promise<void> {
  await db.batch([
    { sql: "INSERT INTO organizations(id, name, created_at) VALUES ('org_1', 'Org', '2026-07-30T00:00:00Z')" },
    {
      sql: `INSERT INTO webhooks(id, org_id, principal_id, url, secret_hash, secret, events, status, created_at)
            VALUES ('whk_1', 'org_1', 'actor', 'https://hooks.example.com/a', 'hash', ?, '*', 'active', '2026-07-30T00:00:00Z')`,
      params: [secret],
    },
    ...ids.flatMap((id, index) => [
      {
        sql: `INSERT INTO events(id, org_id, kind, actor_id, resource_type, resource_id, payload, created_at)
              VALUES (?, 'org_1', 'test.event', 'actor', 'test', ?, '{}', '2026-07-30T00:00:01Z')`,
        params: [`evt_${index}`, `resource_${index}`],
      },
      {
        sql: `INSERT INTO webhook_deliveries(id, webhook_id, event_id, status, attempts, next_retry_at, created_at)
              VALUES (?, 'whk_1', ?, 'pending', 0, '2026-07-30T00:00:02Z', '2026-07-30T00:00:02Z')`,
        params: [id, `evt_${index}`],
      },
    ]),
  ]);
}

test("webhook claims are exclusive, retries keep one delivery ID, and disable terminalizes siblings", async () => {
  const { db, close } = database();
  await migrate(db);
  const cipher = createSecretCipher({ active: "v1", keys: { v1: KEY_ONE } });
  await seededDelivery(db, await cipher.encrypt("shared-secret-value", "webhook:whk_1"), ["dlv_1", "dlv_2"]);
  await db.batch([{ sql: "UPDATE webhook_deliveries SET next_retry_at = '2026-07-30T02:00:00Z' WHERE id = 'dlv_2'" }]);
  let calls = 0;
  const deliveries: string[] = [];
  const attempts: string[] = [];
  const security: WebhookSecurity = {
    allowedHostnames: ["hooks.example.com"],
    timeoutMs: 50,
    resolve: async () => ["93.184.216.34"],
    dispatch: async ({ addresses, init }) => {
      calls += 1;
      deliveries.push(new Headers(init.headers).get("x-titen-delivery")!);
      attempts.push(new Headers(init.headers).get("x-titen-attempt")!);
      return { response: new Response(null, { status: calls === 1 ? 500 : 200 }), connectedAddress: addresses[0]! };
    },
  };
  const now = new Date("2026-07-30T00:01:00Z");
  await Promise.all(Array.from({ length: 20 }, () => drainWebhookQueue({ db, orgId: "org_1", now, limit: 1, security, cipher })));
  assert.equal(calls, 1, "only one concurrent claimant may dispatch a row");
  await db.batch([{ sql: "UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = 'dlv_1'", params: [now.toISOString()] }]);
  await drainWebhookQueue({ db, orgId: "org_1", now, limit: 1, security, cipher });
  assert.deepEqual(deliveries, ["dlv_1", "dlv_1"]);
  assert.notEqual(attempts[0], attempts[1]);

  await db.batch([
    { sql: "UPDATE webhooks SET failure_count = 9 WHERE id = 'whk_1'" },
    { sql: "UPDATE webhook_deliveries SET status = 'pending', attempts = 0, next_retry_at = ? WHERE id = 'dlv_2'", params: [now.toISOString()] },
  ]);
  security.dispatch = async ({ addresses }) => ({ response: new Response(null, { status: 500 }), connectedAddress: addresses[0]! });
  await drainWebhookQueue({ db, orgId: "org_1", now, limit: 1, security, cipher });
  assert.equal((await db.all<{ status: string }>("SELECT status FROM webhooks WHERE id = 'whk_1'"))[0]!.status, "disabled");
  assert.deepEqual(await db.all("SELECT id FROM webhook_deliveries WHERE webhook_id = 'whk_1' AND status = 'pending'"), []);
  close();
});

test("webhook retries stop when the subscriber loses event access", async () => {
  const { db, close } = database();
  await migrate(db);
  const cipher = createSecretCipher({ active: "v1", keys: { v1: KEY_ONE } });
  await db.batch([
    { sql: "INSERT INTO organizations(id, name, created_at) VALUES ('org_1', 'Org', '2026-07-30T00:00:00Z')" },
    { sql: "INSERT INTO workspaces(id, org_id, name, created_at) VALUES ('workspace_1', 'org_1', 'Team', '2026-07-30T00:00:00Z')" },
    {
      sql: `INSERT INTO memberships(id, org_id, workspace_id, principal_id, principal_kind, role, created_at)
            VALUES ('membership_1', 'org_1', 'workspace_1', 'subscriber', 'agent', 'member', '2026-07-30T00:00:00Z')`,
    },
    {
      sql: `INSERT INTO observations
              (id, org_id, subject_id, actor_id, kind, content, content_hash, source_type,
               trust, visibility, ingested_at, workspace_id)
            VALUES ('obs_1', 'org_1', 'subject_1', 'writer', 'tool_result', 'secret', 'hash', 'tool',
                    'verified', 'team', '2026-07-30T00:00:01Z', 'workspace_1')`,
    },
    {
      sql: `INSERT INTO events(id, org_id, kind, actor_id, resource_type, resource_id, payload, created_at)
            VALUES ('evt_1', 'org_1', 'observation.appended', 'writer', 'observation', 'obs_1', '{}',
                    '2026-07-30T00:00:01Z')`,
    },
    {
      sql: `INSERT INTO webhooks(id, org_id, principal_id, url, secret_hash, secret, events, status, created_at)
            VALUES ('whk_1', 'org_1', 'subscriber', 'https://hooks.example.com/a', 'hash', ?, '*', 'active',
                    '2026-07-30T00:00:00Z')`,
      params: [await cipher.encrypt("shared-secret-value", "webhook:whk_1")],
    },
    {
      sql: `INSERT INTO webhook_deliveries
              (id, webhook_id, event_id, status, attempts, next_retry_at, created_at, lease_token, lease_expires_at)
            VALUES ('dlv_1', 'whk_1', 'evt_1', 'pending', 1, '2026-07-30T00:01:00Z',
                    '2026-07-30T00:00:02Z', 'stale-lease', '2026-07-30T00:02:00Z')`,
    },
    { sql: "UPDATE memberships SET removed_at = '2026-07-30T00:00:30Z' WHERE id = 'membership_1'" },
  ]);
  let calls = 0;
  const security: WebhookSecurity = {
    allowedHostnames: ["hooks.example.com"],
    resolve: async () => ["93.184.216.34"],
    dispatch: async ({ addresses }) => {
      calls += 1;
      return { response: new Response(null, { status: 200 }), connectedAddress: addresses[0]! };
    },
  };

  const result = await drainWebhookQueue({
    db,
    orgId: "org_1",
    now: new Date("2026-07-30T00:01:00Z"),
    limit: 1,
    security,
    cipher,
  });

  assert.deepEqual(result, { attempted: 0, delivered: 0 });
  assert.equal(calls, 0, "revoked membership must block outbound retry I/O");
  assert.deepEqual(
    (await db.all<{ status: string; next_retry_at: string | null; lease_token: string | null; lease_expires_at: string | null }>(
      "SELECT status, next_retry_at, lease_token, lease_expires_at FROM webhook_deliveries WHERE id = 'dlv_1'",
    ))[0],
    { status: "expired", next_retry_at: null, lease_token: null, lease_expires_at: null },
  );
  close();
});

test("an expired lease is recovered and a timed-out dispatch returns to retry state", async () => {
  const { db, close } = database();
  await migrate(db);
  const cipher = createSecretCipher({ active: "v1", keys: { v1: KEY_ONE } });
  await seededDelivery(db, await cipher.encrypt("shared-secret-value", "webhook:whk_1"));
  await db.batch([{
    sql: `UPDATE webhook_deliveries SET lease_token = 'crashed', lease_expires_at = '2026-07-30T00:00:30Z'
           WHERE id = 'dlv_1'`,
  }]);
  let calls = 0;
  const security: WebhookSecurity = {
    allowedHostnames: ["hooks.example.com"],
    timeoutMs: 20,
    resolve: async () => ["93.184.216.34"],
    dispatch: async ({ init }) => {
      calls += 1;
      await new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
      throw new Error("unreachable");
    },
  };
  const started = Date.now();
  await drainWebhookQueue({ db, orgId: "org_1", now: new Date("2026-07-30T00:01:00Z"), limit: 1, security, cipher });
  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 500, "outbound duration must be bounded");
  const row = (await db.all<{ status: string; attempts: number; lease_token: string | null; next_retry_at: string | null }>(
    "SELECT status, attempts, lease_token, next_retry_at FROM webhook_deliveries WHERE id = 'dlv_1'",
  ))[0]!;
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);
  assert.equal(row.lease_token, null);
  assert.ok(row.next_retry_at);
  close();
});

test("the fifth failed attempt becomes terminal", async () => {
  const { db, close } = database();
  await migrate(db);
  const cipher = createSecretCipher({ active: "v1", keys: { v1: KEY_ONE } });
  await seededDelivery(db, await cipher.encrypt("shared-secret-value", "webhook:whk_1"));
  await db.batch([{ sql: "UPDATE webhook_deliveries SET attempts = 4 WHERE id = 'dlv_1'" }]);
  const security: WebhookSecurity = {
    allowedHostnames: ["hooks.example.com"],
    resolve: async () => ["93.184.216.34"],
    dispatch: async ({ addresses }) => ({ response: new Response(null, { status: 500 }), connectedAddress: addresses[0]! }),
  };
  await drainWebhookQueue({ db, orgId: "org_1", now: new Date("2026-07-30T00:01:00Z"), limit: 1, security, cipher });
  const row = (await db.all<{ status: string; attempts: number; next_retry_at: string | null }>(
    "SELECT status, attempts, next_retry_at FROM webhook_deliveries WHERE id = 'dlv_1'",
  ))[0]!;
  assert.deepEqual(row, { status: "failed", attempts: 5, next_retry_at: null });
  close();
});
