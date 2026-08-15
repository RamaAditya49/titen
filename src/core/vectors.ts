/**
 * Optional vector retrieval interface.
 *
 * The shared core depends only on this boundary. Each runtime provides its own
 * implementation: sqlite-vec for Bun, Vectorize for Cloudflare. When no vector
 * provider is configured, the system falls back to FTS5 alone.
 * Readiness uses the persisted fingerprint and canonical repair evidence; it
 * never performs provider network I/O.
 */

import { chunk, MAX_BOUND_PARAMS, type Db, type Stmt } from "./db";
import { newId } from "./ids";

export interface VectorMatch {
  id: string;
  score: number;
}

/** Rebuildable index metadata. It narrows work before top-k; SQL stays authoritative. */
export interface VectorMetadata {
  org_id: string;
  subject_id: string;
  /** Empty string represents an unscoped canonical project. */
  project_id: string;
}

export interface VectorStore {
  /** Store or update vectors for the given record IDs. */
  upsert(records: { id: string; vector: Float32Array; metadata: VectorMetadata }[]): Promise<void>;
  /** Find the top-k nearest neighbors for a query vector within a namespace. */
  query(vector: Float32Array, options: { topK: number; namespace?: string; filter?: Partial<VectorMetadata> }): Promise<VectorMatch[]>;
  /** Remove vectors by ID. */
  remove(ids: string[]): Promise<void>;
  /** Return which IDs exist without exposing embedding values. */
  present?(ids: string[]): Promise<Set<string>>;
}

export interface EmbeddingProvider {
  /** Generate embeddings for one or more texts. Returns one vector per input. */
  embed(texts: string[]): Promise<Float32Array[]>;
  /** The configured dimension. Used for readiness checks. */
  dimensions: number;
  /** Model identifier for fingerprint comparison. */
  model: string;
}

export const EMBEDDING_PROFILES = [
  "raw-unit-v1",
  "embeddinggemma-retrieval-v1",
  /**
   * Raw input on a model whose id claims a prefix convention (#250).
   *
   * `embeddingProfileMatchesModel` refuses `raw-unit-v1` for an EmbeddingGemma
   * model on purpose: mixing prefixed and unprefixed vectors in one index
   * corrupts retrieval silently, and an operator who mistypes a profile should
   * not discover it as a slow quality decay. But there was no way to say "yes,
   * I mean it" — which also made a fair head-to-head against a system that
   * embeds raw text impossible. This profile is that opt-out, and the length of
   * what has to be typed is the safety mechanism: nobody reaches it by
   * accident. It goes into the index fingerprint like any other profile, so
   * switching to or from it fails readiness with `index_fingerprint_mismatch`
   * until the index is rebuilt.
   */
  "raw-unit-v1-model-mismatch-acknowledged",
] as const;
export type EmbeddingProfile = (typeof EMBEDDING_PROFILES)[number];
export type EmbeddingRole = "document" | "query";

export interface EmbeddingPolicy {
  profile: EmbeddingProfile;
  minimumCosine: number;
}

export function embeddingPolicyFingerprint(
  profile: EmbeddingProfile,
  minimumCosine: number,
): string {
  if (
    !EMBEDDING_PROFILES.includes(profile) ||
    !Number.isFinite(minimumCosine) ||
    minimumCosine < -1 ||
    minimumCosine > 1
  )
    throw new Error("Invalid embedding policy.");
  return `${profile};min_cosine=${minimumCosine}`;
}

export function parseEmbeddingPolicy(value: string): EmbeddingPolicy | undefined {
  const separator = value.lastIndexOf(";min_cosine=");
  if (separator < 1) return undefined;
  const profile = value.slice(0, separator) as EmbeddingProfile;
  const rawMinimum = value.slice(separator + 12);
  const minimumCosine = Number(rawMinimum);
  if (
    !EMBEDDING_PROFILES.includes(profile) ||
    rawMinimum !== String(minimumCosine) ||
    !Number.isFinite(minimumCosine) ||
    minimumCosine < -1 ||
    minimumCosine > 1
  )
    return undefined;
  return { profile, minimumCosine };
}

export function embeddingInput(
  profile: EmbeddingProfile,
  role: EmbeddingRole,
  content: string,
): string {
  if (profile !== "embeddinggemma-retrieval-v1") return content;
  return role === "document"
    ? `title: none | text: ${content}`
    : `task: search result | query: ${content}`;
}

