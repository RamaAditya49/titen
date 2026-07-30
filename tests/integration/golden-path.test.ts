import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../src/core/migrations";
import { serve } from "../../src/runtime/bun/server";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { provisionWith } from "../contract/harness";

test("the documented golden path runs against scoped principals", async () => {
  const directory = mkdtempSync(join(tmpdir(), "titen-golden-"));
  const dbPath = join(directory, "titen.db");
  const database = openDatabase(dbPath);
  const db = createSqliteDb(database);
  await migrate(db);
  const researcher = await provisionWith(db, {
    principalId: "researcher",
    scopes: ["projects:resolve", "projects:create", "observations:write", "claims:write"],
  });
  const writer = await provisionWith(db, {
    orgId: researcher.orgId,
    principalId: "writer",
    scopes: ["projects:resolve", "context:compile"],
  });
  const operator = await provisionWith(db, {
    orgId: researcher.orgId,
    principalId: "operator",
    scopes: ["checkpoints:write", "leases:write", "handoffs:write"],
  });
  const reviewer = await provisionWith(db, {
    orgId: researcher.orgId,
    principalId: "reviewer",
    scopes: ["handoffs:write", "feedback:write", "evidence:read", "views:compile"],
  });
  database.close();

  const api = await serve({ dbPath, port: 0, hostname: "127.0.0.1", quiet: true });
  try {
    const run = Bun.spawn({
      cmd: [process.execPath, "examples/small-team-golden-path.ts"],
      env: {
        ...process.env,
        TITEN_URL: api.url,
        TITEN_RESEARCHER_KEY: researcher.key,
        TITEN_WRITER_KEY: writer.key,
        TITEN_OPERATOR_KEY: operator.key,
        TITEN_REVIEWER_KEY: reviewer.key,
        TITEN_SUBJECT_ID: "golden-path-smoke",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      run.exited,
      new Response(run.stdout).text(),
      new Response(run.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.ids.observations).toHaveLength(2);
    expect(result.ids.claims).toHaveLength(2);
    expect(result.evidence).toHaveLength(2);
    expect(result.conflict_freshness.edges.some((edge: any) => edge.relation === "contradicts")).toBe(true);
    expect(result.conflict_freshness.metadata.subject_id).toBe("golden-path-smoke");
    expect(result.handoff_status).toBe("accepted");
    expect(result.feedback_outcome).toBe("useful");
  } finally {
    await api.stop();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
