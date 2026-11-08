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
import { countUnconsolidatedObservations } from "../../src/core/context";
import type { RequestContext } from "../../src/core/http";
import { scheduleDerivationBackfill } from "../../src/core/enrichment";
import type { ExtractionCapability } from "../../src/core/extraction";
import { exportableEnrichmentJobIds } from "../../src/core/portability";
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

test("the unconsolidated probe is one statement bounded by an index-ordered window", async () => {
  const probes = await captureSql((db) =>
    countUnconsolidatedObservations(
      { principal: PRINCIPAL, app: { db } } as unknown as RequestContext,
      "sub_plan",
      null,
      false,
      new Date().toISOString(),
    ),
  );
  assert.equal(probes.length, 1, "the probe must issue exactly one statement");
  await withMigratedStore((explain) => {
    const plan = explain(probes[0]!);
    const scan = plan.find((line) => /^SCAN o\b/.test(line));
    assert.equal(scan, undefined, `probe scans observations: ${scan}\nfull plan:\n${plan.join("\n")}`);
    assert.ok(
      plan.some((line) => /SEARCH o USING INDEX observations_scope \(org_id=\? AND subject_id=\? AND ingested_at<\?\)/.test(line)),
      `expected an observations_scope range for the window:\n${plan.join("\n")}`,
    );
    // A sort inside the window would visit every row of the subject before LIMIT applies.
    const windowSort = plan.find((line) => /TEMP B-TREE FOR (LAST TERM OF )?ORDER BY/.test(line)
      && plan.indexOf(line) < plan.findIndex((entry) => /observations_scope/.test(entry)) + 2);
    assert.equal(windowSort, undefined, `window sorts before LIMIT:\n${plan.join("\n")}`);
  });
});

const SYNTHETIC_CAPABILITY = {
  modelId: "plan-model",
  modelFingerprint: "a".repeat(64),
  providerIdentity: "https://models.example.test/v1",
  async generate() {
    return { action: "abstain" };
  },
} as unknown as ExtractionCapability;

test("the derivation backfill anti-join seeks enrichment_jobs by source observation", async () => {
  const [candidates] = await captureSql((db) =>
    scheduleDerivationBackfill({
      db,
      capability: SYNTHETIC_CAPABILITY,
      now: new Date(),
      limit: 5,
    }),
  );
  await withMigratedStore((explain) => {
    const plan = explain(candidates!);
    assert.ok(
      plan.some((line) =>
        /SEARCH existing USING (COVERING )?INDEX enrichment_jobs_source_observation \(org_id=\? AND lane=\? AND source_observation_id=\?\)/.test(line)),
      `expected an equality seek on source_observation_id:\n${plan.join("\n")}`,
    );
  });
});

test("the export job filter reaches input observations by id without parsing JSON", async () => {
  const [jobs] = await captureSql((db) =>
    exportableEnrichmentJobIds(
      { app: { db }, principal: PRINCIPAL } as never,
      ["enr_plan"],
      true,
    ),
  );
  assert.ok(
    !/input_observation\.id\s*=\s*json_extract/.test(jobs!.sql),
    "the observation join must use the stored source observation id",
  );
  await withMigratedStore((explain) => {
    const plan = explain(jobs!);
    assert.ok(
      plan.some((line) => /SEARCH input_observation USING (INTEGER )?PRIMARY KEY \(\w+=\?\)|SEARCH input_observation USING INDEX \w+ \(id=\?\)/.test(line)),
      `expected an id seek on input_observation:\n${plan.join("\n")}`,
    );
  });
});
