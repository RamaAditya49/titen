import { test } from "bun:test";
import assert from "node:assert/strict";
import { recordAccessParams, recordAccessSql } from "../../src/core/authorization";
import {
  parseFenceList,
  readFenceSql,
  subjectMatches,
  subjectPatternSql,
  UNRESTRICTED_FENCES,
} from "../../src/core/key-fences";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";

const placeholders = (sql: string) => sql.split("?").length - 1;

test("record access binds stay aligned with the read fence predicate", () => {
  const principal = {
    keyId: "key_1",
    orgId: "org_1",
    principalId: "agent_1",
    principalKind: "agent" as const,
    scopes: ["*"],
    maxTrust: "verified" as const,
    issuedBy: "owner",
    fences: UNRESTRICTED_FENCES,
  };
  assert.equal(placeholders(recordAccessSql("c")), recordAccessParams(principal).length);
  assert.equal(placeholders(recordAccessSql("o")), recordAccessParams("actor_1").length);
  assert.equal(placeholders(readFenceSql("c")), 5);
  assert.equal(placeholders(readFenceSql("o")), 5);
  assert.deepEqual(recordAccessParams("actor_1").slice(-5), ["", "", "", "", ""]);
  assert.equal(readFenceSql("o").replaceAll("o.", "").includes("o."), false);
  assert.equal(readFenceSql("c").replaceAll("c.", "").includes("c."), false);
});

test("subject patterns are exact or a single trailing prefix", async () => {
  assert.equal(subjectMatches("x:profile:alice", "x:profile:alice"), true);
  assert.equal(subjectMatches("x:profile:*", "x:profile:alice"), true);
  assert.equal(subjectMatches("x:profile:*", "x:shared"), false);
  assert.equal(subjectMatches("x:profile:alice", "x:profile:bob"), false);
  assert.equal(subjectMatches("x:*:bob", "x:a:bob"), false);
  assert.equal(subjectMatches("*", "x:profile:alice"), false);
  assert.equal(parseFenceList(null, "write_subjects", "subject"), null);
  assert.deepEqual(parseFenceList(["b", "a*"], "write_subjects", "subject"), ["a*", "b"]);
  assert.throws(() => parseFenceList([], "write_subjects", "subject"));
  assert.throws(() => parseFenceList(["x:*:bob"], "write_subjects", "subject"));
  assert.throws(() => parseFenceList(["project_*"], "write_projects", "project"));
  assert.throws(() => parseFenceList(["x:shared", "x:shared"], "write_subjects", "subject"));

  const database = openDatabase(":memory:");
  const db = createSqliteDb(database);
  try {
    const pairs = [
      ["x:profile:alice", "x:profile:alice"],
      ["x:profile:*", "x:profile:alice"],
      ["x:profile:*", "x:shared"],
      ["x:profile:alice", "x:profile:bob"],
      ["x:*:bob", "x:a:bob"],
      ["*", "x:profile:alice"],
    ] as const;
    for (const [pattern, subject] of pairs) {
      const rows = await db.all<{ ok: number }>(
        `WITH sample(pattern, subject) AS (SELECT ?, ?)
         SELECT 1 AS ok FROM sample WHERE ${subjectPatternSql("pattern", "subject")}`,
        [pattern, subject],
      );
      assert.equal(rows.length === 1, subjectMatches(pattern, subject), `${pattern} -> ${subject}`);
    }
  } finally {
    database.close();
  }
});
