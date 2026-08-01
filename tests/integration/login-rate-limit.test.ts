import { test } from "bun:test";
import assert from "node:assert/strict";
import { newOperatorAccount } from "../../src/core/accounts";
import { createApp } from "../../src/core/app";
import { organizationStatement } from "../../src/core/auth";
import { migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";

test("a failed public login consumes the optional native edge limiter", async () => {
  const handle = openDatabase(":memory:");
  const db = createSqliteDb(handle);
  try {
    await migrate(db);
    const account = await newOperatorAccount({
      orgId: "org_rate_limit",
      createdBy: "owner_rate_limit",
      username: "edge-owner",
      role: "owner",
      scopes: ["*"],
      maxTrust: "policy_approved",
    });
    await db.batch([
      organizationStatement("org_rate_limit", "Rate Limit Test"),
      ...account.statements,
    ]);
    const keys: string[] = [];
    const app = createApp({
      db,
      runtime: "test",
      loginRateLimit: {
        async limit(key) {
          keys.push(key);
          return { success: false };
        },
      },
    });
    const response = await app(new Request("http://titen.test/v1/dashboard-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "EDGE-OWNER", password: "incorrect horse battery staple" }),
    }));
    assert.equal(response.status, 429);
    assert.equal((await response.json() as any).error.code, "LOGIN_RATE_LIMITED");
    assert.deepEqual(keys, ["edge-owner"]);
  } finally {
    handle.close();
  }
});
