/**
 * Plan-shape guards for the retrieval queries.
 *
 * These exist because the contract suite structurally cannot see the failure
 * they catch. Its stores hold tens of rows, so a query that collapses at 10^5
 * claims still returns the right answer quickly and every assertion passes.
 * Twice now a correlated authorization predicate has been written as a join
 * inside `EXISTS`, and twice SQLite has reordered it to drive from
 * `observations` — scanning the organization once per candidate. Measured on
 * the 342,129-claim pooled store, that shape costs **73.7 s** per candidate
 * query against 232 ms for the nested form.
 *
 * The load-bearing discovery is that the bad plan reproduces on an EMPTY
 * store: the planner picks the join order from the schema, not from row
 * counts. A cheap, deterministic test could have caught both regressions, and
 * that is what these are.
 *
 * They assert the *plan*, never a duration: a timing assertion on CI-less
 * hardware would be flaky, and the plan is the thing that actually regressed.
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db, Param } from "../../src/core/db";
import { migrate } from "../../src/core/migrations";
import { retrieveClaimCandidates, retrieveClaimsByIds } from "../../src/core/retrieval";
import { loadAuthorizedSources } from "../../src/core/evidence";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import type { Principal } from "../../src/core/auth";

const PRINCIPAL: Principal = {
  keyId: "key_plan",
  orgId: "org_plan",
  principalId: "prn_plan",
  principalKind: "service",
  scopes: ["memory:read"],
  maxTrust: "verified",
};

/** Runs the real query builder and returns the SQL it would have executed. */
const captureSql = async (
  run: (db: Db) => Promise<unknown>,
): Promise<{ sql: string; params: Param[] }[]> => {
  const captured: { sql: string; params: Param[] }[] = [];
  const stub: Db = {
    all: async (sql: string, params?: Param[]) => {
      captured.push({ sql, params: params ?? [] });
      return [];
    },
    batch: async () => {},
    exec: async () => {},
  };
  await run(stub);
  assert.ok(captured.length > 0, "the builder issued no query to capture");
  return captured;
};

const withMigratedStore = async (run: (explain: (q: { sql: string; params: Param[] }) => string[]) => void) => {
  const directory = mkdtempSync(join(tmpdir(), "titen-query-plan-"));
  const database = openDatabase(join(directory, "titen.db"));
  try {
    await migrate(createSqliteDb(database));
    run(({ sql, params }) =>
      database
        .query(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...(params as never[]))
        .map((row) => (row as { detail: string }).detail),
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
};

/**
 * The exact regression: `observations` reached through its organization index
 * rather than by the id `claim_sources` already holds. Written as a join —
 * `FROM claim_sources s JOIN observations o ON o.id = s.observation_id` — this
 * is what SQLite 3.53.0 chooses.
 */
const DRIVES_FROM_OBSERVATIONS = /SEARCH \w+ USING INDEX observations_workspace_scope/;

test("the candidate query never reaches observations through the organization index", async () => {
  const [candidates] = await captureSql((db) =>
    retrieveClaimCandidates(db, PRINCIPAL, '"probe"', {
      subjectId: "sub_plan",
      projectId: null,
      crossProject: true,
      at: new Date().toISOString(),
      limit: 1000,
    }),
  );
  await withMigratedStore((explain) => {
    const plan = explain(candidates!);
    const offender = plan.find((line) => DRIVES_FROM_OBSERVATIONS.test(line));
    assert.equal(
      offender,
      undefined,
      `candidate query drives from observations: ${offender}\nfull plan:\n${plan.join("\n")}`,
    );
    assert.ok(
      plan.some((line) => /claim_sources/.test(line)),
      `expected a claim_sources seek in the plan:\n${plan.join("\n")}`,
    );
  });
});

test("hydrating claims by id never reaches observations through the organization index", async () => {
  const [byIds] = await captureSql((db) =>
    retrieveClaimsByIds(db, PRINCIPAL, ["clm_plan"], {
      subjectId: "sub_plan",
      projectId: null,
      crossProject: true,
      at: new Date().toISOString(),
    }),
  );
  await withMigratedStore((explain) => {
    const plan = explain(byIds!);
    const offender = plan.find((line) => DRIVES_FROM_OBSERVATIONS.test(line));
    assert.equal(
      offender,
      undefined,
      `by-id hydration drives from observations: ${offender}\nfull plan:\n${plan.join("\n")}`,
    );
  });
});

test("authorized-source loading seeks claim_sources before probing observations", async () => {
  const [sources] = await captureSql((db) => loadAuthorizedSources(db, PRINCIPAL, ["clm_plan"]));
  await withMigratedStore((explain) => {
    const plan = explain(sources!);
    const offender = plan.find((line) => DRIVES_FROM_OBSERVATIONS.test(line));
    assert.equal(
      offender,
      undefined,
      `source loading drives from observations: ${offender}\nfull plan:\n${plan.join("\n")}`,
    );
  });
});
