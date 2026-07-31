import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/core/app";
import type { Db } from "../../src/core/db";
import { migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { clientVia, provisionWith } from "../contract/harness";

test("D1-like read latency cannot produce duplicate checkpoint heads or handoff winners", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-integrity-latency-"));
  const database = openDatabase(join(directory, "titen.db"));
  const native = createSqliteDb(database);
  try {
    await migrate(native);
    const delayed: Db = {
      ...native,
      async all<Row>(sql: string, params = []) {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return native.all<Row>(sql, params);
      },
    };
    const app = createApp({ db: delayed, runtime: "latency-probe" });
    const client = clientVia(app, "http://titen.test");
    const sender = await provisionWith(native, { scopes: ["*"] });
    const receiver = await provisionWith(native, {
      orgId: sender.orgId,
      scopes: ["*"],
    });
    const subjectId = "latency-race";

    const saves = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      client.call("POST", "/v1/checkpoints", {
        key: sender.key,
        body: {
          subject_id: subjectId,
          kind: "task_state",
          state: { submitted: index },
          ttl_seconds: 600,
        },
      })));
    assert.equal(saves.filter((result) => result.status === 201).length, 1);
    assert.equal(saves.filter((result) => result.status === 200).length, 7);
    assert.equal(new Set(saves.map((result) => result.body.data.checkpoint_id)).size, 1);
    assert.equal(Number((await native.all<{ count: number }>(
      `SELECT COUNT(*) AS count FROM checkpoints
        WHERE org_id = ? AND subject_id = ? AND agent_id = ? AND kind = 'task_state'`,
      [sender.orgId, subjectId, sender.principalId],
    ))[0]!.count), 1);

    const handoff = await client.call("POST", "/v1/handoffs", {
      key: sender.key,
      body: { to_principal: receiver.principalId, subject_id: subjectId },
    });
    assert.equal(handoff.status, 201);
    const resolutions = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      client.call("POST", `/v1/handoffs/${handoff.body.data.handoff_id}/resolve`, {
        key: receiver.key,
        body: { status: index % 2 === 0 ? "accepted" : "rejected" },
      })));
    assert.equal(resolutions.filter((result) => result.status === 200).length, 1);
    assert.ok(resolutions.every((result) => [200, 404, 409].includes(result.status)));
    const durable = (await native.all<{ resolutions: number; events: number }>(
      `SELECT
         (SELECT COUNT(*) FROM handoff_resolutions WHERE handoff_id = ?) AS resolutions,
         (SELECT COUNT(*) FROM events
           WHERE resource_type = 'handoff' AND resource_id = ?
             AND kind IN ('handoff.accepted', 'handoff.rejected')) AS events`,
      [handoff.body.data.handoff_id, handoff.body.data.handoff_id],
    ))[0]!;
    assert.equal(Number(durable.resolutions), 1);
    assert.equal(Number(durable.events), 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
