import { test } from "bun:test";
import assert from "node:assert/strict";
import { newOperatorAccount } from "../../src/core/accounts";
import { createApp } from "../../src/core/app";
import { organizationStatement } from "../../src/core/auth";
import { migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";

test("the edge guard rejects a login before account lookup and password verification", async () => {
  const handle = openDatabase(":memory:");
  const db = createSqliteDb(handle);
  try {
    await migrate(db);
    const inputs: Array<{ identityHash: string; request: Request }> = [];
    const app = createApp({
      db,
      runtime: "test",
      loginRateLimit: {
        async limit(input) {
          inputs.push(input);
          return { success: false };
        },
      },
    });
    const response = await app(new Request("http://titen.test/v1/dashboard-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "EDGE-OWNER", password: "incorrect horse battery staple" }),
    }));
    assert.equal(response.status, 429);
    assert.equal((await response.json() as any).error.code, "LOGIN_RATE_LIMITED");
    assert.equal(inputs.length, 1);
    assert.match(inputs[0]!.identityHash, /^[a-f0-9]{64}$/);
    assert.notEqual(inputs[0]!.identityHash, "edge-owner");
    assert.equal(inputs[0]!.request.headers.get("content-type"), "application/json");
    const rows = await db.all<{ failures: number }>("SELECT failures FROM login_throttles");
    assert.deepEqual(rows, [], "an edge denial must not create canonical failure state");
  } finally {
    handle.close();
  }
});

test("a progressive account throttle survives app reconstruction and clears after success", async () => {
  const handle = openDatabase(":memory:");
  const db = createSqliteDb(handle);
  let now = new Date("2026-08-30T00:00:00.000Z");
  try {
    await migrate(db);
    const account = await newOperatorAccount({
      orgId: "org_persistent_throttle",
      createdBy: "owner_persistent_throttle",
      username: "persistent-owner",
      role: "owner",
      scopes: ["*"],
      maxTrust: "policy_approved",
      now,
    });
    await db.batch([
      organizationStatement("org_persistent_throttle", "Persistent Throttle Test", now),
      ...account.statements,
    ]);
    const login = async (app: ReturnType<typeof createApp>, password: string) => {
      const response = await app(new Request("http://titen.test/v1/dashboard-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "persistent-owner", password }),
      }));
      return { response, body: await response.json() as any };
    };
    let app = createApp({ db, runtime: "test", now: () => now });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failure = await login(app, "incorrect horse battery staple");
      assert.equal(failure.response.status, 401);
      assert.equal(failure.body.error.code, "INVALID_LOGIN");
    }
    const [stored] = await db.all<{
      identity_hash: string;
      failures: number;
      blocked_until_ms: number;
    }>("SELECT identity_hash, failures, blocked_until_ms FROM login_throttles");
    assert.match(stored!.identity_hash, /^[a-f0-9]{64}$/);
    assert.equal(stored!.failures, 5);
    assert.equal(stored!.blocked_until_ms, now.getTime() + 30_000);

    app = createApp({ db, runtime: "test", now: () => now });
    const blocked = await login(app, account.temporaryPassword);
    assert.equal(blocked.response.status, 401);
    assert.equal(blocked.body.error.code, "INVALID_LOGIN");
    assert.equal(blocked.body.error.message, "Username or password is invalid.");

    now = new Date(now.getTime() + 30_000);
    const success = await login(app, account.temporaryPassword);
    assert.equal(success.response.status, 201);
    assert.equal(success.body.data.password_change_required, true);
    assert.deepEqual(await db.all("SELECT * FROM login_throttles"), []);
  } finally {
    handle.close();
  }
});
