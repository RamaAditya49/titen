#!/usr/bin/env bun
/**
 * Scale and concurrency harness: the corpus decades and the throughput ceiling.
 *
 * Every latency figure this repository published before 2026-08-04 was
 * single-process, loopback, effectively single-client, against at most 10,000
 * statements. This runner answers the four questions that leaves open:
 *
 *   1. what ingest throughput, FTS projection rebuild time, database size and
 *      service RSS look like at 10^3, 10^4 and 10^5 claims;
 *   2. where compile throughput stops improving as concurrent clients rise
 *      through 1, 8, 32 and 64;
 *   3. how recall@1 and MRR@10 move on one fixed query set as the corpus grows
 *      by decades;
 *   4. which resource binds first.
 *
 * FTS-only. No embedding provider is contacted, no embedding variable is read,
 * and the spawned service inherits an environment with every `TITEN_EMBED_*`
 * and `TITEN_EXTRACT_*` name removed, so the vector lane cannot silently
 * activate and fold provider latency into Titen's number. Measuring the vector
 * lane needs an operator profile and belongs in a separate run that reports
 * provider round-trip time as its own term.
 *
 *   bun scripts/benchmark-scale.ts --out DIR
 *   bun scripts/benchmark-scale.ts --out DIR --decades 1000,10000 --queries 50
 *   bun scripts/benchmark-scale.ts --self-test
 *
 * The service runs as a separate `titen serve` process, not in this one. That
 * is not incidental: Bun.serve and the load generator sharing one event loop
 * would make every concurrency number a measurement of this harness. The child
 * pid is read from /proc for VmRSS and for utime+stime, so "cores consumed" is
 * the service's own CPU, and this process reports its own CPU separately so a
 * client-bound result cannot be misread as a server ceiling.
 *
 * Corpus is synthetic and deterministic: `--seed` fixes it, decade N is a
 * strict prefix of decade 10N, and the gold claims for every query live in the
 * first 1,000 records so the same query set is answerable at every decade.
 * Statements are token bags over a fixed vocabulary; a query is six tokens
 * drawn from its gold claim. Absolute recall here is a property of that
 * generator, not a retrieval quality claim comparable to the externally
 * authored Mr. TyDi lane. The shape of the curve across decades is the result.
 *
 * Artifacts contain ids, counts, metrics, timings and hashes only. No
 * statement text, no query text, no credential, no embedding. Every artifact is
 * scanned for the generated API key and for a sample of generated statements
 * before it is written, and the run aborts if any appears.
 *
 * Each decade builds its store under a fresh `mkdtemp` directory and removes it
 * on success. A decade that throws deliberately leaves its directory behind for
 * inspection; at 10^5 claims that is roughly half a gigabyte, so delete it
 * after diagnosing a failure. `TMPDIR` chooses the filesystem, which is how the
 * durable-storage lane is run without a flag: `/tmp` is tmpfs on many hosts and
 * an ingest figure measured there is RAM, not disk.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { arch, cpus, hostname, platform, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { createApiKey, organizationStatement } from "../src/core/auth";
import { newId } from "../src/core/ids";
import { MIGRATIONS } from "../src/core/migrations";
import { migrate } from "../src/core/migrations";
import { TITEN_VERSION } from "../src/core/version";
import { createSqliteDb, openDatabase } from "../src/runtime/bun/sqlite";

const HARNESS_VERSION = "titen-scale-concurrency-v1";
const SCHEMA_VERSION = 1;
const REPO_ROOT = resolve(import.meta.dir, "..");
const SCOPES = ["observations:write", "claims:write", "context:compile"];
const DEFAULT_DECADES = [1_000, 10_000, 100_000];
const DEFAULT_CONCURRENCY = [1, 8, 32, 64];
const DEFAULT_QUERIES = 100;
/** Claims per consolidation request; LIMITS.claimsPerConsolidation is 50. */
const CHUNK = 50;
/**
 * Topical corpus. A flat vocabulary gives either no recall degradation (rare
 * terms, no competitors ever) or an unrealistic full-corpus posting list per
 * term. Topics give both properties honestly: a term stays rare corpus-wide
 * while same-topic competitors grow linearly with the corpus, which is what
 * happens to a real memory store as a subject accumulates related claims.
 * Topic of claim i is i % TOPICS, so decade N is a strict prefix of decade 10N
 * and topic membership grows uniformly across the decades.
 */
