#!/usr/bin/env bun
/** Loopback-only static dashboard + narrowly allowlisted live Atlas adapter. */
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const enabled = process.env.TITEN_DASHBOARD_LIVE === "true";
const upstream = process.env.TITEN_API_URL;
const apiKey = process.env.TITEN_API_KEY;
const port = Number(process.env.TITEN_DASHBOARD_PORT ?? "4322");
const root = await realpath(fileURLToPath(new URL("../dist/", import.meta.url)));
if (enabled && (!upstream || !apiKey)) { console.error("dashboard-adapter: live mode requires TITEN_API_URL and TITEN_API_KEY"); process.exit(1); }
if (upstream) { const parsed = new URL(upstream); if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("TITEN_API_URL must be an http(s) origin without credentials, query, or fragment"); }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const lenses = new Set(["conflict_freshness"]);
function authorized(request: Request): boolean {
  const host = request.headers.get("host")?.toLowerCase();
  const expected = `127.0.0.1:${port}`;
  if (host !== expected && host !== `localhost:${port}` && host !== `[::1]:${port}`) return false;
  const origin = request.headers.get("origin");
  return !origin || origin === `http://${host}`;
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
    return new Response(Bun.file(canonical));
  } catch { return new Response("Not found", { status: 404 }); }
}
Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
  const raw = request.url.replace(/^https?:\/\/[^/]+/i, "");
  const url = new URL(request.url);
  if (!authorized(request)) return json({ error: { code: "FORBIDDEN", message: "Dashboard adapter is loopback same-origin only." } }, 403);
  if (url.pathname === "/dashboard-api/status" && request.method === "GET") return json({ mode: enabled ? "live" : "demo", endpoint: enabled ? new URL(upstream!).host : null });
  if (url.pathname === "/dashboard-api/atlas/compile" && request.method === "POST") {
    if (!enabled) return json({ error: { code: "DASHBOARD_DISCONNECTED", message: "Live dashboard integration is not enabled." } }, 503);
    let body: Record<string, unknown>; try { body = await request.json(); } catch { return json({ error: { code: "INVALID_REQUEST", message: "A JSON body is required." } }, 400); }
    if (!lenses.has(String(body.lens)) || typeof body.subject_id !== "string" || body.subject_id.length < 1 || body.subject_id.length > 200 || (body.limit !== undefined && (!Number.isInteger(body.limit) || Number(body.limit) < 1 || Number(body.limit) > 100))) return json({ error: { code: "INVALID_REQUEST", message: "lens, bounded subject_id, and optional limit 1..100 are required." } }, 400);
    const payload = { lens: body.lens, subject_id: body.subject_id, ...(typeof body.focus_id === "string" && body.focus_id.length <= 200 ? { focus_id: body.focus_id } : {}), ...(body.limit === undefined ? {} : { limit: body.limit }) };
    try { const response = await fetch(`${upstream!.replace(/\/+$/, "")}/v1/memory-views/compile`, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) }); if (!response.ok) return json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Titen did not return an authorized Atlas view." } }, 502); return json(await response.json()); } catch { return json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Titen is unreachable." } }, 502); }
  }
  if (url.pathname.startsWith("/dashboard-api/")) return json({ error: { code: "NOT_FOUND", message: "Route is not allowlisted." } }, 404);
  return staticFile(raw);
} });
console.log(`dashboard adapter listening on http://127.0.0.1:${port} (${enabled ? "live" : "demo"})`);
