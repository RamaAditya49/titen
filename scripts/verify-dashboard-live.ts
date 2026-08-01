#!/usr/bin/env bun
/** Real Bun/SQLite upstream + same-origin dashboard adapter verification. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signPayload } from "../src/core/webhooks";
import { createSqliteDb, openDatabase } from "../src/runtime/bun/sqlite";
import { serve } from "../src/runtime/bun/server";
import { provisionWith, TEST_SECRET_CIPHER, type Provisioned } from "../tests/contract/harness";

const dir = mkdtempSync(join(tmpdir(), "titen-live-"));
const dbPath = join(dir, "titen.db");
const subject = "subject-live";
const other = "subject-other";
const federatedSubject = "subject-federated";
const marker = "LIVE SUBJECT MARKER";
const importedMarker = "IMPORTED CANONICAL MARKER";
const releaseMarker = "LIVE RELEASE MARKER";
const leak = "OTHER SUBJECT MUST NOT LEAK";
const api = await serve({
  dbPath,
  port: 0,
  hostname: "127.0.0.1",
  quiet: true,
  revision: "verify",
  secretCipher: TEST_SECRET_CIPHER,
});
const db = createSqliteDb(openDatabase(dbPath));
const destination = await provisionWith(db, { principalId: "dashboard_operator", scopes: ["*"] });
const approver = await provisionWith(db, { orgId: destination.orgId, principalId: "dashboard_approver", scopes: ["*"] });
const gateway = await provisionWith(db, { orgId: destination.orgId, principalId: "dashboard_gateway", principalKind: "service", scopes: ["*"] });
const source = await provisionWith(db, { principalId: "federation_source", scopes: ["*"] });

async function call(path: string, body: unknown, principal: Provisioned = destination) {
  const response = await fetch(api.url + path, {
    method: "POST",
    headers: { authorization: `Bearer ${principal.key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: any = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(payload)}`);
  return payload.data;
}

async function seed(principal: Provisioned, subjectId: string, label: string) {
  const observe = (content: string, ref: string) => call("/v1/observations", {
    subject_id: subjectId,
    kind: "tool_result",
    content,
    source: { type: "tool", ref },
    trust: "verified",
    visibility: "organization",
  }, principal);
  const support = await observe(`${label} support`, `${subjectId}-a`);
  const contradiction = await observe(`${label} contradiction`, `${subjectId}-b`);
  const consolidated = await call("/v1/consolidations", {
    subject_id: subjectId,
    claims: [{
      kind: "semantic_fact",
      statement: label,
      visibility: "organization",
      sources: [
        { observation_id: support.observation_id, relation: "supports" },
        { observation_id: contradiction.observation_id, relation: "contradicts" },
      ],
    }],
  }, principal);
  return consolidated.claims[0].claim_id as string;
}

async function seedActive(principal: Provisioned, subjectId: string, label: string) {
  const observed = await call("/v1/observations", {
    subject_id: subjectId,
    kind: "tool_result",
    content: `${label} support`,
    source: { type: "tool", ref: `${subjectId}-release` },
    trust: "verified",
    visibility: "organization",
  }, principal);
  const consolidated = await call("/v1/consolidations", {
    subject_id: subjectId,
    claims: [{
      kind: "semantic_fact",
      statement: label,
      visibility: "organization",
      sources: [{ observation_id: observed.observation_id, relation: "supports" }],
    }],
  }, principal);
  return consolidated.claims[0].claim_id as string;
}

await seed(destination, subject, marker);
await seed(destination, other, leak);
const releaseClaimId = await seedActive(destination, "subject-release", releaseMarker);
const sourceClaimId = await seed(source, federatedSubject, importedMarker);
const secret = "dashboard-canonical-shared-secret";
const sourcePeer = await call("/v1/federation/peers", {
  name: "dashboard-source",
  endpoint: "https://source.example.test",
  shared_secret: secret,
  direction: "pull",
}, source);
await call(`/v1/federation/peers/${sourcePeer.peer_id}/filters`, { resource_type: "claim" }, source);
const pulled = await call("/v1/federation/pull", { peer_id: sourcePeer.peer_id, include_memory: true }, source);
assert.equal(pulled.events[0].memory.claim.id, sourceClaimId);

const destinationPeer = await call("/v1/federation/peers", {
  name: "dashboard-destination",
  endpoint: "https://destination.example.test",
  shared_secret: secret,
  direction: "push",
}, destination);
await call(`/v1/federation/peers/${destinationPeer.peer_id}/filters`, { resource_type: "claim" });
const pushBody = JSON.stringify({ peer_id: destinationPeer.peer_id, events: pulled.events });
const pushedResponse = await fetch(`${api.url}/v1/federation/push`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${destination.key}`,
    "content-type": "application/json",
    "x-titen-peer-signature": `sha256=${await signPayload(secret, pushBody)}`,
  },
  body: pushBody,
});
const pushed: any = await pushedResponse.json();
assert.ok(pushedResponse.ok, JSON.stringify(pushed));
const importedClaimId = pushed.data.results[0].canonical_claim_id as string;

const channel = await call("/v1/channels", {
  label: "dashboard-verifier",
  gateway_principal_id: gateway.principalId,
  allowed_audiences: ["anonymous"],
  minimum_trust: "asserted",
}, approver);
const release = await call("/v1/knowledge-releases", {
  claim_id: releaseClaimId,
  claim_version: 1,
  channel_id: channel.channel_id,
  audience: "anonymous",
  released_content: releaseMarker,
  proposal_reason: "Dashboard live verifier",
}, destination);
await call(`/v1/knowledge-releases/${release.release_id}/approve`, {
  expected_version: 1,
  reason: "Independent verifier approval",
}, approver);
await call(`/v1/knowledge-releases/${release.release_id}/activate`, { expected_version: 2 }, approver);

const port = 44_000 + Math.floor(Math.random() * 1000);
const adapter = Bun.spawn({
  cmd: [process.execPath, "scripts/dashboard-adapter.ts"],
  env: {
    ...process.env,
    TITEN_DASHBOARD_LIVE: "true",
    TITEN_API_URL: api.url,
    TITEN_API_KEY: destination.key,
    TITEN_DASHBOARD_PORT: String(port),
  },
  stdout: "ignore",
  stderr: "pipe",
});
const dashboard = `http://127.0.0.1:${port}`;

async function dashboardCall(path: string, body?: unknown) {
  const response = await fetch(dashboard + path, body === undefined ? undefined : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
  assert.ok(!JSON.stringify(status).includes(destination.key), "status must not expose the API key");
  assert.equal((await dashboardCall("/dashboard-api/health")).data.status, "ok");
  assert.equal((await dashboardCall("/dashboard-api/readiness")).data.ready, true);

  const cases = [
    { input: { lens: "neighborhood", subject_id: federatedSubject, limit: 5 }, marker: importedMarker },
    { input: { lens: "conflict_freshness", subject_id: federatedSubject, limit: 5 }, marker: importedMarker },
    { input: { lens: "evidence_trace", focus_id: importedClaimId, limit: 5 }, marker: importedMarker },
    { input: { lens: "review_queue", subject_id: federatedSubject, review_reason: "all", limit: 5 }, marker: importedMarker },
    { input: { lens: "scope_preview", focus_id: destination.principalId, limit: 5 }, marker: "agent" },
    { input: { lens: "knowledge_release", focus_id: channel.channel_id, limit: 5 }, marker: releaseMarker },
  ];
  for (const { input, marker: expected } of cases) {
    const payload = await dashboardCall("/dashboard-api/atlas/compile", input);
    const labels = payload.data.nodes.map((node: any) => node.label);
    assert.ok(labels.includes(expected), `${input.lens} returns its authorized record`);
    assert.ok(!labels.includes(leak), `${input.lens} excludes another subject`);
  }
  console.log("OK — six scoped Atlas lenses + signed canonical federation recall passed through the live adapter");
} finally {
  adapter.kill();
  await api.stop();
  rmSync(dir, { recursive: true, force: true });
}
