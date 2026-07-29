#!/usr/bin/env bun
/**
 * Measures the P0 footprint on both runtimes: Worker bundle size, end-to-end
 * loop latency, peak process memory, and canonical storage growth.
 *
 * Usage: bun scripts/measure-footprint.ts [iterations]
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { createSqliteDb, openDatabase } from "../src/runtime/bun/sqlite";
import { serve } from "../src/runtime/bun/server";
import { createD1Db } from "../src/runtime/cloudflare/d1";
import { provisionWith } from "../tests/contract/harness";

const iterations = Number(process.argv[2] ?? "200");
const bundlePath = join(process.cwd(), "dist/worker/worker.js");

const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
};
const kib = (bytes: number) => `${(bytes / 1024).toFixed(2)} KiB`;

async function loop(
  call: (method: string, path: string, body: unknown, key: string) => Promise<any>,
  key: string,
  count: number,
) {
  const timings: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    const observation = await call(
      "POST",
      "/v1/observations",
      {
        subject_id: "user_bench",
        kind: "tool_result",
        content: `Deploy ${index} smoke returned 200 for the checkout service rollback path.`,
        source: { type: "tool", ref: `deploy_${index}#smoke` },
        trust: "verified",
      },
      key,
    );
    const consolidation = await call(
      "POST",
      "/v1/consolidations",
      {
        subject_id: "user_bench",
        claims: [
          {
            kind: "procedural",
            statement: `Deploy ${index} requires a verified rollback smoke before release.`,
            sources: [
              { observation_id: observation.data.observation_id, relation: "supports" },
            ],
          },
        ],
      },
      key,
    );
    const compiled = await call(
      "POST",
      "/v1/context/compile",
      { subject_id: "user_bench", task: "verified rollback smoke before release", max_tokens: 900 },
      key,
    );
    await call(
      "POST",
      `/v1/context/${compiled.data.context_id}/feedback`,
      {
        outcome: "useful",
        // Only an item inside this run may receive item-level feedback.
        claim_id: compiled.data.items[0]?.claim_id ?? null,
      },
      key,
    );
    if (!consolidation.data.claims[0].claim_id) throw new Error("claim was not materialized");
    timings.push(performance.now() - started);
  }
  return timings;
}

async function measureBun() {
  const directory = mkdtempSync(join(tmpdir(), "titen-bench-bun-"));
  const dbPath = join(directory, "titen.db");
  const running = await serve({ dbPath, port: 0, hostname: "127.0.0.1", quiet: true });
  const db = createSqliteDb(openDatabase(dbPath));
  const provisioned = await provisionWith(db, { scopes: ["*"] });
  const before = statSync(dbPath).size;

  const call = async (method: string, path: string, body: unknown, key: string) => {
    const response = await fetch(`${running.url}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const parsed = await response.json();
    if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(parsed)}`);
    return parsed;
  };

  const timings = await loop(call, provisioned.key, iterations);
  const after = readdirSync(directory).reduce(
    (total, name) => total + statSync(join(directory, name)).size,
    0,
  );
  const rss = process.memoryUsage().rss;
  await running.stop();
  rmSync(directory, { recursive: true, force: true });
  return { timings, storage: (after - before) / iterations, rss };
}

async function measureWorker() {
  if (!existsSync(bundlePath)) throw new Error("run pnpm build:worker first");
  const persist = mkdtempSync(join(tmpdir(), "titen-bench-d1-"));
  const mf = new Miniflare({
    modules: true,
    scriptPath: bundlePath,
    compatibilityDate: "2026-07-01",
    d1Databases: { DB: "titen-bench" },
    d1Persist: persist,
    bindings: { TITEN_REVISION: "bench", TITEN_AUTO_MIGRATE: "1" },
  });
  await mf.ready;
  await mf.dispatchFetch("http://titen.test/readyz");
  const db = createD1Db((await mf.getD1Database("DB")) as never);
  const provisioned = await provisionWith(db, { scopes: ["*"] });

  const directorySize = () => {
    let total = 0;
    const walk = (path: string) => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) walk(child);
        else total += statSync(child).size;
      }
    };
    walk(persist);
    return total;
  };
  const before = directorySize();

  const call = async (method: string, path: string, body: unknown, key: string) => {
    const response = await mf.dispatchFetch(`http://titen.test${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json()) as any;
    if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(parsed)}`);
    return parsed;
  };

  const timings = await loop(call, provisioned.key, iterations);
  const storage = (directorySize() - before) / iterations;
  await mf.dispose();
  rmSync(persist, { recursive: true, force: true });
  return { timings, storage };
}

const bundle = existsSync(bundlePath) ? readFileSync(bundlePath) : undefined;
const worker = await measureWorker();
const bun = await measureBun();

const rows = [
  ["metric", "bun-sqlite", "cloudflare-d1"],
  ["---", "---", "---"],
  [
    "worker bundle (raw / gzip)",
    "n/a",
    bundle
      ? `${kib(bundle.byteLength)} / ${kib(Bun.gzipSync(bundle).byteLength)}`
      : "not built",
  ],
  [
    `full loop p50 (${iterations} iterations)`,
    `${percentile(bun.timings, 0.5).toFixed(1)} ms`,
    `${percentile(worker.timings, 0.5).toFixed(1)} ms`,
  ],
  [
    "full loop p95",
    `${percentile(bun.timings, 0.95).toFixed(1)} ms`,
    `${percentile(worker.timings, 0.95).toFixed(1)} ms`,
  ],
  [
    "storage per loop",
    `${(bun.storage / 1024).toFixed(2)} KiB`,
    `${(worker.storage / 1024).toFixed(2)} KiB`,
  ],
  ["peak process RSS", kib(bun.rss), "workerd manages its own isolate memory"],
];

console.log("");
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
console.log("");
console.log(
  `One loop = observation append + claim materialization + context compile + feedback (4 requests).`,
);
