#!/usr/bin/env bun
/**
 * Cycle-1, side-by-side retrieval benchmark for Titen 0.3.0 and self-hosted Mem0.
 *
 * Required environment:
 *   TITEN_URL=http://127.0.0.1:18787 TITEN_KEY=... \
 *   MEM0_URL=http://127.0.0.1:18888 MEM0_KEY=... \
 *   bun scripts/benchmark-mem0-replacement.ts --out /safe/result/path
 *
 * The output contains fixture IDs and aggregate scores, never credentials,
 * memory text, queries, provider responses, or embeddings.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { arch, cpus, freemem, hostname, loadavg, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE = {
  package: "titen-memory@0.3.0",
  npm_integrity: "sha512-R49HwOllKtfn3psuNz4WBW0vVrqJteuGwjatH25djqh4RA5hqbyM5hbd+nlNFtkvlkhuAMmiXrARFodp/wTR/w==",
  npm_shasum: "568d56175257f515ee3c79c7672d62bc39c07dda",
  git_commit: "9f10bfd625ba947897056f1dbc0ab7bfc4ce6304",
} as const;
const FIXTURE_VERSION = "titen-mem0-cycle1-v1";
const RAW_SCHEMA_VERSION = 1;
const TOP_K = 10;
const REQUEST_TIMEOUT_MS = 120_000;

type Product = "titen" | "mem0";
type ClaimKind = "semantic_fact" | "preference" | "procedural" | "decision";
type Fact = { id: string; statement: string; kind: ClaimKind };
type QueryCase = {
  id: string;
  language: "id" | "en" | "jv-id";
  category: "exact" | "paraphrase" | "temporal" | "hard_negative" | "no_result";
  query: string;
  relevant: string[];
};

const FACTS: Fact[] = [
  { id: "fact_incident_code", statement: "Kode insiden pembayaran adalah PAY-7842.", kind: "semantic_fact" },
  {
    id: "fact_rollback_rehearsal",
    statement: "Tim harus melatih pembatalan rilis sebelum pelanggan menerima perubahan.",
    kind: "procedural",
  },
  { id: "fact_atlas_retention", statement: "The Atlas export retention period is 21 days.", kind: "semantic_fact" },
  { id: "fact_mira_timezone", statement: "Mira prefers all calendar times in UTC.", kind: "preference" },
  { id: "fact_raka_meeting", statement: "Raka luwih seneng rapat esuk jam sanga.", kind: "preference" },
  {
    id: "fact_active_endpoint",
    statement: "Mulai Juli 2026, endpoint aktif adalah api-v3.internal.",
    kind: "decision",
  },
  {
    id: "fact_orion_requirement",
    statement: "Prosedur rilis Orion memerlukan smoke rollback sebelum aktivasi.",
    kind: "procedural",
  },
  {
    id: "fact_orion_decoy",
    statement: "Dokumen smoke rollback Orion diarsipkan setelah rapat.",
    kind: "semantic_fact",
  },
];

const CASES: QueryCase[] = [
  {
    id: "id_exact_identifier",
    language: "id",
    category: "exact",
    query: "Apa kode insiden pembayaran?",
    relevant: ["fact_incident_code"],
  },
  {
    id: "id_semantic_rollback",
    language: "id",
    category: "paraphrase",
    query: "Bagaimana prosedur aman untuk membalik deployment sebelum pengguna terdampak?",
    relevant: ["fact_rollback_rehearsal"],
  },
  {
    id: "en_exact_retention",
    language: "en",
    category: "exact",
    query: "How many days is the Atlas export retention period?",
    relevant: ["fact_atlas_retention"],
  },
  {
    id: "en_semantic_timezone",
    language: "en",
    category: "paraphrase",
    query: "Which timezone should we use when scheduling for Mira?",
    relevant: ["fact_mira_timezone"],
  },
  {
    id: "jv_in_id_preference",
    language: "jv-id",
    category: "paraphrase",
    query: "Raka memilih rapat pagi jam berapa?",
    relevant: ["fact_raka_meeting"],
  },
  {
    id: "id_temporal_endpoint",
    language: "id",
    category: "temporal",
    query: "Endpoint mana yang aktif sejak Juli 2026?",
    relevant: ["fact_active_endpoint"],
  },
  {
    id: "id_hard_negative_orion",
    language: "id",
    category: "hard_negative",
    query: "Apa syarat sebelum aktivasi rilis Orion?",
    relevant: ["fact_orion_requirement"],
  },
  {
    id: "id_no_result_passport",
    language: "id",
    category: "no_result",
    query: "Berapa nomor paspor Nadia?",
    relevant: [],
  },
];

interface Options {
  out: string;
  repeats: number;
  seed: number;
  concurrency: number;
  nativeMem0: boolean;
}

interface RetrievalMetrics {
  recall_at_1: number | null;
  recall_at_5: number | null;
  mrr_at_10: number | null;
  ndcg_at_10: number | null;
  no_result_false_positive: number | null;
}

interface RetrievalTrial {
  schema_version: number;
  lane: "controlled_retrieval";
  run_id: string;
  fixture_version: string;
  sequence: number;
  pair_id: string;
  repetition: number;
  case_id: string;
  language: QueryCase["language"];
  category: QueryCase["category"];
  product: Product;
  order: "AB" | "BA";
  order_position: 1 | 2;
  status: "ok" | "error";
  error_code: string | null;
  latency_ms: number;
  ranked_fixture_ids: string[];
  unknown_result_count: number;
  metrics: RetrievalMetrics;
}

interface NativeRecord {
  schema_version: number;
  lane: "native_memory_management";
  run_id: string;
  fixture_version: string;
  product: Product;
  status: "unsupported" | "not_run" | "ok" | "error";
  pass: boolean;
  reason_code: string;
  created_count?: number;
  search_hit_count?: number;
  add_latency_ms?: number;
  search_latency_ms?: number;
}

class HttpFailure extends Error {
  code: string;

  constructor(method: string, path: string, status: number | "INVALID_JSON" | "TIMEOUT") {
    super("HTTP request failed");
    this.name = "HttpFailure";
    this.code = `HTTP_${method}_${path.split("?")[0]!.replaceAll("/", "_")}_${status}`;
  }
}

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const round = (value: number) => Number(value.toFixed(3));
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const asObject = (value: unknown) => (isObject(value) ? value : {});
const asArray = (value: unknown) => (Array.isArray(value) ? value : []);
const stringField = (value: unknown, field: string) => {
  const candidate = asObject(value)[field];
  return typeof candidate === "string" ? candidate : "";
};

function safeError(error: unknown): string {
  if (error instanceof HttpFailure) return error.code;
  if (error instanceof DOMException && error.name === "TimeoutError") return "HTTP_TIMEOUT";
  if (error instanceof Error) return `LOCAL_${error.name.replaceAll(/[^A-Za-z0-9_]/g, "_")}`;
  return "LOCAL_UNKNOWN";
}

function parseArgs(argv: string[]): Options | "self-test" | "help" {
  let out = "";
  let repeats = 10;
  let seed = 20_260_731;
  let concurrency = 1;
  let nativeMem0 = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--self-test") return "self-test";
    if (arg === "--help" || arg === "-h") return "help";
    if (arg === "--native-mem0") {
      nativeMem0 = true;
      continue;
    }
    if (arg === "--out" || arg === "--repeats" || arg === "--seed" || arg === "--concurrency") {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${arg}`);
      if (arg === "--out") out = resolve(value);
      if (arg === "--repeats") repeats = Number(value);
      if (arg === "--seed") seed = Number(value);
      if (arg === "--concurrency") concurrency = Number(value);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(repeats) || repeats < 10) throw new Error("--repeats must be an integer >= 10");
  if (!Number.isSafeInteger(seed)) throw new Error("--seed must be a safe integer");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32)
    throw new Error("--concurrency must be a safe integer between 1 and 32");
  if (!out) {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    out = resolve("benchmark-results", `${FIXTURE_VERSION}-${timestamp}`);
  }
  return { out, repeats, seed, concurrency, nativeMem0 };
}

function usage() {
  return [
    "Usage:",
    "  bun scripts/benchmark-mem0-replacement.ts --out DIR [--repeats 10] [--seed 20260731] [--concurrency 1] [--native-mem0]",
    "  bun scripts/benchmark-mem0-replacement.ts --self-test",
  ].join("\n");
}

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function buildPlan(repeats: number, seed: number) {
  const random = rng(seed);
  const jobs = Array.from({ length: repeats }, (_, repetition) =>
    CASES.map((testCase) => ({ repetition, testCase })),
  ).flat();
  for (let index = jobs.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [jobs[index], jobs[other]] = [jobs[other]!, jobs[index]!];
  }
  return jobs.map((job, index) => ({
    ...job,
    order: ((index + (seed & 1)) % 2 === 0 ? ["titen", "mem0"] : ["mem0", "titen"]) as Product[],
  }));
}

async function mapBounded<T, U>(values: readonly T[], concurrency: number, task: (value: T, index: number) => Promise<U>) {
  const results = new Array<U>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await task(values[index]!, index);
    }
  }));
  return results;
}

function score(ranked: string[], relevant: string[]): RetrievalMetrics {
  if (relevant.length === 0) {
    return {
      recall_at_1: null,
      recall_at_5: null,
      mrr_at_10: null,
      ndcg_at_10: null,
      no_result_false_positive: ranked.length > 0 ? 1 : 0,
    };
  }
  const gold = new Set(relevant);
  const recallAt = (limit: number) =>
    new Set(ranked.slice(0, limit).filter((id) => gold.has(id))).size / gold.size;
  const first = ranked.slice(0, 10).findIndex((id) => gold.has(id));
  const dcg = ranked.slice(0, 10).reduce(
    (total, id, index) => total + (gold.has(id) ? 1 / Math.log2(index + 2) : 0),
    0,
  );
  const ideal = Array.from({ length: Math.min(gold.size, 10) }, (_, index) => 1 / Math.log2(index + 2))
    .reduce((total, value) => total + value, 0);
  return {
    recall_at_1: recallAt(1),
    recall_at_5: recallAt(5),
    mrr_at_10: first < 0 ? 0 : 1 / (first + 1),
    ndcg_at_10: ideal === 0 ? 0 : dcg / ideal,
    no_result_false_positive: null,
  };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

function mean(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function meanCi95(values: number[]) {
  const average = mean(values);
  if (values.length < 2) return { mean: round(average), low: round(average), high: round(average) };
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  const margin = 1.96 * Math.sqrt(variance / values.length);
  return { mean: round(average), low: round(average - margin), high: round(average + margin) };
}

function latencySummary(values: number[]) {
  return {
    count: values.length,
    p50_ms: round(percentile(values, 0.5)),
    p95_ms: round(percentile(values, 0.95)),
    p99_ms: round(percentile(values, 0.99)),
    mean_ci95_ms: meanCi95(values),
  };
}

async function requestJson(
  base: string,
  headers: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "manual",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError")
      throw new HttpFailure(method, path, "TIMEOUT");
    throw error;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpFailure(method, path, response.status);
  }
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpFailure(method, path, "INVALID_JSON");
  }
}

function unwrapData(value: unknown) {
  const root = asObject(value);
  return root.data ?? value;
}

function resultArray(value: unknown): unknown[] {
  const root = asObject(value);
  const data = asObject(root.data);
  if (Array.isArray(root.results)) return root.results;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(root.data)) return root.data;
  return Array.isArray(value) ? value : [];
}

function mapRanked(results: unknown[], idMap: Map<string, string>) {
  let unknown = 0;
  const ranked: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of results.entries()) {
    const id = stringField(entry, "id") || stringField(entry, "claim_id");
    const fixtureId = idMap.get(id) ?? `unknown_${sha256(id || `missing-${index}`).slice(0, 12)}`;
    if (!idMap.has(id)) unknown += 1;
    if (!seen.has(fixtureId)) ranked.push(fixtureId);
    seen.add(fixtureId);
  }
  return { ranked, unknown };
}

function hostSnapshot() {
  const cpuList = cpus();
  return {
    hostname_sha256: sha256(hostname()),
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu_count: cpuList.length,
    cpu_model_sha256: sha256(cpuList[0]?.model ?? "unknown"),
    load_average: loadavg().map(round),
    total_memory_bytes: totalmem(),
    free_memory_bytes: freemem(),
    runner_rss_bytes: process.memoryUsage().rss,
  };
}

function aggregate(trials: RetrievalTrial[], product: Product) {
  const selected = trials.filter((trial) => trial.product === product);
  const successful = selected.filter((trial) => trial.status === "ok");
  const positive = successful.filter((trial) => trial.metrics.recall_at_1 !== null);
  const empty = successful.filter((trial) => trial.metrics.no_result_false_positive !== null);
  const average = (field: keyof RetrievalMetrics, source = positive) =>
    mean(source.map((trial) => trial.metrics[field]).filter((value): value is number => value !== null));
  const group = (field: "language" | "category") => Object.fromEntries(
    [...new Set(successful.map((trial) => trial[field]))].sort().map((name) => {
      const rows = successful.filter((trial) => trial[field] === name);
      const positives = rows.filter((trial) => trial.metrics.recall_at_1 !== null);
      const noResult = rows.filter((trial) => trial.metrics.no_result_false_positive !== null);
      return [name, {
        samples: rows.length,
        recall_at_1: positives.length === 0 ? null : round(mean(positives.map((trial) => trial.metrics.recall_at_1!))),
        recall_at_5: positives.length === 0 ? null : round(mean(positives.map((trial) => trial.metrics.recall_at_5!))),
        mrr_at_10: positives.length === 0 ? null : round(mean(positives.map((trial) => trial.metrics.mrr_at_10!))),
        ndcg_at_10: positives.length === 0 ? null : round(mean(positives.map((trial) => trial.metrics.ndcg_at_10!))),
        no_result_false_positive_rate: noResult.length === 0
          ? null
          : round(mean(noResult.map((trial) => trial.metrics.no_result_false_positive!))),
      }];
    }),
  );
  return {
    samples: selected.length,
    successful_samples: successful.length,
    search_errors: selected.length - successful.length,
    latency: latencySummary(successful.map((trial) => trial.latency_ms)),
    quality: {
      recall_at_1: round(average("recall_at_1")),
      recall_at_5: round(average("recall_at_5")),
      mrr_at_10: round(average("mrr_at_10")),
      ndcg_at_10: round(average("ndcg_at_10")),
      no_result_false_positive_rate: round(average("no_result_false_positive", empty)),
    },
    by_language: group("language"),
    by_category: group("category"),
  };
}

function pairedLatency(trials: RetrievalTrial[]) {
  const pairs = new Map<string, Partial<Record<Product, RetrievalTrial>>>();
  for (const trial of trials) {
    const pair = pairs.get(trial.pair_id) ?? {};
    pair[trial.product] = trial;
    pairs.set(trial.pair_id, pair);
  }
  const deltas = [...pairs.values()]
    .filter((pair) => pair.titen?.status === "ok" && pair.mem0?.status === "ok")
    .map((pair) => pair.titen!.latency_ms - pair.mem0!.latency_ms);
  return { count: deltas.length, titen_minus_mem0_ms: meanCi95(deltas) };
}

function assertArtifactSafe(text: string, secrets: string[]) {
  for (const secret of secrets)
    if (secret && text.includes(secret)) throw new Error("Artifact secret redaction check failed");
  for (const fact of FACTS)
    if (text.includes(fact.statement)) throw new Error("Artifact memory-content redaction check failed");
  for (const testCase of CASES)
    if (text.includes(testCase.query)) throw new Error("Artifact query redaction check failed");
}

function prepareOut(directory: string) {
  if (existsSync(directory) && readdirSync(directory).length > 0)
    throw new Error("Output directory must be absent or empty");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeArtifacts(
  directory: string,
  raw: (RetrievalTrial | NativeRecord)[],
  manifest: unknown,
  summary: any,
  secrets: string[],
) {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const titen = summary.products.titen;
  const mem0 = summary.products.mem0;
  const report = [
    `# Titen 0.3.0 versus Mem0 — ${FIXTURE_VERSION}`,
    "",
    `Run: \`${summary.run_id}\``,
    `Verdict: **${summary.verdict}**`,
    "",
    "## Controlled retrieval",
    "",
    "| Product | Recall@1 | Recall@5 | MRR@10 | nDCG@10 | No-result FP | p50 | p95 | p99 | Errors |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    `| Titen | ${pct(titen.quality.recall_at_1)} | ${pct(titen.quality.recall_at_5)} | ${titen.quality.mrr_at_10.toFixed(3)} | ${titen.quality.ndcg_at_10.toFixed(3)} | ${pct(titen.quality.no_result_false_positive_rate)} | ${titen.latency.p50_ms} ms | ${titen.latency.p95_ms} ms | ${titen.latency.p99_ms} ms | ${titen.search_errors} |`,
    `| Mem0 | ${pct(mem0.quality.recall_at_1)} | ${pct(mem0.quality.recall_at_5)} | ${mem0.quality.mrr_at_10.toFixed(3)} | ${mem0.quality.ndcg_at_10.toFixed(3)} | ${pct(mem0.quality.no_result_false_positive_rate)} | ${mem0.latency.p50_ms} ms | ${mem0.latency.p95_ms} ms | ${mem0.latency.p99_ms} ms | ${mem0.search_errors} |`,
    "",
    "## Native memory management",
    "",
    `- Titen: ${summary.native_memory_management.titen.status} (${summary.native_memory_management.titen.reason_code})`,
    `- Mem0: ${summary.native_memory_management.mem0.status} (${summary.native_memory_management.mem0.reason_code})`,
    "",
    "## Replacement gate",
    "",
    ...summary.blockers.map((blocker: string) => `- ${blocker}`),
    "",
    "This cycle measures controlled retrieval only. Safety, recovery, migration, service resource, and sustained-soak gates remain separate evidence.",
    "",
  ].join("\n");
  const files: Record<string, string> = {
    "raw.jsonl": `${raw.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "summary.json": `${JSON.stringify(summary, null, 2)}\n`,
    "report.md": report,
  };
  for (const text of Object.values(files)) assertArtifactSafe(text, secrets);
  for (const [name, text] of Object.entries(files))
    writeFileSync(resolve(directory, name), text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const checksums = Object.entries(files)
    .map(([name, text]) => `${sha256(text)}  ${name}`)
    .sort()
    .join("\n") + "\n";
  assertArtifactSafe(checksums, secrets);
  writeFileSync(resolve(directory, "SHA256SUMS"), checksums, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

async function run(options: Options) {
  const titenUrl = (process.env.TITEN_URL ?? "").replace(/\/+$/, "");
  const titenKey = process.env.TITEN_KEY ?? "";
  const mem0Url = (process.env.MEM0_URL ?? "").replace(/\/+$/, "");
  const mem0Key = process.env.MEM0_KEY ?? "";
  if (!titenUrl || !titenKey || !mem0Url || !mem0Key)
    throw new Error("TITEN_URL, TITEN_KEY, MEM0_URL, and MEM0_KEY are required");
  for (const [label, value] of [["TITEN_URL", titenUrl], ["MEM0_URL", mem0Url]] as const) {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error(`${label} must be an HTTP(S) base URL without credentials, query, or fragment`);
  }

  prepareOut(options.out);
  const startedAt = new Date().toISOString();
  const startedHost = hostSnapshot();
  const namespace = `bench_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const titenHeaders = { "content-type": "application/json", authorization: `Bearer ${titenKey}` };
  const mem0Headers = { "content-type": "application/json", "x-api-key": mem0Key };
  const titen = (method: string, path: string, body?: unknown) =>
    requestJson(titenUrl, titenHeaders, method, path, body).then(unwrapData);
  const mem0 = (method: string, path: string, body?: unknown) =>
    requestJson(mem0Url, mem0Headers, method, path, body);
  const titenIdMap = new Map<string, string>();
  const mem0IdMap = new Map<string, string>();
  const mem0CreatedIds = new Set<string>();
  const retrievalTrials: RetrievalTrial[] = [];
  const nativeRecords: NativeRecord[] = [{
    schema_version: RAW_SCHEMA_VERSION,
    lane: "native_memory_management",
    run_id: namespace,
    fixture_version: FIXTURE_VERSION,
    product: "titen",
    status: "unsupported",
    pass: false,
    reason_code: "NO_AUTOMATIC_DERIVATION_OR_REFLECTION_RUNTIME_IN_0_3_0",
  }];
  const setupLatency: Record<string, number[]> = { titen_write: [], mem0_write: [] };
  let titenHealth: unknown = {};
  let titenReady: unknown = {};
  let mem0Info: unknown = {};
  let indexSetup = "not_attempted";
  const cleanup = { attempted: 0, deleted: 0, failures: [] as string[] };
  let fatalCode: string | null = null;

  try {
    titenHealth = await titen("GET", "/healthz");
    titenReady = await titen("GET", "/readyz");
    try {
      const openapi = asObject(await mem0("GET", "/openapi.json"));
      const info = asObject(openapi.info);
      mem0Info = { title: typeof info.title === "string" ? info.title : null, version: typeof info.version === "string" ? info.version : null };
    } catch (error) {
      mem0Info = { unavailable: safeError(error) };
    }

    for (const fact of FACTS) {
      let started = performance.now();
      const observation = asObject(await titen("POST", "/v1/observations", {
        subject_id: namespace,
        run_id: namespace,
        kind: "user_statement",
        content: fact.statement,
        source: { type: "benchmark", ref: `${FIXTURE_VERSION}:${fact.id}:${namespace}` },
        trust: "asserted",
      }));
      const observationId = stringField(observation, "observation_id");
      if (!observationId) throw new Error("Titen observation response omitted its ID");
      const consolidated = asObject(await titen("POST", "/v1/consolidations", {
        subject_id: namespace,
        claims: [{
          kind: fact.kind,
          statement: fact.statement,
          confidence: 1,
          sources: [{ observation_id: observationId, relation: "supports" }],
        }],
      }));
      if (consolidated.model_used !== false) throw new Error("Titen direct consolidation did not report model_used=false");
      const claim = asArray(consolidated.claims)[0];
      const claimId = stringField(claim, "claim_id");
      if (!claimId) throw new Error("Titen consolidation response omitted its claim ID");
      titenIdMap.set(claimId, fact.id);
      setupLatency.titen_write.push(round(performance.now() - started));

      started = performance.now();
      const added = await mem0("POST", "/memories", {
        messages: [{ role: "user", content: fact.statement }],
        user_id: namespace,
        infer: false,
        metadata: { benchmark: FIXTURE_VERSION, run_id: namespace, fixture_id: fact.id },
      });
      const ids = resultArray(added).map((entry) => stringField(entry, "id")).filter(Boolean);
      if (ids.length === 0) throw new Error("Mem0 infer=false response omitted created IDs");
      for (const id of ids) {
        mem0CreatedIds.add(id);
        mem0IdMap.set(id, fact.id);
      }
      setupLatency.mem0_write.push(round(performance.now() - started));
    }

    try {
      await titen("POST", "/v1/index/drain?limit=100");
      indexSetup = "explicit_drain_succeeded";
    } catch (error) {
      indexSetup = `automatic_maintenance_wait_after_${safeError(error)}`;
      await sleep(5_000);
    }

    const plan = buildPlan(options.repeats, options.seed);
    const search = async (product: Product, testCase: QueryCase) => {
      if (product === "titen") {
        const response = asObject(await titen("POST", "/v1/context/compile", {
          subject_id: namespace,
          task: testCase.query,
          max_tokens: 32_000,
        }));
        return mapRanked(asArray(response.items), titenIdMap);
      }
      const response = await mem0("POST", "/search", {
        query: testCase.query,
        filters: { user_id: namespace },
        top_k: TOP_K,
        threshold: 0,
        explain: true,
      });
      return mapRanked(resultArray(response), mem0IdMap);
    };

    // One unmeasured warmup per product uses the first planned query.
    for (const product of plan[0]!.order) await search(product, plan[0]!.testCase);

    const pairs = await mapBounded(plan, options.concurrency, async (job, jobIndex) => {
      const trials: RetrievalTrial[] = [];
      const orderName = job.order[0] === "titen" ? "AB" : "BA";
      for (const [position, product] of job.order.entries()) {
        const started = performance.now();
        let ranked: string[] = [];
        let unknown = 0;
        let status: RetrievalTrial["status"] = "ok";
        let errorCode: string | null = null;
        try {
          ({ ranked, unknown } = await search(product, job.testCase));
        } catch (error) {
          status = "error";
          errorCode = safeError(error);
        }
        trials.push({
          schema_version: RAW_SCHEMA_VERSION,
          lane: "controlled_retrieval",
          run_id: namespace,
          fixture_version: FIXTURE_VERSION,
          sequence: jobIndex * 2 + position,
          pair_id: `${job.repetition}:${job.testCase.id}`,
          repetition: job.repetition,
          case_id: job.testCase.id,
          language: job.testCase.language,
          category: job.testCase.category,
          product,
          order: orderName,
          order_position: (position + 1) as 1 | 2,
          status,
          error_code: errorCode,
          latency_ms: round(performance.now() - started),
          ranked_fixture_ids: ranked,
          unknown_result_count: unknown,
          metrics: status === "ok" ? score(ranked, job.testCase.relevant) : score([], job.testCase.relevant),
        });
      }
      return trials;
    });
    retrievalTrials.push(...pairs.flat());

    if (!options.nativeMem0) {
      nativeRecords.push({
        schema_version: RAW_SCHEMA_VERSION,
        lane: "native_memory_management",
        run_id: namespace,
        fixture_version: FIXTURE_VERSION,
        product: "mem0",
        status: "not_run",
        pass: false,
        reason_code: "OPTIONAL_INFER_TRUE_PROBE_NOT_REQUESTED",
      });
    } else {
      const nativeUser = `${namespace}_native`;
      const expectedToken = `NATIVE-${namespace.slice(-8).toUpperCase()}`;
      let addLatency = 0;
      let searchLatency = 0;
      try {
        let started = performance.now();
        const added = await mem0("POST", "/memories", {
          messages: [
            { role: "user", content: `Please remember that my synthetic recovery code is ${expectedToken}.` },
            { role: "assistant", content: "Understood; I will remember that synthetic recovery code." },
          ],
          user_id: nativeUser,
          infer: true,
          metadata: { benchmark: FIXTURE_VERSION, run_id: namespace, lane: "native_memory_management" },
        });
        addLatency = round(performance.now() - started);
        const created = resultArray(added)
          .filter((entry) => {
            const event = stringField(entry, "event").toUpperCase();
            return !event || event === "ADD";
          })
          .map((entry) => stringField(entry, "id"))
          .filter(Boolean);
        for (const id of created) mem0CreatedIds.add(id);
        started = performance.now();
        const found = resultArray(await mem0("POST", "/search", {
          query: "What is the synthetic recovery code?",
          filters: { user_id: nativeUser },
          top_k: 5,
          threshold: 0,
          explain: true,
        }));
        searchLatency = round(performance.now() - started);
        const createdSet = new Set(created);
        const hits = found.filter((entry) => createdSet.has(stringField(entry, "id"))).length;
        nativeRecords.push({
          schema_version: RAW_SCHEMA_VERSION,
          lane: "native_memory_management",
          run_id: namespace,
          fixture_version: FIXTURE_VERSION,
          product: "mem0",
          status: "ok",
          pass: created.length > 0 && hits > 0,
          reason_code: created.length > 0 && hits > 0 ? "INFER_TRUE_CREATED_AND_RETRIEVED_MEMORY" : "INFER_TRUE_DID_NOT_CREATE_AND_RETRIEVE_MEMORY",
          created_count: created.length,
          search_hit_count: hits,
          add_latency_ms: addLatency,
          search_latency_ms: searchLatency,
        });
      } catch (error) {
        nativeRecords.push({
          schema_version: RAW_SCHEMA_VERSION,
          lane: "native_memory_management",
          run_id: namespace,
          fixture_version: FIXTURE_VERSION,
          product: "mem0",
          status: "error",
          pass: false,
          reason_code: safeError(error),
          add_latency_ms: addLatency,
          search_latency_ms: searchLatency,
        });
      }
    }
  } catch (error) {
    fatalCode = safeError(error);
  } finally {
    for (const id of mem0CreatedIds) {
      cleanup.attempted += 1;
      try {
        await mem0("DELETE", `/memories/${encodeURIComponent(id)}`);
        cleanup.deleted += 1;
      } catch (error) {
        cleanup.failures.push(safeError(error));
      }
    }
  }

  const products = {
    titen: aggregate(retrievalTrials, "titen"),
    mem0: aggregate(retrievalTrials, "mem0"),
  };
  const native = Object.fromEntries(nativeRecords.map((record) => [record.product, record])) as Record<Product, NativeRecord>;
  if (!native.mem0) {
    native.mem0 = {
      schema_version: RAW_SCHEMA_VERSION,
      lane: "native_memory_management",
      run_id: namespace,
      fixture_version: FIXTURE_VERSION,
      product: "mem0",
      status: "not_run",
      pass: false,
      reason_code: fatalCode ? "BENCHMARK_ABORTED_BEFORE_NATIVE_PROBE" : "OPTIONAL_INFER_TRUE_PROBE_NOT_REQUESTED",
    };
    nativeRecords.push(native.mem0);
  }
  const blockers = [
    "Titen 0.3.0 has no automatic derivation/reflection runtime.",
    "Embedding revision equivalence requires separate deployment evidence because neither search API proves it.",
    "This runner does not prove isolation, recovery, migration, service-resource, or sustained-soak gates.",
    ...(fatalCode ? [`Benchmark run failed: ${fatalCode}.`] : []),
    ...(cleanup.failures.length > 0 ? ["One or more runner-created Mem0 memories could not be deleted."] : []),
    ...(products.titen.search_errors + products.mem0.search_errors > 0 ? ["One or more controlled searches failed."] : []),
  ];
  const summary = {
    schema_version: RAW_SCHEMA_VERSION,
    run_id: namespace,
    fixture_version: FIXTURE_VERSION,
    status: fatalCode ? "failed" : "completed",
    verdict: "BLOCKED_NOT_READY_TO_REPLACE_MEM0",
    products,
    paired_latency: pairedLatency(retrievalTrials),
    native_memory_management: native,
    blockers,
  };
  const ready = asObject(titenReady);
  const health = asObject(titenHealth);
  const readySchema = asObject(ready.schema);
  const readyCapabilities = asObject(ready.capabilities);
  const fixtureHash = sha256(JSON.stringify({ facts: FACTS, cases: CASES }));
  const runnerPath = fileURLToPath(import.meta.url);
  const manifest = {
    schema_version: RAW_SCHEMA_VERSION,
    run_id: namespace,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    release: RELEASE,
    fixture: {
      version: FIXTURE_VERSION,
      sha256: fixtureHash,
      fact_count: FACTS.length,
      query_count: CASES.length,
      emitted_fields: CASES.map(({ id, language, category, relevant }) => ({ id, language, category, relevant })),
    },
    runner: {
      sha256: sha256(readFileSync(runnerPath)),
      bun: process.versions.bun ?? null,
      node: process.versions.node,
    },
    configuration: {
      repeats: options.repeats,
      seed: options.seed,
      top_k: TOP_K,
      concurrency: options.concurrency,
      warmup_pairs: 1,
      order: "seeded balanced AB/BA",
      native_mem0_probe: options.nativeMem0,
      endpoint_fingerprints: { titen: sha256(titenUrl), mem0: sha256(mem0Url) },
      fingerprint_sha256: sha256(JSON.stringify({ release: RELEASE, fixtureHash, repeats: options.repeats, seed: options.seed, concurrency: options.concurrency, topK: TOP_K, titen: sha256(titenUrl), mem0: sha256(mem0Url) })),
    },
    services: {
      titen: {
        runtime: typeof health.runtime === "string" ? health.runtime : null,
        revision: typeof health.revision === "string" ? health.revision : null,
        ready: typeof ready.ready === "boolean" ? ready.ready : null,
        schema: {
          applied: typeof readySchema.applied === "number" ? readySchema.applied : null,
          expected: typeof readySchema.expected === "number" ? readySchema.expected : null,
          verified: typeof readySchema.verified === "boolean" ? readySchema.verified : null,
        },
        capabilities: {
          fts: readyCapabilities.fts ?? null,
          vector: readyCapabilities.vector ?? null,
          model: readyCapabilities.model ?? null,
        },
        index_setup: indexSetup,
      },
      mem0: mem0Info,
    },
    setup_latency: {
      titen_write: latencySummary(setupLatency.titen_write),
      mem0_write: latencySummary(setupLatency.mem0_write),
    },
    cleanup,
    host: { start: startedHost, end: hostSnapshot() },
    uncollected_gates: ["service_cpu", "service_rss", "storage_growth", "restart_restore", "scope_isolation", "migration", "sustained_soak"],
  };
  writeArtifacts(options.out, [...retrievalTrials, ...nativeRecords], manifest, summary, [titenKey, mem0Key]);
  console.log(`benchmark=${summary.status} verdict=${summary.verdict}`);
  console.log(`results=${options.out}`);
  if (fatalCode) throw new Error(`Benchmark failed with ${fatalCode}; artifacts were retained`);
}

async function selfTest() {
  const ranked = score(["decoy", "gold"], ["gold"]);
  assert.equal(ranked.recall_at_1, 0);
  assert.equal(ranked.recall_at_5, 1);
  assert.equal(ranked.mrr_at_10, 0.5);
  assert.equal(round(ranked.ndcg_at_10!), round(1 / Math.log2(3)));
  assert.equal(score([], []).no_result_false_positive, 0);
  assert.equal(score(["unknown"], []).no_result_false_positive, 1);
  assert.equal(percentile([4, 1, 2, 3], 0.5), 2);
  assert.deepEqual(buildPlan(10, 42).map((job) => job.testCase.id), buildPlan(10, 42).map((job) => job.testCase.id));
  const orderCounts = buildPlan(10, 42).reduce((counts, job) => {
    counts[job.order[0] === "titen" ? 0 : 1] += 1;
    return counts;
  }, [0, 0]);
  assert.ok(Math.abs(orderCounts[0]! - orderCounts[1]!) <= 1);
  assert.deepEqual(resultArray({ results: [{ id: "one" }] }), [{ id: "one" }]);
  assert.throws(() => assertArtifactSafe("prefix secret suffix", ["secret"]));
  assert.equal((parseArgs(["--out", "result"]) as Options).concurrency, 1);
  assert.equal((parseArgs(["--out", "result", "--concurrency", "32"]) as Options).concurrency, 32);
  for (const invalid of ["0", "33", "1.5", "9007199254740992"])
    assert.throws(() => parseArgs(["--concurrency", invalid]));
  let active = 0;
  let peak = 0;
  const pooled = await mapBounded([0, 1, 2, 3, 4, 5], 3, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await sleep(1);
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(pooled, [0, 2, 4, 6, 8, 10]);
  assert.equal(peak, 3);
  console.log("benchmark-mem0-replacement self-test: ok");
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed === "help") console.log(usage());
else if (parsed === "self-test") await selfTest();
else await run(parsed);
