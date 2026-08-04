#!/usr/bin/env bun
/**
 * S-calibration-v1: embedding-only threshold calibration with a locked holdout.
 *
 * Source a mode-0600 profile that defines TITEN_EVAL_EMBED_BASE_URL,
 * TITEN_EVAL_EMBED_MODEL, TITEN_EVAL_EMBED_DIMS, and optionally
 * TITEN_EVAL_EMBED_API_KEY, then run:
 *
 *   bun scripts/benchmark-embedding-calibration.ts --scale smoke --out DIR
 *   bun scripts/benchmark-embedding-calibration.ts --scale full --out DIR
 *   bun scripts/benchmark-embedding-calibration.ts --validation-v2 --scale full --preprocessing embeddinggemma-retrieval-v1 --out DIR
 *
 * Artifacts contain synthetic IDs, scores, metrics, and hashes only. Provider
 * credentials, endpoint URLs, statement/query text, responses, and embeddings
 * are never written or printed. The sqlite-vec index is created under the OS
 * temporary directory and removed before exit.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { arch, cpus, hostname, platform, release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createSqliteVecStore } from "../src/runtime/bun/vectors";

const BENCHMARK_VERSION = "s-calibration-v1";
const VALIDATION_VERSION = "s-validation-v2";
const SCHEMA_VERSION = 1;
const SPLIT_SALT = "titen:s-calibration-v1:locked-holdout";
const VALIDATION_SALT = "titen:s-validation-v2:disjoint-holdout";
const VALIDATION_GROUP_OFFSET = 1_000;
const VALIDATION_THRESHOLD = 0.737307171;
const TOP_K = 10;
const REQUEST_TIMEOUT_MS = 120_000;
const LANGUAGES = ["id", "en", "jv-id"] as const;
const CATEGORIES = ["exact", "paraphrase", "cross_language", "hard_negative", "no_result"] as const;
const RECORD_KINDS = [
  "incident",
  "retention",
  "timezone",
  "release_requirement",
  "release_document",
  "current_endpoint",
  "retired_endpoint",
  "backup_region",
  "on_call",
  "backup_hour",
] as const;
const SCALE = {
  smoke: { groups: 60, queriesPerStratum: 4 },
  full: { groups: 1_000, queriesPerStratum: 40 },
} as const;
const PREPROCESSING = {
  "raw-v1": {
    document_template: "{content}",
    query_template: "{content}",
  },
  "embeddinggemma-retrieval-v1": {
    document_template: "title: none | text: {content}",
    query_template: "task: search result | query: {content}",
  },
} as const;

type Language = (typeof LANGUAGES)[number];
type Category = (typeof CATEGORIES)[number];
type RecordKind = (typeof RECORD_KINDS)[number];
type ScaleName = keyof typeof SCALE;
type PreprocessingName = keyof typeof PREPROCESSING;
type Split = "calibration" | "holdout";

interface Statement {
  id: string;
  group: number;
  kind: RecordKind;
  language: Language;
  text: string;
}

interface QueryCase {
  id: string;
  category: Category;
  language: Language;
  text: string;
  relevantId: string | null;
}

interface RankedHit {
  statement_id: string;
  cosine: number;
}

interface RawTrial {
  schema_version: number;
  benchmark_version: string;
  query_id: string;
  split: Split;
  language: Language;
  category: Category;
  relevant_statement_id: string | null;
  ranked_top_10: RankedHit[];
  retrieval_ms: number;
}

interface Options {
  scale: ScaleName;
  batchSize: number;
  out: string;
  preprocessing: PreprocessingName;
  validation: boolean;
}

interface ProviderConfig {
  baseUrl: string;
  model: string;
  dimensions: number;
  apiKey: string;
}

interface Proportion {
  successes: number;
  samples: number;
  rate: number;
  wilson_95: { low: number; high: number };
}

const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const round = (value: number, digits = 6) => Number(value.toFixed(digits));
const pad = (value: number, width: number) => String(value).padStart(width, "0");

function parseArgs(argv: string[]): Options | "self-test" | "help" {
  let scale: ScaleName = "smoke";
  let batchSize = 64;
  let out = "";
  let preprocessing: PreprocessingName = "raw-v1";
  let validation = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--self-test") return "self-test";
    if (arg === "--help" || arg === "-h") return "help";
    if (arg === "--validation-v2") {
      validation = true;
      continue;
    }
    if (arg === "--scale" || arg === "--batch-size" || arg === "--out" || arg === "--preprocessing") {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${arg}`);
      if (arg === "--scale") {
        if (value !== "smoke" && value !== "full") throw new Error("--scale must be smoke or full");
        scale = value;
      } else if (arg === "--batch-size") {
        batchSize = Number(value);
      } else if (arg === "--preprocessing") {
        if (value !== "raw-v1" && value !== "embeddinggemma-retrieval-v1")
          throw new Error("--preprocessing must be raw-v1 or embeddinggemma-retrieval-v1");
        preprocessing = value;
      } else {
        out = resolve(value);
      }
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 256)
    throw new Error("--batch-size must be an integer between 1 and 256");
  if (validation && (scale !== "full" || preprocessing !== "embeddinggemma-retrieval-v1"))
    throw new Error("--validation-v2 requires --scale full --preprocessing embeddinggemma-retrieval-v1");
  const benchmarkVersion = validation ? VALIDATION_VERSION : BENCHMARK_VERSION;
  if (!out) {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    out = resolve("benchmark-results", `${benchmarkVersion}-${scale}-${timestamp}`);
  }
  return { scale, batchSize, out, preprocessing, validation };
}

function usage() {
  return [
    "Usage:",
    "  bun scripts/benchmark-embedding-calibration.ts --scale smoke|full --out DIR [--batch-size 64] [--preprocessing raw-v1|embeddinggemma-retrieval-v1]",
    "  bun scripts/benchmark-embedding-calibration.ts --validation-v2 --scale full --preprocessing embeddinggemma-retrieval-v1 --out DIR",
    "  bun scripts/benchmark-embedding-calibration.ts --self-test",
  ].join("\n");
}

function preprocess(profile: PreprocessingName, role: "document" | "query", content: string) {
  if (profile === "raw-v1") return content;
  return role === "document"
    ? `title: none | text: ${content}`
    : `task: search result | query: ${content}`;
}

function statementId(group: number, kind: RecordKind) {
  return `s_${pad(group, 4)}_${kind}`;
}

function groupLanguage(group: number, queriesPerStratum: number): Language {
  const block = LANGUAGES.length * queriesPerStratum;
  const positiveBlock = Math.floor(group / block);
  if (positiveBlock < 4) {
    const queryLanguage = Math.floor((group % block) / queriesPerStratum);
    return LANGUAGES[positiveBlock === 2 ? (queryLanguage + 1) % LANGUAGES.length : queryLanguage]!;
  }
  return LANGUAGES[group % LANGUAGES.length]!;
}

function valuesFor(group: number) {
  const entity = `Karsa-${pad(group, 4)}`;
  return {
    entity,
    incident: `PAY-${pad(7_000 + group, 4)}-${String.fromCharCode(65 + (group % 26))}`,
    retention: 14 + (group % 31),
    timezone: [-5, 0, 7, 8, 9][group % 5]!,
    endpointV2: `api-${pad(group, 4)}-v2.internal`,
    endpointV3: `api-${pad(group, 4)}-v3.internal`,
    region: ["ap-southeast-1", "ap-southeast-2", "eu-west-1", "us-west-2"][group % 4]!,
    operator: `Operator-${pad((group * 17) % 997, 3)}`,
    hour: pad((group * 7) % 24, 2),
  };
}

function renderStatement(kind: RecordKind, language: Language, group: number): string {
  const value = valuesFor(group);
  const id: Record<RecordKind, string> = {
    incident: `Kode insiden pembayaran untuk proyek ${value.entity} adalah ${value.incident}.`,
    retention: `Masa retensi ekspor Atlas untuk proyek ${value.entity} adalah ${value.retention} hari.`,
    timezone: `Tim proyek ${value.entity} memilih semua jadwal dalam UTC${value.timezone >= 0 ? "+" : ""}${value.timezone}.`,
    release_requirement: `Aktivasi rilis proyek ${value.entity} wajib didahului smoke rollback.`,
    release_document: `Dokumen smoke rollback proyek ${value.entity} diarsipkan setelah rapat.`,
    current_endpoint: `Sejak Juli 2026, endpoint aktif proyek ${value.entity} adalah ${value.endpointV3}.`,
    retired_endpoint: `Sebelum Juli 2026, endpoint ${value.endpointV2} milik proyek ${value.entity} digunakan dan kini sudah tidak aktif.`,
    backup_region: `Cadangan utama proyek ${value.entity} berada di region ${value.region}.`,
    on_call: `Penanggung jawab on-call proyek ${value.entity} adalah ${value.operator}.`,
    backup_hour: `Pencadangan harian proyek ${value.entity} dijalankan pukul ${value.hour}:00 UTC.`,
  };
  const en: Record<RecordKind, string> = {
    incident: `The payment incident code for project ${value.entity} is ${value.incident}.`,
    retention: `The Atlas export retention period for project ${value.entity} is ${value.retention} days.`,
    timezone: `Project ${value.entity} schedules every calendar event in UTC${value.timezone >= 0 ? "+" : ""}${value.timezone}.`,
    release_requirement: `Project ${value.entity} requires a rollback smoke test before release activation.`,
    release_document: `The rollback smoke document for project ${value.entity} was archived after the meeting.`,
    current_endpoint: `Since July 2026, the active endpoint for project ${value.entity} is ${value.endpointV3}.`,
    retired_endpoint: `Before July 2026, project ${value.entity} used ${value.endpointV2}, which is no longer active.`,
    backup_region: `The primary backup for project ${value.entity} is stored in region ${value.region}.`,
    on_call: `The on-call owner for project ${value.entity} is ${value.operator}.`,
    backup_hour: `Project ${value.entity} runs its daily backup at ${value.hour}:00 UTC.`,
  };
  const jvId: Record<RecordKind, string> = {
    incident: `Kanggo proyek ${value.entity}, kode insiden pembayaran yaiku ${value.incident}.`,
    retention: `Masa simpan ekspor Atlas proyek ${value.entity} suwene ${value.retention} hari.`,
    timezone: `Tim proyek ${value.entity} luwih seneng semua jadwal dalam UTC${value.timezone >= 0 ? "+" : ""}${value.timezone}.`,
    release_requirement: `Sadurunge aktivasi rilis proyek ${value.entity}, tim kudu nindakake smoke rollback.`,
    release_document: `Dokumen smoke rollback proyek ${value.entity} disimpen sawisé rapat.`,
    current_endpoint: `Wiwit Juli 2026, endpoint aktif proyek ${value.entity} yaiku ${value.endpointV3}.`,
    retired_endpoint: `Sadurunge Juli 2026, proyek ${value.entity} nganggo ${value.endpointV2}, nanging saiki wis ora aktif.`,
    backup_region: `Cadangan utama proyek ${value.entity} mapan ing region ${value.region}.`,
    on_call: `Sing tanggung jawab on-call proyek ${value.entity} yaiku ${value.operator}.`,
    backup_hour: `Pencadangan saben dina proyek ${value.entity} mlaku pukul ${value.hour}:00 UTC.`,
  };
  return language === "id" ? id[kind] : language === "en" ? en[kind] : jvId[kind];
}

function renderQuery(category: Category, language: Language, group: number): string {
  const value = valuesFor(group);
  const queries: Record<Language, Record<Category, string>> = {
    id: {
      exact: `Apa kode insiden pembayaran proyek ${value.entity}?`,
      paraphrase: `Berapa lama ekspor Atlas proyek ${value.entity} harus disimpan?`,
      cross_language: `Di region mana salinan cadangan utama proyek ${value.entity} berada?`,
      hard_negative: `Apa syarat yang wajib dilakukan sebelum aktivasi rilis proyek ${value.entity}?`,
      no_result: `Berapa nomor paspor pemilik proyek ${value.entity}?`,
    },
    en: {
      exact: `What is the payment incident code for project ${value.entity}?`,
      paraphrase: `How long must project ${value.entity} keep its Atlas exports?`,
      cross_language: `Which region holds the primary backup for project ${value.entity}?`,
      hard_negative: `What must happen before project ${value.entity} activates a release?`,
      no_result: `What is the passport number of project ${value.entity}'s owner?`,
    },
    "jv-id": {
      exact: `Kode insiden pembayaran proyek ${value.entity} yaiku apa?`,
      paraphrase: `Ekspor Atlas proyek ${value.entity} kudu disimpen suwene pira?`,
      cross_language: `Cadangan utama proyek ${value.entity} mapan ing region endi?`,
      hard_negative: `Sadurunge aktivasi rilis proyek ${value.entity}, apa sing wajib ditindakake?`,
      no_result: `Nomor paspor pemilik proyek ${value.entity} pira?`,
    },
  };
  return queries[language][category];
}

function buildFixture(scale: ScaleName, groupOffset = 0, queryPrefix = "") {
  const config = SCALE[scale];
  const statements: Statement[] = [];
  for (let index = 0; index < config.groups; index += 1) {
    const group = groupOffset + index;
    const language = groupLanguage(index, config.queriesPerStratum);
    for (const kind of RECORD_KINDS)
      statements.push({
        id: statementId(group, kind),
        group,
        kind,
        language,
        text: renderStatement(kind, language, group),
      });
  }

  const targetKind: Record<Exclude<Category, "no_result">, RecordKind> = {
    exact: "incident",
    paraphrase: "retention",
    cross_language: "backup_region",
    hard_negative: "release_requirement",
  };
  const queries: QueryCase[] = [];
  const categoryBlock = LANGUAGES.length * config.queriesPerStratum;
  for (const [categoryIndex, category] of CATEGORIES.entries()) {
    for (const [languageIndex, language] of LANGUAGES.entries()) {
      for (let ordinal = 0; ordinal < config.queriesPerStratum; ordinal += 1) {
        const group = groupOffset + categoryIndex * categoryBlock + languageIndex * config.queriesPerStratum + ordinal;
        const relevantId = category === "no_result" ? null : statementId(group, targetKind[category]);
        queries.push({
          id: `q_${queryPrefix}${category}_${language.replace("-", "_")}_${pad(ordinal, 3)}`,
          category,
          language,
          text: renderQuery(category, language, group),
          relevantId,
        });
      }
    }
  }
  assert.ok(queries.every((query) => query.relevantId === null || statements.some((row) => row.id === query.relevantId)));
  return { statements, queries };
}

function splitFixture(queries: QueryCase[]) {
  const assignments = new Map<string, Split>();
  for (const category of CATEGORIES) {
    for (const language of LANGUAGES) {
      const stratum = queries
        .filter((query) => query.category === category && query.language === language)
        .sort((left, right) =>
          sha256(`${SPLIT_SALT}\0${left.id}`).localeCompare(sha256(`${SPLIT_SALT}\0${right.id}`)),
        );
      assert.equal(stratum.length % 2, 0, "each stratum must split exactly in half");
      stratum.forEach((query, index) => assignments.set(query.id, index < stratum.length / 2 ? "calibration" : "holdout"));
    }
  }
  assert.equal(assignments.size, queries.length);
  const calibration = queries.filter((query) => assignments.get(query.id) === "calibration");
  const holdout = queries.filter((query) => assignments.get(query.id) === "holdout");
  const checksum = sha256(
    [...assignments.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, split]) => `${id}:${split}`)
      .join("\n"),
  );
  return { calibration, holdout, assignments, checksum };
}

function validationFixture(queries: QueryCase[]) {
  const assignments = new Map(queries.map((query) => [query.id, "holdout" as const]));
  const checksum = sha256(
    `${VALIDATION_SALT}\n${[...assignments]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, split]) => `${id}:${split}`)
      .join("\n")}`,
  );
  return { calibration: [] as QueryCase[], holdout: queries, assignments, checksum };
}

function loadProviderConfig(): ProviderConfig {
  const baseUrl = (
    process.env.TITEN_EVAL_EMBED_BASE_URL ?? process.env.TITEN_EMBED_BASE_URL ?? ""
  ).replace(/\/+$/, "");
  const model = process.env.TITEN_EVAL_EMBED_MODEL ?? process.env.TITEN_EMBED_MODEL ?? "";
  const dimensions = Number(process.env.TITEN_EVAL_EMBED_DIMS ?? process.env.TITEN_EMBED_DIMS ?? "");
  const apiKey = process.env.TITEN_EVAL_EMBED_API_KEY ?? process.env.TITEN_EMBED_API_KEY ?? "";
  if (!baseUrl || !model || !Number.isSafeInteger(dimensions) || dimensions < 1)
    throw new Error("Embedding base URL, model, and positive integer dimensions are required");
  const parsed = new URL(baseUrl);
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error("Embedding base URL must be HTTP(S) without credentials, query, or fragment");
  return { baseUrl, model, dimensions, apiKey };
}

function normalize(vector: Float32Array) {
  let squared = 0;
  for (const value of vector) squared += value * value;
  const norm = Math.sqrt(squared);
  if (!Number.isFinite(norm) || norm === 0) throw new Error("Embedding vector norm must be finite and non-zero");
  const unit = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) unit[index] = vector[index]! / norm;
  return { unit, norm };
}

function createProvider(config: ProviderConfig) {
  const responseModels = new Set<string>();
  return {
    responseModels,
    async embed(texts: string[]) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
      const started = performance.now();
      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}/embeddings`, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: config.model, input: texts }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError")
          throw new Error("Embedding request failed: TIMEOUT");
        throw new Error("Embedding request failed: NETWORK");
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Embedding request failed: HTTP_${response.status}`);
      }
      let root: unknown;
      try {
        root = await response.json();
      } catch {
        throw new Error("Embedding request failed: INVALID_JSON");
      }
      if (!root || typeof root !== "object" || !Array.isArray((root as { data?: unknown }).data))
        throw new Error("Embedding response omitted data");
      const responseModel = (root as { model?: unknown }).model;
      if (typeof responseModel === "string") responseModels.add(responseModel);
      const entries = (root as { data: unknown[] }).data.map((entry, position) => {
        if (!entry || typeof entry !== "object" || !Array.isArray((entry as { embedding?: unknown }).embedding))
          throw new Error("Embedding response contained an invalid entry");
        const index = (entry as { index?: unknown }).index;
        return {
          index: Number.isSafeInteger(index) ? Number(index) : position,
          embedding: (entry as { embedding: unknown[] }).embedding,
        };
      });
      entries.sort((left, right) => left.index - right.index);
      if (entries.length !== texts.length || entries.some((entry, index) => entry.index !== index))
        throw new Error("Embedding response count or order did not match the request");
      const vectors = entries.map((entry) => {
        if (entry.embedding.length !== config.dimensions)
          throw new Error("Embedding response dimension mismatch");
        const vector = new Float32Array(config.dimensions);
        for (let index = 0; index < entry.embedding.length; index += 1) {
          const value = entry.embedding[index];
          if (typeof value !== "number" || !Number.isFinite(value))
            throw new Error("Embedding response contained a non-finite value");
          vector[index] = value;
        }
        return vector;
      });
      return { vectors, latencyMs: round(performance.now() - started, 3) };
    },
  };
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

function latencySummary(values: number[]) {
  return {
    batches: values.length,
    p50_ms: round(percentile(values, 0.5), 3),
    p95_ms: round(percentile(values, 0.95), 3),
    p99_ms: round(percentile(values, 0.99), 3),
  };
}

function proportion(successes: number, samples: number): Proportion | null {
  if (samples === 0) return null;
  const z = 1.959963984540054;
  const rate = successes / samples;
  const denominator = 1 + (z * z) / samples;
  const center = (rate + (z * z) / (2 * samples)) / denominator;
  const margin =
    (z / denominator) * Math.sqrt((rate * (1 - rate)) / samples + (z * z) / (4 * samples * samples));
  return {
    successes,
    samples,
    rate: round(rate),
    wilson_95: { low: round(Math.max(0, center - margin)), high: round(Math.min(1, center + margin)) },
  };
}

function filtered(trial: RawTrial, threshold: number) {
  return trial.ranked_top_10.filter((hit) => hit.cosine >= threshold);
}

const f1Score = (precision: number | null, recall: number | null) =>
  precision === null || recall === null || precision + recall === 0
    ? null
    : round((2 * precision * recall) / (precision + recall));

/**
 * Precision is micro-averaged over every trial, no-result queries included: the
 * denominator counts the results the threshold actually returned, so returning
 * junk to lift recall shows up here. Each answerable query has exactly one
 * relevant statement, so the numerator is the recall@k count.
 */
