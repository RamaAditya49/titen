import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Db } from "../../src/core/db";
import { migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { provisionWith } from "../contract/harness";
import { assertConcurrentWriterDurability, PAYLOADS, WRITERS } from "../contract/durability";

const withStore = async (label: string, run: (db: Db) => Promise<void>) => {
  const directory = mkdtempSync(join(tmpdir(), `titen-durability-${label}-`));
  const database = openDatabase(join(directory, "titen.db"));
  try {
    const db = createSqliteDb(database);
    await migrate(db);
    await run(db);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
};

test("bun:sqlite holds the durability invariants under concurrent writers", async () => {
  await withStore("core", async (db) => {
    const report = await assertConcurrentWriterDurability(db, "bun-sqlite");
    assert.equal(report.observation_requests, WRITERS * PAYLOADS);
    assert.equal(report.observation_rows, PAYLOADS);
    assert.equal(report.claim_rows, 1);
    assert.equal(report.partial_rows, 0);
  });
}, 60_000);

/**
 * The same invariants across operating-system processes.
 *
 * Zero-config local mode puts several agents on one `~/.titen/memory.db`, and
 * an event loop that serialises `bun:sqlite` calls inside one process hides
 * exactly the contention that deployment creates. These writers are separate
 * processes on separate connections, so the WAL write lock is real.
 */
const PROCESSES = 8;
/** Payloads every process submits byte-identically. */
const SHARED = 12;
/**
 * Wall-clock slot per payload. Every process first-touches payload `k` at the
 * same instant, which is what opens the read-then-write window; a single barrier
 * at the start only aligns the first write, and per-request jitter then spaces
 * the rest far enough apart that the race never occurs.
 */
const SLOT_MS = 30;

const CHILD = (root: string) => `
import { createApp } from ${JSON.stringify(join(root, "src/core/app.ts"))};
import { createSqliteDb, openDatabase } from ${JSON.stringify(join(root, "src/runtime/bun/sqlite.ts"))};
import { countingCanonicalCollisions } from ${JSON.stringify(join(root, "tests/contract/durability.ts"))};

const [path, key, startAt, payloadsJson] = process.argv.slice(2);
const database = openDatabase(path);
const counted = countingCanonicalCollisions(createSqliteDb(database));
const app = createApp({ db: counted.db, runtime: "bun-sqlite", revision: "durability" });
const payloads = JSON.parse(payloadsJson);
const submit = async (body) => {
  const response = await app(new Request("http://durability.test/v1/observations", {
    method: "POST",
    headers: { authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  const parsed = await response.json();
  return { status: response.status, id: parsed?.data?.observation_id ?? null, error: parsed?.error ?? null };
};

const deadline = Number(startAt);
const waitUntil = async (at) => { while (Date.now() < at) await Bun.sleep(Math.min(5, at - Date.now())); };
await waitUntil(deadline);
const started = Date.now();
const results = [];
for (const [slot, body] of payloads.entries()) {
  await waitUntil(deadline + slot * ${SLOT_MS});
  results.push(await submit(body));
}
database.close();
console.log(JSON.stringify({ started, ended: Date.now(), collisions: counted.collisions(), results }));
`;

test("concurrent bun:sqlite processes hold the durability invariants on one file", async () => {
  const root = resolve(import.meta.dir, "../..");
  const directory = mkdtempSync(join(tmpdir(), "titen-durability-processes-"));
  const dbPath = join(directory, "titen.db");
  const childPath = join(directory, "writer.ts");
  writeFileSync(childPath, CHILD(root));
  const database = openDatabase(dbPath);
  let principal: Awaited<ReturnType<typeof provisionWith>>;
  try {
    const db = createSqliteDb(database);
    await migrate(db);
    principal = await provisionWith(db, { scopes: ["*"] });
  } finally {
    // Release the parent connection so only the child processes contend.
    database.close();
  }

  const body = (id: string, content: string) => ({
    subject_id: "subject_durability_processes",
    kind: "tool_result",
    content,
    source: { type: "tool", ref: "durability", id },
    trust: "verified",
  });
  const shared = Array.from({ length: SHARED }, (_, index) =>
    body(`shared-${index}`, `Shared durability probe ${index}.`));

  try {
    const startAt = Date.now() + 2_500;
    const children = Array.from({ length: PROCESSES }, (_, writer) =>
      Bun.spawn({
        cmd: [
          process.execPath, "run", childPath, dbPath, principal!.key, String(startAt),
          JSON.stringify([...shared, body(`writer-${writer}`, `Writer ${writer} probe.`)]),
        ],
        stdout: "pipe",
        stderr: "pipe",
      }));
    const outcomes = await Promise.all(children.map(async (child) => {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      assert.equal(code, 0, `writer process exited ${code}: ${stderr}`);
      return JSON.parse(stdout) as {
        started: number;
        ended: number;
        collisions: number;
        results: { status: number; id: string | null; error: unknown }[];
      };
    }));

    const rejected = outcomes.flatMap((outcome) =>
      outcome.results.filter((result) => result.status !== 200 && result.status !== 201));
    assert.equal(
      rejected.length,
      0,
      `I2: ${rejected.length} cross-process writes were rejected: ${JSON.stringify(rejected.slice(0, 3))}`,
    );

    const latestStart = Math.max(...outcomes.map((outcome) => outcome.started));
    const earliestEnd = Math.min(...outcomes.map((outcome) => outcome.ended));
    assert.ok(
      latestStart < earliestEnd,
      `the ${PROCESSES} writers never overlapped: last start ${latestStart}, first end ${earliestEnd}`,
    );

    const identities = new Map<string, Set<string>>();
    for (const outcome of outcomes)
      for (const [index, result] of outcome.results.entries()) {
        const key = String(index % (SHARED + 1));
        if (index % (SHARED + 1) < SHARED)
          identities.set(key, (identities.get(key) ?? new Set()).add(result.id!));
      }
    for (const [payload, ids] of identities)
      assert.equal(ids.size, 1, `I1: shared payload ${payload} minted ${ids.size} identities across processes`);

    const verify = openDatabase(dbPath);
    try {
      const db = createSqliteDb(verify);
      const [rows] = await db.all<{ rows: number; hashes: number; fts: number; history: number }>(
        `SELECT (SELECT COUNT(*) FROM observations) AS rows,
                (SELECT COUNT(DISTINCT canonical_hash) FROM observations) AS hashes,
                (SELECT COUNT(*) FROM observations_fts) AS fts,
                (SELECT COUNT(*) FROM record_history WHERE record_type = 'observation') AS history`,
      );
      const expected = SHARED + PROCESSES;
      assert.deepEqual(
        Object.fromEntries(Object.entries(rows!).map(([key, value]) => [key, Number(value)])),
        { rows: expected, hashes: expected, fts: expected, history: expected },
        "I1/I2: cross-process writers must leave one row per canonical hash and lose none",
      );
      process.stderr.write(`[durability] ${JSON.stringify({
        runtime: "bun-sqlite-multiprocess",
        processes: PROCESSES,
        shared_payloads: SHARED,
        requests: outcomes.reduce((total, outcome) => total + outcome.results.length, 0),
        created: outcomes.reduce((total, outcome) =>
          total + outcome.results.filter((result) => result.status === 201).length, 0),
        replayed: outcomes.reduce((total, outcome) =>
          total + outcome.results.filter((result) => result.status === 200).length, 0),
        failed: rejected.length,
        canonical_collisions: outcomes.reduce((total, outcome) => total + outcome.collisions, 0),
        overlap_ms: earliestEnd - latestStart,
        observation_rows: Number(rows!.rows),
      })}\n`);
    } finally {
      verify.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);
