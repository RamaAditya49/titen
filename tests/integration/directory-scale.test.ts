/**
 * Scale smoke for the directory listings (#338).
 *
 * The plan guards in query-plan.test.ts are the strict check. This one proves
 * the plan pays off: a narrow page must cost about the same in a large
 * organization as in a small one. The bounds are generous on purpose, so a
 * slow host does not fail the run, while the old whole-organization aggregate
 * (hundreds of milliseconds at 300k rows) still would.
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Principal } from "../../src/core/auth";
import { listProjects, listSubjects } from "../../src/core/directory";
import { migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";

const PRINCIPAL: Principal = {
  keyId: "key_scale",
  orgId: "org_scale",
  principalId: "prn_scale",
  principalKind: "service",
  scopes: ["*"],
  maxTrust: "verified",
};

const context = (db: ReturnType<typeof createSqliteDb>, path: string) =>
  ({
    principal: PRINCIPAL,
    url: new URL(`http://titen.test${path}`),
    params: {},
    app: { db, now: () => new Date() },
  }) as never;

const median = async (run: () => Promise<unknown>) => {
  const times: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[2]!;
};

const measure = async (observations: number) => {
  const directory = mkdtempSync(join(tmpdir(), "titen-directory-scale-"));
  const database = openDatabase(join(directory, "titen.db"));
  try {
    const db = createSqliteDb(database);
    await migrate(db);
    const now = "2026-11-01T00:00:00.000Z";
    database.run(`INSERT INTO organizations (id, name, created_at) VALUES ('org_scale', 'Scale', ?)`, [now]);
    database.run(
      `INSERT INTO memberships (id, org_id, workspace_id, principal_id, principal_kind, role, created_at)
       VALUES ('mbr_scale', 'org_scale', NULL, 'prn_scale', 'service', 'owner', ?)`, [now]);
    const projects = 20;
    const subjects = 5000;
    database.transaction(() => {
      for (let p = 0; p < projects; p += 1)
        database.run(`INSERT INTO projects (id, org_id, reference, created_at) VALUES (?, 'org_scale', ?, ?)`,
          [`prj_${p}`, `scale/project-${String(p).padStart(2, "0")}`, now]);
      for (let s = 0; s < subjects; s += 1)
        database.run(
          `INSERT INTO subjects (id, org_id, type, label, created_by, created_at, updated_at)
           VALUES (?, 'org_scale', 'concept', ?, 'prn_scale', ?, ?)`,
          [`sub_${s}`, `subject-${String(s).padStart(5, "0")}`, now, now]);
      const insert = database.prepare(
        `INSERT INTO observations (id, org_id, subject_id, project_id, actor_id, kind, content,
           content_hash, source_type, trust, visibility, ingested_at)
         VALUES (?, 'org_scale', ?, ?, 'prn_scale', 'tool_result', 'seed', 'h', 'tool', 'verified',
           'organization', ?)`);
      for (let i = 0; i < observations; i += 1)
        insert.run(`obs_${i}`, `sub_${i % subjects}`, `prj_${i % projects}`, now);
    })();
    database.run("ANALYZE");
    const projectTime = await median(() => listProjects(context(db, "/v1/projects?limit=10&q=project-07")));
    const subjectTime = await median(() => listSubjects(context(db, "/v1/subjects?limit=10&q=subject-00042")));
    const page = await listSubjects(context(db, "/v1/subjects?limit=10&q=subject-00042"));
    assert.equal((page.data as { subjects: unknown[] }).subjects.length, 1);
    return { projectTime, subjectTime };
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
};

test("a narrow directory page costs about the same in a large organization (AC-DIR-002)", async () => {
  const small = await measure(10_000);
  const large = await measure(100_000);
  console.log("directory scale", JSON.stringify({ small, large }));
  assert.ok(large.subjectTime <= small.subjectTime * 2 + 10,
    `subjects: ${large.subjectTime.toFixed(1)} ms at 100k against ${small.subjectTime.toFixed(1)} ms at 10k`);
  assert.ok(large.projectTime < 100, `projects: ${large.projectTime.toFixed(1)} ms at 100k`);
});
