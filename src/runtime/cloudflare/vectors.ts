import type { VectorStore, VectorMatch, EmbeddingProvider, VectorCapability } from "../../core/vectors";

/** Minimal Vectorize binding interface (no @cloudflare/workers-types needed). */
export interface VectorizeIndex {
  upsert(vectors: { id: string; values: number[]; metadata?: Record<string, string> }[]): Promise<unknown>;
  query(vector: number[], options: { topK: number; filter?: Record<string, unknown> }): Promise<{ matches: { id: string; score: number }[] }>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

/** Minimal Workers AI binding interface. */
export interface AiBinding {
  run(model: string, input: { text: string[] }): Promise<{ data: number[][] }>;
}

export function createVectorizeStore(index: VectorizeIndex): VectorStore {
  return {
    async upsert(records) {
      await index.upsert(records.map(r => ({
        id: r.id,
        values: Array.from(r.vector),
        metadata: r.metadata,
      })));
    },
    async query(vector, options) {
      const result = await index.query(Array.from(vector), {
        topK: options.topK,
        filter: options.filter,
      });
      return result.matches.map(m => ({ id: m.id, score: m.score }));
    },
    async remove(ids) {
      await index.deleteByIds(ids);
    },
  };
}

export function createWorkersAiEmbedder(ai: AiBinding, model: string, dimensions: number): EmbeddingProvider {
  return {
    dimensions,
    model,
    async embed(texts) {
      const result = await ai.run(model, { text: texts });
      return result.data.map(d => new Float32Array(d));
    },
  };
}

/** Builds VectorCapability from Worker env bindings. Returns undefined if bindings absent. */
export function tryCreateVectorize(env: {
  VECTORIZE?: VectorizeIndex;
  AI?: AiBinding;
  TITEN_EMBED_MODEL?: string;
  TITEN_EMBED_DIMS?: string;
}): VectorCapability | undefined {
  if (!env.VECTORIZE || !env.AI) return undefined;
  const model = env.TITEN_EMBED_MODEL ?? "@cf/baai/bge-base-en-v1.5";
  const dims = Number(env.TITEN_EMBED_DIMS ?? "768");
  return {
    store: createVectorizeStore(env.VECTORIZE),
    embedder: createWorkersAiEmbedder(env.AI, model, dims),
  };
}
