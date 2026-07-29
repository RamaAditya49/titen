import { createApp } from "../../core/app";
import { migrate } from "../../core/migrations";
import { createSqliteDb, openDatabase } from "./sqlite";
import { tryCreateVectors } from "./vectors";

export interface ServeOptions {
  dbPath: string;
  port: number;
  hostname: string;
  revision?: string;
  autoMigrate?: boolean;
  quiet?: boolean;
  vecDbPath?: string;
  embedBaseUrl?: string;
  embedModel?: string;
  embedDims?: number;
  embedApiKey?: string;
}

/**
 * Starts the VPS/local runtime. Only bindings and logging live here; behavior
 * comes from the shared core.
 */
export async function serve(options: ServeOptions) {
  const database = openDatabase(options.dbPath);
  const db = createSqliteDb(database);
  if (options.autoMigrate !== false) await migrate(db);
  const vectors = tryCreateVectors({
    vecDbPath: options.vecDbPath,
    embedBaseUrl: options.embedBaseUrl,
    embedModel: options.embedModel,
    embedDims: options.embedDims,
    embedApiKey: options.embedApiKey,
  });
  const app = createApp({
    db,
    revision: options.revision ?? "dev",
    runtime: "bun-sqlite",
    vectors,
  });

  // @ts-ignore - Bun global is provided by the runtime.
  const server = Bun.serve({
    port: options.port,
    hostname: options.hostname,
    async fetch(request: Request) {
      const started = Date.now();
      const response = await app(request);
      if (!options.quiet) {
        const url = new URL(request.url);
        // Path and status only: never query values, bodies, or credentials.
        console.log(
          `${request.method} ${url.pathname} ${response.status} ${Date.now() - started}ms ${
            response.headers.get("x-request-id") ?? "-"
          }`,
        );
      }
      return response;
    },
  });

  return {
    server,
    database,
    url: `http://${options.hostname}:${server.port}`,
    stop: async () => {
      await server.stop(true);
      database.close();
    },
  };
}
