import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const upstreamPort = 44_000 + Math.floor(Math.random() * 1_000);
const adapterPort = 45_000 + Math.floor(Math.random() * 1_000);
const serverAdapterPort = 46_000 + Math.floor(Math.random() * 1_000);
const base = `http://127.0.0.1:${adapterPort}`;
const principals: Record<string, Record<string, unknown>> = {
  titen_sk_session_a: {
    organization_id: "org_a",
    principal_id: "user_a",
    principal_kind: "human",
    key_id: "key_a",
    scopes: ["leases:read", "keys:manage", "memberships:read", "memberships:write"],
    max_trust: "verified",
    organization_role: "admin",
    ignored_field: "must not cross the adapter boundary",
  },
  titen_sk_session_b: {
    organization_id: "org_a",
    principal_id: "user_b",
    principal_kind: "human",
    key_id: "key_b",
    scopes: ["leases:read"],
    max_trust: "asserted",
    organization_role: "reader",
  },
};
const revoked = new Set<string>();
const userCreates: Array<{ authorization: string | null; body: unknown }> = [];
let principalMode: "ok" | "unavailable" | "invalid-json" = "ok";
let upstream: ReturnType<typeof Bun.serve>;
let adapter: ReturnType<typeof Bun.spawn>;

function bearer(request: Request): string {
  return request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
}
function cookieFrom(response: Response): string {
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}
function principalFor(key: string): Record<string, unknown> | undefined {
  if (principals[key]) return principals[key];
  if (!key.startsWith("titen_sk_cap_")) return;
  const id = key.slice("titen_sk_cap_".length);
  return {
    organization_id: "org_cap",
    principal_id: `user_cap_${id}`,
    principal_kind: "human",
    key_id: `key_cap_${id}`,
    scopes: ["leases:read"],
    max_trust: "asserted",
    organization_role: "reader",
  };
}
async function login(key: string): Promise<Response> {
  return fetch(`${base}/dashboard-api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ api_key: key }),
  });
}
async function startAdapter() {
  adapter = Bun.spawn({
    cmd: [process.execPath, "scripts/dashboard-adapter.ts"],
    env: {
      ...process.env,
      TITEN_DASHBOARD_LIVE: "true",
      TITEN_DASHBOARD_AUTH: "session",
      TITEN_API_URL: `http://127.0.0.1:${upstreamPort}`,
      TITEN_DASHBOARD_PORT: String(adapterPort),
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${base}/dashboard-api/status`)).ok) return; } catch {}
    await Bun.sleep(20);
  }
  throw new Error("session adapter did not start");
}

beforeAll(async () => {
  upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: upstreamPort,
    async fetch(request) {
      const url = new URL(request.url);
      const key = bearer(request);
      const principal = principalFor(key);
      if (url.pathname === "/healthz") return Response.json({ data: { status: "ok" } });
      if (url.pathname === "/readyz") return Response.json({ data: { ready: true } });
      if (!principal || revoked.has(key))
        return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
      if (url.pathname === "/v1/principal") {
        if (principalMode === "unavailable")
          return Response.json({ error: { code: "NOT_READY" } }, { status: 503 });
        if (principalMode === "invalid-json") return new Response("not json");
        return Response.json({ data: principal });
      }
      if (url.pathname === "/v1/leases")
        return Response.json({ data: { leases: [{ holder_id: principal.principal_id }] } });
      if (url.pathname === "/v1/keys" && request.method === "POST") {
        userCreates.push({ authorization: request.headers.get("authorization"), body: await request.json() });
        return Response.json({ data: {
          key_id: "key_new",
          principal_id: "human_new",
          principal_kind: "human",
          membership_id: "mbr_new",
          membership_role: "reader",
          api_key: "titen_sk_one_time_new",
        } }, { status: 201 });
      }
      return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    },
  });
  await startAdapter();
});

afterAll(() => {
  adapter?.kill();
  upstream?.stop(true);
});

describe("dashboard per-principal sessions", () => {
  test("isolates credentials, provisions a user once, and logs out", async () => {
    const status = await (await fetch(`${base}/dashboard-api/status`)).json();
    expect(status).toEqual({
      mode: "live",
      endpoint: `127.0.0.1:${upstreamPort}`,
      authentication: "session",
      authenticated: false,
    });

    const login = await fetch(`${base}/dashboard-api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ api_key: "titen_sk_session_a" }),
    });
    expect(login.status).toBe(201);
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    expect(login.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(login.headers.get("set-cookie")).not.toContain("titen_sk_session_a");
    const cookieA = cookieFrom(login);
    expect(JSON.stringify(await login.json())).not.toContain("titen_sk_session_a");

    const loginB = await fetch(`${base}/dashboard-api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ api_key: "titen_sk_session_b" }),
    });
    const cookieB = cookieFrom(loginB);
    const leasesA = await (await fetch(`${base}/dashboard-api/work/leases`, { headers: { cookie: cookieA } })).json();
    const leasesB = await (await fetch(`${base}/dashboard-api/work/leases`, { headers: { cookie: cookieB } })).json();
    expect(leasesA.data.leases[0].holder_id).toBe("user_a");
    expect(leasesB.data.leases[0].holder_id).toBe("user_b");

    const created = await fetch(`${base}/dashboard-api/governance/users`, {
      method: "POST",
      headers: { cookie: cookieA, "content-type": "application/json", origin: base },
      body: JSON.stringify({ label: "New reader", scopes: ["leases:read"], membership_role: "reader" }),
    });
    expect(created.status).toBe(201);
    expect((await created.json()).data.api_key).toBe("titen_sk_one_time_new");
    expect(userCreates).toEqual([{
      authorization: "Bearer titen_sk_session_a",
      body: { label: "New reader", scopes: ["leases:read"], membership_role: "reader" },
    }]);

    const logout = await fetch(`${base}/dashboard-api/session`, {
      method: "DELETE",
      headers: { cookie: cookieA, origin: base },
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await fetch(`${base}/dashboard-api/work/leases`, { headers: { cookie: cookieA } })).status).toBe(401);
  });

  test("rejects invalid, cross-origin, oversized, and revoked credentials without reflection", async () => {
    const invalid = await fetch(`${base}/dashboard-api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ api_key: "titen_sk_invalid_secret" }),
    });
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("set-cookie")).toBeNull();
    expect(JSON.stringify(await invalid.json())).not.toContain("titen_sk_invalid_secret");

    expect((await fetch(`${base}/dashboard-api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ api_key: "titen_sk_session_a" }),
    })).status).toBe(403);
    expect((await fetch(`${base}/dashboard-api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ api_key: `titen_sk_${"x".repeat(3_000)}` }),
    })).status).toBe(401);

    const login = await fetch(`${base}/dashboard-api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ api_key: "titen_sk_session_a" }),
    });
    const cookie = cookieFrom(login);
    revoked.add("titen_sk_session_a");
    const denied = await fetch(`${base}/dashboard-api/work/leases`, { headers: { cookie } });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(JSON.stringify(await denied.json())).not.toContain("titen_sk_session_a");
  });

  test("preserves a valid session through temporary 503 and malformed upstream responses", async () => {
    revoked.delete("titen_sk_session_a");
    const cookie = cookieFrom(await login("titen_sk_session_a"));
    try {
      principalMode = "unavailable";
      const unavailable = await fetch(`${base}/dashboard-api/session`, { headers: { cookie } });
      expect(unavailable.status).toBe(503);
      expect(unavailable.headers.get("set-cookie")).toBeNull();

      principalMode = "invalid-json";
      const invalid = await fetch(`${base}/dashboard-api/session`, { headers: { cookie } });
      expect(invalid.status).toBe(502);
      expect(invalid.headers.get("set-cookie")).toBeNull();
    } finally {
      principalMode = "ok";
    }
    expect((await fetch(`${base}/dashboard-api/session`, { headers: { cookie } })).status).toBe(200);
  });

  test("replaces sessions for the same key id and caps process-local sessions", async () => {
    const first = cookieFrom(await login("titen_sk_session_a"));
    const replacement = cookieFrom(await login("titen_sk_session_a"));
    expect((await fetch(`${base}/dashboard-api/session`, { headers: { cookie: first } })).status).toBe(401);
    expect((await fetch(`${base}/dashboard-api/session`, { headers: { cookie: replacement } })).status).toBe(200);

    let oldest = "";
    let newest = "";
    for (let index = 0; index < 129; index++) {
      const response = await login(`titen_sk_cap_${index}`);
      expect(response.status).toBe(201);
      const sessionCookie = cookieFrom(response);
      if (index === 0) oldest = sessionCookie;
      newest = sessionCookie;
    }
    expect((await fetch(`${base}/dashboard-api/session`, { headers: { cookie: oldest } })).status).toBe(401);
    expect((await fetch(`${base}/dashboard-api/session`, { headers: { cookie: newest } })).status).toBe(200);
  });

  test("introspects and sanitizes the configured server credential", async () => {
    const serverBase = `http://127.0.0.1:${serverAdapterPort}`;
    const serverAdapter = Bun.spawn({
      cmd: [process.execPath, "scripts/dashboard-adapter.ts"],
      env: {
        ...process.env,
        TITEN_DASHBOARD_LIVE: "true",
        TITEN_DASHBOARD_AUTH: "server",
        TITEN_API_URL: `http://127.0.0.1:${upstreamPort}`,
        TITEN_API_KEY: "titen_sk_session_a",
        TITEN_DASHBOARD_PORT: String(serverAdapterPort),
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        try { if ((await fetch(`${serverBase}/dashboard-api/status`)).ok) break; } catch {}
        await Bun.sleep(20);
      }
      const response = await fetch(`${serverBase}/dashboard-api/session`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toEqual({
        organization_id: "org_a",
        principal_id: "user_a",
        principal_kind: "human",
        key_id: "key_a",
        scopes: ["leases:read", "keys:manage", "memberships:read", "memberships:write"],
        max_trust: "verified",
        organization_role: "admin",
      });
      expect(JSON.stringify(body)).not.toContain("titen_sk_session_a");
      expect(JSON.stringify(body)).not.toContain("ignored_field");
    } finally {
      serverAdapter.kill();
      await serverAdapter.exited;
    }
  });

  test("restart invalidates process-local sessions", async () => {
    revoked.delete("titen_sk_session_a");
    const login = await fetch(`${base}/dashboard-api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ api_key: "titen_sk_session_a" }),
    });
    const cookie = cookieFrom(login);
    adapter.kill();
    await adapter.exited;
    await startAdapter();
    expect((await fetch(`${base}/dashboard-api/session`, { headers: { cookie } })).status).toBe(401);
  });
});
