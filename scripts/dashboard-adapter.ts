#!/usr/bin/env bun
/** Loopback-only static dashboard, per-principal sessions, and fixed API routes. */
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const enabled = process.env.TITEN_DASHBOARD_LIVE === "true";
const sessionMode = process.env.TITEN_DASHBOARD_AUTH === "session";
const upstream = process.env.TITEN_API_URL;
const apiKey = process.env.TITEN_API_KEY;
const publicOriginValue = process.env.TITEN_DASHBOARD_ORIGIN;
const port = Number(process.env.TITEN_DASHBOARD_PORT ?? "4322");
const root = await realpath(process.env.TITEN_DASHBOARD_ROOT
  ? resolve(process.env.TITEN_DASHBOARD_ROOT)
  : fileURLToPath(new URL("../dist/", import.meta.url)));
const SESSION_COOKIE = "titen_dashboard_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const BODY_LIMIT = 32_768;

if (enabled && (!upstream || (!sessionMode && !apiKey))) {
  console.error("dashboard-adapter: live mode requires TITEN_API_URL and, outside session mode, TITEN_API_KEY");
  process.exit(1);
}
if (upstream) {
  const parsed = new URL(upstream);
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error("TITEN_API_URL must be an http(s) origin without credentials, query, or fragment");
}
const publicOrigin = publicOriginValue ? new URL(publicOriginValue) : null;
if (publicOrigin && (!/^https?:$/.test(publicOrigin.protocol) || publicOrigin.username || publicOrigin.password
  || publicOrigin.pathname !== "/" || publicOrigin.search || publicOrigin.hash))
  throw new Error("TITEN_DASHBOARD_ORIGIN must be an http(s) origin without credentials, path, query, or fragment");
if (sessionMode && publicOrigin && publicOrigin.protocol !== "https:")
  throw new Error("Dashboard session mode requires an HTTPS TITEN_DASHBOARD_ORIGIN");

const json = (data: unknown, status = 200, extra?: HeadersInit) => {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers });
};
const error = (status: number, code: string, message: string, extra?: HeadersInit) =>
  json({ error: { code, message } }, status, extra);
const lenses = new Set(["evidence_trace", "neighborhood", "conflict_freshness", "review_queue", "scope_preview", "knowledge_release"]);
const reviewReasons = new Set(["all", "disputed", "contradiction", "low_confidence", "negative_feedback"]);

function isLoopbackHost(host: string | null): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}
function authorized(request: Request): boolean {
  const host = request.headers.get("host")?.toLowerCase() ?? null;
  if (!isLoopbackHost(host) && host !== publicOrigin?.host.toLowerCase()) return false;
  const origin = request.headers.get("origin");
  return !origin || origin === `http://${host}` || origin === publicOrigin?.origin;
}
function mutationAuthorized(request: Request): boolean {
  const host = request.headers.get("host")?.toLowerCase() ?? null;
  const origin = request.headers.get("origin");
  return isLoopbackHost(host) ? !origin || origin === `http://${host}` : origin === publicOrigin?.origin;
}

