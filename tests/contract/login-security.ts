import assert from "node:assert/strict";
import type { Db } from "../../src/core/db";
import { createApp } from "../../src/core/app";
import { newOperatorAccount } from "../../src/core/accounts";
import { organizationStatement } from "../../src/core/auth";
import { sha256Hex } from "../../src/core/ids";

export async function assertLoginSecurity(db: Db, runtime: string) {
  const now = new Date("2026-10-05T00:00:00Z");
  const orgId = `org_login_${runtime}`;
  const username = `login-${runtime}`;
  const account = await newOperatorAccount({ orgId, username, createdBy: "test-owner", role: "owner", scopes: ["*"], maxTrust: "asserted", now });
  await db.batch([organizationStatement(orgId, "Login test", now), ...account.statements]);
  const app = createApp({ db, runtime, now: () => now, loginClient: (request: Request) => request.headers.get("test-client") ?? "unknown" });
  const login = async (client: string, password: string) => {
    const response = await app(new Request("http://titen.test/v1/dashboard-sessions", {
      method: "POST", headers: { "content-type": "application/json", "test-client": client },
      body: JSON.stringify({ username, password }),
    }));
    return { status: response.status, body: await response.json() as any };
  };
  for (let i = 0; i < 5; i++) assert.equal((await login("client-a", "incorrect horse battery staple")).status, 401);
  assert.equal((await login("client-a", account.temporaryPassword)).status, 401);
  const success = await login("client-b", account.temporaryPassword);
  assert.equal(success.status, 201, "client A must not block client B");
  assert.equal(success.body.data.failed_attempts, 5);
  const audits = await db.all<{ detail: string }>("SELECT detail FROM audit_log WHERE org_id = ? AND action = 'operator_account.login_block'", [orgId]);
  assert.equal(audits.length, 1);
  assert.equal(JSON.parse(audits[0]!.detail).failed_attempts, 5);
  assert.ok(!audits[0]!.detail.includes("client-a"));
  assert.equal((await login("client-a", account.temporaryPassword)).status, 401, "another client's block survives success");

  for (let i = 0; i < 5; i++) assert.equal((await login("client-d", "incorrect horse battery staple")).status, 401);
  const distinctAudits = await db.all("SELECT id FROM audit_log WHERE org_id = ? AND action = 'operator_account.login_block'", [orgId]);
  assert.equal(distinctAudits.length, 2, "separate client blocks at the same time need separate audits");

  const key = await sha256Hex(`dashboard-login:${username}`);
  await db.batch([{ sql: "INSERT OR REPLACE INTO login_throttles VALUES (?, 50, ?, ?)", params: [key, now.getTime() + 30_000, now.getTime()] }]);
  assert.equal((await login("client-c", account.temporaryPassword)).status, 401, "the global account ceiling remains effective");
  await db.batch([{ sql: "DELETE FROM login_throttles" }]);
  await db.batch([{ sql: `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4096)
    INSERT INTO login_throttles SELECT 'capacity-' || x, 5, ?, ? FROM n`, params: [now.getTime() + 60_000, now.getTime() - 3_600_000] }]);
  assert.equal((await login("new-client", account.temporaryPassword)).status, 429, "full active storage rejects before password work");
  assert.equal((await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM login_throttles"))[0]!.count, 4096);
  await db.batch([{ sql: "DELETE FROM login_throttles" }]);
}