const TOPICS = 400;
const TOPIC_POOL = 24;
const MIN_DOC_TOKENS = 8;
const MAX_DOC_TOKENS = 20;
const QUERY_TOKENS = 6;
/** The shipped candidate default, and an agent-sized context budget. Running
 *  Titen above its own default would flatter it; both are declared. */
const MAX_CANDIDATES = 200;
const MAX_TOKENS = 2_000;
/** Fixed request count per concurrency level: throughput is total/elapsed, so a
 *  higher level must not also become a longer test. */
const SWEEP_REQUESTS = 2_000;
const WARMUP_REQUESTS = 50;
const REQUEST_TIMEOUT_MS = 120_000;
const BOOT_TIMEOUT_MS = 60_000;
/** The first level whose throughput gain over the previous level falls under
 *  this fraction is the ceiling. Declared before the run, not fitted after. */
const CEILING_GAIN = 0.1;
const CLOCK_TICKS = 100;

// ---------------------------------------------------------------- generator

/** mulberry32: 32-bit, seeded, and identical on every host. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Distinct tokens sampled without replacement from the claim's topic pool, so
 * term frequency is 1 everywhere and BM25 discriminates on document length and
 * term rarity rather than on repetition. Length varies so a longer competitor
 * that happens to contain every query term still loses to a shorter exact
 * match, which keeps the result a ranking measurement instead of a tie-break
 * measurement. The trailing digit keeps Porter from stemming the token.
 */
export function claimTokens(index: number, seed: number): string[] {
  const topic = index % TOPICS;
  const next = rng(seed + index * 2654435761);
  const length = MIN_DOC_TOKENS
    + Math.floor(next() * (MAX_DOC_TOKENS - MIN_DOC_TOKENS + 1));
  const pool = Array.from({ length: TOPIC_POOL }, (_, i) => i);
  const picked: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const at = Math.floor(next() * pool.length);
    picked.push(`t${String(topic).padStart(3, "0")}w${String(pool[at]).padStart(2, "0")}`);
    pool.splice(at, 1);
  }
  return picked;
}

export function claimStatement(index: number, seed: number): string {
  return claimTokens(index, seed).join(" ");
}

/** Six tokens of the gold claim, in generator order, so the query is a strict
 *  subset of exactly one planted document and any competitor is a collision. */
export function queryText(goldIndex: number, seed: number): string {
  return claimTokens(goldIndex, seed).slice(0, QUERY_TOKENS).join(" ");
}

/** Gold indices spread across the first decade so every query is answerable at
 *  every decade and the query set never changes between them. */
export function goldIndices(count: number, smallestDecade: number): number[] {
  const stride = Math.floor(smallestDecade / count);
  return Array.from({ length: count }, (_, i) => i * stride);
}

// ------------------------------------------------------------------- stats

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[at];
}

export function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: round(percentile(sorted, 0.5), 3),
    p95: round(percentile(sorted, 0.95), 3),
    p99: round(percentile(sorted, 0.99), 3),
    max: round(sorted.at(-1) ?? 0, 3),
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * The ceiling is the first level whose throughput gain over the previous level
 * is under CEILING_GAIN. Returns null when throughput never stops improving,
 * which is a real outcome and must not be reported as a ceiling.
 */
