#!/usr/bin/env bun
/**
 * Release-bound retrieval harness: the Titen side of the head-to-head.
 *
 * Boots this repository's own Bun/SQLite runtime on a loopback port, ingests
 * `tests/fixtures/retrieval-h2h.json` through the shipped write path, runs every
 * fixture query through `POST /v1/context/compile`, and scores the ranked lists.
 * Run it on every release and publish the medians and the ranges, including the
 * losses.
 *
 * Environment, read only by the vector lane (`--fts-only` reads none):
 *   TITEN_EVAL_EMBED_BASE_URL  OpenAI-compatible embeddings origin
 *   TITEN_EVAL_EMBED_MODEL     embedding model identifier
 *   TITEN_EVAL_EMBED_DIMS      embedding dimensions, a positive integer
 *   TITEN_EVAL_EMBED_API_KEY   optional provider bearer token
 *   TITEN_EVAL_EMBED_PROFILE   optional embedding profile override
 * Source them from a mode-0600 profile. Nothing else is read from the
 * environment. The embedding profile is derived from the model name unless
 * TITEN_EVAL_EMBED_PROFILE names one explicitly; the core still validates it,
 * so the only way to embed raw text on a prefix-convention model is the
 * deliberate `raw-unit-v1-model-mismatch-acknowledged` profile, which a fair
 * head-to-head against a raw-text system needs and which is recorded in the
 * index fingerprint.
 *
 *   bun scripts/benchmark-retrieval-h2h.ts --out DIR [--repeats 5] [--warmup 2]
 *   bun scripts/benchmark-retrieval-h2h.ts --fts-only --out DIR
 *   bun scripts/benchmark-retrieval-h2h.ts --out DIR --compare other-system.json
 *   bun scripts/benchmark-retrieval-h2h.ts --self-test
 *
 * Artifacts contain fixture IDs, ranks, scores, metrics, latencies, counts and
 * hashes only. Credentials, endpoint URLs, statement text, query text, provider
 * response bodies and embeddings are never written or printed; failures are
 * recorded as an error class such as `HTTP_POST__v1_context_compile_503`, never
 * as a message. Every artifact is scanned for each generated API key, the
 * provider origin and key, and every fixture statement and query before it is
 * written, and the run aborts if any of them appears.
 *
 * Metrics: recall@1, recall@3, recall@10, MRR@10, nDCG@3, nDCG@10, and a
 * no-result correctness term. precision@k is deliberately absent. This fixture
 * has exactly one gold document per case, so precision@10 is pinned at 1/10
 * when the gold is retrieved and 0 when it is not: it restates recall@10 divided
 * by ten. It is arithmetic, not a measurement, and reporting it as a headline
 * would manufacture a metric that cannot disagree with another one.
 *
 * Every metric is reported as a median and the full across-repeat range over
 * `--repeats` independent runs (minimum 5), each with a fresh database, a fresh
 * server and a fresh subject namespace, and each preceded by `--warmup` untimed
 * queries (minimum 2) that are discarded before any timing. A single run is
 * never reported. When two runs are compared and the leader's across-repeat
 * range overlaps the runner-up's, the harness refuses to name a winner: this
 * fixture has 7 discriminating queries, so one rank flip moves MRR by about
 * 0.07 and an overlapping range is variance rather than a result.
 *
 * The competitor side is NOT vendored. Titen does not ship a rival's benchmark
 * runner, and a comparison whose two runners share an author is not a
 * comparison. To reproduce the external head-to-head, run the other system with
 * your own runner and emit this system-neutral result contract:
 *
 *   {"system": "...", "lane": "...", "corpus_size": 38,
 *    "fixture_content_sha256": "...",
 *    "repeats": [{"repeat": 1, "corpus_size": 38, "corpus_intact": true,
 *                 "queries": [{"case_id": "...", "status": "ok",
 *                              "latency_ms": 0, "ranked": ["fact_id"],
 *                              "scores": [0.0]}]}]}
 *
 * then pass it with `--compare`. The scorer here reads only those fields from
 * either side, so no system-specific signal can reach a metric. The fixture is
 * this repository's own corpus and its distractors were written after reading
 * Titen's ranker: it proves provenance, not neutrality. A neutral lane needs an
 * externally authored corpus (the 2026-08-04 run used Mr. TyDi Indonesian,
 * CC-BY-SA-3.0, one gold per query, passages clipped identically for both
 * systems), emitted into the same fixture schema and passed with `--fixture`
 * plus `--unpinned-fixture`. That corpus is not vendored here because its
 * licence and size do not belong in this package.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, cpus, hostname, platform, release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApiKey, organizationStatement } from "../src/core/auth";
import { newId } from "../src/core/ids";
import { migrate } from "../src/core/migrations";
import { LIMITS } from "../src/core/validate";
import { TITEN_VERSION } from "../src/core/version";
import { serve } from "../src/runtime/bun/server";
import { createSqliteDb, openDatabase } from "../src/runtime/bun/sqlite";

const HARNESS_VERSION = "titen-retrieval-h2h-v1";
const SCHEMA_VERSION = 1;
const DEFAULT_FIXTURE = "tests/fixtures/retrieval-h2h.json";
const ARCHIVED_SOURCE = "scripts/benchmark-mem0-replacement.ts";
/**
 * Fixture version to sha256 over the scored content only: fixture_version,
 * top_k, core_facts, distractor_facts, cases, ground_truth_variants. Prose in
 * the fixture may be edited; anything that can move a published number may not.
 */
const PINNED_FIXTURES: Record<string, string> = {
  "titen-057-h2h-v2": "d7e2785158e659aef5ae192e1f74d4a9d1b693f6ef9ffe84ee507bf13bed92a5",
};
const MIN_REPEATS = 5;
const MIN_WARMUP = 2;
const TOP_K = 10;
const REQUEST_TIMEOUT_MS = 120_000;
const DRAIN_BATCH = 100;
const MAX_DRAIN_ROUNDS = 200;
const PRIMARY_METRICS = ["recall_at_1", "recall_at_3", "mrr_at_10", "ndcg_at_3"] as const;
const CONTEXT_METRICS = ["recall_at_10", "ndcg_at_10"] as const;
const RANKED_METRICS = [...PRIMARY_METRICS, ...CONTEXT_METRICS] as const;
const ALL_METRICS = [...RANKED_METRICS, "no_result_correct"] as const;
const SCOPES = ["observations:write", "claims:write", "context:compile", "index:write"];

type MetricName = (typeof ALL_METRICS)[number];
type Metrics = Record<MetricName, number | null>;
type Variant = "strict" | "lenient";

interface Fact {
  id: string;
  statement: string;
  kind: string;
}

interface QueryCase {
  id: string;
  language: string;
  category: string;
  query: string;
  relevant: string[];
}

interface Fixture {
  fixture_version: string;
  provenance?: string;
  top_k?: number;
  core_facts: Fact[];
  distractor_facts: Fact[];
  cases: QueryCase[];
  ground_truth_variants?: Record<string, { overrides?: Record<string, string[]> }>;
  discriminating_queries?: { count?: number };
}

