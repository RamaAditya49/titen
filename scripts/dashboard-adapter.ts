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
const MAX_SESSIONS = 128;
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
}
interface Session {
  key: string;
  keyId: string;
  principal: DashboardPrincipal;
  expiresAt: number;
}

// ponytail: process-local sessions fit one adapter; use a shared encrypted
// session store only if multiple dashboard adapter replicas become necessary.
const sessions = new Map<string, Session>();
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
    || (role !== null && !["root", "owner", "admin", "member", "reader"].includes(String(role)))) return;
  return {
    organization_id: row.organization_id,
    principal_id: row.principal_id,
    principal_kind: kind as DashboardPrincipal["principal_kind"],
    key_id: row.key_id,
    scopes: row.scopes,
    max_trust: trust as DashboardPrincipal["max_trust"],
    organization_role: role as DashboardPrincipal["organization_role"],
  };
}
function sessionId(request: Request): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
}
function sessionFor(request: Request): [string, Session] | undefined {
  const id = sessionId(request);
  const session = id ? sessions.get(id) : undefined;
  if (!id || !session) return;
  if (session.expiresAt <= Date.now()) { sessions.delete(id); return; }
  return [id, session];
}
function rememberSession(key: string, principal: DashboardPrincipal): string {
  const now = Date.now();
  for (const [id, session] of sessions)
    if (session.expiresAt <= now || session.keyId === principal.key_id) sessions.delete(id);
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (!oldest) break;
    sessions.delete(oldest);
  }
  const id = crypto.randomUUID().replaceAll("-", "");
  sessions.set(id, { key, keyId: principal.key_id, principal, expiresAt: now + SESSION_TTL_MS });
  return id;
}
function cookie(id: string, maxAge = SESSION_TTL_MS / 1000): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${publicOrigin ? "; Secure" : ""}`;
}
function clearSession(request: Request): HeadersInit {
  const id = sessionId(request);
  if (id) sessions.delete(id);
  return { "set-cookie": cookie("", 0) };
}
function credential(request: Request): { key: string; sessionId?: string } | undefined {
  if (!sessionMode) return apiKey ? { key: apiKey } : undefined;
  const found = sessionFor(request);
  return found ? { key: found[1].key, sessionId: found[0] } : undefined;
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
  if (status === 503) return "Titen is not ready.";
  if (status === 400 || status === 413) return "Titen rejected the bounded request.";
  return "Titen did not return a usable response.";
}
async function proxyJson(request: Request, path: string, init?: RequestInit): Promise<Response> {
  if (!enabled) return error(503, "DASHBOARD_DISCONNECTED", "Live dashboard integration is not enabled.");
  const auth = credential(request);
  if (!auth) return error(401, "DASHBOARD_AUTH_REQUIRED", "Sign in to continue.");
  try {
    const response = await upstreamRequest(path, auth.key, init);
    const payload = await response.json().catch(() => null);
    const clear = response.status === 401 && sessionMode ? clearSession(request) : undefined;
    if (!payload || typeof payload !== "object") return error(502, "UPSTREAM_UNAVAILABLE", "Titen returned invalid JSON.", clear);
    if (!response.ok) {
      const status = [400, 401, 403, 404, 409, 413, 503].includes(response.status) ? response.status : 502;
      return error(status, `UPSTREAM_${status}`, upstreamMessage(status), clear);
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
    const loggedIn = sessionMode ? Boolean(sessionFor(request)) : enabled;
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
    const key = typeof body?.api_key === "string" && body.api_key.startsWith("titen_sk_") && body.api_key.length <= 512
      ? body.api_key : undefined;
    if (!key) return error(401, "INVALID_CREDENTIAL", "The Titen credential was rejected.");
    try {
      const { response, principal } = await introspect(key);
      if (response.status === 401) return error(401, "INVALID_CREDENTIAL", "The Titen credential was rejected.");
      if (response.status === 503) return error(503, "UPSTREAM_503", "Titen is not ready.");
      if (!response.ok || !principal) return error(502, "UPSTREAM_UNAVAILABLE", "Titen returned an invalid principal.");
      const id = rememberSession(key, principal);
      return json({ data: principal }, 201, { "set-cookie": cookie(id) });
    } catch { return error(502, "UPSTREAM_UNAVAILABLE", "Titen is unreachable."); }
  }
  if (url.pathname === "/dashboard-api/session" && request.method === "GET") {
    const found = sessionMode ? sessionFor(request) : undefined;
    const key = sessionMode ? found?.[1].key : apiKey;
    if (!key) return error(401, "DASHBOARD_AUTH_REQUIRED", "Sign in to continue.");
    try {
      const { response, principal } = await introspect(key);
      if (response.status === 401) return error(401, "DASHBOARD_AUTH_REQUIRED", "Sign in to continue.",
        sessionMode ? clearSession(request) : undefined);
      if (response.status === 503) return error(503, "UPSTREAM_503", "Titen is not ready.");
      if (!response.ok || !principal) return error(502, "UPSTREAM_UNAVAILABLE", "Titen returned an invalid principal.");
      if (found) found[1].principal = principal;
      return json({ data: principal });
    } catch { return error(502, "UPSTREAM_UNAVAILABLE", "Titen is unreachable."); }
  }
  if (url.pathname === "/dashboard-api/session" && request.method === "DELETE") {
    if (!mutationAuthorized(request)) return error(403, "FORBIDDEN", "A same-origin request is required.");
    return json({ data: { logged_out: true } }, 200, clearSession(request));
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
    return proxyJson(request, "/v1/keys", {
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
