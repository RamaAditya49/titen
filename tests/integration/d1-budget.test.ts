import { test } from "bun:test";
import assert from "node:assert/strict";
import type { Db, Stmt } from "../../src/core/db";
import { createApp } from "../../src/core/app";
import {
  drainEnrichment,
  scheduleReflections,
} from "../../src/core/enrichment";
import type { ExtractionCapability } from "../../src/core/extraction";
import { migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import {
  D1_BOUND_PARAMETER_LIMIT,
  D1_ENRICHMENT_QUERY_BUDGET,
  withD1Budget,
} from "../../src/runtime/cloudflare/d1-budget";
import { clientVia, DEFAULT_SCOPES, provisionWith } from "../contract/harness";

function countingDb() {
  let calls = 0;
  const db: Db = {
    async all() { calls += 1; return []; },
    async batch() { calls += 1; },
    async exec() { calls += 1; },
  };
  return { db, calls: () => calls };
}

test("D1 budget rejects saturation before dispatch", async () => {
  const target = countingDb();
  const budget = withD1Budget(target.db, 2);
  await budget.db.all("SELECT 1");
  await budget.db.exec("SELECT 1");
  assert.equal(budget.used(), 2);
  await assert.rejects(() => budget.db.all("SELECT 1"), /D1_QUERY_BUDGET_EXCEEDED/u);
  assert.equal(target.calls(), 2, "a saturated query must not reach D1");
});

test("D1 budget preflights full batches and the 100-parameter ceiling", async () => {
  const target = countingDb();
  const budget = withD1Budget(target.db, 1);
  const overbound: Stmt = {
    sql: "SELECT 1",
    params: Array.from({ length: D1_BOUND_PARAMETER_LIMIT + 1 }, () => 1),
  };
  await assert.rejects(() => budget.db.batch([overbound]), /D1_PARAMETER_BUDGET_EXCEEDED/u);
  await assert.rejects(
    () => budget.db.batch([{ sql: "SELECT 1" }, { sql: "SELECT 2" }]),
    /D1_QUERY_BUDGET_EXCEEDED/u,
  );
  assert.equal(target.calls(), 0, "an invalid batch must be rejected as a whole");
  await budget.db.batch([{
    sql: "SELECT 1",
    params: Array.from({ length: D1_BOUND_PARAMETER_LIMIT }, () => 1),
  }]);
  assert.equal(target.calls(), 1);
  assert.equal(budget.used(), 1);
});

test("a max-bound enrichment pass fits Paid D1 and saturation stops before model I/O", async () => {
  const handle = openDatabase(":memory:");
  const db = createSqliteDb(handle);
  try {
    await migrate(db);
    let modelCalls = 0;
    let reflectionCalls = 0;
    const capability: ExtractionCapability = {
      modelId: "d1-budget-fixture",
      modelFingerprint: "b".repeat(64),
      async generate(request) {
        modelCalls += 1;
        if (request.lane === "derivation") {
          const observation = (request.input as any).observation;
          return {
            action: "add",
            claims: [{
              kind: "semantic_fact",
              statement: `Bounded D1 premise ${observation.observation_id}.`,
              evidence_ids: [observation.observation_id],
              valid_from: null,
              valid_to: null,
            }],
          };
        }
        reflectionCalls += 1;
        const premises = (request.input as any).premises as Array<{ claim_id: string }>;
        return {
          action: "link",
          claims: null,
          links: premises.map((premise, index) => ({
            source_claim_id: premise.claim_id,
            target_claim_id: premises[(index + 1) % premises.length]!.claim_id,
            relation: "related_to",
          })),
        };
      },
    };
    const principal = await provisionWith(db, {
      scopes: [...DEFAULT_SCOPES, "enrichment:write"],
    });
    const app = createApp({
      db,
      runtime: "cloudflare-d1",
      extraction: capability,
      migrationsReady: true,
      secretStorageReady: true,
      now: () => new Date("2026-07-31T08:00:00.000Z"),
    });
    const client = clientVia(app, "http://d1-budget.test");
    for (let index = 0; index < 8; index += 1) {
      const observed = await client.call("POST", "/v1/observations", {
        key: principal.key,
        body: {
          subject_id: "subject_d1_max_bound",
          kind: "user_statement",
          content: `Maximum reflection premise ${index}.`,
          source: { type: "d1_budget_fixture" },
        },
      });
      assert.equal(observed.status, 201);
    }
    assert.equal((await drainEnrichment({
      db,
      capability,
      limit: 8,
      orgId: principal.orgId,
      now: () => new Date("2026-07-31T08:00:00.000Z"),
    })).completed, 8);
    assert.equal(await scheduleReflections({
      db,
      capability,
      limit: 1,
      orgId: principal.orgId,
      now: new Date("2026-07-31T08:00:01.000Z"),
    }), 1);

    const paid = withD1Budget(db, D1_ENRICHMENT_QUERY_BUDGET);
    const maximum = await drainEnrichment({
      db: paid.db,
      capability,
      limit: 1,
      orgId: principal.orgId,
      now: () => new Date("2026-07-31T08:00:01.000Z"),
    });
    assert.equal(maximum.completed, 1);
    assert.equal(maximum.linked, 8);
    assert.equal(reflectionCalls, 1);
    assert.equal(paid.used(), 30,
      "the max-bound fixture must retain its measured statement count");
    assert.ok(paid.used() < D1_ENRICHMENT_QUERY_BUDGET,
      `max-bound pass used ${paid.used()} declared D1 queries`);

    for (let index = 0; index < 2; index += 1) {
      const observed = await client.call("POST", "/v1/observations", {
        key: principal.key,
        body: {
          subject_id: `subject_d1_saturation_${index}`,
          kind: "user_statement",
          content: `Due job that must not reach the model ${index}.`,
          source: { type: "d1_budget_fixture" },
        },
      });
      assert.equal(observed.status, 201);
    }
    const beforeSaturation = modelCalls;
    const saturated = withD1Budget(db, 1);
    await assert.rejects(() => drainEnrichment({
      db: saturated.db,
      capability,
      limit: 1,
      orgId: principal.orgId,
      now: () => new Date("2026-07-31T08:00:02.000Z"),
    }), /D1_QUERY_BUDGET_EXCEEDED/u);
    assert.equal(modelCalls, beforeSaturation,
      "budget saturation must fail before any extraction call");
    assert.equal(saturated.used(), 1);
    assert.equal(Number((await db.all<{ count: number }>(
      `SELECT COUNT(*) AS count FROM enrichment_jobs
        WHERE org_id = ? AND state = 'pending'
          AND subject_id LIKE 'subject_d1_saturation_%'`,
      [principal.orgId],
    ))[0]!.count), 2, "all due jobs must remain pending after preflight saturation");
  } finally {
    handle.close();
  }
});