export function embeddingProfileMatchesModel(
  profile: EmbeddingProfile,
  model: string,
): boolean {
  if (profile === "raw-unit-v1-model-mismatch-acknowledged") return true;
  const embeddingGemma = model
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "")
    .includes("embeddinggemma");
  return embeddingGemma
    ? profile === "embeddinggemma-retrieval-v1"
    : profile === "raw-unit-v1";
}

function invalidEmbeddingResponse(): never {
  throw new Error("Invalid embedding response.");
}

/** Validate the normalized extension boundary used by every core consumer. */
export function validateEmbeddingVectors(
  response: unknown,
  expectedCount: number,
  dimensions: number,
): Float32Array[] {
  if (!Array.isArray(response) || response.length !== expectedCount)
    invalidEmbeddingResponse();
  for (let position = 0; position < response.length; position += 1) {
    if (!Object.hasOwn(response, position)) invalidEmbeddingResponse();
    const vector = response[position];
    if (!(vector instanceof Float32Array) || vector.length !== dimensions)
      invalidEmbeddingResponse();
    for (const value of vector)
      if (!Number.isFinite(value)) invalidEmbeddingResponse();
  }
  return response;
}

/** Apply the fingerprinted role transform and normalize every vector once. */
export async function embedForRetrieval(
  capability: VectorCapability,
  role: EmbeddingRole,
  texts: string[],
): Promise<Float32Array[]> {
  const policy = parseEmbeddingPolicy(capability.fingerprint.preprocessing);
  if (!policy) throw new Error("Invalid embedding policy.");
  const vectors = validateEmbeddingVectors(
    await capability.embedder.embed(
      texts.map((text) => embeddingInput(policy.profile, role, text)),
    ),
    texts.length,
    capability.embedder.dimensions,
  );
  return vectors.map((vector) => {
    let squared = 0;
    for (const value of vector) squared += value * value;
    const norm = Math.sqrt(squared);
    if (!Number.isFinite(norm) || norm === 0) invalidEmbeddingResponse();
    const normalized = new Float32Array(vector.length);
    for (let index = 0; index < vector.length; index += 1) {
      normalized[index] = vector[index]! / norm;
      if (!Number.isFinite(normalized[index])) invalidEmbeddingResponse();
    }
    return normalized;
  });
}

/** Validate absolute cosine evidence before any ID can reach canonical SQL. */
export function eligibleVectorMatches(
  matches: unknown,
  minimumCosine: number,
): VectorMatch[] {
  if (
    !Array.isArray(matches) ||
    !Number.isFinite(minimumCosine) ||
    minimumCosine < -1 ||
    minimumCosine > 1
  )
    throw new Error("Invalid vector response.");
  const ids = new Set<string>();
  const eligible: VectorMatch[] = [];
  for (const match of matches) {
    if (
      !match ||
      typeof match !== "object" ||
      typeof (match as VectorMatch).id !== "string" ||
      !(match as VectorMatch).id ||
      ids.has((match as VectorMatch).id) ||
      typeof (match as VectorMatch).score !== "number" ||
      !Number.isFinite((match as VectorMatch).score) ||
      (match as VectorMatch).score < -1 ||
      (match as VectorMatch).score > 1
    )
      throw new Error("Invalid vector response.");
    ids.add((match as VectorMatch).id);
    if ((match as VectorMatch).score >= minimumCosine)
      eligible.push(match as VectorMatch);
  }
  return eligible;
}

/** Validate untrusted provider output before it can reach a vector backend. */
export function validateEmbeddingResponse(
  response: unknown,
  expectedCount: number,
  dimensions: number,
): Float32Array[] {
  if (!response || typeof response !== "object" || Array.isArray(response))
    invalidEmbeddingResponse();
  const data = (response as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length !== expectedCount)
    invalidEmbeddingResponse();

  const indexed = data.some(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      Object.hasOwn(entry, "index"),
  );
  const vectors: Float32Array[] = [];
  for (let position = 0; position < data.length; position += 1) {
    if (!Object.hasOwn(data, position)) invalidEmbeddingResponse();
    const entry = data[position];
    let values: unknown;
    if (Array.isArray(entry)) {
      if (indexed) invalidEmbeddingResponse();
      values = entry;
    } else if (entry !== null && typeof entry === "object") {
      if (
        indexed &&
        (!Object.hasOwn(entry, "index") ||
          (entry as { index?: unknown }).index !== position)
      )
        invalidEmbeddingResponse();
      values = (entry as { embedding?: unknown }).embedding;
    } else invalidEmbeddingResponse();

    if (!Array.isArray(values) || values.length !== dimensions)
      invalidEmbeddingResponse();
    const vector = new Float32Array(dimensions);
    for (let coordinate = 0; coordinate < dimensions; coordinate += 1) {
      if (!Object.hasOwn(values, coordinate)) invalidEmbeddingResponse();
      const value = values[coordinate];
      if (typeof value !== "number" || !Number.isFinite(value))
        invalidEmbeddingResponse();
      vector[coordinate] = value;
      if (!Number.isFinite(vector[coordinate])) invalidEmbeddingResponse();
    }
    vectors.push(vector);
  }
  return validateEmbeddingVectors(vectors, expectedCount, dimensions);
}

