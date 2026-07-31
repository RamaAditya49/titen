#!/usr/bin/env bun
/** Synthetic, reversible Mem0 -> Titen migration rehearsal. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_VERSION = "titen-mem0-migration-v1";
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_DRAIN_PASSES = 20;

interface Options {
  out: string;
  count: number;
}

type Phase =
  | "mem0_create"
  | "mem0_export"
  | "titen_observe"
  | "titen_consolidate"
  | "titen_observe_replay"
  | "titen_consolidate_replay"
  | "titen_index_drain"
  | "titen_recall"
  | "titen_evidence"
  | "mem0_cleanup";

interface RawTrial {
  schema_version: 1;
  phase: Phase;
  ordinal: number;
  status: "ok" | "error";
  http_status: number | null;
  latency_ms: number;
  source_id_sha256: string | null;
  observation_id_sha256: string | null;
  claim_id_sha256: string | null;
  result_count: number | null;
  expected_found: boolean | null;
  error_code: string | null;
}

interface Fixture {
  ordinal: number;
  fixtureId: string;
  statement: string;
  query: string;
}

interface ExportedSource {
  fixture: Fixture;
  mem0Id: string;
  content: string;
  sourceRef: string;
}

interface ImportedRecord extends ExportedSource {
  observationBody: Record<string, unknown>;
  observationKey: string;
  observationId: string;
  claimBody: Record<string, unknown>;
  claimKey: string;
  claimId: string;
}

interface HttpResult {
  status: number;
  value: unknown;
}

interface StepResult<T> {
  httpStatus: number;
  value: T;
  ids?: Partial<Pick<RawTrial, "source_id_sha256" | "observation_id_sha256" | "claim_id_sha256">>;
  resultCount?: number;
  expectedFound?: boolean;
}

class HttpFailure extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number | null,
  ) {
    super(code);
    this.name = "HttpFailure";
  }
}

class RehearsalFailure extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number | null = null,
  ) {
    super(code);
    this.name = "RehearsalFailure";
  }
}

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const round = (value: number) => Number(value.toFixed(3));
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const asObject = (value: unknown) => (isObject(value) ? value : {});
const asArray = (value: unknown) => (Array.isArray(value) ? value : []);
const stringField = (value: unknown, field: string) => {
  const candidate = asObject(value)[field];
  return typeof candidate === "string" ? candidate : "";
};
const numberField = (value: unknown, field: string) => {
  const candidate = asObject(value)[field];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
};
const idHash = (value: string) => sha256(value);
const rate = (passed: number, expected: number) => expected === 0 ? 0 : round(passed / expected);

function parseArgs(argv: string[]): Options | "help" | "self-test" {
  let out = "";
  let count = 20;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") return "help";
    if (arg === "--self-test") return "self-test";
    if (arg !== "--out" && arg !== "--count") throw new Error(`Unknown argument: ${arg}`);
    const value = argv[++index];
    if (!value) throw new Error(`Missing value for ${arg}`);
    if (arg === "--out") out = resolve(value);
    else {
      if (!/^\d+$/u.test(value)) throw new Error("--count must be an integer between 5 and 100");
      count = Number(value);
    }
  }
  if (!out) throw new Error("--out DIR is required");
  if (!Number.isSafeInteger(count) || count < 5 || count > 100)
    throw new Error("--count must be an integer between 5 and 100");
  return { out, count };
}

function usage() {
  return [
    "Usage:",
    "  bun scripts/benchmark-mem0-migration.ts --out DIR [--count 20]",
    "  bun scripts/benchmark-mem0-migration.ts --self-test",
  ].join("\n");
}

function validateBaseUrl(label: string, value: string) {
  const parsed = new URL(value);
  if (!/^https?:$/u.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error(`${label} must be an HTTP(S) base URL without credentials, query, or fragment`);
}

function resultArray(value: unknown): unknown[] {
  const root = asObject(value);
  const data = asObject(root.data);
  if (Array.isArray(root.results)) return root.results;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(root.data)) return root.data;
  return Array.isArray(value) ? value : [];
}

function mem0Record(value: unknown) {
  const root = asObject(value);
  if (isObject(root.data)) return root.data;
  if (Array.isArray(root.data) && root.data.length === 1) return asObject(root.data[0]);
  return root;
}

function titenEnvelope(value: unknown) {
  const root = asObject(value);
  return { data: asObject(root.data), meta: asObject(root.meta) };
}

function recallScore(value: unknown, expectedClaimId: string) {
  const { data } = titenEnvelope(value);
  const items = asArray(data.items);
  return {
    found: items.some((item) => stringField(item, "claim_id") === expectedClaimId),
    count: items.length,
  };
}

function evidenceScore(
  value: unknown,
  expectedClaimId: string,
  expectedObservationId: string,
  expectedSourceRef: string,
) {
  const { data } = titenEnvelope(value);
  const evidence = asObject(data.evidence);
  const supporting = asArray(evidence.supporting);
  const source = asObject(asObject(supporting[0]).source);
  return supporting.length === 1
    && stringField(data.claim, "claim_id") === expectedClaimId
    && stringField(supporting[0], "observation_id") === expectedObservationId
    && stringField(supporting[0], "kind") === "imported_source"
    && stringField(source, "type") === "mem0_import"
    && stringField(source, "ref") === expectedSourceRef;
}

function safeError(error: unknown) {
  if (error instanceof HttpFailure || error instanceof RehearsalFailure) return error.code;
  if (error instanceof DOMException && error.name === "TimeoutError") return "HTTP_TIMEOUT";
  if (error instanceof Error) return `LOCAL_${error.name.replaceAll(/[^A-Za-z0-9_]/gu, "_")}`;
  return "LOCAL_UNKNOWN";
}

async function requestJson(
  base: string,
  headers: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<HttpResult> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: { ...headers, ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError")
      throw new HttpFailure("HTTP_TIMEOUT", null);
    throw error;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpFailure(`HTTP_${method}_${response.status}`, response.status);
  }
  const text = await response.text();
  if (!text) return { status: response.status, value: {} };
  try {
    return { status: response.status, value: JSON.parse(text) };
  } catch {
    throw new HttpFailure(`HTTP_${method}_INVALID_JSON`, response.status);
  }
}

function fixture(namespace: string, ordinal: number): Fixture {
  const locator = `TMR-${sha256(`${namespace}:${ordinal}`).slice(0, 14).toUpperCase()}`;
  const slot = String(ordinal).padStart(3, "0");
  return {
    ordinal,
    fixtureId: `migration_${slot}`,
    statement: `Synthetic migration record ${slot} uses locator ${locator} for verification slot ${slot}.`,
    query: `Which verification slot uses locator ${locator}?`,
  };
}

function prepareOut(directory: string) {
  if (existsSync(directory) && readdirSync(directory).length > 0)
    throw new Error("Output directory must be absent or empty");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function assertArtifactSafe(text: string, sensitive: string[]) {
  for (const value of sensitive)
    if (value && text.includes(value)) throw new Error("Artifact redaction check failed");
}

function writeArtifacts(
  directory: string,
  raw: RawTrial[],
  manifest: unknown,
  summary: any,
  sensitive: string[],
) {
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const report = [
    `# Mem0 to Titen synthetic migration rehearsal — ${FIXTURE_VERSION}`,
    "",
    `Status: **${summary.status}**`,
    `Verdict: **${summary.verdict}**`,
    "",
    `- requested sources: ${summary.requested_source_count}`,
    `- exported sources: ${summary.source_count}`,
    `- first pass: ${summary.first_pass.observations} observations, ${summary.first_pass.claims} claims`,
    `- replay pass: ${summary.replay_pass.observations} observations, ${summary.replay_pass.claims} claims`,
    `- stable replay IDs: ${percent(summary.idempotency.stable_id_rate)}`,
    `- recall: ${summary.recall.recalled}/${summary.recall.expected} (${percent(summary.recall.rate)})`,
    `- exact evidence: ${summary.evidence.exact}/${summary.evidence.expected} (${percent(summary.evidence.exact_rate)})`,
    `- Mem0 cleanup: ${summary.mem0_cleanup.deleted}/${summary.mem0_cleanup.attempted}`,
    "",
    "This is a synthetic direct-import rehearsal, not a production cutover or proof of automatic memory derivation.",
    "",
  ].join("\n");
  const files: Record<string, string> = {
    "raw.jsonl": `${raw.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "summary.json": `${JSON.stringify(summary, null, 2)}\n`,
    "report.md": report,
  };
  for (const text of Object.values(files)) assertArtifactSafe(text, sensitive);
  for (const [name, text] of Object.entries(files))
    writeFileSync(resolve(directory, name), text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const checksums = `${Object.entries(files)
    .map(([name, text]) => `${sha256(text)}  ${name}`)
    .sort()
    .join("\n")}\n`;
  assertArtifactSafe(checksums, sensitive);
  writeFileSync(resolve(directory, "SHA256SUMS"), checksums, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

async function run(options: Options) {
  const titenUrl = (process.env.TITEN_URL ?? "").replace(/\/+$/u, "");
  const titenKey = process.env.TITEN_KEY ?? "";
  const mem0Url = (process.env.MEM0_URL ?? "").replace(/\/+$/u, "");
  const mem0Key = process.env.MEM0_KEY ?? "";
  if (!titenUrl || !titenKey || !mem0Url || !mem0Key)
    throw new Error("TITEN_URL, TITEN_KEY, MEM0_URL, and MEM0_KEY are required");
  validateBaseUrl("TITEN_URL", titenUrl);
  validateBaseUrl("MEM0_URL", mem0Url);
  prepareOut(options.out);

  const startedAt = new Date().toISOString();
  const namespace = `mig_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const fixtures = Array.from({ length: options.count }, (_, index) => fixture(namespace, index + 1));
  const titenHeaders = { "content-type": "application/json", authorization: `Bearer ${titenKey}` };
  const mem0Headers = { "content-type": "application/json", "x-api-key": mem0Key };
  const raw: RawTrial[] = [];
  const mem0Created = new Set<string>();
  const exported: ExportedSource[] = [];
  const imported: ImportedRecord[] = [];
  const sensitive = new Set<string>([
    titenUrl,
    titenKey,
    mem0Url,
    mem0Key,
    namespace,
    ...fixtures.flatMap((item) => [item.fixtureId, item.statement, item.query]),
  ]);
  let replayedObservations = 0;
  let replayedClaims = 0;
  let firstObservations = 0;
  let firstClaims = 0;
  let stableObservationIds = 0;
  let stableClaimIds = 0;
  let recalled = 0;
  let exactEvidence = 0;
  let drainPasses = 0;
  let fatalCode: string | null = null;
  const cleanup = { attempted: 0, deleted: 0, failures: [] as string[] };

  const step = async <T>(
    phase: Phase,
    ordinal: number,
    knownIds: Partial<Pick<RawTrial, "source_id_sha256" | "observation_id_sha256" | "claim_id_sha256">>,
    task: () => Promise<StepResult<T>>,
  ) => {
    const started = performance.now();
    try {
      const result = await task();
      raw.push({
        schema_version: 1,
        phase,
        ordinal,
        status: "ok",
        http_status: result.httpStatus,
        latency_ms: round(performance.now() - started),
        source_id_sha256: result.ids?.source_id_sha256 ?? knownIds.source_id_sha256 ?? null,
        observation_id_sha256: result.ids?.observation_id_sha256 ?? knownIds.observation_id_sha256 ?? null,
        claim_id_sha256: result.ids?.claim_id_sha256 ?? knownIds.claim_id_sha256 ?? null,
        result_count: result.resultCount ?? null,
        expected_found: result.expectedFound ?? null,
        error_code: null,
      });
      return result.value;
    } catch (error) {
      raw.push({
        schema_version: 1,
        phase,
        ordinal,
        status: "error",
        http_status: error instanceof HttpFailure || error instanceof RehearsalFailure ? error.httpStatus : null,
        latency_ms: round(performance.now() - started),
        source_id_sha256: knownIds.source_id_sha256 ?? null,
        observation_id_sha256: knownIds.observation_id_sha256 ?? null,
        claim_id_sha256: knownIds.claim_id_sha256 ?? null,
        result_count: null,
        expected_found: null,
        error_code: safeError(error),
      });
      throw error;
    }
  };

  try {
    for (const item of fixtures) {
      const createdId = await step("mem0_create", item.ordinal, {}, async () => {
        const response = await requestJson(mem0Url, mem0Headers, "POST", "/memories", {
          messages: [{ role: "user", content: item.statement }],
          user_id: namespace,
          infer: false,
          metadata: { benchmark: FIXTURE_VERSION, run_id: namespace, fixture_id: item.fixtureId },
        });
        const ids = resultArray(response.value).map((entry) => stringField(entry, "id")).filter(Boolean);
        for (const id of ids) {
          mem0Created.add(id);
          sensitive.add(id);
        }
        if (ids.length !== 1) throw new RehearsalFailure("MEM0_CREATE_ID_CARDINALITY", response.status);
        return {
          httpStatus: response.status,
          value: ids[0]!,
          ids: { source_id_sha256: idHash(ids[0]!) },
          resultCount: ids.length,
        };
      });

      const source = await step("mem0_export", item.ordinal, { source_id_sha256: idHash(createdId) }, async () => {
        const response = await requestJson(mem0Url, mem0Headers, "GET", `/memories/${encodeURIComponent(createdId)}`);
        const record = mem0Record(response.value);
        const returnedId = stringField(record, "id");
        const content = stringField(record, "memory") || stringField(record, "content");
        if (returnedId && returnedId !== createdId)
          throw new RehearsalFailure("MEM0_EXPORT_ID_MISMATCH", response.status);
        if (!content || content !== item.statement)
          throw new RehearsalFailure("MEM0_EXPORT_CONTENT_MISMATCH", response.status);
        return { httpStatus: response.status, value: content };
      });
      const sourceRef = `mem0:${createdId}`;
      sensitive.add(sourceRef);
      exported.push({ fixture: item, mem0Id: createdId, content: source, sourceRef });
    }

    for (const source of exported) {
      const observationBody = {
        subject_id: namespace,
        run_id: namespace,
        kind: "imported_source",
        content: source.content,
        source: { type: "mem0_import", ref: source.sourceRef },
        trust: "asserted",
      };
      const observationKey = `migration-observation-${sha256(`${namespace}:${source.mem0Id}`).slice(0, 48)}`;
      sensitive.add(observationKey);
      const observationId = await step(
        "titen_observe",
        source.fixture.ordinal,
        { source_id_sha256: idHash(source.mem0Id) },
        async () => {
          const response = await requestJson(
            titenUrl,
            titenHeaders,
            "POST",
            "/v1/observations",
            observationBody,
            { "idempotency-key": observationKey },
          );
          const envelope = titenEnvelope(response.value);
          const id = stringField(envelope.data, "observation_id");
          if (!id) throw new RehearsalFailure("TITEN_OBSERVATION_ID_MISSING", response.status);
          if (envelope.meta.replayed === true)
            throw new RehearsalFailure("TITEN_FIRST_OBSERVATION_REPLAYED", response.status);
          sensitive.add(id);
          return {
            httpStatus: response.status,
            value: id,
            ids: { observation_id_sha256: idHash(id) },
          };
        },
      );
      firstObservations += 1;
      const claimBody = {
        subject_id: namespace,
        claims: [{
          kind: "semantic_fact",
          statement: source.content,
          confidence: 1,
          sources: [{ observation_id: observationId, relation: "supports" }],
        }],
      };
      const claimKey = `migration-claim-${sha256(`${namespace}:${source.mem0Id}`).slice(0, 48)}`;
      sensitive.add(claimKey);
      const claimId = await step(
        "titen_consolidate",
        source.fixture.ordinal,
        { source_id_sha256: idHash(source.mem0Id), observation_id_sha256: idHash(observationId) },
        async () => {
          const response = await requestJson(
            titenUrl,
            titenHeaders,
            "POST",
            "/v1/consolidations",
            claimBody,
            { "idempotency-key": claimKey },
          );
          const envelope = titenEnvelope(response.value);
          const id = stringField(asArray(envelope.data.claims)[0], "claim_id");
          if (!id) throw new RehearsalFailure("TITEN_CLAIM_ID_MISSING", response.status);
          if (envelope.data.model_used !== false)
            throw new RehearsalFailure("TITEN_DIRECT_CLAIM_USED_MODEL", response.status);
          if (envelope.meta.replayed === true)
            throw new RehearsalFailure("TITEN_FIRST_CLAIM_REPLAYED", response.status);
          sensitive.add(id);
          return { httpStatus: response.status, value: id, ids: { claim_id_sha256: idHash(id) } };
        },
      );
      firstClaims += 1;
      imported.push({
        ...source,
        observationBody,
        observationKey,
        observationId,
        claimBody,
        claimKey,
        claimId,
      });
    }

    for (const record of imported) {
      await step(
        "titen_observe_replay",
        record.fixture.ordinal,
        {
          source_id_sha256: idHash(record.mem0Id),
          observation_id_sha256: idHash(record.observationId),
        },
        async () => {
          const response = await requestJson(
            titenUrl,
            titenHeaders,
            "POST",
            "/v1/observations",
            record.observationBody,
            { "idempotency-key": record.observationKey },
          );
          const envelope = titenEnvelope(response.value);
          const id = stringField(envelope.data, "observation_id");
          if (id !== record.observationId || envelope.meta.replayed !== true)
            throw new RehearsalFailure("TITEN_OBSERVATION_REPLAY_MISMATCH", response.status);
          replayedObservations += 1;
          stableObservationIds += 1;
          return { httpStatus: response.status, value: undefined };
        },
      );
      await step(
        "titen_consolidate_replay",
        record.fixture.ordinal,
        {
          source_id_sha256: idHash(record.mem0Id),
          observation_id_sha256: idHash(record.observationId),
          claim_id_sha256: idHash(record.claimId),
        },
        async () => {
          const response = await requestJson(
            titenUrl,
            titenHeaders,
            "POST",
            "/v1/consolidations",
            record.claimBody,
            { "idempotency-key": record.claimKey },
          );
          const envelope = titenEnvelope(response.value);
          const id = stringField(asArray(envelope.data.claims)[0], "claim_id");
          if (id !== record.claimId || envelope.meta.replayed !== true)
            throw new RehearsalFailure("TITEN_CLAIM_REPLAY_MISMATCH", response.status);
          replayedClaims += 1;
          stableClaimIds += 1;
          return { httpStatus: response.status, value: undefined };
        },
      );
    }

    let remaining = 1;
    while (remaining > 0 && drainPasses < MAX_DRAIN_PASSES) {
      drainPasses += 1;
      remaining = await step("titen_index_drain", drainPasses, {}, async () => {
        const response = await requestJson(titenUrl, titenHeaders, "POST", "/v1/index/drain?limit=100");
        const { data } = titenEnvelope(response.value);
        const pending = numberField(data, "remaining");
        if (pending === null || !Number.isInteger(pending) || pending < 0)
          throw new RehearsalFailure("TITEN_DRAIN_REMAINING_INVALID", response.status);
        return { httpStatus: response.status, value: pending, resultCount: numberField(data, "drained") ?? 0 };
      });
    }
    if (remaining !== 0) throw new RehearsalFailure("TITEN_INDEX_DRAIN_INCOMPLETE");

    for (const record of imported) {
      await step(
        "titen_recall",
        record.fixture.ordinal,
        { claim_id_sha256: idHash(record.claimId) },
        async () => {
          const response = await requestJson(titenUrl, titenHeaders, "POST", "/v1/context/compile", {
            subject_id: namespace,
            task: record.fixture.query,
            max_tokens: 32_000,
          });
          const score = recallScore(response.value, record.claimId);
          if (!score.found) throw new RehearsalFailure("TITEN_EXPECTED_CLAIM_NOT_RECALLED", response.status);
          recalled += 1;
          return {
            httpStatus: response.status,
            value: undefined,
            resultCount: score.count,
            expectedFound: true,
          };
        },
      );
      await step(
        "titen_evidence",
        record.fixture.ordinal,
        {
          source_id_sha256: idHash(record.mem0Id),
          observation_id_sha256: idHash(record.observationId),
          claim_id_sha256: idHash(record.claimId),
        },
        async () => {
          const response = await requestJson(
            titenUrl,
            titenHeaders,
            "GET",
            `/v1/claims/${encodeURIComponent(record.claimId)}/evidence`,
          );
          const exact = evidenceScore(
            response.value,
            record.claimId,
            record.observationId,
            record.sourceRef,
          );
          if (!exact) throw new RehearsalFailure("TITEN_EVIDENCE_MISMATCH", response.status);
          exactEvidence += 1;
          return { httpStatus: response.status, value: undefined, resultCount: 1, expectedFound: true };
        },
      );
    }
  } catch (error) {
    fatalCode = safeError(error);
  } finally {
    let ordinal = 0;
    for (const id of mem0Created) {
      ordinal += 1;
      cleanup.attempted += 1;
      try {
        await step("mem0_cleanup", ordinal, { source_id_sha256: idHash(id) }, async () => {
          const response = await requestJson(mem0Url, mem0Headers, "DELETE", `/memories/${encodeURIComponent(id)}`);
          return { httpStatus: response.status, value: undefined };
        });
        cleanup.deleted += 1;
      } catch (error) {
        cleanup.failures.push(safeError(error));
      }
    }
  }

  const expectedIds = options.count * 2;
  const stableIds = stableObservationIds + stableClaimIds;
  const passed = fatalCode === null
    && exported.length === options.count
    && firstObservations === options.count
    && firstClaims === options.count
    && imported.length === options.count
    && replayedObservations === options.count
    && replayedClaims === options.count
    && stableIds === expectedIds
    && recalled === options.count
    && exactEvidence === options.count
    && cleanup.attempted === options.count
    && cleanup.deleted === cleanup.attempted
    && cleanup.failures.length === 0;
  const summary = {
    schema_version: 1,
    fixture_version: FIXTURE_VERSION,
    status: passed ? "completed" : "failed",
    verdict: passed ? "pass" : "fail_keep_mem0_active",
    fatal_error_code: fatalCode,
    requested_source_count: options.count,
    mem0_created_count: mem0Created.size,
    source_count: exported.length,
    first_pass: { observations: firstObservations, claims: firstClaims },
    replay_pass: { observations: replayedObservations, claims: replayedClaims },
    idempotency: {
      expected_stable_ids: expectedIds,
      stable_observation_ids: stableObservationIds,
      stable_claim_ids: stableClaimIds,
      stable_ids: stableIds,
      stable_id_rate: rate(stableIds, expectedIds),
    },
    recall: { expected: options.count, recalled, rate: rate(recalled, options.count) },
    evidence: { expected: options.count, exact: exactEvidence, exact_rate: rate(exactEvidence, options.count) },
    index: { drain_passes: drainPasses },
    mem0_cleanup: { ...cleanup, complete: cleanup.attempted === options.count && cleanup.deleted === cleanup.attempted },
  };
  const runnerPath = fileURLToPath(import.meta.url);
  const endpointFingerprints = { titen: sha256(titenUrl), mem0: sha256(mem0Url) };
  const manifest = {
    schema_version: 1,
    fixture_version: FIXTURE_VERSION,
    run_id_sha256: sha256(namespace),
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    runner_sha256: sha256(readFileSync(runnerPath)),
    configuration: {
      count: options.count,
      endpoint_fingerprints: endpointFingerprints,
      fixture_sha256: sha256(JSON.stringify(fixtures.map((item) => ({ ordinal: item.ordinal, statement: item.statement, query: item.query })))),
      configuration_sha256: sha256(JSON.stringify({ count: options.count, endpoints: endpointFingerprints, fixture_version: FIXTURE_VERSION })),
    },
  };
  writeArtifacts(options.out, raw, manifest, summary, [...sensitive]);
  console.log(`migration_rehearsal=${summary.status} verdict=${summary.verdict}`);
  console.log(`results=${options.out}`);
  if (!passed) throw new RehearsalFailure(fatalCode ?? "MIGRATION_GATE_FAILED");
}

function selfTest() {
  const parsed = parseArgs(["--out", "results"]);
  assert.notEqual(parsed, "help");
  assert.notEqual(parsed, "self-test");
  assert.equal((parsed as Options).count, 20);
  assert.equal((parseArgs(["--out", "results", "--count", "5"]) as Options).count, 5);
  assert.equal((parseArgs(["--out", "results", "--count", "100"]) as Options).count, 100);
  for (const invalid of ["0", "4", "101", "5.5", "1e2", "9007199254740992"])
    assert.throws(() => parseArgs(["--out", "results", "--count", invalid]));
  assert.throws(() => parseArgs([]));
  assert.deepEqual(resultArray({ results: [{ id: "one" }] }), [{ id: "one" }]);
  assert.equal(recallScore({ data: { items: [{ claim_id: "claim_a" }] } }, "claim_a").found, true);
  assert.equal(recallScore({ data: { items: [{ claim_id: "claim_b" }] } }, "claim_a").found, false);
  const evidence = {
    data: {
      claim: { claim_id: "claim_a" },
      evidence: {
        supporting: [{
          observation_id: "obs_a",
          kind: "imported_source",
          source: { type: "mem0_import", ref: "mem0:source_a" },
        }],
      },
    },
  };
  assert.equal(evidenceScore(evidence, "claim_a", "obs_a", "mem0:source_a"), true);
  assert.equal(evidenceScore(evidence, "claim_a", "obs_a", "mem0:wrong"), false);
  assert.equal(rate(19, 20), 0.95);
  assert.throws(() => assertArtifactSafe("prefix secret suffix", ["secret"]));
  assert.doesNotThrow(() => assertArtifactSafe(`id_sha256=${sha256("secret")}`, ["secret"]));
  console.log("benchmark-mem0-migration self-test: ok");
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed === "help") console.log(usage());
else if (parsed === "self-test") selfTest();
else await run(parsed);