export function findCeiling(
  levels: { concurrency: number; throughput_rps: number }[],
): number | null {
  for (let i = 1; i < levels.length; i += 1) {
    const previous = levels[i - 1].throughput_rps;
    const current = levels[i].throughput_rps;
    // A missing or unusable throughput is a harness fault, not "no ceiling".
    if (!Number.isFinite(previous) || !Number.isFinite(current))
      throw new Error("CeilingInputNotFinite");
    if (previous <= 0) continue;
    if ((current - previous) / previous < CEILING_GAIN) return levels[i - 1].concurrency;
  }
  return null;
}

// ------------------------------------------------------------------ /proc

function procRssKb(pid: number): number {
  const match = /VmRSS:\s+(\d+) kB/u.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
  return match ? Number(match[1]) : 0;
}

/** utime + stime in seconds. Fields 14 and 15, after the parenthesised comm. */
function procCpuSeconds(pid: number): number {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return (Number(fields[11]) + Number(fields[12])) / CLOCK_TICKS;
}

// ------------------------------------------------------------------ runner

class HttpFailure extends Error {
  constructor(readonly method: string, readonly path: string, readonly status: number | string) {
    super("http");
  }
}

/** Path and status only. A response body may echo request content. */
function errorCode(error: unknown): string {
  if (error instanceof HttpFailure)
    return `HTTP_${error.method}_${error.path.split("?")[0].replaceAll("/", "_")}_${error.status}`;
  if (error instanceof Error && error.name === "TimeoutError") return "TIMEOUT";
  return error instanceof Error ? `ERR_${error.name}` : "ERR_UNKNOWN";
}

async function freePort(): Promise<number> {
  // @ts-ignore - Bun global is provided by the runtime.
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = probe.port as number;
  probe.stop(true);
  return port;
}

/** FTS-only is enforced here, not documented here: the child never sees a
 *  provider variable, so it cannot activate the vector or extraction lane. */
function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("TITEN_EMBED") || key.startsWith("TITEN_EXTRACT")) continue;
    env[key] = value;
  }
  env.TITEN_MAINTENANCE_INTERVAL_MS = "0";
  return env;
}

interface Options {
  out: string;
  decades: number[];
  concurrency: number[];
  queries: number;
  seed: number;
  ingestConcurrency: number;
  sweepRequests: number;
}