async function staticFile(raw: string): Promise<Response> {
  // WHATWG URL normalizes traversal before pathname is exposed. Inspect the raw
  // request target first and reject every ambiguous or encoded form.
  if (/\0|\\|%00/i.test(raw) || raw.startsWith("//") || isAbsolute(raw.replace(/^\//, ""))) return new Response("Not found", { status: 404 });
  let decoded = raw;
  for (let i = 0; i < 3; i++) {
    try { decoded = decodeURIComponent(decoded); } catch { return new Response("Not found", { status: 404 }); }
    if (/\0|\\|(^|\/)\.\.(\/|$)|^\/\//.test(decoded)) return new Response("Not found", { status: 404 });
  }
  const path = decoded.split("?", 1)[0].split("#", 1)[0];
  const route = path === "/" ? "index.html" : path === "/dashboard" || path === "/dashboard/"
    ? "dashboard/index.html" : path.replace(/^\//, "").replace(/\/$/, "/index.html");
  const candidate = resolve(root, route);
  const rel = relative(root, candidate);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) return new Response("Not found", { status: 404 });
  try {
    const canonical = await realpath(candidate);
    const canonicalRel = relative(root, canonical);
    if (canonicalRel.startsWith(`..${sep}`) || canonicalRel === ".." || isAbsolute(canonicalRel)) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(canonical), { headers: {
      "content-security-policy": "default-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    } });
  } catch { return new Response("Not found", { status: 404 }); }
}

interface DashboardPrincipal {
  organization_id: string;
  principal_id: string;
  principal_kind: "human" | "agent" | "service";
  key_id: string;
  scopes: string[];
  max_trust: "unverified" | "asserted" | "verified" | "policy_approved";
  organization_role: "root" | "owner" | "admin" | "member" | "reader" | null;
  password_change_required?: boolean;
}
interface Session {
  key: string;
  principal: DashboardPrincipal;
  expiresAt: number;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function decodeBase64Url(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "="));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch { return; }
}
const sessionKey = sessionMode ? await (async () => {
  const configured = process.env.TITEN_DASHBOARD_SESSION_KEY;
  const material = configured ? decodeBase64Url(configured) : crypto.getRandomValues(new Uint8Array(32));
  if (material?.length !== 32)
    throw new Error("TITEN_DASHBOARD_SESSION_KEY must be a base64url-encoded 32-byte key");
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
})() : undefined;
function safePrincipal(value: unknown): DashboardPrincipal | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  const kind = row.principal_kind;
  const trust = row.max_trust;
  const role = row.organization_role;
  if (typeof row.organization_id !== "string" || typeof row.principal_id !== "string"
    || typeof row.key_id !== "string" || !["human", "agent", "service"].includes(String(kind))
    || !["unverified", "asserted", "verified", "policy_approved"].includes(String(trust))
    || !Array.isArray(row.scopes) || row.scopes.length > 256 || !row.scopes.every((scope) => typeof scope === "string")
    || (role !== null && !["root", "owner", "admin", "member", "reader"].includes(String(role)))
    || (row.password_change_required !== undefined && typeof row.password_change_required !== "boolean")) return;
  return {
    organization_id: row.organization_id,
    principal_id: row.principal_id,
    principal_kind: kind as DashboardPrincipal["principal_kind"],
    key_id: row.key_id,
    scopes: row.scopes,
    max_trust: trust as DashboardPrincipal["max_trust"],
    organization_role: role as DashboardPrincipal["organization_role"],
    ...(typeof row.password_change_required === "boolean"
      ? { password_change_required: row.password_change_required } : {}),
  };
}
function sessionId(request: Request): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
}
async function sessionFor(request: Request): Promise<Session | undefined> {
  const token = sessionId(request);
  if (!token || token.length > 8192 || !sessionKey) return;
  const [version, rawIv, rawCiphertext, ...rest] = token.split(".");
  const iv = rawIv ? decodeBase64Url(rawIv) : undefined;
  const ciphertext = rawCiphertext ? decodeBase64Url(rawCiphertext) : undefined;
  if (version !== "v1" || iv?.length !== 12 || !ciphertext?.length || rest.length) return;
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, sessionKey, ciphertext);
    const value = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;
    const principal = safePrincipal(value.principal);
    if (typeof value.key !== "string" || !value.key.startsWith("titen_sk_")
      || value.key.length > 512 || typeof value.expiresAt !== "number"
      || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now() || !principal) return;
    return { key: value.key, principal, expiresAt: value.expiresAt };
  } catch { return; }
}
async function rememberSession(key: string, principal: DashboardPrincipal): Promise<string> {
  if (!sessionKey) throw new Error("Dashboard session key is unavailable.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({
    key,
    principal,
    expiresAt: Date.now() + SESSION_TTL_MS,
  }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sessionKey,
    plaintext,
  ));
  return `v1.${base64Url(iv)}.${base64Url(ciphertext)}`;
}
function cookie(id: string, maxAge = SESSION_TTL_MS / 1000): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${publicOrigin ? "; Secure" : ""}`;
}
function clearSession(_request?: Request): HeadersInit {
  return { "set-cookie": cookie("", 0) };
}
async function credential(request: Request): Promise<{ key: string } | undefined> {
  if (!sessionMode) return apiKey ? { key: apiKey } : undefined;
  const found = await sessionFor(request);
  return found ? { key: found.key } : undefined;
}

async function bodyObject(request: Request, limit = BODY_LIMIT): Promise<Record<string, unknown> | undefined> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) return;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > limit) return;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch { return; }
}
async function upstreamRequest(path: string, key: string, init?: RequestInit): Promise<Response> {
  return fetch(`${upstream!.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, ...init?.headers },
    signal: AbortSignal.timeout(5000),
  });
}
async function introspect(key: string): Promise<{ response: Response; principal?: DashboardPrincipal }> {
  const response = await upstreamRequest("/v1/principal", key);
  const payload = await response.json().catch(() => null) as { data?: unknown } | null;
  return { response, principal: response.ok ? safePrincipal(payload?.data) : undefined };
}
async function serviceCheck(path: "/healthz" | "/readyz"): Promise<Response> {
  if (!enabled) return error(503, "DASHBOARD_DISCONNECTED", "Live dashboard integration is not enabled.");
  try {
    const response = await fetch(`${upstream!.replace(/\/+$/, "")}${path}`, { signal: AbortSignal.timeout(5000) });
    const payload = await response.json().catch(() => null);
    return payload && typeof payload === "object" ? json(payload, response.status)
      : error(502, "UPSTREAM_UNAVAILABLE", "Titen returned an invalid service check.");
  } catch { return error(502, "UPSTREAM_UNAVAILABLE", "Titen is unreachable."); }
}
function queryPath(url: URL, path: string, allowed: readonly string[]): string | undefined {
  if ([...url.searchParams].length > 12) return;
  for (const [key, value] of url.searchParams)
    if (!allowed.includes(key) || value.length > 1000) return;
  const query = url.searchParams.toString();
  return query ? `${path}?${query}` : path;
}
function upstreamMessage(status: number): string {
  if (status === 401) return "The dashboard session is no longer valid.";
  if (status === 403) return "This principal is not authorized for the selected operation.";
  if (status === 404) return "The requested authorized resource was not found.";
  if (status === 409) return "The operation conflicts with current canonical state.";
  if (status === 429) return "Too many sign-in attempts. Try again later.";
  if (status === 503) return "Titen is not ready.";
  if (status === 400 || status === 413) return "Titen rejected the bounded request.";
  return "Titen did not return a usable response.";
}
async function proxyJson(request: Request, path: string, init?: RequestInit): Promise<Response> {
  if (!enabled) return error(503, "DASHBOARD_DISCONNECTED", "Live dashboard integration is not enabled.");
  const auth = await credential(request);
  if (!auth) return error(401, "DASHBOARD_AUTH_REQUIRED", "Sign in to continue.");
  try {
    const response = await upstreamRequest(path, auth.key, init);
    const payload = await response.json().catch(() => null);
    const clear = response.status === 401 && sessionMode ? clearSession(request) : undefined;
    if (!payload || typeof payload !== "object") return error(502, "UPSTREAM_UNAVAILABLE", "Titen returned invalid JSON.", clear);
    if (!response.ok) {
      const status = [400, 401, 403, 404, 409, 413, 503].includes(response.status) ? response.status : 502;
      const code = status === 401 && sessionMode ? "DASHBOARD_AUTH_REQUIRED" : `UPSTREAM_${status}`;
      return error(status, code, upstreamMessage(status), clear);
    }
    return json(payload, response.status);
  } catch { return error(502, "UPSTREAM_UNAVAILABLE", "Titen is unreachable."); }
}

