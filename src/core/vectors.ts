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

export interface VectorStore {
  /** Store or update vectors for the given record IDs. */
  upsert(records: { id: string; vector: Float32Array; metadata?: Record<string, string> }[]): Promise<void>;
  /** Find the top-k nearest neighbors for a query vector within a namespace. */
  query(vector: Float32Array, options: { topK: number; namespace?: string; filter?: Record<string, string> }): Promise<VectorMatch[]>;
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

/**
 * The vector capability aggregates a store and an embedding provider. When
 * absent from AppContext, retrieval uses FTS5 only.
 */
export interface VectorCapability {
  store: VectorStore;
  embedder: EmbeddingProvider;
}
