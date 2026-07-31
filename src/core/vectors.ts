/**
 * Optional vector retrieval interface.
 *
 * The shared core depends only on this boundary. Each runtime provides its own
 * implementation: sqlite-vec for Bun, Vectorize for Cloudflare. When no vector
 * provider is configured, the system falls back to FTS5 alone.
 *
 * ponytail: one shared boundary and one persisted fingerprint, without a
 * provider factory or network probe in readiness.
 */

import type { Db } from "./db";

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
}

export interface EmbeddingProvider {
  /** Generate embeddings for one or more texts. Returns one vector per input. */
  embed(texts: string[]): Promise<Float32Array[]>;
  /** The configured dimension. Used for readiness checks. */
  dimensions: number;
  /** Model identifier for fingerprint comparison. */
  model: string;
}

function invalidEmbeddingResponse(): never {
  throw new Error("Invalid embedding response.");
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
  return vectors;
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
  | "vector_initialization_failed"
  | "vector_storage_conflict"
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
  if (
    !fingerprint ||
    !validFingerprint(fingerprint) ||
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
      // ponytail: this catches the canonical-only restore case without a second
      // index metadata protocol. Partial external index loss still requires the
      // documented drain/query smoke to detect.
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
