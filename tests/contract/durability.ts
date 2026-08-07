import assert from "node:assert/strict";
import { createApp } from "../../src/core/app";
import type { Db, Stmt } from "../../src/core/db";
import { clientVia, provisionWith } from "./harness";

/**
 * Concurrent-writer durability, stated as invariants before it is run.
 *
 * I1 — exactly one claim per canonical hash. N writers submitting byte-identical
 *      content converge on one record id; a duplicate is permanent damage, and a
 *      read-then-write check alone cannot prevent one.
 * I2 — zero lost observations. Every submission either creates its record or
 *      replays the record that won, and every distinct payload survives.
 * I3 — no partial write survives a failed batch. A write whose batch fails leaves
 *      no observation, no FTS projection, no history, no event, no outbox work,
 *      and no idempotency receipt behind.
 *
 * The same assertions run on bun:sqlite and on D1, because the claim is about the
 * shared core's write path, which expresses every atomic write as one batch
 * (`src/core/db.ts`). Dedup lives inside that batch as a unique index, so the
 * read-then-write window in `appendObservation` and `consolidate` is a fast path,
 * not the safety mechanism — that is what these invariants exist to prove.
 */

const ORIGIN = "http://durability.test";

/** Writers per payload. Six keeps a D1 round trip honest without a long lane. */
export const WRITERS = 6;
/** Distinct payloads in the same burst, so overlap is not the only case. */
export const PAYLOADS = 4;

export interface DurabilityReport {
  runtime: string;
  writers: number;
  payloads: number;
  /**
   * Batches rejected by a canonical unique index during this run.
   *
   * Instrumentation, not an assertion: it records whether the read-then-write
   * window actually opened on this runtime. Zero means the burst serialised and
   * only the fast path was exercised — a weaker result that must be reported as
   * such rather than read as "no race exists".
   */
  canonical_collisions: number;
  /** Concurrent observation submissions issued in one burst. */
  observation_requests: number;
  observation_created: number;
  observation_replayed: number;
  observation_failed: number;
  observation_rows: number;
  observation_canonical_hashes: number;
  claim_requests: number;
  claim_created: number;
  claim_replayed: number;
  claim_failed: number;
  claim_rows: number;
  /** Rows left behind by the deliberately failed batch. Must be zero. */
  partial_rows: number;
}

type Client = Pick<ReturnType<typeof clientVia>, "call">;

const clientFor = (db: Db, runtime: string): Client =>
  clientVia(createApp({ db, runtime, revision: "durability" }), ORIGIN);

/** Counts the batches a canonical unique index rejected, without changing behaviour. */
export function countingCanonicalCollisions(db: Db): { db: Db; collisions: () => number } {
  let collisions = 0;
  return {
    collisions: () => collisions,
    db: {
      all: <Row>(sql: string, params: Parameters<Db["all"]>[1] = []) => db.all<Row>(sql, params),
      exec: (sql: string) => db.exec(sql),
      async batch(statements: Stmt[]) {
        try {
          await db.batch(statements);
        } catch (error) {
          if (error instanceof Error && /UNIQUE.*canonical_hash/iu.test(error.message)) collisions += 1;
          throw error;
        }
      },
    },
  };
}

const observationBody = (runtime: string, index: number) => ({
  subject_id: "subject_durability",
  kind: "tool_result",
  content: `Durability probe ${index} on ${runtime}.`,
  // `source.id` is what makes the write canonically identifiable; without it the
  // core assigns no canonical hash and every submission is a distinct record.
  source: { type: "tool", ref: "durability", id: `durability-${index}` },
  trust: "verified",
});

function assertAccepted(label: string, responses: { status: number; body: any }[]) {
  const rejected = responses.filter((response) => response.status !== 200 && response.status !== 201);
  assert.equal(
    rejected.length,
    0,
    `${label}: ${rejected.length} concurrent writes were rejected: ${
      JSON.stringify(rejected.slice(0, 3).map((response) => [response.status, response.body?.error]))
    }`,
  );
}

async function counters(db: Db) {
  const [row] = await db.all<Record<string, number>>(
    `SELECT (SELECT COUNT(*) FROM observations) AS observations,
            (SELECT COUNT(*) FROM observations_fts) AS observations_fts,
            (SELECT COUNT(*) FROM record_history) AS record_history,
            (SELECT COUNT(*) FROM events) AS events,
            (SELECT COUNT(*) FROM index_outbox) AS index_outbox,
            (SELECT COUNT(*) FROM idempotency_v3) AS idempotency_v3`,
  );
  return Object.fromEntries(Object.entries(row!).map(([key, value]) => [key, Number(value)]));
}