function quality(trials: RawTrial[], threshold: number) {
  const positive = trials.filter((trial) => trial.relevant_statement_id !== null);
  const empty = trials.filter((trial) => trial.relevant_statement_id === null);
  let recall1 = 0;
  let recall5 = 0;
  let coverage = 0;
  let reciprocalRank = 0;
  let ndcg = 0;
  let returned1 = 0;
  let returned5 = 0;
  for (const trial of trials) {
    const hits = filtered(trial, threshold);
    returned1 += Math.min(1, hits.length);
    returned5 += Math.min(5, hits.length);
    if (trial.relevant_statement_id === null) continue;
    if (hits.length > 0) coverage += 1;
    const rank = hits.findIndex((hit) => hit.statement_id === trial.relevant_statement_id);
    if (rank === 0) recall1 += 1;
    if (rank >= 0 && rank < 5) recall5 += 1;
    if (rank >= 0 && rank < 10) {
      reciprocalRank += 1 / (rank + 1);
      ndcg += 1 / Math.log2(rank + 2);
    }
  }
  const falsePositives = empty.filter((trial) => filtered(trial, threshold).length > 0).length;
  const recallAt1 = proportion(recall1, positive.length);
  const recallAt5 = proportion(recall5, positive.length);
  const precisionAt1 = returned1 === 0 ? null : round(recall1 / returned1);
  const precisionAt5 = returned5 === 0 ? null : round(recall5 / returned5);
  return {
    samples: trials.length,
    answerable_samples: positive.length,
    no_result_samples: empty.length,
    recall_at_1: recallAt1,
    recall_at_5: recallAt5,
    precision_at_1: precisionAt1,
    precision_at_5: precisionAt5,
    f1_at_1: f1Score(precisionAt1, recallAt1?.rate ?? null),
    f1_at_5: f1Score(precisionAt5, recallAt5?.rate ?? null),
    mrr_at_10: positive.length === 0 ? null : round(reciprocalRank / positive.length),
    ndcg_at_10: positive.length === 0 ? null : round(ndcg / positive.length),
    answerable_coverage: proportion(coverage, positive.length),
    answerable_abstention: proportion(positive.length - coverage, positive.length),
    no_result_abstention: proportion(empty.length - falsePositives, empty.length),
    no_result_false_positive: proportion(falsePositives, empty.length),
  };
}

