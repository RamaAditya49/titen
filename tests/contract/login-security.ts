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

  // Storage full of unblocked one-failure rows (what made-up usernames leave behind) must not lock operators out.
  const rowCount = async () => Number((await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM login_throttles"))[0]!.count);
  const hasRow = async (id: string) => (await db.all("SELECT 1 FROM login_throttles WHERE identity_hash = ?", [id])).length === 1;
  const recent = now.getTime() - 5 * 60_000; // idle past the two-minute eviction bound
  await db.batch([
    { sql: `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4094)
      INSERT INTO login_throttles SELECT 'flood-' || printf('%04d', x), 1, 0, ? + x FROM n`, params: [recent] },
    { sql: "INSERT INTO login_throttles VALUES ('kept-high', 4, 0, ?)", params: [recent - 30_000] },
    { sql: "INSERT INTO login_throttles VALUES ('kept-blocked', 5, ?, ?)", params: [now.getTime() + 60_000, recent - 30_000] },
  ]);
  assert.equal(await rowCount(), 4096);
  assert.equal((await login("flood-client", account.temporaryPassword)).status, 201, "full unblocked storage still admits sign-in");
  assert.ok(await rowCount() <= 4096, "storage stays bounded");
  assert.equal(await hasRow("flood-0001"), false, "the oldest one-failure row is evicted first");
  assert.equal(await hasRow("flood-0002"), false, "only the needed rows are evicted");
  assert.equal(await hasRow("flood-0003"), true, "newer one-failure rows survive");
  assert.equal(await hasRow("kept-high"), true, "rows with more failures outrank older one-failure rows");
  assert.equal(await hasRow("kept-blocked"), true, "active blocks are never evicted");
  await db.batch([{ sql: "DELETE FROM login_throttles" }]);

  // Flooding must not reset an account bucket that already holds more failures than the flood rows.
  await db.batch([
    { sql: `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4095)
      INSERT INTO login_throttles SELECT 'flood-' || printf('%04d', x), 1, 0, ? + x FROM n`, params: [recent] },
    { sql: "INSERT INTO login_throttles VALUES (?, 49, 0, ?)", params: [key, recent - 30_000] },
  ]);
  assert.equal((await login("flood-client-2", "incorrect horse battery staple")).status, 401);
  const accountRow = await db.all<{ failures: number; blocked_until_ms: number }>(
    "SELECT failures, blocked_until_ms FROM login_throttles WHERE identity_hash = ?", [key]);
  assert.equal(accountRow[0]?.failures, 50, "the account failure count survives a full table");
  assert.ok(accountRow[0]!.blocked_until_ms > now.getTime(), "the account ceiling still blocks");
  assert.equal((await login("client-e", account.temporaryPassword)).status, 401, "the account block applies to new clients");
  assert.ok(await rowCount() <= 4096, "storage stays bounded");
  await db.batch([{ sql: "DELETE FROM login_throttles" }]);

  // Storage dominated by active blocks must not make a high-count account row the eviction victim.
  await db.batch([
    { sql: `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4094)
      INSERT INTO login_throttles SELECT 'blocked-' || printf('%04d', x), 5, ?, ? FROM n`, params: [now.getTime() + 60_000, recent] },
    { sql: "INSERT INTO login_throttles VALUES (?, 49, 0, ?)", params: [key, recent - 30_000] },
    { sql: "INSERT INTO login_throttles VALUES ('flood-last', 1, 0, ?)", params: [recent] },
  ]);
  const other = async (client: string) => (await app(new Request("http://titen.test/v1/dashboard-sessions", {
    method: "POST", headers: { "content-type": "application/json", "test-client": client },
    body: JSON.stringify({ username: `made-up-${runtime}`, password: "incorrect horse battery staple" }),
  }))).status;
  assert.equal(await other("flood-client-3"), 429, "no room without evicting the high-count account row");
  const survivor = await db.all<{ failures: number }>("SELECT failures FROM login_throttles WHERE identity_hash = ?", [key]);
  assert.equal(survivor[0]?.failures, 49, "a bucket at or above the client limit is never evicted");
  assert.ok(await rowCount() <= 4096, "storage stays bounded");
  await db.batch([{ sql: "DELETE FROM login_throttles" }]);

  // Recently touched rows are not evicted, so a flood cannot cycle a bucket's count quickly.
  await db.batch([{ sql: `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4096)
    INSERT INTO login_throttles SELECT 'fresh-' || printf('%04d', x), 1, 0, ? FROM n`, params: [now.getTime() - 60_000] }]);
  assert.equal((await login("fresh-client", account.temporaryPassword)).status, 429, "rows idle under two minutes stay");
  assert.equal(await rowCount(), 4096);
  await db.batch([{ sql: "DELETE FROM login_throttles" }]);
}