/**
 * The vector capability aggregates a store and an embedding provider. When
 * absent from AppContext, retrieval uses FTS5 only.
 */
export interface VectorCapability {
  store: VectorStore;
  embedder: EmbeddingProvider;
  fingerprint: EmbeddingFingerprint;
  /** Local Bun projection was empty when the capability initialized. */
  indexEmpty?: boolean;
}

export const CAPABILITY_VERSION = 1;

export type CapabilityState = "disabled" | "enabled" | "configured_error";

export type SemanticDiagnostic =
  | "embedding_configuration_invalid"
  | "embedding_dependency_unavailable"
  | "semantic_dependencies_unavailable"
  | "vector_initialization_failed"
  | "vector_dependency_unavailable"
  | "vector_storage_conflict"
  | "index_projection_pending"
  | "index_backfill_required"
  | "index_fingerprint_missing"
  | "index_fingerprint_mismatch"
  | "index_metadata_unavailable";

/** Immutable compatibility contract for one rebuildable semantic index. */
export interface EmbeddingFingerprint {
  provider: string;
  model: string;
  revision: string;
  dimensions: number;
  metric: string;
  preprocessing: string;
  index_schema: string;
}

export interface SemanticReadiness {
  embedding: CapabilityState;
  vector: CapabilityState;
  diagnostic?: SemanticDiagnostic;
}

export type SemanticDependency = "embedder" | "vector_store";

export const SEMANTIC_INDEX_LEASE_MS = 5 * 60_000;

export interface SemanticIndexLease {
  token: string;
  ids: string[];
  acquiredAt: string;
}

export interface SemanticIndexWrite {
  outboxId: string;
  sourceOutboxId: string;
  recordId: string;
  repairId: string;
}

/** Atomically fence rebuildable index work before any provider call. */
export async function claimSemanticIndexWork(
  db: Db,
  outboxIds: string[],
): Promise<SemanticIndexLease> {
  const ids = [...new Set(outboxIds)];
  if (ids.length === 0)
    return { token: newId("idxlease"), ids: [], acquiredAt: "1970-01-01T00:00:00.000Z" };
  const token = newId("idxlease");
  const claimed: string[] = [];
  const expiries: string[] = [];
  for (const group of chunk(ids, MAX_BOUND_PARAMS - 1)) {
    await db.batch([{
      sql: `UPDATE index_outbox
               SET lease_token = ?,
                   lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${SEMANTIC_INDEX_LEASE_MS / 1000} seconds')
             WHERE state = 'pending'
               AND (lease_expires_at IS NULL OR lease_expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
               AND id IN (${group.map(() => "?").join(", ")})`,
      params: [token, ...group],
    }]);
    const rows = await db.all<{ id: string; lease_expires_at: string }>(
      `SELECT id, lease_expires_at FROM index_outbox
        WHERE state = 'pending' AND lease_token = ?
          AND id IN (${group.map(() => "?").join(", ")})`,
      [token, ...group],
    );
    claimed.push(...rows.map(({ id }) => id));
    expiries.push(...rows.map(({ lease_expires_at }) => lease_expires_at));
  }
  const parsedExpiries = expiries.map((value) => Date.parse(value));
  if (parsedExpiries.some((value) => !Number.isFinite(value)))
    throw new Error("Invalid semantic index lease expiry.");
  const acquiredAt = parsedExpiries.length === 0
    ? "1970-01-01T00:00:00.000Z"
    : new Date(Math.max(...parsedExpiries) - SEMANTIC_INDEX_LEASE_MS).toISOString();
  return { token, ids: claimed, acquiredAt };
}