async function runDecade(options: Options, size: number, secrets: string[]) {
  const directory = mkdtempSync(join(tmpdir(), "titen-scale-"));
  const dbPath = join(directory, "titen.db");
  const namespace = `scale_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const orgId = newId("org");
  const errors: string[] = [];

  const database = openDatabase(dbPath);
  const db = createSqliteDb(database);
  await migrate(db);
  const credential = await createApiKey({
    orgId,
    principalId: newId("agent"),
    principalKind: "agent",
    label: "scale-bench",
    scopes: SCOPES,
    maxTrust: "verified",
  });
  await db.batch([organizationStatement(orgId, "Scale Bench"), credential.statement]);
  database.close();
  secrets.push(credential.key);

  const port = await freePort();
  // @ts-ignore - Bun global is provided by the runtime.
  const child = Bun.spawn({
    cmd: ["bun", "src/runtime/bun/cli.ts", "serve", "--db", dbPath, "--port", String(port), "--host", "127.0.0.1", "--quiet"],
    cwd: REPO_ROOT,
    env: childEnv(),
    stdout: "ignore",
    stderr: "ignore",
  });
  const pid = child.pid as number;
  const base = `http://127.0.0.1:${port}`;

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${credential.key}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) throw new HttpFailure(method, path, response.status);
    let payload: { data?: Record<string, any> };
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new HttpFailure(method, path, "INVALID_JSON");
    }
    return payload.data ?? {};
  };

  const compile = (task: string) => call("POST", "/v1/context/compile", {
    subject_id: namespace,
    task,
    max_tokens: MAX_TOKENS,
    max_candidates: MAX_CANDIDATES,
  });

  const bootStart = performance.now();
  for (;;) {
    if (performance.now() - bootStart > BOOT_TIMEOUT_MS) throw new Error("ServiceBootTimeout");
    try {
      const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) break;
    } catch {
      /* not listening yet */
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  const bootMs = round(performance.now() - bootStart, 2);

  const claimIndexById = new Map<string, number>();
  const record: Record<string, any> = { decade: size, boot_ms: bootMs };

  try {
    // A non-empty start would make every count and every recall number a lie.
    const probe = await compile("startup binding probe");
    if (!Array.isArray(probe.items) || probe.items.length !== 0)
      throw new Error("FreshDatabaseNotEmpty");

    // ------------------------------------------------------------- ingest
    const rssBefore = procRssKb(pid);
    const cpuBefore = procCpuSeconds(pid);
    const ingestStart = performance.now();
    let ingestErrors = 0;
    for (let offset = 0; offset < size; offset += CHUNK) {
      const indices = Array.from(
        { length: Math.min(CHUNK, size - offset) },
        (_, i) => offset + i,
      );
      const observations = new Array<string>(indices.length);
      let cursor = 0;
      const worker = async () => {
        for (;;) {
          const slot = cursor;
          cursor += 1;
          if (slot >= indices.length) return;
          const statement = claimStatement(indices[slot], options.seed);
          const created = await call("POST", "/v1/observations", {
            subject_id: namespace,
            run_id: namespace,
            kind: "user_statement",
            content: statement,
            source: { type: "benchmark", ref: `scale:${indices[slot]}` },
            trust: "asserted",
          });
          observations[slot] = String(created.observation_id);
        }
      };
      try {
        await Promise.all(
          Array.from({ length: Math.min(options.ingestConcurrency, indices.length) }, worker),
        );
        const consolidated = await call("POST", "/v1/consolidations", {
          subject_id: namespace,
          claims: indices.map((index, slot) => ({
            kind: "semantic_fact",
            statement: claimStatement(index, options.seed),
            confidence: 1,
            sources: [{ observation_id: observations[slot], relation: "supports" }],
          })),
        });
        if (consolidated.model_used !== false) throw new Error("ModelUsed");
        const returned = consolidated.claims ?? [];
        if (returned.length !== indices.length) throw new Error("ClaimCountMismatch");
        returned.forEach((claim: any, slot: number) =>
          claimIndexById.set(String(claim.claim_id), indices[slot]));
      } catch (error) {
        ingestErrors += indices.length;
        if (errors.length < 20) errors.push(`ingest:${offset}:${errorCode(error)}`);
      }
    }
    const ingestMs = round(performance.now() - ingestStart, 2);
    record.ingest = {
      claims: size,
      concurrency: options.ingestConcurrency,
      wall_ms: ingestMs,
      claims_per_second: round((size - ingestErrors) / (ingestMs / 1000), 2),
      records_per_second: round(((size - ingestErrors) * 2) / (ingestMs / 1000), 2),
      errors: ingestErrors,
      service_cpu_seconds: round(procCpuSeconds(pid) - cpuBefore, 3),
      service_cores_used: round((procCpuSeconds(pid) - cpuBefore) / (ingestMs / 1000), 3),
      rss_kb_before: rssBefore,
      rss_kb_after: procRssKb(pid),
      // Corpus-only size, measured before the sweep. Compile persists a
      // context_runs row and one context_run_items row per selected claim, so
      // a post-sweep file also contains this harness's own read traffic and is
      // not the size of the corpus. A second connection checkpoints the WAL
      // into the main file first, because db plus WAL double-counts every page
      // the WAL still holds a copy of.
      ...checkpointedBytes(dbPath),
    };
    if (ingestErrors > 0) throw new Error("IngestIncomplete");

    // ------------------------------------------------------------ queries
    const golds = goldIndices(options.queries, Math.min(...options.decades));
    const queries = golds.map((gold) => ({ gold, task: queryText(gold, options.seed) }));
    for (let i = 0; i < WARMUP_REQUESTS; i += 1)
      await compile(queries[i % queries.length].task);

    // Recall at concurrency 1: a queued request measures the queue, not rank.
    let reciprocalTotal = 0;
    let hitsAt1 = 0;
    const serialLatency: number[] = [];
    for (const query of queries) {
      const started = performance.now();
      const compiled = await compile(query.task);
      serialLatency.push(performance.now() - started);
      const items = Array.isArray(compiled.items) ? compiled.items : [];
      const ranked = items
        .map((item: any) => claimIndexById.get(String(item.claim_id)))
        .filter((index: number | undefined) => index !== undefined) as number[];
      const at = ranked.indexOf(query.gold);
      if (at === 0) hitsAt1 += 1;
      if (at >= 0 && at < 10) reciprocalTotal += 1 / (at + 1);
    }
    record.recall = {
      queries: queries.length,
      recall_at_1: round(hitsAt1 / queries.length, 6),
      mrr_at_10: round(reciprocalTotal / queries.length, 6),
      serial_latency_ms: summarize(serialLatency),
    };

    // -------------------------------------------------------- concurrency
    record.sweep = [];
    for (const level of options.concurrency) {
      const latency: number[] = [];
      let failures = 0;
      let cursor = 0;
      const cpuStart = procCpuSeconds(pid);
      const clientStart = process.cpuUsage();
      const wallStart = performance.now();
      const worker = async () => {
        for (;;) {
          const slot = cursor;
          cursor += 1;
          if (slot >= options.sweepRequests) return;
          const started = performance.now();
          try {
            await compile(queries[slot % queries.length].task);
            latency.push(performance.now() - started);
          } catch (error) {
            failures += 1;
            if (errors.length < 20) errors.push(`sweep:${level}:${errorCode(error)}`);
          }
        }
      };
      await Promise.all(Array.from({ length: level }, worker));
      const wallMs = performance.now() - wallStart;
      const clientCpu = process.cpuUsage(clientStart);
      record.sweep.push({
        concurrency: level,
        requests: options.sweepRequests,
        failures,
        wall_ms: round(wallMs, 2),
        throughput_rps: round((options.sweepRequests - failures) / (wallMs / 1000), 2),
        latency_ms: summarize(latency),
        service_cpu_seconds: round(procCpuSeconds(pid) - cpuStart, 3),
        service_cores_used: round((procCpuSeconds(pid) - cpuStart) / (wallMs / 1000), 3),
        client_cores_used: round(((clientCpu.user + clientCpu.system) / 1e6) / (wallMs / 1000), 3),
        rss_kb: procRssKb(pid),
      });
    }
    record.ceiling_concurrency = findCeiling(record.sweep);
    // Peak across every phase: ingest can hold more than a read sweep does.
    record.peak_rss_kb = Math.max(
      record.ingest.rss_kb_after,
      ...record.sweep.map((level: any) => level.rss_kb),
    );
  } finally {
    child.kill();
    await child.exited;
  }

  // ------------------------------------------------- storage and rebuild
  const post = openDatabase(dbPath);
  post.run("PRAGMA wal_checkpoint(TRUNCATE)");
  record.storage = {
    db_bytes_after_sweep: statSync(dbPath).size,
    wal_bytes: fileBytes(`${dbPath}-wal`),
    claims: Number(post.query("SELECT count(*) AS n FROM claims").get()?.n ?? 0),
    observations: Number(post.query("SELECT count(*) AS n FROM observations").get()?.n ?? 0),
    claims_fts: Number(post.query("SELECT count(*) AS n FROM claims_fts").get()?.n ?? 0),
    context_runs: Number(post.query("SELECT count(*) AS n FROM context_runs").get()?.n ?? 0),
    context_run_items: Number(post.query("SELECT count(*) AS n FROM context_run_items").get()?.n ?? 0),
  };
  // FTS is derived data written inline with the canonical row, so there is no
  // separate build step during ingest. The build cost that exists is the
  // projection rebuild, and migration 11 is exactly that statement list: drop
  // and repopulate both FTS tables from canonical claims and observations.
  const rebuild = MIGRATIONS.find((migration) => migration.version === 11);
  if (!rebuild) throw new Error("MissingFtsRebuildMigration");
  const rebuildStart = performance.now();
  post.transaction(() => {
    for (const statement of rebuild.statements) post.run(statement);
  })();
  record.fts_rebuild_ms = round(performance.now() - rebuildStart, 2);
  post.run("PRAGMA wal_checkpoint(TRUNCATE)");
  record.storage.db_bytes_after_rebuild = statSync(dbPath).size;
  post.close();

  record.errors = errors;
  rmSync(directory, { recursive: true, force: true });
  return record;
}

