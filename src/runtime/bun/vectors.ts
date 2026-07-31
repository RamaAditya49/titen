// @ts-ignore - bun:sqlite types ship with the Bun runtime, not with this package.
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type {
  EmbeddingProvider,
  EmbeddingFingerprint,
  VectorInitialization,
  VectorStore,
} from "../../core/vectors";
import { validateEmbeddingResponse } from "../../core/vectors";

function normalizedFilePath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    try {
      return join(realpathSync(dirname(absolute)), basename(absolute));
    } catch {
      return absolute;
    }
  }
}

function aliasesFile(first: string, second: string): boolean {
  if (normalizedFilePath(first) === normalizedFilePath(second)) return true;
  try {
    const left = statSync(first);
    const right = statSync(second);
    return left.dev === right.dev && left.ino === right.ino;
  } catch {
    return false;
  }
}

/**
 * A sqlite-vec backed vector store.
 *
 * Vectors live in their own database file, never in the canonical one: an index
 * is rebuildable and must never be able to corrupt evidence. Returns null when
 * the extension, database, or expected schema is unavailable; configured
 * semantic readiness then fails closed while canonical SQL remains intact.
 *
 * ponytail: cosine-style scoring derived from L2 distance as 1/(1+d). The
 * ceiling is that the score is monotonic but not a calibrated similarity, which
 * is enough for ranking and not enough to compare across queries. Upgrade path:
 * store normalized vectors and use a cosine distance metric directly.
 */
export function createSqliteVecStore(
  dbPath: string,
  dimensions: number,
): (VectorStore & { empty: boolean }) | null {
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 65_536)
    return null;
  let db: Database;
  try {
    db = new Database(dbPath, { create: true });
  } catch {
    return null;
  }

  let empty = true;
  try {
    // The prebuilt extension ships per-platform; absence is expected, not fatal.
    //
    // Two loaders are attempted because the working one depends on how the
    // package was installed. sqlite-vec's own load() passes a path ending in
    // `.so`, and some Bun builds append the platform suffix again, producing
    // `.so.so`. Stripping the suffix and loading directly is what works under
    // `bun install`; load() is what works under a pnpm symlink layout. Trying
    // both keeps one install method from silently losing vector retrieval.
    const sqliteVec = require("sqlite-vec") as {
      load(database: unknown): void;
      getLoadablePath?(): string;
    };
    try {
      sqliteVec.load(db);
    } catch (error) {
      const path = sqliteVec.getLoadablePath?.();
      if (!path) throw error;
      db.loadExtension(path.replace(/\.(so|dylib|dll)$/, ""));
    }
    const columns = db
      .query(`PRAGMA table_info(vec_claims)`)
      .all() as { name: string }[];
    if (
      columns.length > 0 &&
      !["id", "embedding", "org_id", "subject_id", "project_id"].every((name) =>
        columns.some((column) => column.name === name)
      )
    )
      throw new Error("incompatible vector schema");
    db.run(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vec_claims USING vec0(
         id TEXT PRIMARY KEY,
         embedding float[${dimensions}],
         org_id TEXT partition key,
         subject_id TEXT,
         project_id TEXT
       )`,
    );
    const table = db
      .query(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vec_claims'`)
      .get() as { sql: string } | null;
    if (
      !table ||
      !/^CREATE VIRTUAL TABLE\s+[`"']?vec_claims[`"']?\s+USING\s+vec0\s*\(/i.test(table.sql) ||
      !new RegExp(`embedding\\s+float\\[${dimensions}\\]`, "i").test(table.sql) ||
      !/org_id\s+TEXT\s+partition\s+key/i.test(table.sql)
    )
      throw new Error("incompatible vector schema");
    empty = !db.query(`SELECT 1 FROM vec_claims LIMIT 1`).get();
  } catch {
    db.close();
    return null;
  }

  const bytes = (vector: Float32Array) =>
    Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);

  return {
    empty,
    async upsert(records) {
      if (records.length === 0) return;
      // vec0 does not honour INSERT OR REPLACE: it raises a uniqueness error
      // instead of replacing. Deleting first is what makes re-indexing a changed
      // claim work, and both statements share one transaction so a row is never
      // left missing.
      const remove = db.prepare(`DELETE FROM vec_claims WHERE id = ?`);
      const insert = db.prepare(
        `INSERT INTO vec_claims
           (id, embedding, org_id, subject_id, project_id)
         VALUES (?, ?, ?, ?, ?)`,
      );
      db.transaction((batch: typeof records) => {
        for (const record of batch) {
          remove.run(record.id);
          insert.run(
            record.id,
            bytes(record.vector),
            record.metadata.org_id,
            record.metadata.subject_id,
            record.metadata.project_id,
          );
        }
      })(records);
    },
    async query(vector, options) {
      const filters = Object.entries(options.filter ?? {});
      const rows = db
        .query(
          `SELECT id, distance FROM vec_claims
            WHERE embedding MATCH ?
              ${filters.map(([column]) => `AND ${column} = ?`).join(" ")}
            ORDER BY distance LIMIT ?`,
        )
        .all(bytes(vector), ...filters.map(([, value]) => value), options.topK) as {
          id: string;
          distance: number;
        }[];
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
      return validateEmbeddingResponse(
        await res.json(),
        texts.length,
        config.dimensions,
      );
    },
  };
}