/** Persist canonical reconciliation before an owned external mutation. */
export async function prepareSemanticIndexWrites(
  db: Db,
  entries: { outboxId: string; recordId: string }[],
  leaseToken: string,
): Promise<SemanticIndexWrite[]> {
  const unique = [...new Map(entries.map((entry) => [entry.outboxId, entry])).values()];
  const order = new Map(unique.map(({ outboxId }, index) => [outboxId, index]));
  const owned: { id: string; record_id: string; operation: string }[] = [];
  for (const group of chunk(unique.map(({ outboxId }) => outboxId), MAX_BOUND_PARAMS - 1))
    owned.push(...await db.all<{ id: string; record_id: string; operation: string }>(
      `SELECT id, record_id, operation FROM index_outbox
        WHERE state = 'pending' AND lease_token = ?
          AND id IN (${group.map(() => "?").join(", ")})`,
      [leaseToken, ...group],
    ));
  owned.sort((left, right) => order.get(left.id)! - order.get(right.id)!);

  const rowsByRecord = new Map<string, typeof owned>();
  for (const row of owned) {
    const rows = rowsByRecord.get(row.record_id) ?? [];
    rows.push(row);
    rowsByRecord.set(row.record_id, rows);
  }
  const writes = [...rowsByRecord].map(([recordId, rows]) => {
    const source = rows.find(({ operation }) => operation !== "reconcile") ?? rows[0]!;
    const repair = rows.find(
      ({ id, operation }) => id !== source.id && operation === "reconcile",
    );
    return {
      outboxId: source.id,
      sourceOutboxId: source.id,
      recordId,
      repairId: repair?.id ?? newId("obx"),
      sourceIds: rows.map(({ id }) => id),
      insertedRepair: !repair,
    };
  });
  for (const write of writes) {
    const placeholders = write.sourceIds.map(() => "?").join(", ");
    const statements: Stmt[] = [
      {
        sql: `UPDATE index_outbox
                 SET lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${SEMANTIC_INDEX_LEASE_MS / 1000} seconds')
               WHERE state = 'pending' AND lease_token = ?
                 AND id IN (${placeholders})`,
        params: [leaseToken, ...write.sourceIds],
      },
    ];
    if (write.insertedRepair) statements.push({
      sql: `INSERT INTO index_outbox
                (id, org_id, record_type, record_id, operation, state, attempts,
                 created_at, lease_token, lease_expires_at)
              SELECT ?, org_id, 'claim', record_id, 'reconcile', 'pending', 0,
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), lease_token, lease_expires_at
                FROM index_outbox
               WHERE id = ? AND record_type = 'claim'
                 AND state = 'pending' AND lease_token = ?`,
      params: [write.repairId, write.outboxId, leaseToken],
    });
    const redundantIds = write.sourceIds.filter(
      (id) => id !== write.outboxId && id !== write.repairId,
    );
    if (redundantIds.length > 0) statements.push({
      sql: `UPDATE index_outbox
                 SET state = 'done', attempts = attempts + 1,
                     lease_token = NULL, lease_expires_at = NULL
               WHERE state = 'pending' AND lease_token = ?
                 AND id IN (${redundantIds.map(() => "?").join(", ")})
                 AND EXISTS (
                   SELECT 1 FROM index_outbox repair
                    WHERE repair.id = ? AND repair.operation = 'reconcile'
                      AND repair.state = 'pending' AND repair.lease_token = ?
                 )`,
      params: [leaseToken, ...redundantIds, write.repairId, leaseToken],
    });
    await db.batch(statements);
  }

  const prepared = new Set<string>();
  const preparedIds = [...new Set(writes.flatMap(
    ({ outboxId, repairId }) => [outboxId, repairId],
  ))];
  for (const group of chunk(preparedIds, MAX_BOUND_PARAMS - 1))
    for (const { id } of await db.all<{ id: string }>(
      `SELECT id FROM index_outbox
        WHERE state = 'pending' AND lease_token = ?
          AND id IN (${group.map(() => "?").join(", ")})`,
      [leaseToken, ...group],
    )) prepared.add(id);
  return writes
    .filter(({ outboxId, repairId }) => prepared.has(outboxId) && prepared.has(repairId))
    .map(({ sourceIds: _, insertedRepair: __, ...write }) => write);
}