const readRoutes = new Map<string, { path: string; query: string[] }>([
  ["/dashboard-api/work/leases", { path: "/v1/leases", query: ["limit", "after"] }],
  ["/dashboard-api/work/handoffs", { path: "/v1/handoffs", query: [] }],
  ["/dashboard-api/work/checkpoint", { path: "/v1/checkpoints", query: ["subject_id", "agent_id", "kind"] }],
  ["/dashboard-api/audit/events", { path: "/v1/events", query: ["after", "limit", "kind"] }],
  ["/dashboard-api/audit/log", { path: "/v1/audit", query: ["after", "limit", "action"] }],
  ["/dashboard-api/governance/memberships", { path: "/v1/memberships", query: ["workspace_id"] }],
  ["/dashboard-api/governance/keys", { path: "/v1/keys", query: [] }],
  ["/dashboard-api/governance/policies", { path: "/v1/policies", query: [] }],
  ["/dashboard-api/governance/approvals", { path: "/v1/claim-approvals", query: [] }],
  ["/dashboard-api/governance/channels", { path: "/v1/channels", query: [] }],
  ["/dashboard-api/governance/releases", { path: "/v1/knowledge-releases", query: [] }],
  ["/dashboard-api/federation/peers", { path: "/v1/federation/peers", query: [] }],
  ["/dashboard-api/federation/log", { path: "/v1/federation/log", query: ["peer_id", "limit"] }],
]);

