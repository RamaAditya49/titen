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
    }>("SELECT identity_hash, failures, blocked_until_ms FROM login_throttles WHERE identity_hash LIKE '%.%'");
    assert.match(stored!.identity_hash, /^[a-f0-9]{64}\.[a-f0-9]{64}$/);
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


test("concurrent password admission rejects work beyond the configured limit", async () => {
  const handle = openDatabase(":memory:");
  const db = createSqliteDb(handle);
  try {
    await migrate(db);
    const app = createApp({ db, runtime: "test", passwordCheckLimit: 1 });
    const attempts = await Promise.all(Array.from({ length: 8 }, (_, index) => app(new Request("http://titen.test/v1/dashboard-sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: `concurrent-${index}`, password: "incorrect horse battery staple" }),
    }))));
    assert.equal(attempts.filter((response) => response.status === 401).length, 1);
    assert.equal(attempts.filter((response) => response.status === 429).length, 7);
  } finally { handle.close(); }
});

test("raw paths reject dot segments and encoded separators before routing", async () => {
  const handle = openDatabase(":memory:");
  try {
    const app = createApp({ db: createSqliteDb(handle), runtime: "test" });
    for (const path of ["/v1/../healthz", "/./healthz", "/v1%2fhealthz", "/v1%252fhealthz", "/v1%5chealthz"]) {
      const request = new Request("http://titen.test/healthz");
      Object.defineProperty(request, "url", { value: `http://titen.test${path}` });
      assert.equal((await app(request)).status, 400, path);
    }
  } finally { handle.close(); }
});

test("the Bun listener limits a client before password work", async () => {
  const { serve } = await import("../../src/runtime/bun/server");
  const running = await serve({ dbPath: ":memory:", hostname: "127.0.0.1", port: 0, maintenanceIntervalMs: 0, quiet: true,
    loginClientIpHeader: "x-test-client-ip" });
  try {
    for (let i = 0; i < 20; i++) {
      const response = await fetch(`${running.url}/v1/dashboard-sessions`, { method: "POST", headers: { "content-type": "application/json", "x-test-client-ip": "192.0.2.1" }, body: JSON.stringify({ username: `rate-${i}`, password: "incorrect horse battery staple" }) });
      assert.equal(response.status, 401);
    }
    const attempt = (ip: string) => fetch(`${running.url}/v1/dashboard-sessions`, { method: "POST", headers: { "content-type": "application/json", "x-test-client-ip": ip }, body: JSON.stringify({ username: "rate-other", password: "incorrect horse battery staple" }) });
    assert.equal((await attempt("192.0.2.1")).status, 429);
    assert.equal((await attempt("192.0.2.2")).status, 401);
  } finally { await running.stop(); }
});


test("the Bun listener rejects raw dot segments and encoded slash paths", async () => {
  const { serve } = await import("../../src/runtime/bun/server");
  const { createConnection } = await import("node:net");
  const running = await serve({ dbPath: ":memory:", hostname: "127.0.0.1", port: 0, maintenanceIntervalMs: 0, quiet: true });
  try {
    for (const path of ["/v1/../healthz", "/./healthz", "/v1%2fhealthz", "/%252e%252e/healthz"]) {
      const status = await new Promise<number>((resolve, reject) => {
        const url = new URL(running.url);
        const socket = createConnection({ host: url.hostname, port: Number(url.port) });
        let response = "";
        socket.on("connect", () => socket.write(`GET ${path} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`));
        socket.on("data", (chunk) => { response += chunk.toString(); });
        socket.on("end", () => resolve(Number(response.match(/^HTTP\/1.1 (\d+)/)?.[1])));
        socket.on("error", reject);
      });
      assert.equal(status, 400, path);
    }
  } finally { await running.stop(); }
});

test("untrusted client headers cannot replace direct socket identity", async () => {
  const { loginClientAddress } = await import("../../src/runtime/bun/login-rate-limit");
  const request = new Request("http://test", { headers: { "x-client-ip": "192.0.2.1" } });
  assert.equal(loginClientAddress("198.51.100.1", request, "x-client-ip"), "198.51.100.1");
  assert.equal(loginClientAddress("127.0.0.1", request), "127.0.0.1");
  assert.equal(loginClientAddress("127.0.0.1", request, "x-client-ip"), "192.0.2.1");
});