/** Leave one immediately claimable canonical repair per affected record. */
export async function ensureSemanticIndexReconciliation(
  db: Db,
  orgId: string,
  recordIds: string[],
): Promise<void> {
  const entries = [...new Set(recordIds)].map((recordId) => ({
    id: newId("obx"),
    recordId,
  }));
  for (const group of chunk(entries))
    await db.batch(group.map((entry) => ({
      sql: `INSERT INTO index_outbox
              (id, org_id, record_type, record_id, operation, state, attempts,
               created_at, lease_token, lease_expires_at)
            SELECT ?, ?, 'claim', ?, 'reconcile', 'pending', 0,
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL
             WHERE NOT EXISTS (
               SELECT 1 FROM index_outbox
                WHERE org_id = ? AND record_type = 'claim' AND record_id = ?
                  AND operation IN ('upsert', 'reconcile') AND state = 'pending'
                  AND lease_token IS NULL
             )`,
      params: [entry.id, orgId, entry.recordId, orgId, entry.recordId],
    })));
}

/** Record only the canonical statement hash after a confirmed external write. */
export async function recordSemanticIndexHashes(
  db: Db,
  orgId: string,
  entries: { recordId: string; statementHash: string }[],
  at: string,
): Promise<void> {
  for (const group of chunk([...new Map(entries.map((entry) => [entry.recordId, entry])).values()]))
    await db.batch(group.map((entry) => ({
      sql: `INSERT INTO semantic_index_records (org_id, record_id, statement_hash, indexed_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (org_id, record_id) DO UPDATE SET
              statement_hash = excluded.statement_hash,
              indexed_at = excluded.indexed_at`,
      params: [orgId, entry.recordId, entry.statementHash, at],
    })));
}

export async function removeSemanticIndexRecords(
  db: Db,
  orgId: string,
  recordIds: string[],
): Promise<void> {
  for (const group of chunk([...new Set(recordIds)], MAX_BOUND_PARAMS - 1))
    await db.batch([{
      sql: `DELETE FROM semantic_index_records
             WHERE org_id = ? AND record_id IN (${group.map(() => "?").join(", ")})`,
      params: [orgId, ...group],
    }]);
}

/** Release owned pending work without consuming an attempt. */
export async function releaseSemanticIndexWork(
  db: Db,
  outboxIds: string[],
  leaseToken: string,
): Promise<void> {
  for (const group of chunk([...new Set(outboxIds)], MAX_BOUND_PARAMS - 1))
    await db.batch([{
      sql: `UPDATE index_outbox
               SET lease_token = NULL, lease_expires_at = NULL
             WHERE state = 'pending' AND lease_token = ?
               AND id IN (${group.map(() => "?").join(", ")})`,
      params: [leaseToken, ...group],
    }]);
}

/** Release every pending row still owned by one interrupted maintenance pass. */
export async function releaseSemanticIndexLease(db: Db, leaseToken: string): Promise<void> {
  await db.batch([{
    sql: `UPDATE index_outbox
             SET lease_token = NULL, lease_expires_at = NULL
           WHERE state = 'pending' AND lease_token = ?`,
    params: [leaseToken],
  }]);
}

/** Activate owned write-ahead repair and replace any repair lost to takeover. */
export async function preserveSemanticIndexReconciliation(
  db: Db,
  writes: SemanticIndexWrite[],
  orgId: string,
  leaseToken: string,
): Promise<void> {
  await releaseSemanticIndexWork(
    db,
    writes.map(({ repairId }) => repairId),
    leaseToken,
  );
  await ensureSemanticIndexReconciliation(
    db,
    orgId,
    writes.map(({ recordId }) => recordId),
  );
}

/** Persist only safe local failure evidence; provider output never enters SQL. */
export async function recordSemanticDependencyFailure(
  db: Db,
  dependency: SemanticDependency,
  at: string,
  outboxIds: string[],
  leaseToken: string,
): Promise<void> {
  const ids = [...new Set(outboxIds)];
  if (ids.length === 0) return;
  const column = dependency === "embedder"
    ? "embedder_failure_at"
    : "vector_store_failure_at";
  for (const group of chunk(ids, MAX_BOUND_PARAMS - 2)) {
    await db.batch([
      {
        sql: `UPDATE semantic_index_metadata SET ${column} = ?
               WHERE id = 'claims' AND EXISTS (
                 SELECT 1 FROM index_outbox
                  WHERE state = 'pending' AND lease_token = ?
                    AND id IN (${group.map(() => "?").join(", ")})
               )`,
        params: [at, leaseToken, ...group],
      },
      {
        sql: `UPDATE index_outbox
                 SET attempts = attempts + 1,
                     lease_token = NULL, lease_expires_at = NULL
               WHERE state = 'pending' AND lease_token = ?
                 AND id IN (${group.map(() => "?").join(", ")})`,
        params: [leaseToken, ...group],
      },
    ]);
  }
}