function subgroupQuality(trials: RawTrial[], threshold: number) {
  const byLanguage = Object.fromEntries(
    LANGUAGES.map((language) => [language, quality(trials.filter((trial) => trial.language === language), threshold)]),
  );
  const byCategory = Object.fromEntries(
    CATEGORIES.map((category) => [category, quality(trials.filter((trial) => trial.category === category), threshold)]),
  );
  const byStratum = Object.fromEntries(
    CATEGORIES.flatMap((category) =>
      LANGUAGES.map((language) => [
        `${category}:${language}`,
        quality(trials.filter((trial) => trial.category === category && trial.language === language), threshold),
      ]),
    ),
  );
  return { overall: quality(trials, threshold), by_language: byLanguage, by_category: byCategory, by_stratum: byStratum };
}

function selectThreshold(calibration: RawTrial[]) {
  const noResult = calibration.filter((trial) => trial.relevant_statement_id === null);
  assert.ok(noResult.length > 0, "calibration requires no-result queries");
  const topScores = noResult.map((trial) => trial.ranked_top_10[0]?.cosine ?? -1);
  const candidates = [...new Set([...topScores.map((score) => round(score + 1e-9, 12)), 1.000000001])]
    .sort((left, right) => left - right);
  const positive = calibration.filter((trial) => trial.relevant_statement_id !== null);
  const evaluated = candidates.map((threshold) => {
    const falsePositives = noResult.filter((trial) => filtered(trial, threshold).length > 0).length;
    const recall5 = positive.filter((trial) =>
      filtered(trial, threshold).slice(0, 5).some((hit) => hit.statement_id === trial.relevant_statement_id),
    ).length;
    return { threshold, falsePositives, recall5 };
  });
  const valid = evaluated.filter((candidate) => candidate.falsePositives === 0);
  assert.ok(valid.length > 0, "a zero-false-positive threshold must exist");
  valid.sort((left, right) => right.recall5 - left.recall5 || left.threshold - right.threshold);
  const selected = valid[0]!;
  return {
    cosine_threshold: selected.threshold,
    objective: "zero_no_result_false_positives_then_maximize_recall_at_5",
    candidate_count: candidates.length,
    zero_fp_candidate_count: valid.length,
    maximum_calibration_no_result_top_score: round(Math.max(...topScores), 9),
    calibration_recall_at_5: proportion(selected.recall5, positive.length),
    calibration_no_result_false_positive: proportion(0, noResult.length),
  };
}