/**
 * Folds the WAL into the main file from a second connection and reports the
 * result. `busy` non-zero means a reader blocked the checkpoint and the size
 * is a floor, not an exact figure, so the artifact carries the flag rather
 * than a number whose provenance is invisible.
 */
function checkpointedBytes(dbPath: string): { db_bytes: number; checkpoint_busy: number } {
  const connection = openDatabase(dbPath, { create: false });
  try {
    const result = connection.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as
      | { busy?: number }
      | undefined;
    return {
      db_bytes: fileBytes(dbPath) + fileBytes(`${dbPath}-wal`),
      checkpoint_busy: Number(result?.busy ?? -1),
    };
  } finally {
    connection.close();
  }
}

function fileBytes(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

// --------------------------------------------------------------- artifacts

/** Nothing leaves this process until it has been searched for every generated
 *  key and a sample of the generated corpus. */
export function assertRedacted(text: string, forbidden: string[]): void {
  for (const needle of forbidden)
    if (needle.length > 0 && text.includes(needle)) throw new Error("ForbiddenContentInArtifact");
}

function writeArtifact(directory: string, name: string, text: string, forbidden: string[]): string {
  assertRedacted(text, forbidden);
  writeFileSync(join(directory, name), text);
  return createHash("sha256").update(text).digest("hex");
}

function parseList(value: string | undefined, fallback: number[]): number[] {
  if (!value) return fallback;
  return value.split(",").map((part) => {
    const parsed = Number(part.trim());
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid list value: ${part}`);
    return parsed;
  });
}

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const out = flag("out");
  if (!out) throw new Error("--out DIR is required");
  const options: Options = {
    out: resolve(out),
    decades: parseList(flag("decades"), DEFAULT_DECADES).sort((a, b) => a - b),
    concurrency: parseList(flag("concurrency"), DEFAULT_CONCURRENCY).sort((a, b) => a - b),
    queries: Number(flag("queries") ?? DEFAULT_QUERIES),
    seed: Number(flag("seed") ?? 20260804),
    ingestConcurrency: Number(flag("ingest-concurrency") ?? 8),
    sweepRequests: Number(flag("sweep-requests") ?? SWEEP_REQUESTS),
  };
  mkdirSync(options.out, { recursive: true });

  const secrets: string[] = [];
  const startedAt = new Date().toISOString();
  const decades: any[] = [];
  for (const size of options.decades) {
    console.log(`decade ${size}: starting`);
    const record = await runDecade(options, size, secrets);
    decades.push(record);
    console.log(
      `decade ${size}: ingest ${record.ingest.claims_per_second}/s, `
      + `recall@1 ${record.recall.recall_at_1}, ceiling ${record.ceiling_concurrency}`,
    );
  }

  // The corpus itself is the other secret: a statement in an artifact is
  // fixture text, and this file's contract says ids, counts and hashes only.
  const forbidden = [
    ...secrets,
    ...Array.from({ length: 32 }, (_, i) => claimStatement(i * 31, options.seed)),
  ];
  const fixtureHash = createHash("sha256")
    .update(JSON.stringify({
      seed: options.seed,
      topics: TOPICS,
      topic_pool: TOPIC_POOL,
      doc_tokens: [MIN_DOC_TOKENS, MAX_DOC_TOKENS],
      query_tokens: QUERY_TOKENS,
      queries: options.queries,
      decades: options.decades,
    }))
    .digest("hex");

  const manifest = {
    schema_version: SCHEMA_VERSION,
    harness_version: HARNESS_VERSION,
    system: "titen",
    system_version: TITEN_VERSION,
    lane: "a-core-fts-only",
    runtime: "bun-sqlite",
    vector_lane: "disabled",
    embedding_provider: "none",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    host: {
      hostname: createHash("sha256").update(hostname()).digest("hex").slice(0, 16),
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu_model: cpus()[0]?.model ?? "unknown",
      cpu_count: cpus().length,
      total_memory_bytes: totalmem(),
      bun_version: (globalThis as any).Bun?.version ?? "unknown",
    },
    config: {
      decades: options.decades,
      concurrency: options.concurrency,
      queries: options.queries,
      seed: options.seed,
      ingest_concurrency: options.ingestConcurrency,
      sweep_requests: options.sweepRequests,
      warmup_requests: WARMUP_REQUESTS,
      max_tokens: MAX_TOKENS,
      max_candidates: MAX_CANDIDATES,
      claims_per_consolidation: CHUNK,
      ceiling_gain_threshold: CEILING_GAIN,
      topics: TOPICS,
      topic_pool: TOPIC_POOL,
      doc_tokens: [MIN_DOC_TOKENS, MAX_DOC_TOKENS],
      query_tokens: QUERY_TOKENS,
    },
    fixture_sha256: fixtureHash,
  };

  const summary = {
    schema_version: SCHEMA_VERSION,
    decades: decades.map((record) => ({
      decade: record.decade,
      ingest_claims_per_second: record.ingest.claims_per_second,
      ingest_wall_ms: record.ingest.wall_ms,
      ingest_cores_used: record.ingest.service_cores_used,
      fts_rebuild_ms: record.fts_rebuild_ms,
      corpus_db_bytes: record.ingest.db_bytes,
      db_bytes_after_sweep: record.storage.db_bytes_after_sweep,
      context_runs: record.storage.context_runs,
      ingest_rss_kb: record.ingest.rss_kb_after,
      peak_rss_kb: record.peak_rss_kb,
      recall_at_1: record.recall.recall_at_1,
      mrr_at_10: record.recall.mrr_at_10,
      serial_p50_ms: record.recall.serial_latency_ms.p50,
      ceiling_concurrency: record.ceiling_concurrency,
      sweep: record.sweep,
    })),
  };

  const raw = decades.map((record) => JSON.stringify(record)).join("\n") + "\n";
  const hashes = [
    ["manifest.json", writeArtifact(options.out, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, forbidden)],
    ["summary.json", writeArtifact(options.out, "summary.json", `${JSON.stringify(summary, null, 2)}\n`, forbidden)],
    ["raw.jsonl", writeArtifact(options.out, "raw.jsonl", raw, forbidden)],
  ];
  writeFileSync(
    join(options.out, "SHA256SUMS"),
    hashes.map(([name, hash]) => `${hash}  ${name}`).join("\n") + "\n",
  );
  console.log(`wrote ${hashes.length + 1} artifacts to ${options.out}`);
}

// --------------------------------------------------------------- self-test

function selfTest() {
  // Determinism, and decade N is a strict prefix of decade 10N.
  assert.equal(claimStatement(7, 1), claimStatement(7, 1));
  assert.notEqual(claimStatement(7, 1), claimStatement(7, 2));
  assert.notEqual(claimStatement(7, 1), claimStatement(8, 1));
  const tokens = claimTokens(3, 5);
  assert.ok(tokens.length >= MIN_DOC_TOKENS && tokens.length <= MAX_DOC_TOKENS);
  assert.equal(new Set(tokens).size, tokens.length, "tokens must be distinct");
  // Every token of a claim belongs to that claim's topic, and only to it.
  assert.ok(tokens.every((token) => token.startsWith(`t${String(3 % TOPICS).padStart(3, "0")}w`)));
  assert.equal(
    claimTokens(3, 5).filter((token) => claimTokens(4, 5).includes(token)).length,
    0,
    "different topics must not share a token",
  );
  // Topic membership is a prefix-stable function of the index alone.
  assert.equal(
    claimTokens(3 + TOPICS, 5)[0].slice(0, 4),
    claimTokens(3, 5)[0].slice(0, 4),
  );

  // A query is a strict prefix subset of exactly its own gold document.
  const query = queryText(11, 5).split(" ");
  assert.equal(query.length, QUERY_TOKENS);
  assert.ok(query.every((token) => claimTokens(11, 5).includes(token)));

  // Gold indices stay inside the smallest decade so the query set is fixed.
  const golds = goldIndices(100, 1_000);
  assert.equal(golds.length, 100);
  assert.equal(new Set(golds).size, 100);
  assert.ok(golds.every((index) => index < 1_000));

  // Percentiles: nearest-rank, so p50 of 1..100 is 50 and p99 is 99.
  const stats = summarize(Array.from({ length: 100 }, (_, i) => i + 1));
  assert.equal(stats.p50, 50);
  assert.equal(stats.p95, 95);
  assert.equal(stats.p99, 99);
  assert.equal(summarize([]).p95, 0);

  // Ceiling: the level before the first sub-threshold gain, or null. The field
  // name is the one the sweep record actually writes; reading a name the sweep
  // does not write silently reported "no ceiling" for a whole run once.
  const sweepShape = [
    { concurrency: 1, requests: 1, failures: 0, throughput_rps: 100 },
    { concurrency: 8, requests: 1, failures: 0, throughput_rps: 700 },
    { concurrency: 32, requests: 1, failures: 0, throughput_rps: 720 },
    { concurrency: 64, requests: 1, failures: 0, throughput_rps: 700 },
  ];
  assert.equal(findCeiling(sweepShape), 8);
  assert.equal(findCeiling([
    { concurrency: 1, throughput_rps: 100 },
    { concurrency: 8, throughput_rps: 800 },
    { concurrency: 32, throughput_rps: 3200 },
  ]), null);
  assert.throws(() => findCeiling([
    { concurrency: 1, throughput_rps: 100 },
    { concurrency: 8, throughput_rps: Number.NaN },
  ]));

  // Error codes carry a path and a status, never a message or a query value.
  assert.equal(
    errorCode(new HttpFailure("POST", "/v1/context/compile?x=1", 503)),
    "HTTP_POST__v1_context_compile_503",
  );

  // Redaction refuses, it does not warn.
  assert.throws(() => assertRedacted("a tk_live_secret b", ["tk_live_secret"]));
  assertRedacted("ids and counts only", ["tk_live_secret"]);

  // The FTS rebuild the storage phase times must exist in the shipped schema.
  const rebuild = MIGRATIONS.find((migration) => migration.version === 11);
  assert.ok(rebuild && rebuild.statements.some((sql) => sql.includes("claims_fts")));

  // The child can never inherit a provider variable.
  process.env.TITEN_EMBED_BASE_URL = "http://example.invalid";
  process.env.TITEN_EXTRACT_MODEL = "unused";
  const env = childEnv();
  assert.equal(env.TITEN_EMBED_BASE_URL, undefined);
  assert.equal(env.TITEN_EXTRACT_MODEL, undefined);
  assert.equal(env.TITEN_MAINTENANCE_INTERVAL_MS, "0");
  delete process.env.TITEN_EMBED_BASE_URL;
  delete process.env.TITEN_EXTRACT_MODEL;

  console.log("self-test ok");
}

if (process.argv.includes("--self-test")) selfTest();
else if (process.argv.includes("--help")) console.log(`
  bun scripts/benchmark-scale.ts --out DIR
    [--decades 1000,10000,100000] [--concurrency 1,8,32,64]
    [--queries 100] [--seed 20260804] [--ingest-concurrency 8]
    [--sweep-requests 2000]
  bun scripts/benchmark-scale.ts --self-test
`);
else await main();