/** Complete selected work and clear outage evidence only after global recovery. */
export async function completeSemanticIndexWork(
  db: Db,
  outboxIds: string[],
  recovered: boolean,
  leaseToken: string,
): Promise<string[]> {
  const ids = [...new Set(outboxIds)];
  const completed: string[] = [];
  for (const group of chunk(ids, Math.floor((MAX_BOUND_PARAMS - 2) / 2))) {
    const statements: Stmt[] = group.map((id) => ({
      sql: `UPDATE index_outbox
               SET state = 'done', attempts = attempts + 1,
                   lease_expires_at = NULL
             WHERE id = ? AND state = 'pending' AND lease_token = ?`,
      params: [id, leaseToken],
    }));
    if (recovered)
      statements.push({
        sql: `UPDATE semantic_index_metadata
                 SET embedder_failure_at = NULL, vector_store_failure_at = NULL
               WHERE id = 'claims'
                 AND EXISTS (
                   SELECT 1 FROM index_outbox
                    WHERE state = 'done' AND lease_token = ?
                      AND attempts > 1
                      AND id IN (${group.map(() => "?").join(", ")})
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM index_outbox unresolved
                    WHERE unresolved.state = 'pending' AND unresolved.attempts > 0
                 )`,
        params: [leaseToken, ...group],
      });
    await db.batch(statements);
    const owned = (await db.all<{ id: string }>(
      `SELECT id FROM index_outbox
        WHERE state = 'done' AND lease_token = ?
          AND id IN (${group.map(() => "?").join(", ")})`,
      [leaseToken, ...group],
    )).map(({ id }) => id);
    completed.push(...owned);
    if (owned.length > 0)
      await db.batch([{
        sql: `UPDATE index_outbox SET lease_token = NULL
               WHERE state = 'done' AND lease_token = ?
                 AND id IN (${owned.map(() => "?").join(", ")})`,
        params: [leaseToken, ...owned],
      }]);
  }
  return completed;
}

/** Complete a vector mutation and its canonical reconciliation in one batch. */
export async function completeSemanticIndexWrites(
  db: Db,
  writes: SemanticIndexWrite[],
  recovery: "none" | "vector_store" | "all",
  leaseToken: string,
): Promise<string[]> {
  const completed: string[] = [];
  for (const group of chunk(writes, Math.floor((MAX_BOUND_PARAMS - 2) / 2))) {
    const sourceIds = group.map(({ outboxId }) => outboxId);
    const repairIds = group.map(({ repairId }) => repairId);
    const statements: Stmt[] = [];
    for (const write of group) statements.push(
      {
        sql: `UPDATE index_outbox
                 SET state = 'done', attempts = attempts + 1,
                     lease_expires_at = NULL
               WHERE id = ? AND state = 'pending'
                 AND lease_token = ?
                 AND EXISTS (
                   SELECT 1 FROM index_outbox repair
                    WHERE repair.id = ? AND repair.operation = 'reconcile'
                      AND repair.state = 'pending' AND repair.lease_token = ?
                 )`,
        params: [write.outboxId, leaseToken, write.repairId, leaseToken],
      },
      {
        sql: `UPDATE index_outbox
                 SET state = 'done', attempts = attempts + 1,
                     lease_expires_at = NULL
               WHERE id = ? AND operation = 'reconcile' AND state = 'pending'
                 AND lease_token = ?
                 AND EXISTS (
                   SELECT 1 FROM index_outbox source
                    WHERE source.id = ? AND source.state = 'done'
                      AND source.lease_token = ?
                 )`,
        params: [write.repairId, leaseToken, write.outboxId, leaseToken],
      },
    );
    if (recovery !== "none") statements.push({
      sql: `UPDATE semantic_index_metadata
               SET ${recovery === "all"
                 ? "embedder_failure_at = NULL, vector_store_failure_at = NULL"
                 : "vector_store_failure_at = NULL"}
             WHERE id = 'claims'
               AND EXISTS (
                 SELECT 1 FROM index_outbox
                  WHERE state = 'done' AND lease_token = ?
                    AND attempts > 1
                    AND id IN (${sourceIds.map(() => "?").join(", ")})
               )
               AND NOT EXISTS (
                 SELECT 1 FROM index_outbox unresolved
                  WHERE unresolved.state = 'pending' AND unresolved.attempts > 0
               )`,
      params: [leaseToken, ...sourceIds],
    });
    await db.batch(statements);
    const ownedRepairs = new Set((await db.all<{ id: string }>(
      `SELECT id FROM index_outbox
        WHERE state = 'done' AND lease_token = ?
          AND id IN (${repairIds.map(() => "?").join(", ")})`,
      [leaseToken, ...repairIds],
    )).map(({ id }) => id));
    const owned = group.filter(({ repairId }) => ownedRepairs.has(repairId));
    completed.push(...owned.map(({ outboxId }) => outboxId));
    const doneIds = [...new Set(owned.flatMap(
      ({ outboxId, repairId }) => [outboxId, repairId],
    ))];
    if (doneIds.length > 0)
      await db.batch([{
        sql: `UPDATE index_outbox SET lease_token = NULL
               WHERE state = 'done' AND lease_token = ?
                 AND id IN (${doneIds.map(() => "?").join(", ")})`,
        params: [leaseToken, ...doneIds],
      }]);
  }
  return completed;
}