function cosineFromStoreScore(score: number) {
  return round(score, 9);
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

function writeArtifacts(
  directory: string,
  raw: RawTrial[],
  manifest: Record<string, unknown>,
  summary: Record<string, any>,
  forbidden: string[],
) {
  const rawText = `${raw.map((trial) => JSON.stringify(trial)).join("\n")}\n`;
  const rawSha = sha256(rawText);
  manifest.checksums = { ...(manifest.checksums as object), raw_trials_sha256: rawSha };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  summary.checksums = {
    ...(summary.checksums as object),
    raw_trials_sha256: rawSha,
    manifest_sha256: sha256(manifestText),
  };
  const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
  const holdout = summary.quality.holdout.overall;
  const validation = summary.validation_fixture === true;
  const pct = (metric: Proportion | null) => (metric ? `${(metric.rate * 100).toFixed(1)}%` : "n/a");
  const reportText = [
    `# Embedding ${summary.benchmark_version} — ${summary.scale}`,
    "",
    `Run: \`${summary.run_id}\``,
    `Model: \`${summary.embedding.model}\` (${summary.embedding.dimensions} dimensions)`,
    `Preprocessing: \`${summary.embedding.preprocessing.id}\``,
    `Threshold: \`${summary.threshold.cosine_threshold}\` (${validation ? "fixed before the disjoint validation; no tuning" : "selected from calibration only"})`,
    "",
    validation ? "## Disjoint validation holdout" : "## Locked holdout",
    "",
    `- Recall@1: ${pct(holdout.recall_at_1)}`,
    `- Recall@5: ${pct(holdout.recall_at_5)}`,
    `- Precision@1: ${holdout.precision_at_1 ?? "n/a"} (F1 ${holdout.f1_at_1 ?? "n/a"})`,
    `- Precision@5: ${holdout.precision_at_5 ?? "n/a"} (F1 ${holdout.f1_at_5 ?? "n/a"})`,
    `- MRR@10: ${holdout.mrr_at_10 ?? "n/a"}`,
    `- nDCG@10: ${holdout.ndcg_at_10 ?? "n/a"}`,
    `- no-result false positives: ${pct(holdout.no_result_false_positive)}`,
    `- answerable abstention: ${pct(holdout.answerable_abstention)}`,
    "",
    validation
      ? "This validates one deployment-specific profile and threshold; it does not publish a universal default."
      : summary.scale === "full"
      ? "This is the scale-S embedding-only lane; it is not a Mem0 replacement decision."
      : "This is a smoke-scale harness check; the 10,000-statement/600-query scale-S gate remains open.",
    "",
  ].join("\n");
  const files: Record<string, string> = {
    "raw.jsonl": rawText,
    "manifest.json": manifestText,
    "summary.json": summaryText,
    "report.md": reportText,
  };
  for (const text of Object.values(files)) safeArtifact(text, forbidden);
  for (const [name, text] of Object.entries(files))
    writeFileSync(resolve(directory, name), text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const checksums = `${Object.entries(files)
    .map(([name, text]) => `${sha256(text)}  ${name}`)
    .sort()
    .join("\n")}\n`;
  safeArtifact(checksums, forbidden);
  writeFileSync(resolve(directory, "SHA256SUMS"), checksums, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

async function run(options: Options) {
  const benchmarkVersion = options.validation ? VALIDATION_VERSION : BENCHMARK_VERSION;
  const config = loadProviderConfig();
  const source = gitState();
  const fixture = buildFixture(
    options.scale,
    options.validation ? VALIDATION_GROUP_OFFSET : 0,
    options.validation ? "v2_" : "",
  );
  const split = options.validation ? validationFixture(fixture.queries) : splitFixture(fixture.queries);
  const expected = SCALE[options.scale];
  assert.equal(fixture.statements.length, expected.groups * RECORD_KINDS.length);
  assert.equal(fixture.queries.length, expected.queriesPerStratum * LANGUAGES.length * CATEGORIES.length);
  if (options.scale === "full") {
    assert.equal(fixture.statements.length, 10_000);
    assert.equal(fixture.queries.length, 600);
  }
  const fixtureSha = sha256(JSON.stringify({
    benchmark_version: benchmarkVersion,
    scale: options.scale,
    statements: fixture.statements,
    queries: fixture.queries,
  }));
  const provider = createProvider(config);
  const tempDirectory = mkdtempSync(join(tmpdir(), `titen-${benchmarkVersion}-`));
  const vectorPath = join(tempDirectory, "vectors.db");
  const store = createSqliteVecStore(vectorPath, config.dimensions);
  if (!store) {
    rmSync(tempDirectory, { recursive: true, force: true });
    throw new Error("sqlite-vec is unavailable; exact native ranking cannot run");
  }

  const statementBatchLatency: number[] = [];
  const calibrationBatchLatency: number[] = [];
  const holdoutBatchLatency: number[] = [];
  const retrievalLatency: number[] = [];
  const observedNorms = { count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: 0 };
  const observeNorm = (norm: number) => {
    observedNorms.count += 1;
    observedNorms.sum += norm;
    observedNorms.min = Math.min(observedNorms.min, norm);
    observedNorms.max = Math.max(observedNorms.max, norm);
  };
  const started = performance.now();

  const rankQueries = async (queries: QueryCase[], splitName: Split, latencies: number[]) => {
    const trials: RawTrial[] = [];
    for (let offset = 0; offset < queries.length; offset += options.batchSize) {
      const batch = queries.slice(offset, offset + options.batchSize);
      const embedded = await provider.embed(batch.map((query) => preprocess(options.preprocessing, "query", query.text)));
      latencies.push(embedded.latencyMs);
      for (let index = 0; index < batch.length; index += 1) {
        const normalized = normalize(embedded.vectors[index]!);
        observeNorm(normalized.norm);
        const retrievalStarted = performance.now();
        const hits = await store.query(normalized.unit, {
          topK: TOP_K,
          filter: { org_id: benchmarkVersion, subject_id: "synthetic" },
        });
        const retrievalMs = round(performance.now() - retrievalStarted, 3);
        retrievalLatency.push(retrievalMs);
        trials.push({
          schema_version: SCHEMA_VERSION,
          benchmark_version: benchmarkVersion,
          query_id: batch[index]!.id,
          split: splitName,
          language: batch[index]!.language,
          category: batch[index]!.category,
          relevant_statement_id: batch[index]!.relevantId,
          ranked_top_10: hits.map((hit) => ({ statement_id: hit.id, cosine: cosineFromStoreScore(hit.score) })),
          retrieval_ms: retrievalMs,
        });
      }
    }
    return trials;
  };

  try {
    for (let offset = 0; offset < fixture.statements.length; offset += options.batchSize) {
      const batch = fixture.statements.slice(offset, offset + options.batchSize);
      const embedded = await provider.embed(
        batch.map((statement) => preprocess(options.preprocessing, "document", statement.text)),
      );
      statementBatchLatency.push(embedded.latencyMs);
      await store.upsert(
        batch.map((statement, index) => {
          const normalized = normalize(embedded.vectors[index]!);
          observeNorm(normalized.norm);
          return {
            id: statement.id,
            vector: normalized.unit,
            metadata: { org_id: benchmarkVersion, subject_id: "synthetic", project_id: "" },
          };
        }),
      );
    }

    const calibrationTrials = await rankQueries(split.calibration, "calibration", calibrationBatchLatency);
    const threshold: Record<string, any> = options.validation
      ? {
          cosine_threshold: VALIDATION_THRESHOLD,
          objective: "predeclared_profile_threshold_validation_without_tuning",
          selected_on_current_fixture: false,
          source_benchmark_version: BENCHMARK_VERSION,
        }
      : selectThreshold(calibrationTrials);
    if (!options.validation)
      assert.equal(threshold.calibration_no_result_false_positive?.successes, 0);

    // The threshold is immutable before the first holdout embedding/query call.
    const holdoutTrials = await rankQueries(split.holdout, "holdout", holdoutBatchLatency);
    const trials = [...calibrationTrials, ...holdoutTrials].sort((left, right) => left.query_id.localeCompare(right.query_id));
    const elapsedMs = performance.now() - started;
    const endpointHash = sha256(config.baseUrl);
    const responseModels = [...provider.responseModels].sort();
    const preprocessing = {
      id: options.preprocessing,
      ...PREPROCESSING[options.preprocessing],
      sha256: sha256(JSON.stringify(PREPROCESSING[options.preprocessing])),
    };
    const fingerprintMaterial = {
      provider_endpoint_sha256: endpointHash,
      requested_model: config.model,
      response_models: responseModels,
      dimensions: config.dimensions,
      metric: "cosine",
      stored_precision: "float32",
      ranking: "sqlite-vec exact L2 over unit vectors; cosine=1-(distance^2/2)",
      preprocessing,
    };
    const modelFingerprint = sha256(JSON.stringify(fingerprintMaterial));
    const vectorBytes = statSync(vectorPath).size;
    const manifest: Record<string, unknown> = {
      schema_version: SCHEMA_VERSION,
      benchmark_version: benchmarkVersion,
      run_id: `${options.validation ? "s_val" : "s_cal"}_${randomUUID()}`,
      scale: options.scale,
      source,
      fixture: {
        statements: fixture.statements.length,
        queries: fixture.queries.length,
        calibration_queries: split.calibration.length,
        holdout_queries: split.holdout.length,
        id: benchmarkVersion,
        group_offset: options.validation ? VALIDATION_GROUP_OFFSET : 0,
        split_salt_sha256: sha256(options.validation ? VALIDATION_SALT : SPLIT_SALT),
        languages: LANGUAGES,
        categories: CATEGORIES,
        fixture_sha256: fixtureSha,
        split_sha256: split.checksum,
      },
      embedding: {
        model: config.model,
        response_models: responseModels,
        dimensions: config.dimensions,
        provider_endpoint_sha256: endpointHash,
        authenticated: config.apiKey.length > 0,
        immutable_revision_attested: false,
        fingerprint_sha256: modelFingerprint,
        metric: "cosine",
        stored_precision: "float32",
        preprocessing,
      },
      execution: {
        batch_size: options.batchSize,
        preprocessing_profile: options.preprocessing,
        top_k: TOP_K,
        threshold_selected_before_holdout: true,
        threshold_tuned_on_current_fixture: !options.validation,
        vector_database: "disposable sqlite-vec",
        vector_database_bytes_before_cleanup: vectorBytes,
        raw_embeddings_retained: false,
        elapsed_ms: round(elapsedMs, 3),
      },
      host: hostSnapshot(),
      checksums: { fixture_sha256: fixtureSha, split_sha256: split.checksum, model_fingerprint_sha256: modelFingerprint },
    };
    const summary: Record<string, any> = {
      schema_version: SCHEMA_VERSION,
      benchmark_version: benchmarkVersion,
      run_id: manifest.run_id,
      scale: options.scale,
      validation_fixture: options.validation,
      replacement_decision: "NOT_EVALUATED_EMBEDDING_ONLY",
      scale_s_gate_executed: options.scale === "full",
      counts: manifest.fixture,
      embedding: manifest.embedding,
      threshold,
      quality: {
        calibration: options.validation ? null : subgroupQuality(calibrationTrials, threshold.cosine_threshold),
        holdout: subgroupQuality(holdoutTrials, threshold.cosine_threshold),
      },
      latency: {
        statement_embedding_batches: latencySummary(statementBatchLatency),
        calibration_embedding_batches: latencySummary(calibrationBatchLatency),
        holdout_embedding_batches: latencySummary(holdoutBatchLatency),
        native_retrieval: latencySummary(retrievalLatency),
        elapsed_ms: round(elapsedMs, 3),
      },
      provider_vector_norm: {
        samples: observedNorms.count,
        min: round(observedNorms.min, 6),
        mean: round(observedNorms.sum / observedNorms.count, 6),
        max: round(observedNorms.max, 6),
      },
      checksums: { fixture_sha256: fixtureSha, split_sha256: split.checksum, model_fingerprint_sha256: modelFingerprint },
      limitations: [
        "The provider did not attest an immutable embedding revision.",
        ...(options.validation
          ? ["The fixed profile and threshold remain deployment-specific and are not a bundled universal default."]
          : []),
        "This embedding-only lane does not test authorization, evidence, lifecycle, LLM enrichment, or Mem0 parity.",
        ...(options.scale === "smoke" ? ["Smoke scale does not satisfy the 10,000-statement/600-query scale-S gate."] : []),
      ],
    };

    prepareOutput(options.out);
    writeArtifacts(options.out, trials, manifest, summary, [config.apiKey, config.baseUrl, fixture.statements[0]!.text, fixture.queries[0]!.text]);
    console.log(`ok ${benchmarkVersion} scale=${options.scale} statements=${fixture.statements.length} queries=${fixture.queries.length}`);
    console.log(`holdout_recall_at_5=${summary.quality.holdout.overall.recall_at_5.rate}`);
    console.log(`holdout_precision_at_5=${summary.quality.holdout.overall.precision_at_5}`);
    console.log(`holdout_f1_at_5=${summary.quality.holdout.overall.f1_at_5}`);
    console.log(`holdout_no_result_false_positive=${summary.quality.holdout.overall.no_result_false_positive.rate}`);
    console.log(`artifacts=${options.out}`);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
    assert.equal(existsSync(tempDirectory), false, "disposable vector database must be removed");
  }
}

function selfTest() {
  const full = buildFixture("full");
  const smoke = buildFixture("smoke");
  const validation = buildFixture("full", VALIDATION_GROUP_OFFSET, "v2_");
  assert.equal(full.statements.length, 10_000);
  assert.equal(full.queries.length, 600);
  assert.equal(smoke.statements.length, 600);
  assert.equal(smoke.queries.length, 60);
  assert.equal(new Set(full.statements.map((row) => row.id)).size, full.statements.length);
  assert.equal(new Set(full.queries.map((row) => row.id)).size, full.queries.length);
  assert.equal(validation.statements.length, 10_000);
  assert.equal(validation.queries.length, 600);
  const priorStatementIds = new Set(full.statements.map((row) => row.id));
  const priorStatementText = new Set(full.statements.map((row) => row.text));
  const priorQueryIds = new Set(full.queries.map((row) => row.id));
  const priorQueryText = new Set(full.queries.map((row) => row.text));
  assert.equal(
    validation.statements.some((row) => priorStatementIds.has(row.id) || priorStatementText.has(row.text)),
    false,
  );
  assert.equal(
    validation.queries.some((row) => priorQueryIds.has(row.id) || priorQueryText.has(row.text)),
    false,
  );
  const validationSplit = validationFixture(validation.queries);
  assert.equal(validationSplit.calibration.length, 0);
  assert.equal(validationSplit.holdout.length, 600);
  for (const category of CATEGORIES)
    for (const language of LANGUAGES)
      assert.equal(
        validationSplit.holdout.filter((row) => row.category === category && row.language === language).length,
        40,
      );
  assert.throws(
    () => parseArgs(["--validation-v2", "--scale", "full"]),
    /requires --scale full --preprocessing embeddinggemma-retrieval-v1/,
  );
  const validationOptions = parseArgs([
    "--validation-v2",
    "--scale", "full",
    "--preprocessing", "embeddinggemma-retrieval-v1",
    "--out", "/tmp/titen-validation-self-test",
  ]);
  assert.notEqual(typeof validationOptions, "string");
  if (typeof validationOptions !== "string") {
    assert.equal(validationOptions.validation, true);
    assert.equal(validationOptions.scale, "full");
    assert.equal(validationOptions.preprocessing, "embeddinggemma-retrieval-v1");
  }
  const split = splitFixture(full.queries);
  assert.equal(
    sha256(JSON.stringify({ benchmark_version: BENCHMARK_VERSION, scale: "full", ...full })),
    "18affc5931bc7eaf8f0da3249e83b0d523d39c573118b29d4289e4fe20228992",
  );
  assert.equal(split.checksum, "01767a26076a3ddb2e326d073ddcf6aada080c3552d3511a4f1f3c506adf9dcb");
  assert.equal(split.calibration.length, 300);
  assert.equal(split.holdout.length, 300);
  for (const category of CATEGORIES)
    for (const language of LANGUAGES) {
      assert.equal(split.calibration.filter((row) => row.category === category && row.language === language).length, 20);
      assert.equal(split.holdout.filter((row) => row.category === category && row.language === language).length, 20);
    }
  const fake = (id: string, relevant: string | null, score: number): RawTrial => ({
    schema_version: SCHEMA_VERSION,
    benchmark_version: BENCHMARK_VERSION,
    query_id: id,
    split: "calibration",
    language: "id",
    category: relevant ? "exact" : "no_result",
    relevant_statement_id: relevant,
    ranked_top_10: [{ statement_id: relevant ?? "decoy", cosine: score }],
    retrieval_ms: 1,
  });
  const calibration = [fake("positive", "gold", 0.8), fake("empty", null, 0.4)];
  const threshold = selectThreshold(calibration);
  assert.ok(threshold.cosine_threshold > 0.4);
  assert.equal(threshold.calibration_recall_at_5?.rate, 1);
  assert.equal(quality(calibration, threshold.cosine_threshold).no_result_false_positive?.rate, 0);
  // A perfect-recall run that also returns a decoy and answers a no-result query
  // must report precision below recall, and F1 between the two.
  const answerable = fake("answerable", "gold", 0.9);
  answerable.ranked_top_10 = [
    { statement_id: "gold", cosine: 0.9 },
    { statement_id: "decoy", cosine: 0.8 },
  ];
  const noisy = quality([answerable, fake("no_result", null, 0.85)], 0.5);
  assert.equal(noisy.recall_at_1?.rate, 1);
  assert.equal(noisy.recall_at_5?.rate, 1);
  assert.equal(noisy.precision_at_1, 0.5);
  assert.equal(noisy.precision_at_5, round(1 / 3));
  assert.equal(noisy.f1_at_1, round(2 / 3));
  assert.equal(noisy.f1_at_5, 0.5);
  const emptyQuality = quality([], 0.5);
  assert.equal(emptyQuality.precision_at_1, null);
  assert.equal(emptyQuality.f1_at_5, null);
  assert.equal(cosineFromStoreScore(1), 1);
  assert.equal(cosineFromStoreScore(0.25), 0.25);
  assert.deepEqual(splitFixture(full.queries).checksum, split.checksum);
  assert.equal(preprocess("raw-v1", "query", "hello"), "hello");
  assert.equal(
    preprocess("embeddinggemma-retrieval-v1", "document", "hello"),
    "title: none | text: hello",
  );
  assert.equal(
    preprocess("embeddinggemma-retrieval-v1", "query", "hello"),
    "task: search result | query: hello",
  );
  assert.ok(proportion(10, 10)!.wilson_95.low < 1);
  console.log(`self-test ok fixture_sha256=${sha256(JSON.stringify(full))}`);
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
