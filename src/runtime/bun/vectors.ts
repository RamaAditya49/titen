// @ts-ignore - bun:sqlite types ship with the Bun runtime, not with this package.
import { Database } from "bun:sqlite";
import type {
  EmbeddingProvider,
  VectorCapability,
  VectorStore,
} from "../../core/vectors";

/**
 * A sqlite-vec backed vector store.
 *
 * Vectors live in their own database file, never in the canonical one: an index
 * is rebuildable and must never be able to corrupt evidence. Returns null when
 * the extension is unavailable so the service degrades to FTS instead of
 * refusing to start.
 *
 * ponytail: cosine-style scoring derived from L2 distance as 1/(1+d). The
 * ceiling is that the score is monotonic but not a calibrated similarity, which
 * is enough for ranking and not enough to compare across queries. Upgrade path:
 * store normalized vectors and use a cosine distance metric directly.
 */
export function createSqliteVecStore(
  dbPath: string,
  dimensions: number,
): VectorStore | null {
  let db: Database;
  try {
    db = new Database(dbPath, { create: true });
  } catch {
    return null;
  }

  try {
    // The prebuilt extension ships per-platform; absence is expected, not fatal.
    const sqliteVec = require("sqlite-vec") as { load(database: unknown): void };
    sqliteVec.load(db);
    db.run(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vec_claims USING vec0(
         id TEXT PRIMARY KEY,
         embedding float[${dimensions}]
       )`,
    );
  } catch {
    db.close();
    return null;
  }

  const bytes = (vector: Float32Array) =>
    Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);

  return {
    async upsert(records) {
      if (records.length === 0) return;
      // vec0 does not honour INSERT OR REPLACE: it raises a uniqueness error
      // instead of replacing. Deleting first is what makes re-indexing a changed
      // claim work, and both statements share one transaction so a row is never
      // left missing.
      const remove = db.prepare(`DELETE FROM vec_claims WHERE id = ?`);
      const insert = db.prepare(
        `INSERT INTO vec_claims (id, embedding) VALUES (?, ?)`,
      );
      db.transaction((batch: typeof records) => {
        for (const record of batch) {
          remove.run(record.id);
          insert.run(record.id, bytes(record.vector));
        }
      })(records);
    },
    async query(vector, options) {
      const rows = db
        .query(
          `SELECT id, distance FROM vec_claims
            WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
        )
        .all(bytes(vector), options.topK) as { id: string; distance: number }[];
      return rows.map((row) => ({ id: row.id, score: 1 / (1 + row.distance) }));
    },
    async remove(ids) {
      if (ids.length === 0) return;
      const remove = db.prepare(`DELETE FROM vec_claims WHERE id = ?`);
      db.transaction((batch: string[]) => {
        for (const id of batch) remove.run(id);
      })(ids);
    },
  };
}

/**
 * Embeddings from any OpenAI-compatible endpoint, which is what Ollama, vLLM,
 * and llama.cpp all expose. Titen never ships a model.
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
      if (!res.ok) throw new Error(`embedding request failed: ${res.status}`);
      const json = (await res.json()) as { data: { embedding: number[] }[] };
      const vectors = json.data.map((entry) => new Float32Array(entry.embedding));
      // A dimension mismatch silently ruins retrieval quality, so fail loudly.
      for (const vector of vectors)
        if (vector.length !== config.dimensions)
          throw new Error(
            `embedding dimension mismatch: expected ${config.dimensions}, got ${vector.length}`,
          );
      return vectors;
    },
  };
}

/**
 * Builds the capability only when both halves are present. Vector retrieval
 * needs a store and a model; either one missing means FTS-only, reported
 * honestly by readiness.
 */
export function tryCreateVectors(config: {
  vecDbPath?: string;
  embedBaseUrl?: string;
  embedModel?: string;
  embedDims?: number;
  embedApiKey?: string;
}): VectorCapability | undefined {
  if (!config.embedBaseUrl || !config.embedModel || !config.embedDims) return undefined;
  const store = createSqliteVecStore(
    config.vecDbPath ?? "titen-vec.db",
    config.embedDims,
  );
  if (!store) return undefined;
  return {
    store,
    embedder: createHttpEmbedder({
      baseUrl: config.embedBaseUrl,
      model: config.embedModel,
      dimensions: config.embedDims,
      apiKey: config.embedApiKey,
    }),
  };
}
