import { test } from "bun:test";
import assert from "node:assert/strict";
import type { Principal } from "../../src/core/auth";
import type { Db, Param } from "../../src/core/db";
import { loadAuthorizedEvidenceIds, supportingDepth } from "../../src/core/evidence";
import { packUnderBudget } from "../../src/core/rank";
import { planFtsQuery, retrieveClaimCandidates } from "../../src/core/retrieval";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { assertPopulatedV10RetrievalMigration } from "../contract/retrieval-migration";
import { estimateTokens } from "../../src/core/tokens";

test("portable budget units count UTF-8 bytes across scripts", () => {
  assert.equal(estimateTokens("abc"), 1);
  assert.equal(estimateTokens("abcdef"), 2);
  assert.equal(estimateTokens("界"), 1);
  assert.equal(estimateTokens("😀"), 2);
  assert.equal(estimateTokens(""), 0);
});

test("lexical planning normalizes Unicode and drops only bounded function words", () => {
  assert.equal(planFtsQuery("q\u200du\u200da\u200dr\u200dt\u200dz").match, '"quartz"');
  assert.equal(planFtsQuery("İstanbul").match, '"i̇stanbul"');
  assert.equal(
    planFtsQuery("ship to prod safely").match,
    '"ship" OR "prod" OR "safely"',
  );
  assert.equal(planFtsQuery("to the").match, '"to" OR "the"');

  const long = planFtsQuery(
    "Could you please remind me what our team decided about whether we should keep using the old formatter or move to a new one for all of the frontend repositories",
  );
  assert.match(long.match!, /"old"/);
  assert.match(long.match!, /"new"/);
  assert.ok(long.termsUsed <= 16);
  assert.ok(long.termsDropped > 0);
});

test("packing preserves full-fit rank, then uses diversity under pressure", () => {
  const packed = packUnderBudget([
    { value: "a1", kind: "a", tokens: 2 },
    { value: "a2", kind: "a", tokens: 2 },
    { value: "a3", kind: "a", tokens: 2 },
    { value: "a4", kind: "a", tokens: 2 },
    { value: "b1", kind: "b", tokens: 2 },
  ], 10);
  assert.deepEqual(packed, {
    selected: ["a1", "a2", "a3", "a4", "b1"],
    usedTokens: 10,
    omittedCount: 0,
    deduplicatedCount: 0,
    budgetExhausted: false,
  });

  assert.deepEqual(packUnderBudget([
    { value: "a1", kind: "a", tokens: 2 },
    { value: "a2", kind: "a", tokens: 2 },
    { value: "a3", kind: "a", tokens: 2 },
    { value: "a4", kind: "a", tokens: 2 },
    { value: "b1", kind: "b", tokens: 2 },
  ], 8), {
    selected: ["a1", "b1", "a2", "a3"],
    usedTokens: 8,
    omittedCount: 1,
    deduplicatedCount: 0,
    budgetExhausted: true,
  });

  assert.deepEqual(packUnderBudget([
    { value: "top", kind: "a", tokens: 1, dedupeKey: "same bytes" },
    { value: "duplicate", kind: "b", tokens: 1, dedupeKey: "same bytes" },
    { value: "other", kind: "b", tokens: 1, dedupeKey: "other bytes" },
  ], 3), {
    selected: ["top", "other"],
    usedTokens: 2,
    omittedCount: 0,
    deduplicatedCount: 1,
    budgetExhausted: false,
  });

  assert.deepEqual(packUnderBudget([
    { value: "too-large", kind: "a", tokens: 9 },
  ], 8), {
    selected: [],
    usedTokens: 0,
    omittedCount: 1,
    deduplicatedCount: 0,
    budgetExhausted: true,
  });
});

test("hot retrieval SQL bounds candidates and drives evidence from claim sources", async () => {
  let capturedSql = "";
  let capturedParams: Param[] = [];
  const db: Db = {
    async all<Row>(sql: string, params: Param[] = []): Promise<Row[]> {
      capturedSql = sql;
      capturedParams = params;
      return [];
    },
    async batch() {
      throw new Error("not used");
    },
    async exec() {
      throw new Error("not used");
    },
  };
  const principal: Principal = {
    keyId: "key_test",
    orgId: "org_test",
    principalId: "agent_test",
    principalKind: "agent",
    scopes: ["context:compile"],
    maxTrust: "verified",
  };

  await retrieveClaimCandidates(db, principal, '"marker"', {
    subjectId: "subject_test",
    projectId: null,
    crossProject: false,
    at: "2026-07-31T00:00:00.000Z",
  });

  assert.match(capturedSql, /claims_fts MATCH \([\s\S]*org_scope[\s\S]*subject_scope[\s\S]*statement/);
  assert.ok(capturedSql.indexOf("subject_scope") < capturedSql.indexOf("ORDER BY bm25"));
  assert.ok(capturedSql.indexOf("LIMIT ?") < capturedSql.indexOf("FROM claim_sources s"));
  assert.ok(capturedSql.indexOf("LIMIT ?") < capturedSql.indexOf("context_feedback"));
  assert.deepEqual(capturedParams.slice(0, 5), [
    "org_test",
    "subject_test",
    '"marker"',
    "org_test",
    "subject_test",
  ]);

  await loadAuthorizedEvidenceIds(db, principal, ["claim_late", "claim_early"]);
  // The relation travels with the source so ranking can tell corroboration from
  // contradiction. Counting rows instead would make the most disputed claim in a
  // store look like the best supported one.
  assert.match(capturedSql, /SELECT s\.claim_id, s\.observation_id, s\.relation/);
  assert.equal(supportingDepth(undefined), 0);
  assert.equal(
    supportingDepth([
      { observationId: "obs_a", relation: "supports" },
      { observationId: "obs_b", relation: "supports" },
      { observationId: "obs_c", relation: "contradicts" },
      { observationId: "obs_d", relation: "qualifies" },
    ]),
    2,
  );
  assert.match(capturedSql, /FROM claim_sources s/);
  assert.doesNotMatch(capturedSql, /JOIN observations/);
  assert.match(capturedSql, /EXISTS \([\s\S]*FROM observations o/);
  assert.match(capturedSql, /o\.id = s\.observation_id/);
  assert.match(capturedSql, /o\.org_id = \?/);
  assert.match(capturedSql, /o\.visibility/);
  assert.deepEqual(capturedParams, [
    "claim_late",
    "claim_early",
    "org_test",
    "agent_test",
    "agent_test",
  ]);
});

test("schema v10 migrates by rebuilding and backfilling scoped Porter FTS", async () => {
  const handle = openDatabase(":memory:");
  try {
    await assertPopulatedV10RetrievalMigration(createSqliteDb(handle));
  } finally {
    handle.close();
  }
});
