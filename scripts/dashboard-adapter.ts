#!/usr/bin/env bun
/** Loopback-only static dashboard + narrowly allowlisted live read adapter. */
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const enabled = process.env.TITEN_DASHBOARD_LIVE === "true";
const upstream = process.env.TITEN_API_URL;
const apiKey = process.env.TITEN_API_KEY;
const publicOriginValue = process.env.TITEN_DASHBOARD_ORIGIN;
const port = Number(process.env.TITEN_DASHBOARD_PORT ?? "4322");
const root = await realpath(fileURLToPath(new URL("../dist/", import.meta.url)));
if (enabled && (!upstream || !apiKey)) { console.error("dashboard-adapter: live mode requires TITEN_API_URL and TITEN_API_KEY"); process.exit(1); }
if (upstream) { const parsed = new URL(upstream); if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("TITEN_API_URL must be an http(s) origin without credentials, query, or fragment"); }
const publicOrigin = publicOriginValue ? new URL(publicOriginValue) : null;
if (publicOrigin && (!/^https?:$/.test(publicOrigin.protocol) || publicOrigin.username || publicOrigin.password || publicOrigin.pathname !== "/" || publicOrigin.search || publicOrigin.hash)) throw new Error("TITEN_DASHBOARD_ORIGIN must be an http(s) origin without credentials, path, query, or fragment");
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const lenses = new Set(["evidence_trace", "neighborhood", "conflict_freshness", "review_queue", "scope_preview", "knowledge_release"]);
const reviewReasons = new Set(["all", "disputed", "contradiction", "low_confidence", "negative_feedback"]);
function authorized(request: Request): boolean {
  const host = request.headers.get("host")?.toLowerCase();
  const expected = `127.0.0.1:${port}`;
  const loopback = host === expected || host === `localhost:${port}` || host === `[::1]:${port}`;
  if (!loopback && host !== publicOrigin?.host.toLowerCase()) return false;
  const origin = request.headers.get("origin");
  return !origin || origin === `http://${host}` || origin === publicOrigin?.origin;
}
async function staticFile(raw: string): Promise<Response> {
  // WHATWG URL normalizes traversal before pathname is exposed. Inspect the raw
  // request target first and reject every ambiguous or encoded form.
  if (/\0|\\|%00/i.test(raw) || raw.startsWith("//") || isAbsolute(raw.replace(/^\//, ""))) return new Response("Not found", { status: 404 });
  let decoded = raw;
  for (let i = 0; i < 3; i++) { try { decoded = decodeURIComponent(decoded); } catch { return new Response("Not found", { status: 404 }); } if (/\0|\\|(^|\/)\.\.(\/|$)|^\/\//.test(decoded)) return new Response("Not found", { status: 404 }); }
  const path = decoded.split("?", 1)[0].split("#", 1)[0];
  const route = path === "/" ? "index.html" : path === "/dashboard" || path === "/dashboard/" ? "dashboard/index.html" : path.replace(/^\//, "").replace(/\/$/, "/index.html");
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
async function upstreamRequest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${upstream!.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${apiKey}`, ...init?.headers },
    signal: AbortSignal.timeout(5000),
  });
}
async function serviceCheck(path: "/healthz" | "/readyz"): Promise<Response> {
  if (!enabled) return json({ error: { code: "DASHBOARD_DISCONNECTED", message: "Live dashboard integration is not enabled." } }, 503);
  try {
    const response = await upstreamRequest(path);
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") return json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Titen returned an invalid service check." } }, 502);
    return json(payload, response.status);
  } catch {
    return json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Titen is unreachable." } }, 502);
  }
}
Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
  const raw = request.url.replace(/^https?:\/\/[^/]+/i, "");
  const url = new URL(request.url);
  if (!authorized(request)) return json({ error: { code: "FORBIDDEN", message: "Dashboard adapter is loopback same-origin only." } }, 403);
  if (url.pathname === "/dashboard-api/status" && request.method === "GET") return json({ mode: enabled ? "live" : "disconnected", endpoint: enabled ? new URL(upstream!).host : null });
  if (url.pathname === "/dashboard-api/health" && request.method === "GET") return serviceCheck("/healthz");
  if (url.pathname === "/dashboard-api/readiness" && request.method === "GET") return serviceCheck("/readyz");
  if (url.pathname === "/dashboard-api/atlas/compile" && request.method === "POST") {
    if (!enabled) return json({ error: { code: "DASHBOARD_DISCONNECTED", message: "Live dashboard integration is not enabled." } }, 503);
    let body: Record<string, unknown>; try { body = await request.json(); } catch { return json({ error: { code: "INVALID_REQUEST", message: "A JSON body is required." } }, 400); }
    const lens = String(body.lens);
    const text = (key: string, max = 200) => body[key] === undefined ? undefined : typeof body[key] === "string" && body[key].length > 0 && body[key].length <= max ? body[key] : null;
    const subjectId = text("subject_id"), focusId = text("focus_id"), ownerId = text("owner_id"), cursor = text("cursor", 1000);
    const limit = body.limit === undefined ? 50 : body.limit;
    const reviewReason = body.review_reason === undefined ? "all" : String(body.review_reason);
    if (!lenses.has(lens) || subjectId === null || focusId === null || ownerId === null || cursor === null
      || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100
      || !reviewReasons.has(reviewReason)
      || ((lens === "evidence_trace" || lens === "scope_preview") && !focusId)
      || ((lens === "neighborhood" || lens === "conflict_freshness") && !subjectId))
      return json({ error: { code: "INVALID_REQUEST", message: "The selected lens requires bounded subject/focus input and limit 1..100." } }, 400);
    const payload = {
      lens,
      ...(subjectId ? { subject_id: subjectId } : {}),
      ...(focusId ? { focus_id: focusId } : {}),
      ...(ownerId ? { owner_id: ownerId } : {}),
      ...(cursor ? { cursor } : {}),
      ...(lens === "review_queue" ? { review_reason: reviewReason } : {}),
      limit,
    };
    try {
      const response = await upstreamRequest("/v1/memory-views/compile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) {
        const status = [400, 401, 403, 404, 503].includes(response.status) ? response.status : 502;
        const message = status === 401 ? "The dashboard credential was rejected."
          : status === 403 ? "The dashboard credential cannot access this view."
            : status === 404 ? "The requested authorized record was not found."
              : status === 503 ? "Titen is not ready."
                : status === 400 ? "Titen rejected the Atlas request."
                  : "Titen did not return an authorized Atlas view.";
        return json({ error: { code: `UPSTREAM_${status}`, message } }, status);
      }
      const responsePayload = await response.json().catch(() => null);
      return responsePayload && typeof responsePayload === "object" ? json(responsePayload) : json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Titen returned an invalid Atlas view." } }, 502);
    } catch { return json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Titen is unreachable." } }, 502); }
  }
  if (url.pathname.startsWith("/dashboard-api/")) return json({ error: { code: "NOT_FOUND", message: "Route is not allowlisted." } }, 404);
  return staticFile(raw);
} });
console.log(`dashboard adapter listening on http://127.0.0.1:${port} (${enabled ? "live" : "demo"})`);
