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
const destination = await provisionWith(db, {
  principalId: "dashboard_operator",
  principalKind: "human",
  scopes: ["*"],
  maxTrust: "policy_approved",
});
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
await call("/v1/leases", {
  resource_type: "release",
  resource_id: "dashboard-release",
  purpose: "verify live work area",
  ttl_seconds: 600,
});
await call("/v1/handoffs", {
  to_principal: destination.principalId,
  subject_id: subject,
  message: "Verify the live dashboard product map.",
}, approver);

const ownerUsername = "dashboard.owner";
const ownerPassword = "correct horse battery staple owner";
const ownerAccount = await call("/v1/operator-accounts", {
  username: ownerUsername,
  role: "owner",
  scopes: ["*"],
  max_trust: "policy_approved",
});
const ownerLoginResponse = await fetch(`${api.url}/v1/dashboard-sessions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: ownerUsername, password: ownerAccount.temporary_password }),
});
const temporaryOwnerLogin: any = await ownerLoginResponse.json();
assert.ok(ownerLoginResponse.ok, JSON.stringify(temporaryOwnerLogin));
assert.equal(temporaryOwnerLogin.data.password_change_required, true);
assert.deepEqual(temporaryOwnerLogin.data.scopes, []);
const changedOwnerPassword = await fetch(`${api.url}/v1/operator-accounts/current/password`, {
  method: "PATCH",
  headers: { authorization: `Bearer ${temporaryOwnerLogin.data.api_key}`, "content-type": "application/json" },
  body: JSON.stringify({ password: ownerPassword }),
});
assert.equal(changedOwnerPassword.status, 200);
assert.equal((await fetch(`${api.url}/v1/principal`, {
  headers: { authorization: `Bearer ${temporaryOwnerLogin.data.api_key}` },
})).status, 401, "password change revokes the temporary session");
const establishedOwnerLoginResponse = await fetch(`${api.url}/v1/dashboard-sessions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: ownerUsername, password: ownerPassword }),
});
const ownerLogin: any = await establishedOwnerLoginResponse.json();
assert.ok(establishedOwnerLoginResponse.ok, JSON.stringify(ownerLogin));
assert.equal(ownerLogin.data.password_change_required, false);
const ownerSession: Provisioned = {
  orgId: ownerLogin.data.organization_id,
  principalId: ownerLogin.data.principal_id,
  keyId: ownerLogin.data.key_id,
  key: ownerLogin.data.api_key,
};
await call("/v1/checkpoints", {
  subject_id: subject,
  kind: "task_state",
  state: { phase: "verify" },
  ttl_seconds: 600,
}, ownerSession);
const ownerPeer = await call("/v1/federation/peers", {
  name: "dashboard-owner-peer",
  endpoint: "https://owner.example.test",
  shared_secret: "dashboard-owner-shared-secret",
  direction: "pull",
}, ownerSession);
await call(`/v1/federation/peers/${ownerPeer.peer_id}/filters`, { resource_type: "claim" }, ownerSession);
await call("/v1/federation/pull", { peer_id: ownerPeer.peer_id }, ownerSession);
await call("/v1/handoffs", {
  to_principal: ownerAccount.principal_id,
  subject_id: subject,
  message: "Verify the live dashboard product map as its human owner.",
}, approver);

const port = 44_000 + Math.floor(Math.random() * 1000);
const adapter = Bun.spawn({
  cmd: [process.execPath, "scripts/dashboard-adapter.ts"],
  env: {
    ...process.env,
    TITEN_DASHBOARD_LIVE: "true",
    TITEN_DASHBOARD_AUTH: "session",
    TITEN_API_URL: api.url,
    TITEN_DASHBOARD_PORT: String(port),
  },
  stdout: "ignore",
  stderr: "pipe",
});
const dashboard = `http://127.0.0.1:${port}`;
let sessionCookie = "";