/** Remove a stale write and leave current canonical reconciliation queued. */
export async function compensateStaleSemanticIndexWrites(
  db: Db,
  store: VectorStore,
  writes: SemanticIndexWrite[],
  orgId: string,
  leaseToken: string,
): Promise<void> {
  if (writes.length === 0) return;
  const recordIds = [...new Set(writes.map(({ recordId }) => recordId))];
  await preserveSemanticIndexReconciliation(db, writes, orgId, leaseToken);
  await store.remove(recordIds);
  await completeSemanticIndexWork(
    db,
    writes.map(({ repairId }) => repairId),
    false,
    leaseToken,
  );
}

/** Project durable dependency evidence into readiness without provider I/O. */
export async function observedSemanticReadiness(
  db: Db,
  readiness: SemanticReadiness,
): Promise<SemanticReadiness> {
  if (readiness.embedding !== "enabled" || readiness.vector !== "enabled")
    return readiness;
  const state = (
    await db.all<{
      embedder_failure_at: string | null;
      vector_store_failure_at: string | null;
      projection_pending: number;
    }>(
      `SELECT embedder_failure_at, vector_store_failure_at,
              EXISTS(
                SELECT 1 FROM index_outbox o
                JOIN claims c ON c.org_id = o.org_id AND c.id = o.record_id
                WHERE o.record_type = 'claim'
                  AND o.operation IN ('upsert', 'reconcile')
                  AND o.state = 'pending'
                  AND c.status IN ('active', 'disputed')
              ) AS projection_pending
         FROM semantic_index_metadata WHERE id = 'claims'`,
    )
  )[0];
  if (!state) throw new Error("Semantic index metadata is unavailable.");
  const embedderFailed = state.embedder_failure_at !== null;
  const vectorFailed = state.vector_store_failure_at !== null;
  if (embedderFailed && vectorFailed)
    return {
      embedding: "configured_error",
      vector: "configured_error",
      diagnostic: "semantic_dependencies_unavailable",
    };
  if (embedderFailed)
    return {
      embedding: "configured_error",
      vector: "enabled",
      diagnostic: "embedding_dependency_unavailable",
    };
  if (vectorFailed)
    return {
      embedding: "enabled",
      vector: "configured_error",
      diagnostic: "vector_dependency_unavailable",
    };
  if (Number(state.projection_pending) > 0)
    return {
      embedding: "enabled",
      vector: "enabled",
      diagnostic: "index_projection_pending",
    };
  return readiness;
}

export interface VectorInitialization {
  vectors?: VectorCapability;
  readiness: SemanticReadiness;
}

export const SEMANTIC_DISABLED: SemanticReadiness = {
  embedding: "disabled",
  vector: "disabled",
};

function sameFingerprint(
  stored: EmbeddingFingerprint,
  configured: EmbeddingFingerprint,
): boolean {
  return (
    stored.provider === configured.provider &&
    stored.model === configured.model &&
    stored.revision === configured.revision &&
    Number(stored.dimensions) === configured.dimensions &&
    stored.metric === configured.metric &&
    stored.preprocessing === configured.preprocessing &&
    stored.index_schema === configured.index_schema
  );
}