/**
 * Builds the capability only when both halves are valid. A completely absent
 * tuple is FTS-only; partial or broken opt-in is a configured readiness error.
 */
export function tryCreateVectors(config: {
  canonicalDbPath?: string;
  vecDbPath?: string;
  embedBaseUrl?: string;
  embedModel?: string;
  embedDims?: number | string;
  embedRevision?: string;
  embedApiKey?: string;
}): VectorInitialization {
  const requested = [
    config.embedBaseUrl,
    config.embedModel,
    config.embedDims,
    config.embedRevision,
    config.embedApiKey,
  ].some((value) => value !== undefined);
  if (!requested)
    return { readiness: { embedding: "disabled", vector: "disabled" } };

  const dimensions = Number(config.embedDims);
  let baseUrl: URL;
  try {
    baseUrl = new URL(config.embedBaseUrl ?? "");
  } catch {
    return {
      readiness: {
        embedding: "configured_error",
        vector: "configured_error",
        diagnostic: "embedding_configuration_invalid",
      },
    };
  }
  if (
    !config.embedModel?.trim() ||
    config.embedModel.trim().length > 200 ||
    !Number.isInteger(dimensions) ||
    dimensions < 1 ||
    dimensions > 65_536 ||
    !["http:", "https:"].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash ||
    baseUrl.href.length > 2_048 ||
    (config.embedRevision !== undefined &&
      (!config.embedRevision.trim() || config.embedRevision.trim().length > 200)) ||
    (config.vecDbPath !== undefined && !config.vecDbPath.trim())
  )
    return {
      readiness: {
        embedding: "configured_error",
        vector: "configured_error",
        diagnostic: "embedding_configuration_invalid",
      },
    };

  const vecDbPath = config.vecDbPath ?? "titen-vec.db";
  if (config.canonicalDbPath && aliasesFile(config.canonicalDbPath, vecDbPath))
    return {
      readiness: {
        embedding: "enabled",
        vector: "configured_error",
        diagnostic: "vector_storage_conflict",
      },
    };

  const store = createSqliteVecStore(
    vecDbPath,
    dimensions,
  );
  if (!store)
    return {
      readiness: {
        embedding: "enabled",
        vector: "configured_error",
        diagnostic: "vector_initialization_failed",
      },
    };
  const endpoint = baseUrl.href.replace(/\/$/, "");
  const fingerprint: EmbeddingFingerprint = {
    provider: `openai-compatible:${createHash("sha256").update(endpoint).digest("hex")}`,
    model: config.embedModel.trim(),
    revision: config.embedRevision?.trim() ?? "unspecified",
    dimensions,
    metric: "l2",
    preprocessing: "text-v1",
    index_schema: "claims-scope-v1",
  };
  return {
    readiness: { embedding: "enabled", vector: "enabled" },
    vectors: {
      store,
      indexEmpty: store.empty,
      fingerprint,
      embedder: createHttpEmbedder({
        baseUrl: endpoint,
        model: config.embedModel.trim(),
        dimensions,
        apiKey: config.embedApiKey,
      }),
    },
  };
}