async function dashboardCall(
  path: string,
  options: { method?: string; body?: unknown; expected?: number; authenticated?: boolean } = {},
) {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const headers = new Headers({ accept: "application/json" });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (method !== "GET") headers.set("origin", dashboard);
  if (options.authenticated !== false && sessionCookie) headers.set("cookie", sessionCookie);
  const response = await fetch(dashboard + path, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const payload: any = await response.json();
  assert.equal(response.status, options.expected ?? 200, `${path}: ${JSON.stringify(payload)}`);
  return { payload, response };
}

try {
  let started = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${dashboard}/dashboard-api/status`)).ok) { started = true; break; } } catch {}
    await Bun.sleep(20);
  }
  assert.ok(started, "adapter starts");
  const initial = (await dashboardCall("/dashboard-api/status", { authenticated: false })).payload;
  assert.equal(initial.mode, "live");
  assert.equal(initial.authentication, "session");
  assert.equal(initial.authenticated, false);
  assert.ok(!JSON.stringify(initial).includes(destination.key), "status must not expose the bootstrap API key");
  const loggedIn = await dashboardCall("/dashboard-api/session", {
    method: "POST",
    body: { username: ownerUsername, password: ownerPassword },
    expected: 201,
    authenticated: false,
  });
  sessionCookie = loggedIn.response.headers.get("set-cookie")!.split(";", 1)[0]!;
  assert.match(sessionCookie, /^titen_dashboard_session=/);
  assert.ok(!JSON.stringify(loggedIn.payload).includes(ownerPassword), "login must not echo the password");
  assert.equal(loggedIn.payload.data.principal_id, ownerAccount.principal_id);
  assert.equal((await dashboardCall("/dashboard-api/health")).payload.data.status, "ok");
  assert.equal((await dashboardCall("/dashboard-api/readiness")).payload.data.ready, true);

  const cases = [
    { input: { lens: "neighborhood", subject_id: federatedSubject, limit: 5 }, marker: importedMarker },
    { input: { lens: "conflict_freshness", subject_id: federatedSubject, limit: 5 }, marker: importedMarker },
    { input: { lens: "evidence_trace", focus_id: importedClaimId, limit: 5 }, marker: importedMarker },
    { input: { lens: "review_queue", subject_id: federatedSubject, review_reason: "all", limit: 5 }, marker: importedMarker },
    { input: { lens: "scope_preview", focus_id: destination.principalId, limit: 5 }, marker: "human" },
    { input: { lens: "knowledge_release", focus_id: channel.channel_id, limit: 5 }, marker: releaseMarker },
  ];
  for (const { input, marker: expected } of cases) {
    const payload = (await dashboardCall("/dashboard-api/atlas/compile", { body: input })).payload;
    const labels = payload.data.nodes.map((node: any) => node.label);
    assert.ok(labels.includes(expected), `${input.lens} returns its authorized record`);
    assert.ok(!labels.includes(leak), `${input.lens} excludes another subject`);
  }

  const context = (await dashboardCall("/dashboard-api/context/compile", { body: {
    subject_id: federatedSubject,
    task: "imported canonical marker",
    max_tokens: 600,
  } })).payload.data;
  assert.ok(context.items.some((item: any) => item.claim.includes(importedMarker)), "Context area returns imported memory");

  const leases = (await dashboardCall("/dashboard-api/work/leases?limit=50")).payload.data.leases;
  assert.ok(leases.some((item: any) => item.resource_id === "dashboard-release"), "Work area returns leases");
  const handoffs = (await dashboardCall("/dashboard-api/work/handoffs")).payload.data.handoffs;
  assert.ok(handoffs.some((item: any) => item.message.includes("product map")), "Work area returns pending handoffs");
  assert.equal((await dashboardCall(`/dashboard-api/work/checkpoint?subject_id=${subject}&agent_id=${ownerAccount.principal_id}&kind=task_state`)).payload.data.state.phase, "verify");

  assert.ok((await dashboardCall("/dashboard-api/audit/log?limit=50")).payload.data.entries.length > 0, "Audit area returns entries");
  assert.ok((await dashboardCall("/dashboard-api/audit/events?limit=50")).payload.data.events.length > 0, "Audit area returns events");
  assert.ok((await dashboardCall("/dashboard-api/governance/channels")).payload.data.channels.length > 0, "Governance area returns channels");
  assert.ok((await dashboardCall("/dashboard-api/governance/releases")).payload.data.releases.length > 0, "Governance area returns releases");
  assert.ok((await dashboardCall("/dashboard-api/federation/peers")).payload.data.peers.length > 0, "Federation area returns peers");
  assert.ok((await dashboardCall(`/dashboard-api/federation/log?peer_id=${ownerPeer.peer_id}&limit=50`)).payload.data.entries.length > 0, "Federation area returns exchange log");

  const created = (await dashboardCall("/dashboard-api/governance/users", { body: {
    username: "dashboard.reader",
    role: "reader",
    scopes: ["views:compile"],
    max_trust: "asserted",
  }, expected: 201 })).payload.data;
  assert.equal(created.api_key, undefined);
  assert.match(created.temporary_password, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(created.password_change_required, true);
  assert.equal(created.username, "dashboard.reader");
  assert.equal(created.role, "reader");
  const membershipRows = await db.all<{ count: number }>(
    `SELECT COUNT(*) AS count FROM memberships WHERE org_id = ? AND principal_id = ? AND role = 'reader' AND removed_at IS NULL`,
    [destination.orgId, created.principal_id],
  );
  assert.equal(Number(membershipRows[0]!.count), 1, "Add user commits one membership");

  await dashboardCall("/dashboard-api/session", { method: "DELETE" });
  assert.equal((await dashboardCall("/dashboard-api/work/leases", { expected: 401 })).payload.error.code, "DASHBOARD_AUTH_REQUIRED");
  sessionCookie = "";
  const readerLogin = await dashboardCall("/dashboard-api/session", {
    method: "POST",
    body: { username: "dashboard.reader", password: created.temporary_password },
    expected: 201,
    authenticated: false,
  });
  sessionCookie = readerLogin.response.headers.get("set-cookie")!.split(";", 1)[0]!;
  assert.equal(readerLogin.payload.data.principal_id, created.principal_id, "new user can log in");
  assert.equal(readerLogin.payload.data.password_change_required, true);
  assert.deepEqual(readerLogin.payload.data.scopes, []);
  assert.equal((await dashboardCall("/dashboard-api/work/leases", { expected: 403 })).payload.error.code, "UPSTREAM_403");
  const readerPassword = "correct horse battery staple reader";
  const changed = await dashboardCall("/dashboard-api/password", {
    method: "PATCH",
    body: { password: readerPassword },
  });
  assert.match(changed.response.headers.get("set-cookie") ?? "", /Max-Age=0/);
  sessionCookie = "";
  await dashboardCall("/dashboard-api/session", {
    method: "POST",
    body: { username: "dashboard.reader", password: created.temporary_password },
    expected: 401,
    authenticated: false,
  });
  const establishedReader = await dashboardCall("/dashboard-api/session", {
    method: "POST",
    body: { username: "dashboard.reader", password: readerPassword },
    expected: 201,
    authenticated: false,
  });
  sessionCookie = establishedReader.response.headers.get("set-cookie")!.split(";", 1)[0]!;
  assert.equal(establishedReader.payload.data.password_change_required, false);
  assert.equal((await dashboardCall("/dashboard-api/session")).payload.data.organization_role, "reader");

  console.log("OK — six live product areas, forced first password change, atomic add-user, and canonical federation passed through the real adapter");
} finally {
  adapter.kill();
  await api.stop();
  rmSync(dir, { recursive: true, force: true });
}