/** The system-neutral result contract. The scorer reads nothing else. */
interface QueryResult {
  case_id: string;
  status: string;
  latency_ms: number | null;
  ranked: string[];
  scores: number[];
}

interface RepeatResult {
  repeat: number;
  corpus_size: number | null;
  corpus_intact: boolean;
  queries: QueryResult[];
  ingest?: { total_ms?: number | null };
}

interface RunContract {
  system: string;
  lane: string;
  corpus_size?: number | null;
  fixture_content_sha256?: string;
  repeats: RepeatResult[];
}

interface Spread {
  median: number;
  min: number;
  max: number;
  mean: number;
  values: number[];
  n: number;
}

interface ScoredRow {
  case_id: string;
  language: string;
  language_group: string;
  category: string;
  status: "ok" | "error" | "missing";
  latency_ms: number | null;
  metrics: Metrics & { returned_at_k: number };
}

interface Options {
  fixture: string;
  unpinnedFixture: boolean;
  out: string;
  repeats: number;
  warmup: number;
  topK: number;
  threshold: number;
  variant: Variant;
  ftsOnly: boolean;
  compare: string[];
}

interface EmbedConfig {
  embedBaseUrl: string;
  embedModel: string;
  embedDims: number;
  embedRevision: string;
  embedProfile: string;
  embedMinCosine: number;
  embedApiKey?: string;
}

class HttpFailure extends Error {
  readonly code: string;

