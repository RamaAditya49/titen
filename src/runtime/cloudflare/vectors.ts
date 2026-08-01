import { validateEmbeddingResponse } from "../../core/vectors";
import type {
  EmbeddingProvider,
  EmbeddingProfile,
  VectorInitialization,
  VectorStore,
} from "../../core/vectors";
import {
  embeddingPolicyFingerprint,
  embeddingProfileMatchesModel,
} from "../../core/vectors";

/** Minimal Vectorize binding interface (no @cloudflare/workers-types needed). */
export interface VectorizeIndex {
  upsert(vectors: { id: string; values: number[]; metadata?: Record<string, string> }[]): Promise<unknown>;
  query(vector: number[], options: { topK: number; filter?: Record<string, unknown> }): Promise<{ matches: { id: string; score: number }[] }>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

/** Minimal Workers AI binding interface. */
export interface AiBinding {
  run(model: string, input: { text: string[] }): Promise<unknown>;
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
        topK: Math.min(options.topK, 100),
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
      return validateEmbeddingResponse(result, texts.length, dimensions);
    },
  };
}

/** Builds a locally validated capability from native Worker bindings. */
export function tryCreateVectorize(env: {
  VECTORIZE?: VectorizeIndex;
  AI?: AiBinding;
  TITEN_EMBED_MODEL?: string;
  TITEN_EMBED_DIMS?: string;
  TITEN_EMBED_REVISION?: string;
  TITEN_EMBED_PROFILE?: string;
  TITEN_EMBED_MIN_COSINE?: string;
}): VectorInitialization {
  const requested = [
    env.VECTORIZE,
    env.AI,
    env.TITEN_EMBED_MODEL,
    env.TITEN_EMBED_DIMS,
    env.TITEN_EMBED_REVISION,
    env.TITEN_EMBED_PROFILE,
    env.TITEN_EMBED_MIN_COSINE,
  ].some((value) => value !== undefined);
  if (!requested)
    return { readiness: { embedding: "disabled", vector: "disabled" } };

  const model = env.TITEN_EMBED_MODEL ?? "@cf/baai/bge-base-en-v1.5";
  const dimensions = Number(env.TITEN_EMBED_DIMS ?? "768");
  const revision = env.TITEN_EMBED_REVISION?.trim();
  const profile = env.TITEN_EMBED_PROFILE?.trim() as EmbeddingProfile | undefined;
  const rawMinimumCosine = env.TITEN_EMBED_MIN_COSINE?.trim() ?? "";
  const minimumCosine = Number(rawMinimumCosine);
  const aiReady = Boolean(env.AI && typeof env.AI.run === "function");
  const vectorReady = Boolean(
    env.VECTORIZE &&
    typeof env.VECTORIZE.upsert === "function" &&
    typeof env.VECTORIZE.query === "function" &&
    typeof env.VECTORIZE.deleteByIds === "function"
  );
  if (
    !model.trim() ||
    model.trim().length > 200 ||
    !revision ||
    revision.length > 200 ||
    !profile ||
    !embeddingProfileMatchesModel(profile, model.trim()) ||
    !rawMinimumCosine ||
    !Number.isFinite(minimumCosine) ||
    minimumCosine < -1 ||
    minimumCosine > 1 ||
    !Number.isInteger(dimensions) ||
    dimensions < 1 ||
    dimensions > 65_536
  )
    return {
      readiness: {
        embedding: "configured_error",
        vector: "configured_error",
        diagnostic: "embedding_configuration_invalid",
      },
    };
  if (!aiReady || !vectorReady)
    return {
      readiness: {
        embedding: aiReady ? "enabled" : "configured_error",
        vector: "configured_error",
        diagnostic: "vector_initialization_failed",
      },
    };
  return {
    readiness: { embedding: "enabled", vector: "enabled" },
    vectors: {
      store: createVectorizeStore(env.VECTORIZE!),
      embedder: createWorkersAiEmbedder(env.AI!, model.trim(), dimensions),
      fingerprint: {
        provider: "workers-ai",
        model: model.trim(),
        revision,
        dimensions,
        metric: "cosine",
        preprocessing: embeddingPolicyFingerprint(profile, minimumCosine),
        index_schema: "claims-scope-v1",
      },
    },
  };
}
