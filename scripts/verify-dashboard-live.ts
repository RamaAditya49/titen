#!/usr/bin/env bun
/**
 * Proves the dashboard renders live memory instead of the frozen fixture.
 *
 * Starts a real Titen service, seeds a disputed claim with a statement that
 * cannot appear in the fixture, builds the dashboard against it, and asserts the
 * built HTML contains the live claim and not the fixture rows. Run:
 *
 *   bun scripts/verify-dashboard-live.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../src/runtime/bun/sqlite";
import { serve } from "../src/runtime/bun/server";
import { provisionWith } from "../tests/contract/harness";

const directory = mkdtempSync(join(tmpdir(), "titen-dash-"));
const dbPath = join(directory, "titen.db");
const SUBJECT = "checkout-service";
const LIVE_MARKER = "Live disputed claim proving the dashboard reads the API";

const running = await serve({
  dbPath,
  port: 0,
  hostname: "127.0.0.1",
  quiet: true,
  revision: "dash",
});
const { key } = await provisionWith(createSqliteDb(openDatabase(dbPath)), { scopes: ["*"] });

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${running.url}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = (await res.json()) as any;
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(parsed)}`);
  return parsed;
};

// Two contradicting observations produce a disputed claim, which is exactly what
// the Conflict & Freshness lens exists to surface.
const supporting = await call("POST", "/v1/observations", {
  subject_id: SUBJECT,
  kind: "tool_result",
  content: "Smoke run recorded p95 at 383 ms.",
  source: { type: "tool", ref: "dash#1" },
  trust: "verified",
});
const contradicting = await call("POST", "/v1/observations", {
  subject_id: SUBJECT,
  kind: "tool_result",
  content: "Peak run recorded p95 at 268 ms.",
  source: { type: "tool", ref: "dash#2" },
  trust: "verified",
});
const consolidated = await call("POST", "/v1/consolidations", {
  subject_id: SUBJECT,
  claims: [
    {
      kind: "decision",
      statement: LIVE_MARKER,
      sources: [
        { observation_id: supporting.data.observation_id, relation: "supports" },
        { observation_id: contradicting.data.observation_id, relation: "contradicts" },
      ],
    },
  ],
});
assert.equal(consolidated.data.claims[0].status, "disputed", "the fixture needs a dispute");

// Confirm the API itself reports it, so a later failure is the dashboard's.
const view = await call("POST", "/v1/memory-views/compile", {
  lens: "conflict_freshness",
  subject_id: SUBJECT,
  limit: 5,
});
assert.ok(
  view.data.nodes.some((node: any) => node.label === LIVE_MARKER),
  "the Atlas lens must report the disputed claim",
);
console.log(`api: conflict_freshness returned ${view.data.nodes.length} node(s)`);

// Build the dashboard pointed at this service.
// Async spawn on purpose: spawnSync would block this process's event loop and
// the in-process service could not answer the build's fetch.
const build = Bun.spawn({
  cmd: ["pnpm", "build"],
  env: {
    ...process.env,
    PUBLIC_TITEN_ENDPOINT: running.url,
    PUBLIC_TITEN_DASHBOARD_KEY: key,
    PUBLIC_TITEN_SUBJECT: SUBJECT,
  },
  stdout: "pipe",
  stderr: "pipe",
});
if ((await build.exited) !== 0) {
  console.error(await new Response(build.stderr).text());
  throw new Error("dashboard build failed against the live endpoint");
}

const html = readFileSync(join(process.cwd(), "dist/dashboard/index.html"), "utf8");

assert.ok(html.includes(LIVE_MARKER), "the built page must contain the live claim");
assert.ok(
  !html.includes("Escalation contact is the platform lead"),
  "fixture rows must be replaced when live data is available",
);
assert.ok(
  html.includes(new URL(running.url).host),
  "the shell must name the endpoint it read",
);
assert.ok(!html.includes(key), "the built page must not embed the API key");

console.log("dashboard: live claim rendered, fixture rows replaced, no key embedded");

await running.stop();
rmSync(directory, { recursive: true, force: true });

// Leave the checked-in build in its offline state so the committed output and
// the browser suite keep describing the fixture.
const restore = Bun.spawn({ cmd: ["pnpm", "build"], stdout: "pipe", stderr: "pipe" });
if ((await restore.exited) !== 0) throw new Error("failed to restore the offline build");
const offline = readFileSync(join(process.cwd(), "dist/dashboard/index.html"), "utf8");
assert.ok(!offline.includes(LIVE_MARKER), "the offline build must not retain live data");
assert.ok(
  offline.includes("synthetic fixture"),
  "with no endpoint the shell must say it is showing a fixture",
);

console.log("restored: offline build shows the fixture and says so");
console.log("\nOK — the dashboard reads the memory API when one is configured.");
