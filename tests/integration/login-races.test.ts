import { test } from "bun:test";
import assert from "node:assert/strict";
import { newOperatorAccount } from "../../src/core/accounts";
import { createApp } from "../../src/core/app";
import { organizationStatement } from "../../src/core/auth";
import type { Db, Param } from "../../src/core/db";
import { migrate } from "../../src/core/migrations";
import { recoverHostAccount } from "../../src/runtime/bun/accounts";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";

async function setup(db: Db, now: Date) {
  await migrate(db);
  const account = await newOperatorAccount({
    orgId: "org_login_race",
    username: "login-race-owner",
    createdBy: "race-test-owner",
    role: "owner",
    scopes: ["*"],
    maxTrust: "asserted",
    now,
  });
  await db.batch([
    organizationStatement("org_login_race", "Login race test", now),
    ...account.statements,
    { sql: "UPDATE operator_accounts SET must_change_password = 0 WHERE id = ?", params: [account.accountId] },
  ]);
  return account;
}

function loginRequest(password: string) {
  return new Request("http://titen.test/v1/dashboard-sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "login-race-owner", password }),
  });
}

test("a host reset rejects a password check that read the previous verifier", async () => {
  const handle = openDatabase(":memory:");
  const db = createSqliteDb(handle);
  try {
    const now = new Date("2026-10-05T00:00:00.000Z");
    const account = await setup(db, now);
    let resetOccurred = false;
    const racedDb: Db = {
      ...db,
      async all<Row>(sql: string, params?: Param[]) {
        const rows = await db.all<Row>(sql, params);
        if (!resetOccurred && sql.includes("AS webauthn_credentials")) {
          resetOccurred = true;
          await recoverHostAccount(db, account.username, true);
        }
        return rows;
      },
    };
    const app = createApp({ db: racedDb, runtime: "test", now: () => now });
    const response = await app(loginRequest(account.temporaryPassword));
    assert.equal(resetOccurred, true);
    assert.equal(response.status, 401, "the previous password must not issue a session after reset");
    const active = await db.all<{ count: number }>(
      "SELECT COUNT(*) AS count FROM api_keys WHERE label = 'Dashboard session' AND revoked_at IS NULL",
    );
    assert.equal(active[0]!.count, 0);
    const current = await db.all<{ must_change_password: number }>(
      "SELECT must_change_password FROM operator_accounts WHERE id = ?", [account.accountId],
    );
    assert.equal(current[0]!.must_change_password, 1);
  } finally { handle.close(); }
});

test("concurrent failures write one audit for the active client block", async () => {
  const handle = openDatabase(":memory:");
  const db = createSqliteDb(handle);
  try {
    const now = new Date("2026-10-05T00:00:00.000Z");
    await setup(db, now);
    const app = createApp({ db, runtime: "test", now: () => now });
    const attempt = () => app(loginRequest("incorrect horse battery staple"));
    for (let i = 0; i < 4; i++) assert.equal((await attempt()).status, 401);
    const responses = await Promise.all(Array.from({ length: 4 }, attempt));
    assert.deepEqual(responses.map((response) => response.status), [401, 401, 401, 401]);
    const audits = await db.all<{ detail: string }>(
      "SELECT detail FROM audit_log WHERE org_id = ? AND action = 'operator_account.login_block'",
      ["org_login_race"],
    );
    assert.equal(audits.length, 1, "an active client block has only one transition audit");
    assert.equal(JSON.parse(audits[0]!.detail).failed_attempts, 5);
    const blocked = await db.all<{ blocked_until_ms: number }>(
      "SELECT blocked_until_ms FROM login_throttles WHERE identity_hash LIKE '%.%'",
    );
    assert.equal(blocked[0]!.blocked_until_ms, now.getTime() + 30_000);
  } finally { handle.close(); }
});

test("a host reset prevents a revoked session from completing password replacement", async () => {
  const handle = openDatabase(":memory:");
  const db = createSqliteDb(handle);
  try {
    const now = new Date("2026-10-05T00:00:00Z");
    const account = await setup(db, now);
    const app = createApp({ db, runtime: "test", now: () => now });
    const login = await app(loginRequest(account.temporaryPassword));
    const key = (await login.json() as any).data.api_key;
    let resetOccurred = false;
    const racedDb: Db = { ...db, async all<Row>(sql: string, params?: Param[]) {
      const rows = await db.all<Row>(sql, params);
      if (!resetOccurred && sql.includes("SELECT id, username, password_verifier")) {
        resetOccurred = true;
        await recoverHostAccount(db, account.username, true);
      }
      return rows;
    } };
    const racedApp = createApp({ db: racedDb, runtime: "test", now: () => now });
    const result = await racedApp(new Request("http://titen.test/v1/operator-accounts/current/password", {
      method: "PATCH", headers: { authorization: `Bearer ${key}` },
      body: JSON.stringify({ password: "a revoked session replacement passphrase" }),
    }));
    assert.equal(resetOccurred, true);
    assert.equal(result.status, 401);
    const accountState = await db.all<{ must_change_password: number }>("SELECT must_change_password FROM operator_accounts WHERE id = ?", [account.accountId]);
    assert.equal(accountState[0]!.must_change_password, 1);
  } finally { handle.close(); }
});
