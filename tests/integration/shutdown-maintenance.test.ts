import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb } from "../../src/runtime/bun/sqlite";
import { serve } from "../../src/runtime/bun/server";
import { fakeVectors, provisionWith } from "../contract/harness";

const INTERVAL_MS = 25;

async function call(base: string, key: string, method: string, path: string, body?: unknown) {
  const response = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(response.ok, `${method} ${path} returned ${response.status}`);
  return (await response.json() as any).data;
}

async function victim(directory: string) {
  const vectors = fakeVectors();
  let blocked!: () => void;
  const embeddingStarted = new Promise<void>((resolve) => { blocked = resolve; });
  vectors.embedder.embed = async () => {
    blocked();
    await new Promise<void>(() => {});
    return [];
  };
  const running = await serve({
    dbPath: join(directory, "titen.db"),
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    maintenanceIntervalMs: INTERVAL_MS,
    vectors,
  });
  const db = createSqliteDb(running.database);
  const principal = await provisionWith(db, { scopes: ["*"] });
  const observation = await call(running.url, principal.key, "POST", "/v1/observations", {
    subject_id: "subject_shutdown",
    kind: "tool_result",
    content: "Synthetic shutdown evidence.",
    source: { type: "test" },
    trust: "verified",
  });
  const consolidation = await call(running.url, principal.key, "POST", "/v1/consolidations", {
    subject_id: "subject_shutdown",
    claims: [{
      kind: "procedural",
      statement: "Synthetic shutdown claim.",
      sources: [{ observation_id: observation.observation_id, relation: "supports" }],
    }],
  });
  const claimId = String(consolidation.claims[0].claim_id);
  await Promise.race([
    embeddingStarted,
    Bun.sleep(2_000).then(() => { throw new Error("maintenance did not acquire work"); }),
  ]);
  const [lease] = await db.all<{ leased: number }>(
    `SELECT lease_token IS NOT NULL AS leased FROM index_outbox
      WHERE record_id = ? AND state = 'pending'`,
    [claimId],
  );
  process.stdout.write(`${JSON.stringify({ claimId, leased: Number(lease?.leased ?? 0) })}\n`);
  await new Promise<void>(() => {});
}

async function restart(directory: string, claimId: string) {
  const vectors = fakeVectors();
  const running = await serve({
    dbPath: join(directory, "titen.db"),
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    maintenanceIntervalMs: INTERVAL_MS,
    vectors,
  });
  const db = createSqliteDb(running.database);
  try {
    const deadline = Date.now() + INTERVAL_MS * 40;
    let outbox: { state: string; leased: number } | undefined;
    while (Date.now() < deadline) {
      [outbox] = await db.all<{ state: string; leased: number }>(
        `SELECT state, lease_token IS NOT NULL AS leased FROM index_outbox
          WHERE record_id = ? AND operation = 'upsert'`,
        [claimId],
      );
      if (outbox?.state === "done" && vectors.metadataFor(claimId)) break;
      await Bun.sleep(INTERVAL_MS);
    }
    const readiness = await fetch(`${running.url}/readyz`);
    const [counts] = await db.all<{ observations: number; claims: number }>(
      `SELECT (SELECT COUNT(*) FROM observations) AS observations,
              (SELECT COUNT(*) FROM claims) AS claims`,
    );
    const integrity = running.database.query("PRAGMA integrity_check").get() as {
      integrity_check: string;
    };
    process.stdout.write(`${JSON.stringify({
      ready: readiness.status,
      embeds: vectors.embedCalls(),
      vector: Boolean(vectors.metadataFor(claimId)),
      outbox,
      counts,
      integrity: integrity.integrity_check,
    })}\n`);
  } finally {
    await running.stop();
  }
}

async function firstLine(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let value = "";
  while (true) {
    const next = await reader.read();
    if (next.done) throw new Error("child exited before acquiring work");
    value += decoder.decode(next.value, { stream: true });
    const newline = value.indexOf("\n");
    if (newline >= 0) return { value: value.slice(0, newline), reader };
  }
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    Bun.sleep(timeoutMs).then(() => { throw new Error(`operation exceeded ${timeoutMs}ms`); }),
  ]);
}

const mode = process.argv[2];
if (mode === "--victim") await victim(process.argv[3]!);
else if (mode === "--restart") await restart(process.argv[3]!, process.argv[4]!);
else test("SIGTERM releases active semantic work for immediate truthful recovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "titen-shutdown-maintenance-"));
  try {
    for (let repeat = 0; repeat < 5; repeat += 1) {
      const directory = join(root, String(repeat));
      mkdirSync(directory);
      const victimProcess = Bun.spawn({
        cmd: ["bun", import.meta.path, "--victim", directory],
        stdout: "pipe",
        stderr: "pipe",
      });
      const acquired = await bounded(firstLine(victimProcess.stdout), 3_000);
      const before = JSON.parse(acquired.value) as { claimId: string; leased: number };
      assert.equal(before.leased, 1);
      const signalledAt = performance.now();
      victimProcess.kill("SIGTERM");
      assert.equal(await bounded(victimProcess.exited, 2_000), 0);
      assert.ok(performance.now() - signalledAt < 1_000);
      while (!(await acquired.reader.read()).done) {}
      assert.equal((await new Response(victimProcess.stderr).text()).trim(), "");

      const restarted = Bun.spawn({
        cmd: ["bun", import.meta.path, "--restart", directory, before.claimId],
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(restarted.stdout).text();
      const stderr = await new Response(restarted.stderr).text();
      assert.equal(await restarted.exited, 0);
      assert.equal(stderr.trim(), "");
      const after = JSON.parse(stdout) as any;
      assert.equal(after.ready, 200);
      assert.equal(after.embeds, 1);
      assert.equal(after.vector, true);
      assert.deepEqual(after.outbox, { state: "done", leased: 0 });
      assert.deepEqual(after.counts, { observations: 1, claims: 1 });
      assert.equal(after.integrity, "ok");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