function validFingerprint(value: EmbeddingFingerprint): boolean {
  return (
    [
      value.provider,
      value.model,
      value.revision,
      value.metric,
      value.preprocessing,
      value.index_schema,
    ].every(
      (part) => typeof part === "string" && part.length > 0 && part.length <= 200,
    ) &&
    Number.isInteger(value.dimensions) &&
    value.dimensions > 0 &&
    value.dimensions <= 65_536
  );
}

/**
 * Persist or compare the local semantic contract before exposing vectors.
 * This performs bounded SQL only; provider and vector-index calls never belong
 * in readiness.
 */
export async function prepareSemanticReadiness(
  db: Db,
  initialization: VectorInitialization,
  at: string,
): Promise<SemanticReadiness> {
  if (initialization.readiness.vector !== "enabled")
    return initialization.readiness;
  const fingerprint = initialization.vectors?.fingerprint;
  const policy = fingerprint
    ? parseEmbeddingPolicy(fingerprint.preprocessing)
    : undefined;
  if (
    !fingerprint ||
    !policy ||
    !validFingerprint(fingerprint) ||
    fingerprint.metric !== "cosine" ||
    !embeddingProfileMatchesModel(policy.profile, fingerprint.model) ||
    fingerprint.model !== initialization.vectors?.embedder.model ||
    fingerprint.dimensions !== initialization.vectors.embedder.dimensions
  )
    return {
      embedding: "configured_error",
      vector: "configured_error",
      diagnostic: "embedding_configuration_invalid",
    };

  try {
    let stored = (
      await db.all<EmbeddingFingerprint>(
        `SELECT provider, model, revision, dimensions, metric, preprocessing, index_schema
           FROM semantic_index_metadata WHERE id = 'claims'`,
      )
    )[0];
    const missingWork = await db.all<{ present: number }>(
      `SELECT 1 AS present FROM claims c
        WHERE c.status IN ('active', 'disputed')
          AND NOT EXISTS (
            SELECT 1 FROM index_outbox o
             WHERE o.record_type = 'claim' AND o.record_id = c.id
               AND o.operation = 'upsert' AND o.state IN ('pending', 'done')
          )
        LIMIT 1`,
    );
    if (missingWork.length)
      return {
        embedding: "enabled",
        vector: "configured_error",
        diagnostic: "index_backfill_required",
      };
    if (stored && initialization.vectors?.indexEmpty) {
      // Catch a canonical-only restore at startup; bounded `/v1/index/verify`
      // detects partial provider loss without putting network I/O in readiness.
      const missingPending = await db.all<{ present: number }>(
        `SELECT 1 AS present FROM claims c
          WHERE c.status IN ('active', 'disputed')
            AND NOT EXISTS (
              SELECT 1 FROM index_outbox o
               WHERE o.record_type = 'claim' AND o.record_id = c.id
                 AND o.operation = 'upsert' AND o.state = 'pending'
            )
          LIMIT 1`,
      );
      if (missingPending.length)
        return {
          embedding: "enabled",
          vector: "configured_error",
          diagnostic: "index_backfill_required",
        };
    }
    if (!stored) {
      const indexed = await db.all<{ present: number }>(
        `SELECT 1 AS present FROM index_outbox
          WHERE record_type = 'claim' AND state = 'done' LIMIT 1`,
      );
      if (indexed.length)
        return {
          embedding: "enabled",
          vector: "configured_error",
          diagnostic: "index_fingerprint_missing",
        };
      await db.batch([
        {
          sql: `INSERT OR IGNORE INTO semantic_index_metadata
                  (id, provider, model, revision, dimensions, metric,
                   preprocessing, index_schema, created_at)
                VALUES ('claims', ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            fingerprint.provider,
            fingerprint.model,
            fingerprint.revision,
            fingerprint.dimensions,
            fingerprint.metric,
            fingerprint.preprocessing,
            fingerprint.index_schema,
            at,
          ],
        },
      ]);
      stored = (
        await db.all<EmbeddingFingerprint>(
          `SELECT provider, model, revision, dimensions, metric, preprocessing, index_schema
             FROM semantic_index_metadata WHERE id = 'claims'`,
        )
      )[0];
    }
    if (!stored || !sameFingerprint(stored, fingerprint))
      return {
        embedding: "enabled",
        vector: "configured_error",
        diagnostic: "index_fingerprint_mismatch",
      };
    return { embedding: "enabled", vector: "enabled" };
  } catch {
    return {
      embedding: "enabled",
      vector: "configured_error",
      diagnostic: "index_metadata_unavailable",
    };
  }
}
