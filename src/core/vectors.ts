/**
 * Optional vector retrieval interface.
 *
 * The shared core depends only on this boundary. Each runtime provides its own
 * implementation: sqlite-vec for Bun, Vectorize for Cloudflare. When no vector
 * provider is configured, the system falls back to FTS5 alone.
 *
 * ponytail: abstraction boundary only, no runtime code here. The ceiling is
 * that both implementations must produce compatible f32 vectors of the same
 * dimension from the same embedding provider. Upgrade path: add a dimension
 * mismatch readiness check.
 */

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
}
