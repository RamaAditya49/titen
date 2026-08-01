#!/usr/bin/env bun
/** Real Bun/SQLite upstream + same-origin dashboard adapter verification. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../src/runtime/bun/sqlite";
import { serve } from "../src/runtime/bun/server";
import { provisionWith } from "../tests/contract/harness";

const dir = mkdtempSync(join(tmpdir(), "titen-live-"));
const dbPath = join(dir, "titen.db");
const subject = "subject-live";
const other = "subject-other";
const marker = "LIVE SUBJECT MARKER";
const leak = "OTHER SUBJECT MUST NOT LEAK";
const api = await serve({ dbPath, port: 0, hostname: "127.0.0.1", quiet: true, revision: "verify" });
const { key } = await provisionWith(createSqliteDb(openDatabase(dbPath)), { scopes: ["*"] });

async function call(path: string, body: unknown) {
  const response = await fetch(api.url + path, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: any = await response.json();
  assert.ok(response.ok, JSON.stringify(payload));
  return payload.data;
}

async function seed(subjectId: string, label: string) {
  const support = await call("/v1/observations", { subject_id: subjectId, kind: "tool_result", content: "supports", source: { type: "tool", ref: `${subjectId}-a` }, trust: "verified" });
  const contradiction = await call("/v1/observations", { subject_id: subjectId, kind: "tool_result", content: "contradicts", source: { type: "tool", ref: `${subjectId}-b` }, trust: "verified" });
  const consolidated = await call("/v1/consolidations", { subject_id: subjectId, claims: [{ kind: "semantic_fact", statement: label, sources: [{ observation_id: support.observation_id, relation: "supports" }, { observation_id: contradiction.observation_id, relation: "contradicts" }] }] });
  return consolidated.claims[0].claim_id as string;
}

const claimId = await seed(subject, marker);
await seed(other, leak);
const port = 44_000 + Math.floor(Math.random() * 1000);
const adapter = Bun.spawn({
  cmd: [process.execPath, "scripts/dashboard-adapter.ts"],
  env: { ...process.env, TITEN_DASHBOARD_LIVE: "true", TITEN_API_URL: api.url, TITEN_API_KEY: key, TITEN_DASHBOARD_PORT: String(port) },
  stdout: "ignore",
  stderr: "pipe",
});
const dashboard = `http://127.0.0.1:${port}`;

async function dashboardCall(path: string, body?: unknown) {
  const response = await fetch(dashboard + path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload: any = await response.json();
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(payload)}`);
  return payload;
}

try {
  let started = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${dashboard}/dashboard-api/status`)).ok) { started = true; break; } } catch {}
    await Bun.sleep(20);
  }
  assert.ok(started, "adapter starts");
  const status = await dashboardCall("/dashboard-api/status");
  assert.equal(status.mode, "live");
  assert.ok(!JSON.stringify(status).includes(key), "status must not expose the API key");
  assert.equal((await dashboardCall("/dashboard-api/health")).data.status, "ok");
  assert.equal((await dashboardCall("/dashboard-api/readiness")).data.ready, true);

  const cases = [
    { lens: "neighborhood", subject_id: subject, limit: 5 },
    { lens: "conflict_freshness", subject_id: subject, limit: 5 },
    { lens: "evidence_trace", focus_id: claimId, limit: 5 },
    { lens: "review_queue", subject_id: subject, review_reason: "all", limit: 5 },
  ];
  for (const input of cases) {
    const payload = await dashboardCall("/dashboard-api/atlas/compile", input);
    const labels = payload.data.nodes.map((node: any) => node.label);
    assert.ok(labels.includes(marker), `${input.lens} returns the authorized subject`);
    assert.ok(!labels.includes(leak), `${input.lens} excludes another subject`);
  }
  console.log("OK — live health/readiness + four scoped Atlas lenses passed through the same-origin adapter");
} finally {
  adapter.kill();
  await api.stop();
  rmSync(dir, { recursive: true, force: true });
}