const server = Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
  const raw = request.url.replace(/^https?:\/\/[^/]+/i, "");
  const url = new URL(request.url);
  if (!authorized(request)) return error(403, "FORBIDDEN", "Dashboard adapter is loopback same-origin only.");
  if (url.pathname === "/dashboard-api/status" && request.method === "GET") {
    const loggedIn = sessionMode ? Boolean(await sessionFor(request)) : enabled;
    return json({
      mode: enabled ? "live" : "disconnected",
      endpoint: enabled ? new URL(upstream!).host : null,
      authentication: sessionMode ? "session" : "server",
      authenticated: loggedIn,
    });
  }
  if (url.pathname === "/dashboard-api/health" && request.method === "GET") return serviceCheck("/healthz");
  if (url.pathname === "/dashboard-api/readiness" && request.method === "GET") return serviceCheck("/readyz");

  if (url.pathname === "/dashboard-api/session" && request.method === "POST") {
    if (!sessionMode) return error(404, "NOT_FOUND", "Dashboard session mode is not enabled.");
    if (!mutationAuthorized(request)) return error(403, "FORBIDDEN", "A same-origin request is required.");
    const body = await bodyObject(request, 2048);
    const username = typeof body?.username === "string" && body.username.length <= 64 ? body.username : undefined;
    const password = typeof body?.password === "string" && body.password.length <= 256 ? body.password : undefined;
    if (!username || !password) return error(401, "INVALID_LOGIN", "Username or password is invalid.");
    try {
      const response = await fetch(`${upstream!.replace(/\/+$/, "")}/v1/dashboard-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(5000),
      });
      const payload = await response.json().catch(() => null) as { data?: unknown } | null;
      if (response.status === 401) return error(401, "INVALID_LOGIN", "Username or password is invalid.");
      if (response.status === 429) return error(429, "LOGIN_RATE_LIMITED", "Too many sign-in attempts. Try again later.");
      if (response.status === 503) return error(503, "UPSTREAM_503", "Titen is not ready.");
      const data = payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? payload.data as Record<string, unknown> : undefined;
      const key = typeof data?.api_key === "string" && data.api_key.startsWith("titen_sk_") ? data.api_key : undefined;
      const principal = safePrincipal(data);
      if (!response.ok || !principal) return error(502, "UPSTREAM_UNAVAILABLE", "Titen returned an invalid principal.");
      if (!key) return error(502, "UPSTREAM_UNAVAILABLE", "Titen returned an invalid session.");
      const id = await rememberSession(key, principal);
      return json({ data: principal }, 201, { "set-cookie": cookie(id) });
    } catch { return error(502, "UPSTREAM_UNAVAILABLE", "Titen is unreachable."); }
  }
  if (url.pathname === "/dashboard-api/session" && request.method === "GET") {
    const found = sessionMode ? await sessionFor(request) : undefined;
    const key = sessionMode ? found?.key : apiKey;
    if (!key) return error(401, "DASHBOARD_AUTH_REQUIRED", "Sign in to continue.");
    try {
      const { response, principal } = await introspect(key);
      if (response.status === 401) return error(401, "DASHBOARD_AUTH_REQUIRED", "Sign in to continue.",
        sessionMode ? clearSession(request) : undefined);
      if (response.status === 503) return error(503, "UPSTREAM_503", "Titen is not ready.");
      if (!response.ok || !principal) return error(502, "UPSTREAM_UNAVAILABLE", "Titen returned an invalid principal.");
      if (found) {
        principal.password_change_required = found.principal.password_change_required;
      }
      return json({ data: principal });
    } catch { return error(502, "UPSTREAM_UNAVAILABLE", "Titen is unreachable."); }
  }
  if (url.pathname === "/dashboard-api/session" && request.method === "DELETE") {
    if (!mutationAuthorized(request)) return error(403, "FORBIDDEN", "A same-origin request is required.");
    const found = sessionMode ? await sessionFor(request) : undefined;
    if (found) {
      try {
        const response = await upstreamRequest("/v1/dashboard-sessions/current", found.key, { method: "DELETE" });
        if (!response.ok && response.status !== 401)
          return error(502, "UPSTREAM_UNAVAILABLE", "Titen could not revoke the dashboard session.");
      } catch { return error(502, "UPSTREAM_UNAVAILABLE", "Titen is unreachable."); }
    }
    return json({ data: { logged_out: true } }, 200, clearSession(request));
  }
  if (url.pathname === "/dashboard-api/password" && request.method === "PATCH") {
    if (!sessionMode) return error(404, "NOT_FOUND", "Password changes require dashboard session mode.");
    if (!mutationAuthorized(request)) return error(403, "FORBIDDEN", "A same-origin request is required.");
    const found = await sessionFor(request);
    if (!found) return error(401, "DASHBOARD_AUTH_REQUIRED", "Sign in to continue.");
    const body = await bodyObject(request, 2048);
    const password = typeof body?.password === "string" && body.password.length <= 256 ? body.password : undefined;
    if (!password) return error(400, "INVALID_REQUEST", "A new password is required.");
    try {
      const response = await upstreamRequest("/v1/operator-accounts/current/password", found.key, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => null);
      if (!payload || typeof payload !== "object")
        return error(502, "UPSTREAM_UNAVAILABLE", "Titen returned invalid JSON.");
      if (!response.ok) {
        const status = [400, 401, 404, 503].includes(response.status) ? response.status : 502;
        return json(payload, status, status === 401 ? clearSession(request) : undefined);
      }
      return json(payload, response.status, clearSession(request));
    } catch { return error(502, "UPSTREAM_UNAVAILABLE", "Titen is unreachable."); }
  }

  if (url.pathname === "/dashboard-api/atlas/compile" && request.method === "POST") {
    if (!mutationAuthorized(request)) return error(403, "FORBIDDEN", "A same-origin request is required.");
    const body = await bodyObject(request);
    if (!body) return error(400, "INVALID_REQUEST", "A bounded JSON body is required.");
    const lens = String(body.lens);
    const text = (key: string, max = 200) => body[key] === undefined ? undefined
      : typeof body[key] === "string" && body[key].length > 0 && body[key].length <= max ? body[key] : null;
    const subjectId = text("subject_id"), focusId = text("focus_id"), ownerId = text("owner_id"), cursor = text("cursor", 1000);
    const limit = body.limit === undefined ? 50 : body.limit;
    const reviewReason = body.review_reason === undefined ? "all" : String(body.review_reason);
    if (!lenses.has(lens) || subjectId === null || focusId === null || ownerId === null || cursor === null
      || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100
      || !reviewReasons.has(reviewReason)
      || ((lens === "evidence_trace" || lens === "scope_preview") && !focusId)
      || ((lens === "neighborhood" || lens === "conflict_freshness") && !subjectId))
      return error(400, "INVALID_REQUEST", "The selected lens requires bounded subject/focus input and limit 1..100.");
    const payload = {
      lens,
      ...(subjectId ? { subject_id: subjectId } : {}),
      ...(focusId ? { focus_id: focusId } : {}),
      ...(ownerId ? { owner_id: ownerId } : {}),
      ...(cursor ? { cursor } : {}),
      ...(lens === "review_queue" ? { review_reason: reviewReason } : {}),
      limit,
    };
    return proxyJson(request, "/v1/memory-views/compile", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
  }
  if (url.pathname === "/dashboard-api/context/compile" && request.method === "POST") {
    if (!mutationAuthorized(request)) return error(403, "FORBIDDEN", "A same-origin request is required.");
    const body = await bodyObject(request);
    if (!body) return error(400, "INVALID_REQUEST", "A bounded JSON body is required.");
    return proxyJson(request, "/v1/context/compile", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
  }
  if (url.pathname === "/dashboard-api/governance/users" && request.method === "POST") {
    if (!sessionMode) return error(404, "NOT_FOUND", "User administration requires dashboard session mode.");
    if (!mutationAuthorized(request)) return error(403, "FORBIDDEN", "A same-origin request is required.");
    const body = await bodyObject(request, 8192);
    if (!body) return error(400, "INVALID_REQUEST", "A bounded JSON body is required.");
    return proxyJson(request, "/v1/operator-accounts", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
  }
  if (request.method === "GET") {
    const route = readRoutes.get(url.pathname);
    if (route) {
      const path = queryPath(url, route.path, route.query);
      return path ? proxyJson(request, path) : error(400, "INVALID_REQUEST", "Query parameters are not allowlisted.");
    }
  }
  if (url.pathname.startsWith("/dashboard-api/")) return error(404, "NOT_FOUND", "Route is not allowlisted.");
  return staticFile(raw);
} });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => { server.stop(true); process.exit(0); });
console.log(`dashboard adapter listening on http://127.0.0.1:${port} (${enabled ? sessionMode ? "session" : "server-key" : "demo"})`);
