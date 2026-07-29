import type { VectorStore, VectorMatch, EmbeddingProvider, VectorCapability } from "../../core/vectors";

/**
 * Attempts to create a sqlite-vec backed VectorStore.
 * Returns null if the extension is unavailable.
 *
 * ponytail: sqlite-vec is pre-v1 and may not be installed. The ceiling is that
 * vector retrieval is unavailable without it. Upgrade path: ship a bundled
 * .so or use a different vector backend.
 */
export function createSqliteVecStore(dbPath: string, dimensions: number): VectorStore | null {
  try {
    // @ts-ignore
    const { Database } = require("bun:sqlite");
    const db = new Database(dbPath, { create: true });
    // Try loading the extension - this may fail if not installed
    try {
      db.loadExtension("vec0");
    } catch {
      db.close();
      return null;
    }
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_claims USING vec0(id TEXT PRIMARY KEY, embedding float[${dimensions}])`);

    return {
      async upsert(records) {
        const stmt = db.prepare(`INSERT OR REPLACE INTO vec_claims (id, embedding) VALUES (?, ?)`);
        for (const r of records) {
          stmt.run(r.id, Buffer.from(r.vector.buffer));
        }
      },
      async query(vector, options) {
        const rows = db.query(
          `SELECT id, distance FROM vec_claims WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
        ).all(Buffer.from(vector.buffer), options.topK) as { id: string; distance: number }[];
        // Convert distance to similarity score (lower distance = higher score)
        return rows.map(r => ({ id: r.id, score: 1 / (1 + r.distance) }));
      },
      async remove(ids) {
        for (const id of ids) {
          db.run(`DELETE FROM vec_claims WHERE id = ?`, id);
        }
      },
    };
  } catch {
    return null;
  }
}

/**
 * Creates an EmbeddingProvider that calls an OpenAI-compatible endpoint.
 * Returns null if no endpoint is configured.
 */
export function createHttpEmbedder(config: {
  baseUrl: string;
  model: string;
  dimensions: number;
  apiKey?: string;
}): EmbeddingProvider {
  return {
    dimensions: config.dimensions,
    model: config.model,
    async embed(texts: string[]): Promise<Float32Array[]> {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
      const res = await fetch(`${config.baseUrl}/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: config.model, input: texts }),
      });
      if (!res.ok) throw new Error(`Embedding request failed: ${res.status}`);
      const json = await res.json() as { data: { embedding: number[] }[] };
      return json.data.map(d => new Float32Array(d.embedding));
    },
  };
}

/** Tries to build VectorCapability from env vars. Returns undefined if not configured. */
export function tryCreateVectors(config: {
  vecDbPath?: string;
  embedBaseUrl?: string;
  embedModel?: string;
  embedDims?: number;
  embedApiKey?: string;
}): VectorCapability | undefined {
  if (!config.embedBaseUrl || !config.embedModel || !config.embedDims) return undefined;
  const store = createSqliteVecStore(config.vecDbPath ?? "titen-vec.db", config.embedDims);
  if (!store) return undefined;
  const embedder = createHttpEmbedder({
    baseUrl: config.embedBaseUrl,
    model: config.embedModel,
    dimensions: config.embedDims,
    apiKey: config.embedApiKey,
  });
  return { store, embedder };
}