  constructor(method: string, path: string, status: number | string) {
    super("request failed");
    this.name = "HttpFailure";
    this.code = `HTTP_${method}_${path.split("?")[0]!.replaceAll("/", "_")}_${status}`;
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const round = (value: number, digits = 4) => Number(value.toFixed(digits));

/** Error classes only: a provider or validation message may quote a query. */
function errorCode(error: unknown): string {
  if (error instanceof HttpFailure) return error.code;
  if (error instanceof DOMException && error.name === "TimeoutError") return "HTTP_TIMEOUT";
  if (error instanceof Error) return `LOCAL_${error.name.replaceAll(/[^A-Za-z0-9_]/g, "_")}`;
  return "LOCAL_UNKNOWN";
}

function parseArgs(argv: string[]): Options | "self-test" | "help" {
  let fixture = "";
  let unpinnedFixture = false;
  let out = "";
  let repeats = MIN_REPEATS;
  let warmup = MIN_WARMUP;
  let topK = TOP_K;
  let threshold = 0;
  let variant: Variant = "strict";
  let ftsOnly = false;
  const compare: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--self-test") return "self-test";
    if (arg === "--help" || arg === "-h") return "help";
    if (arg === "--fts-only") {
      ftsOnly = true;
      continue;
    }
    if (arg === "--unpinned-fixture") {
      unpinnedFixture = true;
      continue;
    }
    const value = argv[++index];
    if (!value) throw new Error(`Missing value for ${arg}`);
    if (arg === "--fixture") fixture = resolve(value);
    else if (arg === "--out") out = resolve(value);
    else if (arg === "--compare") compare.push(resolve(value));
    else if (arg === "--repeats") repeats = Number(value);
    else if (arg === "--warmup") warmup = Number(value);
    else if (arg === "--top-k") topK = Number(value);
    else if (arg === "--threshold") threshold = Number(value);
    else if (arg === "--variant") {
      if (value !== "strict" && value !== "lenient")
        throw new Error("--variant must be strict or lenient");
      variant = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  // A single run is an anecdote and a cold first query is a warm-up, not a
  // sample. Both floors are the reason the published ranges were trustworthy.
  if (!Number.isSafeInteger(repeats) || repeats < MIN_REPEATS)
    throw new Error(`--repeats must be an integer >= ${MIN_REPEATS}`);
  if (!Number.isSafeInteger(warmup) || warmup < MIN_WARMUP)
    throw new Error(`--warmup must be an integer >= ${MIN_WARMUP}`);
  if (!Number.isSafeInteger(topK) || topK < 1 || topK > LIMITS.candidates)
    throw new Error(`--top-k must be an integer between 1 and ${LIMITS.candidates}`);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new Error("--threshold must be between 0 and 1");
  if (!fixture) fixture = resolve(import.meta.dir, "..", DEFAULT_FIXTURE);
  if (!out) {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    out = resolve("benchmark-results", `${HARNESS_VERSION}-${ftsOnly ? "fts" : "vec"}-${timestamp}`);
  }
  return { fixture, unpinnedFixture, out, repeats, warmup, topK, threshold, variant, ftsOnly, compare };
}

function usage() {
  return [
    "Usage:",
    "  bun scripts/benchmark-retrieval-h2h.ts --out DIR [--repeats 5] [--warmup 2] [--variant strict|lenient]",
    "  bun scripts/benchmark-retrieval-h2h.ts --fts-only --out DIR",
    "  bun scripts/benchmark-retrieval-h2h.ts --out DIR --compare other-system.json",
    "  bun scripts/benchmark-retrieval-h2h.ts --fixture NEUTRAL.json --unpinned-fixture --out DIR",
    "  bun scripts/benchmark-retrieval-h2h.ts --self-test",
  ].join("\n");
}

/** Exactly the fields that can move a number. Prose is excluded on purpose. */
function fixtureContentHash(fixture: Fixture) {
  return sha256(JSON.stringify({
    fixture_version: fixture.fixture_version,
    top_k: fixture.top_k,
    core_facts: fixture.core_facts,
    distractor_facts: fixture.distractor_facts,
    cases: fixture.cases,
    ground_truth_variants: fixture.ground_truth_variants,
  }));
}

function loadFixture(path: string, allowUnpinned: boolean) {
  const text = readFileSync(path, "utf8");
  const fixture = JSON.parse(text) as Fixture;
  const contentSha = fixtureContentHash(fixture);
  const pinned = PINNED_FIXTURES[fixture.fixture_version];
  if (pinned === undefined && !allowUnpinned)
    throw new Error(
      `Fixture version ${fixture.fixture_version} is not pinned; pass --unpinned-fixture to run it as unpublishable evidence`,
    );
  if (pinned !== undefined && pinned !== contentSha)
    throw new Error(
      `Fixture ${fixture.fixture_version} content sha256 ${contentSha} does not match the pinned ${pinned}; a published number cannot be reproduced from this file`,
    );
  return {
    fixture,
    contentSha,
    fileSha: sha256(text),
    pinned: pinned !== undefined,
  };
}

/** Structural invariants that hold for any fixture, neutral or not. */
function assertFixtureIntegrity(fixture: Fixture) {
  const facts = [...fixture.core_facts, ...fixture.distractor_facts];
  const ids = new Set(facts.map((fact) => fact.id));
  const distractors = new Set(fixture.distractor_facts.map((fact) => fact.id));
  const gold = new Set(fixture.cases.flatMap((entry) => entry.relevant));
  assert.equal(ids.size, facts.length, "duplicate fact id");
  assert.equal(new Set(facts.map((fact) => fact.statement)).size, facts.length, "duplicate statement");
  assert.equal(new Set(fixture.cases.map((entry) => entry.id)).size, fixture.cases.length, "duplicate case id");
  for (const id of gold) assert.ok(ids.has(id), `ground truth ${id} is not in the corpus`);
  for (const id of gold) assert.ok(!distractors.has(id), `distractor ${id} is used as ground truth`);
  for (const entry of fixture.cases)
    if (entry.category !== "no_result")
      assert.ok(entry.relevant.length > 0, `case ${entry.id} has no ground truth`);
  for (const [name, variant] of Object.entries(fixture.ground_truth_variants ?? {}))
    for (const [caseId, relevant] of Object.entries(variant.overrides ?? {})) {
      assert.ok(
        fixture.cases.some((entry) => entry.id === caseId),
        `variant ${name} overrides unknown case ${caseId}`,
      );
      for (const id of relevant) assert.ok(ids.has(id), `variant ${name} references unknown fact ${id}`);
    }
}

function groundTruth(fixture: Fixture, variant: Variant) {
  const relevant = new Map(fixture.cases.map((entry) => [entry.id, [...entry.relevant]]));
  for (const [caseId, ids] of Object.entries(fixture.ground_truth_variants?.[variant]?.overrides ?? {}))
    relevant.set(caseId, [...ids]);
  return relevant;
}

/**
 * English cases have near-parity analysers across systems. Indonesian and
 * Javanese ones do not: `src/core/retrieval.ts` ships an Indonesian
 * function-word stoplist covering exactly this fixture's question words, and a
 * system without one is not being measured on the same task. Never blend them.
 */
const langGroup = (language: string) => (language === "en" ? "en" : "id_jv");

function scoreCase(
  ranked: string[],
  scores: number[] | null,
  relevant: string[],
  status: string,
  k: number,
  threshold: number,
): Metrics & { returned_at_k: number } {
  if (scores && scores.length > 0 && scores.length !== ranked.length)
    throw new Error("ranked/scores length mismatch");
  const gated = scores && scores.length > 0
    ? ranked.filter((_, index) => typeof scores[index] === "number" && scores[index]! >= threshold)
    : ranked;
  const cut = gated.slice(0, k);
  const gold = new Set(relevant);
  const blank = Object.fromEntries(ALL_METRICS.map((metric) => [metric, null])) as Metrics;

  if (gold.size === 0) {
    // A crash returned nothing because it failed, which is not the same as
    // deciding to return nothing. Only a successful abstention counts.
    return { ...blank, returned_at_k: cut.length, no_result_correct: cut.length === 0 && status === "ok" ? 1 : 0 };
  }

  const hits: number[] = [];
  cut.forEach((id, index) => {
    if (gold.has(id)) hits.push(index);
  });
  const recallAt = (n: number) => new Set(hits.filter((i) => i < n).map((i) => cut[i]!)).size / gold.size;
  const ndcgAt = (n: number) => {
    const dcg = hits.filter((i) => i < n).reduce((sum, i) => sum + 1 / Math.log2(i + 2), 0);
    let ideal = 0;
    for (let i = 0; i < Math.min(gold.size, n); i += 1) ideal += 1 / Math.log2(i + 2);
    return ideal > 0 ? dcg / ideal : 0;
  };
  return {
    ...blank,
    returned_at_k: cut.length,
    recall_at_1: recallAt(1),
    recall_at_3: recallAt(3),
    recall_at_10: recallAt(k),
    mrr_at_10: hits.length > 0 ? 1 / (hits[0]! + 1) : 0,
    ndcg_at_3: ndcgAt(3),
    ndcg_at_10: ndcgAt(k),
    no_result_correct: null,
  };
}

function scoreRepeat(
  fixture: Fixture,
  queries: QueryResult[],
  relevant: Map<string, string[]>,
  k: number,
  threshold: number,
): ScoredRow[] {
  const byCase = new Map(queries.map((query) => [query.case_id, query]));
  // Iterate the FIXTURE, never the runner's output: a case a runner never
  // emitted must occupy a zero row, not vanish and lift every average.
  return fixture.cases.map((entry) => {
    const query = byCase.get(entry.id);
    const gold = relevant.get(entry.id) ?? [];
    const status: ScoredRow["status"] = query === undefined ? "missing" : query.status === "ok" ? "ok" : "error";
    return {
      case_id: entry.id,
      language: entry.language,
      language_group: langGroup(entry.language),
      category: entry.category,
      status,
      latency_ms: status === "ok" ? query!.latency_ms ?? null : null,
      metrics: status === "ok"
        ? scoreCase(query!.ranked ?? [], query!.scores ?? [], gold, "ok", k, threshold)
        : scoreCase([], [], gold, status, k, threshold),
    };
  });
}

function meanOf(values: (number | null | undefined)[]) {
  const kept = values.filter((value): value is number => typeof value === "number");
  return kept.length > 0 ? round(kept.reduce((sum, value) => sum + value, 0) / kept.length) : null;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Median and the FULL range. The mean of five repeats hides the flip that
 * produced them, and the range is what decides whether a gap is real.
 */
function spread(values: (number | null | undefined)[]): Spread | null {
  const kept = values.filter((value): value is number => typeof value === "number");
  if (kept.length === 0) return null;
  return {
    median: round(median(kept)),
    min: round(Math.min(...kept)),
    max: round(Math.max(...kept)),
    mean: round(kept.reduce((sum, value) => sum + value, 0) / kept.length),
    values: kept.map((value) => round(value)),
    n: kept.length,
  };
}

function groupMetrics(rows: ScoredRow[], field: "language" | "language_group" | "category") {
  const out: Record<string, Record<string, number | null>> = {};
  for (const name of [...new Set(rows.map((row) => row[field]))].sort()) {
    const subset = rows.filter((row) => row[field] === name).map((row) => row.metrics);
    out[name] = {
      ...Object.fromEntries(ALL_METRICS.map((metric) => [metric, meanOf(subset.map((entry) => entry[metric]))])),
      cases: subset.length,
    };
  }
  return out;
}

function latencyStats(samples: (number | null)[]) {
  const sorted = samples.filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const pct = (fraction: number) => round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!, 2);
  return {
    n: sorted.length,
    min: round(sorted[0]!, 2),
    median: round(median(sorted), 2),
    max: round(sorted.at(-1)!, 2),
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length, 2),
    p50: pct(0.5),
    p95: pct(0.95),
    // Over eight samples p95 is max() wearing a percentile's name.
    p95_is_meaningful: sorted.length >= 20,
  };
}

function scoreRun(fixture: Fixture, run: RunContract, options: Options) {
  const relevant = groundTruth(fixture, options.variant);
  const perRepeat = run.repeats.map((repeat) => {
    const rows = scoreRepeat(fixture, repeat.queries ?? [], relevant, options.topK, options.threshold);
    return {
      repeat: repeat.repeat,
      corpus_size: repeat.corpus_size ?? null,
      corpus_intact: repeat.corpus_intact === true,
      errors: rows.filter((row) => row.status !== "ok").length,
      overall: Object.fromEntries(
        ALL_METRICS.map((metric) => [metric, meanOf(rows.map((row) => row.metrics[metric]))]),
      ) as Record<MetricName, number | null>,
      by_language_group: groupMetrics(rows, "language_group"),
      by_language: groupMetrics(rows, "language"),
      by_category: groupMetrics(rows, "category"),
      latency_ms: latencyStats(rows.map((row) => row.latency_ms)),
      ingest_ms: repeat.ingest?.total_ms ?? null,
      per_case: rows,
    };
  });

  // A short corpus has fewer distractors, which inflates every rank metric.
  // Refuse to score it rather than publish a number that flatters the system.
  const sizes = [...new Set(perRepeat.map((entry) => entry.corpus_size).filter((size) => size !== null))];
  const notIntact = perRepeat.filter((entry) => !entry.corpus_intact).map((entry) => entry.repeat);
  const blocking: string[] = [];
  if (perRepeat.length === 0) blocking.push("no repeats");
  if (perRepeat.length > 0 && perRepeat.length < MIN_REPEATS)
    blocking.push(`only ${perRepeat.length} repeats; ${MIN_REPEATS} is the floor for a range`);
  if (sizes.length > 1) blocking.push(`repeats disagree on corpus_size: ${sizes.join(", ")}`);
  if (notIntact.length > 0)
    blocking.push(`corpus not intact in repeats ${notIntact.join(", ")}; fewer distractors inflates every rank metric`);

  const names = (field: "by_language_group" | "by_language" | "by_category") =>
    [...new Set(perRepeat.flatMap((entry) => Object.keys(entry[field])))].sort();
  const aggregateBy = (field: "by_language_group" | "by_language" | "by_category") =>
    Object.fromEntries(names(field).map((name) => [
      name,
      Object.fromEntries(
        ALL_METRICS.map((metric) => [metric, spread(perRepeat.map((entry) => entry[field][name]?.[metric]))]),
      ),
    ]));

  return {
    system: run.system,
    lane: run.lane,
    corpus_size: run.corpus_size ?? null,
    fixture_content_sha256: run.fixture_content_sha256 ?? null,
    ground_truth_variant: options.variant,
    k: options.topK,
    threshold: options.threshold,
    repeats: perRepeat.length,
    blocking_integrity_failures: blocking,
    scoreable: blocking.length === 0,
    aggregate: Object.fromEntries(
      ALL_METRICS.map((metric) => [metric, spread(perRepeat.map((entry) => entry.overall[metric]))]),
    ) as Record<MetricName, Spread | null>,
    aggregate_by_language_group: aggregateBy("by_language_group"),
    aggregate_by_language: aggregateBy("by_language"),
    aggregate_by_category: aggregateBy("by_category"),
    latency_ms_pooled: latencyStats(perRepeat.flatMap((entry) => entry.per_case.map((row) => row.latency_ms))),
    ingest_ms_spread: spread(perRepeat.map((entry) => entry.ingest_ms)),
    total_error_rows: perRepeat.reduce((sum, entry) => sum + entry.errors, 0),
    per_repeat: perRepeat,
  };
}

type ScoredRun = ReturnType<typeof scoreRun>;

/**
 * The rule that made the 2026-08-04 numbers trustworthy, encoded rather than
 * left to the reader: no winner on any metric whose across-repeat ranges
 * overlap, and no headline winner unless every primary metric is disjoint.
 */
function compareRuns(runs: ScoredRun[]) {
  const label = (run: ScoredRun) => `${run.system} | ${run.lane}`;
  if (runs.length < 2)
    return {
      runs: runs.map(label),
      per_metric: {},
      declared_winner: null,
      refusal: "single run: a winner claim needs a second system scored on the same fixture",
    };

  const perMetric: Record<string, unknown> = {};
  const primaryLeaders = new Set<string>();
  let refusal: string | null = null;
  for (const metric of RANKED_METRICS) {
    const entries = runs
      .map((run) => ({ name: label(run), value: run.aggregate[metric] }))
      .filter((entry): entry is { name: string; value: Spread } => entry.value != null)
      .sort((left, right) => right.value.median - left.value.median);
    if (entries.length < 2) continue;
    const [top, second] = entries as [{ name: string; value: Spread }, { name: string; value: Spread }];
    const overlap = top.value.min <= second.value.max;
    perMetric[metric] = {
      ranking: entries.map((entry) => ({
        run: entry.name,
        median: entry.value.median,
        range: [entry.value.min, entry.value.max],
      })),
      ranges_overlap: overlap,
      verdict: overlap
        ? `NO WINNER: ${top.name} range [${top.value.min}, ${top.value.max}] overlaps ${second.name} range [${second.value.min}, ${second.value.max}]; across-repeat variance is not smaller than the gap`
        : `${top.name} > ${second.name} (ranges disjoint: [${top.value.min}, ${top.value.max}] vs [${second.value.min}, ${second.value.max}])`,
    };
    if (!(PRIMARY_METRICS as readonly string[]).includes(metric)) continue;
    if (overlap) refusal ??= `${metric} ranges overlap`;
    else primaryLeaders.add(top.name);
  }

  if (primaryLeaders.size > 1) refusal ??= "primary metrics disagree on the leader";
  const measured = (PRIMARY_METRICS as readonly string[]).filter((metric) => metric in perMetric);
  if (measured.length < PRIMARY_METRICS.length) refusal ??= "not every primary metric was measurable on both runs";
  return {
    runs: runs.map(label),
    per_metric: perMetric,
    declared_winner: refusal === null && primaryLeaders.size === 1 ? [...primaryLeaders][0]! : null,
    refusal,
  };
}

function embedConfig(): EmbedConfig {
  const read = (name: string) => (process.env[name] ?? "").trim();
  const baseUrl = read("TITEN_EVAL_EMBED_BASE_URL");
  const model = read("TITEN_EVAL_EMBED_MODEL");
  const dims = Number(read("TITEN_EVAL_EMBED_DIMS"));
  for (const [name, value] of [
    ["TITEN_EVAL_EMBED_BASE_URL", baseUrl],
    ["TITEN_EVAL_EMBED_MODEL", model],
  ] as const)
    if (!value) throw new Error(`Missing ${name}; run with --fts-only to measure the lexical lane`);
  if (!Number.isSafeInteger(dims) || dims < 1) throw new Error("TITEN_EVAL_EMBED_DIMS must be a positive integer");
  const apiKey = read("TITEN_EVAL_EMBED_API_KEY");
  return {
    embedBaseUrl: baseUrl,
    embedModel: model,
    embedDims: dims,
    embedRevision: model,
    // Derived by default, because the core refuses a profile that contradicts
    // the model id. `TITEN_EVAL_EMBED_PROFILE` overrides that derivation for a
    // fair head-to-head: comparing Titen against a system that embeds raw text
    // needs Titen to embed raw text too, which is what the deliberate
    // `raw-unit-v1-model-mismatch-acknowledged` profile allows (#250). Any
    // other value is still validated by the core and fails closed.
    embedProfile: read("TITEN_EVAL_EMBED_PROFILE") ||
      (model.toLowerCase().replaceAll(/[^a-z0-9]/g, "").includes("embeddinggemma")
        ? "embeddinggemma-retrieval-v1"
        : "raw-unit-v1"),
    // Accept every candidate. Titen ships no default minimum cosine, so 0 is the
    // floor a competing system's default threshold of 0.0 is compared against.
    embedMinCosine: 0,
    ...(apiKey ? { embedApiKey: apiKey } : {}),
  };
}

async function runRepeat(
  options: Options,
  fixture: Fixture,
  embed: EmbedConfig | null,
  repeat: number,
  secrets: string[],
) {
  const facts = [...fixture.core_facts, ...fixture.distractor_facts];
  const directory = mkdtempSync(join(tmpdir(), "titen-h2h-"));
  const dbPath = join(directory, "titen.db");
  const namespace = `h2h_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const errors: string[] = [];
  const note = (where: string, error: unknown) => {
    const code = errorCode(error);
    errors.push(`${where}:${code}`);
    return code;
  };

  const orgId = newId("org");
  const database = openDatabase(dbPath);
  const db = createSqliteDb(database);
  await migrate(db);
  const credential = await createApiKey({
    orgId,
    principalId: newId("agent"),
    principalKind: "agent",
    label: "retrieval-h2h",
    scopes: SCOPES,
    maxTrust: "verified",
  });
  await db.batch([organizationStatement(orgId, "Retrieval H2H"), credential.statement]);
  database.close();
  secrets.push(credential.key);

  const api = await serve({
    dbPath,
    port: 0,
    hostname: "127.0.0.1",
    quiet: true,
    // Explicit drains only: a background maintenance pass firing mid-query would
    // put indexing work inside a latency sample.
    maintenanceIntervalMs: 0,
    ...(embed ? { vecDbPath: join(directory, "vectors.db"), ...embed } : {}),
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${api.url}${path}`, {
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
    max_tokens: LIMITS.maxTokens,
    // The shipped default, not the 1,000 ceiling. Running Titen above its own
    // default while another system runs at its default is an unearned edge.
    max_candidates: LIMITS.candidates,
  });

  const queries: QueryResult[] = [];
  const ingest = {
    corpus_size: facts.length,
    write_ms: 0,
    index_ms: 0,
    total_ms: 0,
    drain_rounds: 0,
    indexed: 0,
    ingest_errors: 0,
  };
  let semanticIndex = "unknown";
  let startedEmpty = false;
  const claimToFact = new Map<string, string>();

  try {
    // One flag only: the readiness body itself is never copied into an artifact.
    const ready = await call("GET", "/readyz");
    semanticIndex = String((ready.checks as Record<string, unknown> | undefined)?.semantic_index ?? "unknown");
    const probe = await compile("startup binding probe");
    startedEmpty = Array.isArray(probe.items) && probe.items.length === 0;
    if (!startedEmpty) throw new Error("fresh database was not empty");

    const totalStart = performance.now();
    const writeStart = performance.now();
    for (const fact of facts) {
      try {
        const observation = await call("POST", "/v1/observations", {
          subject_id: namespace,
          run_id: namespace,
          kind: "user_statement",
          content: fact.statement,
          source: { type: "benchmark", ref: `${fixture.fixture_version}:${fact.id}` },
          trust: "asserted",
        });
        const consolidated = await call("POST", "/v1/consolidations", {
          subject_id: namespace,
          claims: [{
            kind: fact.kind,
            statement: fact.statement,
            confidence: 1,
            sources: [{ observation_id: observation.observation_id, relation: "supports" }],
          }],
        });
        // No model may touch this lane; an enriched claim is a different corpus.
        if (consolidated.model_used !== false) throw new Error("ModelUsed");
        const claimId = consolidated.claims?.[0]?.claim_id;
        if (!claimId) throw new Error("NoClaimId");
        claimToFact.set(claimId, fact.id);
      } catch (error) {
        ingest.ingest_errors += 1;
        note(`ingest:${fact.id}`, error);
      }
    }
    ingest.write_ms = round(performance.now() - writeStart, 2);

    const indexStart = performance.now();
    if (embed)
      for (let attempt = 0; attempt < MAX_DRAIN_ROUNDS; attempt += 1) {
        const drained = await call("POST", `/v1/index/drain?limit=${DRAIN_BATCH}`);
        ingest.drain_rounds += 1;
        ingest.indexed += Number(drained.indexed ?? 0);
        if (Number(drained.remaining ?? 0) === 0) break;
      }
    ingest.index_ms = round(performance.now() - indexStart, 2);
    ingest.total_ms = round(performance.now() - totalStart, 2);

    // Untimed and discarded: the first query of a fresh server pays for a cold
    // JIT, a cold page cache and a cold connection, none of which is retrieval.
    for (let index = 0; index < options.warmup; index += 1) {
      try {
        await compile(`warmup probe ${index}`);
      } catch (error) {
        note(`warmup:${index}`, error);
      }
    }

    for (const entry of fixture.cases) {
      const started = performance.now();
      try {
        const compiled = await compile(entry.query);
        const latency = round(performance.now() - started, 2);
        const items = Array.isArray(compiled.items) ? compiled.items : [];
        const ranked: string[] = [];
        const scores: number[] = [];
        for (const item of items) {
          const mapped = claimToFact.get(item.claim_id);
          if (!mapped) continue;
          ranked.push(mapped);
          scores.push(typeof item.score === "number" ? item.score : 0);
        }
        // The kind-diversity packer reorders results and only runs when the
        // budget is exhausted. If it engages, Titen gains a ranking signal
        // (claim.kind) that a competing system never receives. Record it.
        if (compiled.budget?.budget_exhausted === true) note(`budget:${entry.id}`, new Error("BudgetExhausted"));
        queries.push({
          case_id: entry.id,
          status: "ok",
          latency_ms: latency,
          ranked: ranked.slice(0, options.topK),
          scores: scores.slice(0, options.topK),
        });
      } catch (error) {
        queries.push({
          case_id: entry.id,
          status: note(`query:${entry.id}`, error),
          latency_ms: round(performance.now() - started, 2),
          ranked: [],
          scores: [],
        });
      }
    }
  } catch (error) {
    note("repeat", error);
  } finally {
    await api.stop();
    rmSync(directory, { recursive: true, force: true });
  }

  const corpusIntact = startedEmpty
    && ingest.ingest_errors === 0
    && claimToFact.size === facts.length
    && (!embed || ingest.indexed === facts.length);
  const packerEngaged = errors.filter((entry) => entry.startsWith("budget:")).length;
  console.log(
    `  repeat ${repeat}: corpus_intact=${corpusIntact} indexed=${ingest.indexed}/${facts.length}`
    + ` packer_engaged=${packerEngaged} errors=${errors.length}`,
  );
  return {
    repeat,
    run_id: namespace,
    semantic_index: semanticIndex,
    started_empty: startedEmpty,
    corpus_size: facts.length,
    corpus_intact: corpusIntact,
    warmup_queries: options.warmup,
    packer_engaged_queries: packerEngaged,
    ingest,
    queries,
    error_codes: errors,
  } satisfies RepeatResult & Record<string, unknown>;
}

function prepareOutput(directory: string) {
  if (existsSync(directory) && readdirSync(directory).length > 0)
    throw new Error("Output directory must be absent or empty");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function gitState() {
  const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
  const status = Bun.spawnSync(["git", "status", "--porcelain"], { stdout: "pipe", stderr: "ignore" });
  return {
    commit: revision.exitCode === 0 ? revision.stdout.toString().trim() : "unavailable",
    dirty: status.exitCode !== 0 || status.stdout.length > 0,
  };
}

function hostSnapshot() {
  const cpu = cpus();
  return {
    hostname_sha256: sha256(hostname()),
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu_count: cpu.length,
    cpu_model_sha256: sha256(cpu[0]?.model ?? "unknown"),
    bun_version: Bun.version,
  };
}

function safeArtifact(text: string, forbidden: string[]) {
  for (const value of forbidden)
    if (value && text.includes(value)) throw new Error("Artifact redaction check failed");
}

function renderReport(summary: Record<string, any>) {
  const line = (metric: string, value: Spread | null) =>
    `| ${metric} | ${value ? value.median : "n/a"} | ${value ? `${value.min} – ${value.max}` : "n/a"} | ${value ? value.n : 0} |`;
  const own = summary.runs[0];
  const comparison = summary.comparison as ReturnType<typeof compareRuns>;
  return [
    `# Retrieval ${summary.harness_version} — ${own.system} (${own.lane})`,
    "",
    `Package: \`titen-memory@${summary.package_version}\` at \`${summary.source.commit}\`${summary.source.dirty ? " (DIRTY TREE — not publishable)" : ""}`,
    `Fixture: \`${summary.fixture.version}\` content sha256 \`${summary.fixture.content_sha256}\` (${summary.fixture.pinned ? "pinned" : "UNPINNED"})`,
    `Ground truth: \`${summary.ground_truth_variant}\`, k=${summary.k}, threshold=${summary.threshold}`,
    `Repeats: ${own.repeats} × ${summary.corpus_size} facts, ${summary.warmup_queries} untimed warm-up queries discarded per repeat`,
    "",
    "## Metrics (median and full across-repeat range)",
    "",
    "| metric | median | range | repeats |",
    "| --- | --- | --- | --- |",
    ...ALL_METRICS.map((metric) => line(metric, own.aggregate[metric])),
    "",
    `Latency ms (pooled): ${own.latency_ms_pooled ? `median ${own.latency_ms_pooled.median}, range ${own.latency_ms_pooled.min} – ${own.latency_ms_pooled.max}, n=${own.latency_ms_pooled.n}` : "n/a"}`,
    "",
    "## Comparison",
    "",
    comparison.declared_winner
      ? `Winner: ${comparison.declared_winner} (every primary metric range disjoint).`
      : `NO WINNER DECLARED: ${comparison.refusal}.`,
    "",
    ...Object.entries(comparison.per_metric).map(([metric, entry]) => `- ${metric}: ${(entry as any).verdict}`),
    "",
    "## Limitations",
    "",
    ...(summary.limitations as string[]).map((entry: string) => `- ${entry}`),
    "",
  ].join("\n");
}

async function run(options: Options) {
  const loaded = loadFixture(options.fixture, options.unpinnedFixture);
  const fixture = loaded.fixture;
  assertFixtureIntegrity(fixture);
  const embed = options.ftsOnly ? null : embedConfig();
  const facts = [...fixture.core_facts, ...fixture.distractor_facts];
  const secrets: string[] = [
    ...(embed ? [embed.embedBaseUrl, embed.embedApiKey ?? ""] : []),
    ...facts.map((fact) => fact.statement),
    ...fixture.cases.map((entry) => entry.query),
  ];

  // Validate the comparison inputs before spending the repeats: two runs scored
  // against different corpora are not comparable, and finding that out after
  // the measurement has already run wastes the measurement.
  const external = options.compare.map((path) => {
    const contract = JSON.parse(readFileSync(path, "utf8")) as RunContract;
    if ((contract.corpus_size ?? null) !== facts.length)
      throw new Error(`${path}: corpus_size does not match this fixture; the runs are not comparable`);
    if (contract.fixture_content_sha256 && contract.fixture_content_sha256 !== loaded.contentSha)
      throw new Error(`${path}: fixture_content_sha256 does not match; the runs scored different corpora`);
    return contract;
  });

  const repeats = [];
  for (let repeat = 1; repeat <= options.repeats; repeat += 1)
    repeats.push(await runRepeat(options, fixture, embed, repeat, secrets));

  const own: RunContract = {
    system: options.ftsOnly ? "titen-fts" : "titen-vec",
    lane: options.ftsOnly ? "lexical FTS5 only, no embedding configured" : "lexical FTS5 + sqlite-vec",
    corpus_size: facts.length,
    fixture_content_sha256: loaded.contentSha,
    repeats,
  };

  const scored = [own, ...external].map((contract) => scoreRun(fixture, contract, options));
  const comparison = compareRuns(scored.filter((entry) => entry.scoreable));
  const source = gitState();
  const summary = {
    schema_version: SCHEMA_VERSION,
    harness_version: HARNESS_VERSION,
    package_version: TITEN_VERSION,
    started_at: new Date().toISOString(),
    source,
    host: hostSnapshot(),
    fixture: {
      version: fixture.fixture_version,
      provenance: fixture.provenance ?? "unknown",
      content_sha256: loaded.contentSha,
      file_sha256: loaded.fileSha,
      pinned: loaded.pinned,
      corpus_size: facts.length,
      cases: fixture.cases.length,
      discriminating_queries: fixture.discriminating_queries?.count ?? null,
    },
    corpus_size: facts.length,
    ground_truth_variant: options.variant,
    k: options.topK,
    threshold: options.threshold,
    warmup_queries: options.warmup,
    metric_notes: {
      primary: [...PRIMARY_METRICS],
      context: [...CONTEXT_METRICS],
      excluded: {
        "precision@10": "one gold per case at k=10 pins it at recall@10/10; arithmetic, not a measurement",
      },
      no_result_correct: `credited only when the system returns nothing at threshold ${options.threshold} and the query succeeded`,
    },
    publishable: loaded.pinned && !source.dirty && scored.every((entry) => entry.scoreable),
    runs: scored,
    comparison,
    limitations: [
      "The fixture is Titen's own corpus; its distractors were authored after reading Titen's ranker. This proves provenance, not neutrality.",
      "One process, loopback HTTP, one client. No concurrency and no throughput ceiling is measured here.",
      `Corpus is ${facts.length} facts and ${fixture.cases.length} queries; this says nothing about recall at 10^4 and above.`,
      "Bun/SQLite only. The Cloudflare runtime is not exercised by this harness.",
      ...(loaded.pinned ? [] : ["The fixture is not pinned; these numbers are not publishable evidence."]),
      ...(source.dirty ? ["The working tree was dirty; these numbers are not reproducible from a commit."] : []),
    ],
  };

  const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
  const contractText = `${JSON.stringify(own, null, 2)}\n`;
  const reportText = renderReport(summary);
  const files: Record<string, string> = {
    "result-contract.json": contractText,
    "summary.json": summaryText,
    "report.md": reportText,
  };
  for (const text of Object.values(files)) safeArtifact(text, secrets);
  prepareOutput(options.out);
  for (const [name, text] of Object.entries(files))
    writeFileSync(resolve(options.out, name), text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const checksums = `${Object.entries(files)
    .map(([name, text]) => `${sha256(text)}  ${name}`)
    .sort()
    .join("\n")}\n`;
  safeArtifact(checksums, secrets);
  writeFileSync(resolve(options.out, "SHA256SUMS"), checksums, { encoding: "utf8", flag: "wx", mode: 0o600 });

  const aggregate = scored[0]!.aggregate;
  const scoreable = scored.every((entry) => entry.scoreable);
  console.log(
    `${scoreable ? "ok" : "UNSCOREABLE"} ${HARNESS_VERSION} ${own.system}`
    + ` repeats=${options.repeats} corpus=${facts.length}`,
  );
  for (const metric of PRIMARY_METRICS) {
    const value = aggregate[metric];
    console.log(`  ${metric}=${value ? `${value.median} [${value.min}, ${value.max}]` : "n/a"}`);
  }
  console.log(`  ${comparison.declared_winner ? `winner=${comparison.declared_winner}` : `no winner: ${comparison.refusal}`}`);
  console.log(`  publishable=${summary.publishable} artifacts=${options.out}`);
  if (!scoreable) {
    for (const entry of scored)
      for (const failure of entry.blocking_integrity_failures) console.error(`  BLOCKING ${entry.system}: ${failure}`);
    process.exitCode = 1;
  }
}

function selfTest() {
  const options = (overrides: Partial<Options> = {}): Options => ({
    fixture: "",
    unpinnedFixture: false,
    out: "",
    repeats: MIN_REPEATS,
    warmup: MIN_WARMUP,
    topK: TOP_K,
    threshold: 0,
    variant: "strict",
    ftsOnly: true,
    compare: [],
    ...overrides,
  });

  // --- scorer maths ---------------------------------------------------------
  const second = scoreCase(["decoy", "gold"], [0.9, 0.8], ["gold"], "ok", 10, 0);
  assert.equal(second.recall_at_1, 0);
  assert.equal(second.recall_at_3, 1);
  assert.equal(second.recall_at_10, 1);
  assert.equal(second.mrr_at_10, 0.5);
  assert.equal(round(second.ndcg_at_3!, 6), round(1 / Math.log2(3), 6));
  assert.equal(round(second.ndcg_at_10!, 6), round(1 / Math.log2(3), 6));
  const first = scoreCase(["gold", "decoy"], null, ["gold"], "ok", 10, 0);
  assert.equal(first.recall_at_1, 1);
  assert.equal(first.mrr_at_10, 1);
  assert.equal(first.ndcg_at_3, 1);
  // a hit at rank 4 is invisible to recall@3 and visible to recall@10
  assert.equal(scoreCase(["a", "b", "c", "gold"], null, ["gold"], "ok", 10, 0).recall_at_3, 0);
  assert.equal(scoreCase(["a", "b", "c", "gold"], null, ["gold"], "ok", 10, 0).recall_at_10, 1);
  // a hit beyond k is a miss, and the same gold twice is one hit
  const beyond = [...Array.from({ length: 10 }, (_, index) => `d${index}`), "gold"];
  assert.equal(scoreCase(beyond, null, ["gold"], "ok", 10, 0).recall_at_10, 0);
  assert.equal(scoreCase(["gold", "gold"], null, ["gold"], "ok", 10, 0).recall_at_10, 1);
  // two golds: nDCG@3 must normalise against the ideal two-hit gain
  const both = scoreCase(["g1", "decoy", "g2"], null, ["g1", "g2"], "ok", 10, 0);
  assert.equal(both.recall_at_3, 1);
  assert.equal(round(both.ndcg_at_3!, 6), round((1 + 1 / 2) / (1 + 1 / Math.log2(3)), 6));
  // no-result correctness: only a successful abstention counts
  assert.equal(scoreCase([], [], [], "ok", 10, 0).no_result_correct, 1);
  assert.equal(scoreCase(["x"], [0.5], [], "ok", 10, 0).no_result_correct, 0);
  assert.equal(scoreCase([], [], [], "error", 10, 0).no_result_correct, 0);
  assert.equal(scoreCase([], [], [], "missing", 10, 0).no_result_correct, 0);
  // the threshold gates identically whichever system produced the scores
  assert.equal(scoreCase(["x"], [0.05], [], "ok", 10, 0.1).no_result_correct, 1);
  assert.equal(scoreCase(["decoy", "gold"], [0.9, 0.05], ["gold"], "ok", 10, 0.1).mrr_at_10, 0);
  assert.throws(() => scoreCase(["a", "b"], [1], ["a"], "ok", 10, 0), /length mismatch/);

  // --- a case the runner never emitted must drag the average down -----------
  const tiny: Fixture = {
    fixture_version: "self-test",
    top_k: 10,
    core_facts: [
      { id: "g1", statement: "one", kind: "semantic_fact" },
      { id: "g2", statement: "two", kind: "semantic_fact" },
    ],
    distractor_facts: [],
    cases: [
      { id: "a", language: "id", category: "exact", query: "qa", relevant: ["g1"] },
      { id: "b", language: "en", category: "exact", query: "qb", relevant: ["g2"] },
    ],
    ground_truth_variants: { lenient: { overrides: { a: ["g1", "g2"] } } },
  };
  const truth = groundTruth(tiny, "strict");
  const complete = scoreRepeat(tiny, [
    { case_id: "a", status: "ok", latency_ms: 1, ranked: ["g1"], scores: [1] },
    { case_id: "b", status: "ok", latency_ms: 1, ranked: ["g2"], scores: [1] },
  ], truth, 10, 0);
  assert.equal(meanOf(complete.map((row) => row.metrics.mrr_at_10)), 1);
  const dropped = scoreRepeat(tiny, [
    { case_id: "a", status: "ok", latency_ms: 1, ranked: ["g1"], scores: [1] },
  ], truth, 10, 0);
  assert.equal(dropped.length, 2, "a missing case must still occupy a row");
  assert.equal(dropped[1]!.status, "missing");
  assert.equal(meanOf(dropped.map((row) => row.metrics.mrr_at_10)), 0.5, "crashing must not raise the average");
  assert.deepEqual(groundTruth(tiny, "lenient").get("a"), ["g1", "g2"]);
  assert.equal(langGroup("en"), "en");
  assert.equal(langGroup("jv-id"), "id_jv");

  // --- spread and integrity refusal ----------------------------------------
  assert.deepEqual(spread([0.2, 0.6, 0.4])!.median, 0.4);
  assert.deepEqual(spread([0.2, 0.6, 0.4, 0.8])!.median, 0.5);
  assert.equal(spread([null, undefined]), null);
  const contract = (intact: boolean, size: number): RunContract => ({
    system: "self", lane: "test", corpus_size: size,
    repeats: Array.from({ length: MIN_REPEATS }, (_, index) => ({
      repeat: index + 1, corpus_size: size, corpus_intact: intact,
      queries: tiny.cases.map((entry) => ({
        case_id: entry.id, status: "ok", latency_ms: 1, ranked: entry.relevant, scores: [1],
      })),
    })),
  });
  assert.equal(scoreRun(tiny, contract(true, 2), options()).scoreable, true);
  assert.equal(scoreRun(tiny, contract(false, 2), options()).scoreable, false);
  const short = contract(true, 2);
  short.repeats = short.repeats.slice(0, 2);
  assert.equal(scoreRun(tiny, short, options()).scoreable, false, "fewer than the repeat floor is not scoreable");

  // --- the winner refusal ---------------------------------------------------
  const fake = (system: string, values: Record<string, Spread>) =>
    ({ system, lane: "l", aggregate: values } as unknown as ScoredRun);
  const wide = (median: number, min: number, max: number): Spread =>
    ({ median, min, max, mean: median, values: [min, max], n: 2 });
  const winning = Object.fromEntries(PRIMARY_METRICS.map((metric) => [metric, wide(0.9, 0.8, 1)])) as Record<string, Spread>;
  const losing = Object.fromEntries(PRIMARY_METRICS.map((metric) => [metric, wide(0.5, 0.4, 0.6)])) as Record<string, Spread>;
  const disjoint = compareRuns([fake("a", winning), fake("b", losing)]);
  assert.equal(disjoint.declared_winner, "a | l");
  assert.equal((disjoint.per_metric.mrr_at_10 as any).ranges_overlap, false);
  const touching = { ...losing, mrr_at_10: wide(0.5, 0.4, 0.85) };
  const overlapping = compareRuns([fake("a", winning), fake("b", touching)]);
  assert.equal((overlapping.per_metric.mrr_at_10 as any).ranges_overlap, true);
  assert.equal(overlapping.declared_winner, null, "an overlapping range must not produce a winner");
  assert.match(overlapping.refusal!, /mrr_at_10/);
  const split = compareRuns([
    fake("a", { ...winning, ndcg_at_3: wide(0.2, 0.1, 0.3) }),
    fake("b", { ...losing, ndcg_at_3: wide(0.9, 0.8, 1) }),
  ]);
  assert.equal(split.declared_winner, null, "primary metrics disagreeing must not produce a winner");
  assert.equal(compareRuns([fake("a", winning)]).declared_winner, null);

  // --- argument floors ------------------------------------------------------
  assert.throws(() => parseArgs(["--repeats", "4"]), /--repeats must be an integer >= 5/);
  assert.throws(() => parseArgs(["--warmup", "1"]), /--warmup must be an integer >= 2/);
  assert.throws(() => parseArgs(["--variant", "loose"]), /strict or lenient/);
  assert.throws(() => parseArgs(["--nope", "1"]), /Unknown argument/);
  const parsed = parseArgs(["--fts-only", "--out", "/tmp/titen-h2h-self-test"]);
  assert.notEqual(typeof parsed, "string");
  if (typeof parsed !== "string") {
    assert.equal(parsed.repeats, MIN_REPEATS);
    assert.equal(parsed.warmup, MIN_WARMUP);
    assert.ok(parsed.fixture.endsWith(DEFAULT_FIXTURE));
  }

  // --- the shipped fixture, its pin, and its provenance ---------------------
  const shipped = loadFixture(resolve(import.meta.dir, "..", DEFAULT_FIXTURE), false);
  assertFixtureIntegrity(shipped.fixture);
  assert.equal(shipped.pinned, true);
  assert.equal(shipped.contentSha, PINNED_FIXTURES[shipped.fixture.fixture_version]);
  const mutated = JSON.parse(JSON.stringify(shipped.fixture)) as Fixture;
  mutated.cases[0]!.relevant = ["fact_mira_timezone"];
  assert.notEqual(fixtureContentHash(mutated), shipped.contentSha, "a moved gold must break the pin");
  // core facts, queries, language, category and the ground truth itself are
  // verbatim from the archived runner; only distractors are harness-authored.
  const archive = readFileSync(resolve(import.meta.dir, "benchmark-mem0-replacement.ts"), "utf8");
  for (const fact of shipped.fixture.core_facts) {
    assert.ok(archive.includes(JSON.stringify(fact.statement)), `${fact.id} statement is not verbatim in ${ARCHIVED_SOURCE}`);
    assert.ok(archive.includes(`id: "${fact.id}"`), `${fact.id} is not in ${ARCHIVED_SOURCE}`);
  }
  for (const entry of shipped.fixture.cases) {
    const start = archive.indexOf(`id: "${entry.id}"`);
    assert.ok(start >= 0, `case ${entry.id} is not in ${ARCHIVED_SOURCE}`);
    const block = archive.slice(start, archive.indexOf("\n  },", start));
    assert.ok(block.includes(JSON.stringify(entry.query)), `case ${entry.id} query drifted`);
    assert.ok(block.includes(`language: "${entry.language}"`), `case ${entry.id} language drifted`);
    assert.ok(block.includes(`category: "${entry.category}"`), `case ${entry.id} category drifted`);
    const archived = [...(block.match(/relevant:\s*\[([^\]]*)\]/s)?.[1] ?? "").matchAll(/"([^"]*)"/g)]
      .map((match) => match[1]!);
    assert.deepEqual(archived, entry.relevant, `case ${entry.id} GROUND TRUTH drifted from ${ARCHIVED_SOURCE}`);
  }
  for (const fact of shipped.fixture.distractor_facts)
    assert.ok(
      !archive.includes(JSON.stringify(fact.statement)),
      `distractor ${fact.id} appears in ${ARCHIVED_SOURCE}; ids may collide`,
    );

  // --- artifacts never carry a secret or the fixture text -------------------
  assert.throws(() => safeArtifact('{"x":"Mira prefers all calendar times in UTC."}', [
    "Mira prefers all calendar times in UTC.",
  ]), /redaction check failed/);
  assert.equal(errorCode(new HttpFailure("POST", "/v1/context/compile?x=1", 503)), "HTTP_POST__v1_context_compile_503");
  assert.equal(errorCode(new Error("secret in the message")), "LOCAL_Error");

  console.log(`self-test ok fixture=${shipped.fixture.fixture_version} content_sha256=${shipped.contentSha}`);
}

try {
  const options = parseArgs(Bun.argv.slice(2));
  if (options === "help") console.log(usage());
  else if (options === "self-test") selfTest();
  else await run(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Benchmark failed");
  process.exitCode = 1;
}