export async function assertConcurrentWriterDurability(
  db: Db,
  runtime: string,
): Promise<DurabilityReport> {
  const principal = await provisionWith(db, { scopes: ["*"] });
  const scope = [principal.orgId, principal.principalId];
  const counted = countingCanonicalCollisions(db);
  // Each writer is its own app instance over the same store, as N agents are.
  const writers = Array.from({ length: WRITERS }, () => clientFor(counted.db, runtime));

  // --- I1 + I2, observations -------------------------------------------------
  const burst = writers.flatMap((client) =>
    Array.from({ length: PAYLOADS }, (_, index) => ({
      index,
      sent: client.call("POST", "/v1/observations", {
        key: principal.key,
        body: observationBody(runtime, index),
      }),
    })));
  const observed = await Promise.all(burst.map(async ({ index, sent }) => ({ index, res: await sent })));
  assertAccepted("observations", observed.map(({ res }) => res));

  for (let index = 0; index < PAYLOADS; index += 1) {
    const group = observed.filter((entry) => entry.index === index);
    const ids = new Set(group.map(({ res }) => res.body.data.observation_id as string));
    assert.equal(
      ids.size,
      1,
      `I1: payload ${index} minted ${ids.size} identities under ${WRITERS} concurrent writers`,
    );
    assert.equal(
      group.filter(({ res }) => res.status === 201).length,
      1,
      `I1: payload ${index} reported more than one creation`,
    );
  }

  const [observationRows] = await db.all<{
    rows: number; hashes: number; fts: number; history: number; events: number;
  }>(
    `SELECT (SELECT COUNT(*) FROM observations WHERE org_id = ? AND actor_id = ?) AS rows,
            (SELECT COUNT(DISTINCT canonical_hash) FROM observations
              WHERE org_id = ? AND actor_id = ?) AS hashes,
            (SELECT COUNT(*) FROM observations_fts f
               JOIN observations o ON o.id = f.observation_id
              WHERE o.org_id = ? AND o.actor_id = ?) AS fts,
            (SELECT COUNT(*) FROM record_history
              WHERE org_id = ? AND record_type = 'observation') AS history,
            (SELECT COUNT(*) FROM events
              WHERE org_id = ? AND kind = 'observation.appended') AS events`,
    [...scope, ...scope, ...scope, principal.orgId, principal.orgId],
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(observationRows!).map(([key, value]) => [key, Number(value)])),
    { rows: PAYLOADS, hashes: PAYLOADS, fts: PAYLOADS, history: PAYLOADS, events: PAYLOADS },
    `I1/I2: ${WRITERS * PAYLOADS} concurrent submissions must leave exactly ${PAYLOADS} observations and one projection each`,
  );

  // --- I1, claims ------------------------------------------------------------
  const evidenceId = observed[0]!.res.body.data.observation_id as string;
  const consolidation = {
    subject_id: "subject_durability",
    claims: [{
      kind: "procedural",
      statement: "Concurrent writers must converge on one claim per canonical hash.",
      confidence: 0.9,
      sources: [{ observation_id: evidenceId, relation: "supports" }],
    }],
  };
  const consolidated = await Promise.all(writers.map((client) =>
    client.call("POST", "/v1/consolidations", { key: principal.key, body: consolidation })));
  assertAccepted("consolidations", consolidated);
  const claimIds = new Set(consolidated.map((res) => res.body.data.claims[0].claim_id as string));
  assert.equal(claimIds.size, 1, `I1: ${WRITERS} concurrent consolidations minted ${claimIds.size} claims`);

  const [claimRows] = await db.all<{ rows: number; sources: number; fts: number; history: number }>(
    `SELECT (SELECT COUNT(*) FROM claims WHERE org_id = ? AND actor_id = ?) AS rows,
            (SELECT COUNT(*) FROM claim_sources s
               JOIN claims c ON c.id = s.claim_id
              WHERE c.org_id = ? AND c.actor_id = ?) AS sources,
            (SELECT COUNT(*) FROM claims_fts f
               JOIN claims c ON c.id = f.claim_id
              WHERE c.org_id = ? AND c.actor_id = ?) AS fts,
            (SELECT COUNT(*) FROM record_history
              WHERE org_id = ? AND record_type = 'claim') AS history`,
    [...scope, ...scope, ...scope, principal.orgId],
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(claimRows!).map(([key, value]) => [key, Number(value)])),
    { rows: 1, sources: 1, fts: 1, history: 1 },
    `I1: ${WRITERS} concurrent consolidations must leave exactly one claim and one projection each`,
  );

  // --- I3, no partial write survives a failed batch ---------------------------
  const before = await counters(db);
  let poisoned = false;
  const faulty: Db = {
    all: <Row>(sql: string, params: Parameters<Db["all"]>[1] = []) => db.all<Row>(sql, params),
    exec: (sql: string) => db.exec(sql),
    async batch(statements: Stmt[]) {
      if (!poisoned && statements.some((statement) => /INSERT INTO observations\s/u.test(statement.sql))) {
        poisoned = true;
        // Fail the last statement of a real write batch. Every earlier statement
        // in it must roll back with it, on both drivers.
        await db.batch([
          ...statements,
          { sql: `INSERT INTO titen_durability_absent_table (id) VALUES ('x')` },
        ]);
        return;
      }
      await db.batch(statements);
    },
  };
  const failed = await clientFor(faulty, runtime).call("POST", "/v1/observations", {
    key: principal.key,
    body: observationBody(runtime, PAYLOADS),
  });
  assert.equal(poisoned, true, "I3: the fault was never injected into a real write batch");
  assert.ok(
    failed.status >= 500,
    `I3: a failed write batch must not report success, got ${failed.status}`,
  );
  const after = await counters(db);
  assert.deepEqual(after, before, "I3: a failed batch left rows behind");

  const report: DurabilityReport = {
    runtime,
    writers: WRITERS,
    payloads: PAYLOADS,
    canonical_collisions: counted.collisions(),
    observation_requests: observed.length,
    observation_created: observed.filter(({ res }) => res.status === 201).length,
    observation_replayed: observed.filter(({ res }) => res.status === 200).length,
    observation_failed: 0,
    observation_rows: Number(observationRows!.rows),
    observation_canonical_hashes: Number(observationRows!.hashes),
    claim_requests: consolidated.length,
    claim_created: consolidated.filter((res) => res.status === 201).length,
    claim_replayed: consolidated.filter((res) => res.status === 200).length,
    claim_failed: 0,
    claim_rows: Number(claimRows!.rows),
    partial_rows: Object.entries(after)
      .reduce((total, [key, value]) => total + (value - before[key]!), 0),
  };
  process.stderr.write(`[durability] ${JSON.stringify(report)}\n`);
  return report;
}
