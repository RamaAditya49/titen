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
const latestKey = new Map<string, string>();
let loginSequence = 0;
let temporaryPassword = "temporary horse battery staple";
let permanentPassword = "replacement horse battery staple";
let temporaryLogin = true;
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
async function login(username: string, password = "correct horse battery staple"): Promise<Response> {
  return fetch(`${base}/dashboard-api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ username, password }),
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
      if (url.pathname === "/v1/dashboard-sessions" && request.method === "POST") {
        const body = await request.json() as { username?: string; password?: string };
        const username = body.username ?? "";
        const validPassword = username === "user_temp"
          ? body.password === (temporaryLogin ? temporaryPassword : permanentPassword)
          : body.password === "correct horse battery staple";
        if (!validPassword
          || (!/^user_(?:a|b|temp)$/.test(username) && !/^cap_\d+$/.test(username)))
          return Response.json({ error: { code: "INVALID_LOGIN" } }, { status: 401 });
        const raw = `titen_sk_login_${username}_${++loginSequence}`;
        revoked.delete(raw);
        const template = username === "user_a" ? principals.titen_sk_session_a!
          : username === "user_b" ? principals.titen_sk_session_b!
          : username === "user_temp" ? {
              organization_id: "org_a",
              principal_id: "user_temp",
              principal_kind: "human",
              scopes: temporaryLogin ? [] : ["leases:read"],
              max_trust: "asserted",
              organization_role: "reader",
              password_change_required: temporaryLogin,
            }
          : {
              organization_id: "org_cap",
              principal_id: `user_${username}`,
              principal_kind: "human",
              key_id: `key_${username}_${loginSequence}`,
              scopes: ["leases:read"],
              max_trust: "asserted",
              organization_role: "reader",
            };
        const sessionPrincipal = { ...template, key_id: `key_session_${++loginSequence}` };
        principals[raw] = sessionPrincipal;
        latestKey.set(username, raw);
        return Response.json({ data: { ...sessionPrincipal, api_key: raw } }, { status: 201 });
      }
      if (!principal || revoked.has(key))
        return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
      if (url.pathname === "/v1/dashboard-sessions/current" && request.method === "DELETE") {
        revoked.add(key);
        return Response.json({ data: { logged_out: true } });
      }
      if (url.pathname === "/v1/operator-accounts/current/password" && request.method === "PATCH") {
        const body = await request.json() as { password?: string };
        if (principal.principal_id !== "user_temp" || typeof body.password !== "string")
          return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
        permanentPassword = body.password;
        temporaryLogin = false;
        revoked.add(key);
        return Response.json({ data: { password_changed: true, login_required: true } });
      }
      if (url.pathname === "/v1/principal") {
        if (principalMode === "unavailable")
          return Response.json({ error: { code: "NOT_READY" } }, { status: 503 });
        if (principalMode === "invalid-json") return new Response("not json");
        const { password_change_required: _ignored, ...safe } = principal;
        return Response.json({ data: safe });
      }
      if (url.pathname === "/v1/leases" && !(principal.scopes as string[]).includes("leases:read"))
        return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
      if (url.pathname === "/v1/leases")
        return Response.json({ data: { leases: [{ holder_id: principal.principal_id }] } });
      if (url.pathname === "/v1/operator-accounts" && request.method === "POST") {
        userCreates.push({ authorization: request.headers.get("authorization"), body: await request.json() });
        return Response.json({ data: {
          account_id: "usr_new",
          username: "new.reader",
          principal_id: "human_new",
          principal_kind: "human",
          membership_id: "mbr_new",
          role: "reader",
          temporary_password: "generated temporary password",
          password_change_required: true,
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
      body: JSON.stringify({ username: "user_a", password: "correct horse battery staple" }),
    });
    expect(login.status).toBe(201);
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    expect(login.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(login.headers.get("set-cookie")).not.toContain(latestKey.get("user_a")!);
    const cookieA = cookieFrom(login);
    expect(JSON.stringify(await login.json())).not.toContain(latestKey.get("user_a")!);

    const loginB = await fetch(`${base}/dashboard-api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ username: "user_b", password: "correct horse battery staple" }),
    });
    const cookieB = cookieFrom(loginB);
    const leasesA = await (await fetch(`${base}/dashboard-api/work/leases`, { headers: { cookie: cookieA } })).json();
    const leasesB = await (await fetch(`${base}/dashboard-api/work/leases`, { headers: { cookie: cookieB } })).json();
    expect(leasesA.data.leases[0].holder_id).toBe("user_a");
    expect(leasesB.data.leases[0].holder_id).toBe("user_b");

    const created = await fetch(`${base}/dashboard-api/governance/users`, {
      method: "POST",
      headers: { cookie: cookieA, "content-type": "application/json", origin: base },
      body: JSON.stringify({ username: "new.reader", scopes: ["leases:read"], role: "reader" }),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.data.username).toBe("new.reader");
    expect(createdBody.data.temporary_password).toBe("generated temporary password");
    expect(userCreates).toEqual([{
      authorization: `Bearer ${latestKey.get("user_a")}`,
      body: { username: "new.reader", scopes: ["leases:read"], role: "reader" },
    }]);

    const logout = await fetch(`${base}/dashboard-api/session`, {
      method: "DELETE",
      headers: { cookie: cookieA, origin: base },
    });
    expect(logout.status).toBe(200);
    expect(revoked.has(latestKey.get("user_a")!)).toBe(true);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await fetch(`${base}/dashboard-api/work/leases`, { headers: { cookie: cookieA } })).status).toBe(401);
  });

  test("restricts first login to password replacement and clears the session", async () => {
    temporaryLogin = true;
    temporaryPassword = "temporary horse battery staple";
    permanentPassword = "replacement horse battery staple";
    const initial = await login("user_temp", temporaryPassword);
    expect(initial.status).toBe(201);
    const initialBody = await initial.json();
    expect(initialBody.data.password_change_required).toBe(true);
    expect(initialBody.data.scopes).toEqual([]);
    const cookie = cookieFrom(initial);
    const introspected = await (await fetch(`${base}/dashboard-api/session`, { headers: { cookie } })).json();
    expect(introspected.data.password_change_required).toBe(true);
    expect((await fetch(`${base}/dashboard-api/work/leases`, { headers: { cookie } })).status).toBe(403);

    const changed = await fetch(`${base}/dashboard-api/password`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json", origin: base },
      body: JSON.stringify({ password: permanentPassword }),
    });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await fetch(`${base}/dashboard-api/session`, { headers: { cookie } })).status).toBe(401);
    expect((await login("user_temp", temporaryPassword)).status).toBe(401);
    const established = await login("user_temp", permanentPassword);
    expect(established.status).toBe(201);
    expect((await established.json()).data.password_change_required).toBe(false);
  });

  test("rejects invalid, cross-origin, oversized, and revoked credentials without reflection", async () => {
    const invalid = await fetch(`${base}/dashboard-api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ username: "user_a", password: "incorrect horse battery staple" }),
    });
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("set-cookie")).toBeNull();
    expect(JSON.stringify(await invalid.json())).not.toContain("incorrect horse battery staple");

    expect((await fetch(`${base}/dashboard-api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ username: "user_a", password: "correct horse battery staple" }),
    })).status).toBe(403);
    expect((await fetch(`${base}/dashboard-api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ username: "user_a", password: "x".repeat(3_000) }),
    })).status).toBe(401);

    const login = await fetch(`${base}/dashboard-api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ username: "user_a", password: "correct horse battery staple" }),
    });
    const cookie = cookieFrom(login);
    revoked.add(latestKey.get("user_a")!);
    const denied = await fetch(`${base}/dashboard-api/work/leases`, { headers: { cookie } });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(JSON.stringify(await denied.json())).not.toContain("titen_sk_session_a");
  });

  test("preserves a valid session through temporary 503 and malformed upstream responses", async () => {
    revoked.delete("titen_sk_session_a");
    const cookie = cookieFrom(await login("user_a"));
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
    const first = cookieFrom(await login("user_a"));
    const replacement = cookieFrom(await login("user_a"));
    expect((await fetch(`${base}/dashboard-api/session`, { headers: { cookie: first } })).status).toBe(401);
    expect((await fetch(`${base}/dashboard-api/session`, { headers: { cookie: replacement } })).status).toBe(200);

    let oldest = "";
    let newest = "";
    for (let index = 0; index < 129; index++) {
      const response = await login(`cap_${index}`);
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
      body: JSON.stringify({ username: "user_a", password: "correct horse battery staple" }),
    });
    const cookie = cookieFrom(login);
    adapter.kill();
    await adapter.exited;
    await startAdapter();
    expect((await fetch(`${base}/dashboard-api/session`, { headers: { cookie } })).status).toBe(401);
  });
});
