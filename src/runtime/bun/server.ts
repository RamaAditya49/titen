import { createApp, parseMcpOrigin } from "../../core/app";
import { migrate, schemaState } from "../../core/migrations";
import { runMaintenance } from "../../core/maintenance";
import type { VectorCapability } from "../../core/vectors";
import { createSqliteDb, openDatabase } from "./sqlite";
import { tryCreateVectors } from "./vectors";
import type { WebhookSecurity } from "../../core/webhook-security";
import { prepareSigningSecrets, type SecretCipher } from "../../core/secrets";

export interface ServeOptions {
  dbPath: string;
  port: number;
  hostname: string;
  revision?: string;
  autoMigrate?: boolean;
  quiet?: boolean;
  /** Milliseconds between maintenance passes. 0 disables the timer. */
  maintenanceIntervalMs?: number;
  /**
   * A ready-made capability, used instead of deriving one from the environment.
   * Lets a caller embedding this server supply its own store or model.
   */
  vectors?: VectorCapability;
  vecDbPath?: string;
  embedBaseUrl?: string;
  embedModel?: string;
  embedDims?: number;
  embedApiKey?: string;
  webhookSecurity?: WebhookSecurity;
  secretCipher?: SecretCipher;
  /** Exact public MCP origin when TLS terminates at a trusted reverse proxy. */
  mcpOrigin?: string;
}

/**
 * Starts the VPS/local runtime. Only bindings and logging live here; behavior
 * comes from the shared core.
 */
export async function serve(options: ServeOptions) {
  const mcpOrigin = parseMcpOrigin(options.mcpOrigin);
  const database = openDatabase(options.dbPath);
  const db = createSqliteDb(database);
  let migrationsReady = true;
  try {
    if (options.autoMigrate !== false) await migrate(db);
    const schema = await schemaState(db);
    migrationsReady = schema.applied === schema.expected && schema.verified;
  } catch {
    migrationsReady = false;
  }
  let secretStorageReady = false;
  if (migrationsReady) {
    try {
      secretStorageReady = await prepareSigningSecrets(db, options.secretCipher);
    } catch {
      secretStorageReady = false;
    }
  }
  const vectors =
    options.vectors ??
    tryCreateVectors({
    vecDbPath: options.vecDbPath,
    embedBaseUrl: options.embedBaseUrl,
    embedModel: options.embedModel,
    embedDims: options.embedDims,
    embedApiKey: options.embedApiKey,
  });
  const intervalMs = options.maintenanceIntervalMs ?? 15_000;
  const backgroundRepair = intervalMs > 0 && migrationsReady && secretStorageReady;
  const app = createApp({
    db,
    revision: options.revision ?? "dev",
    runtime: "bun-sqlite",
    vectors,
    backgroundRepair: {
      configured: backgroundRepair,
      staleAfterMs: Math.max(1_000, intervalMs * 3),
    },
    migrationsReady,
    secretStorageReady,
    webhookSecurity: options.webhookSecurity,
    secretCipher: options.secretCipher,
    mcpOrigin,
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

  let stopped = false;

  /**
   * Maintenance runs in-process because the alternative is that it does not run
   * at all: a deployment with a vector capability whose index is never populated
   * searches nothing, and that was the behavior before this existed. Disable with
   * an interval of 0 when an external scheduler owns the work instead.
   */
  let ticking = false;
  const tick = async () => {
    // Skip rather than queue: a slow model must not stack overlapping passes.
    if (ticking || stopped) return;
    ticking = true;
    try {
      const result = await runMaintenance({
        db,
        vectors,
        webhookSecurity: options.webhookSecurity,
        secretCipher: options.secretCipher,
        expectedIntervalMs: intervalMs,
      });
      if (!options.quiet && (result.indexed > 0 || result.delivered > 0 || result.errors.length))
        console.log(
          `maintenance indexed=${result.indexed} delivered=${result.delivered}${
            result.errors.length ? ` errors=${result.errors.join(",")}` : ""
          }`,
        );
    } catch {
      // runMaintenance already contains its own failures; this is a backstop so a
      // timer callback can never take the process down.
    } finally {
      ticking = false;
    }
  };
  const timer = backgroundRepair ? setInterval(tick, intervalMs) : undefined;
  // Never hold the process open on account of maintenance.
  timer?.unref?.();
  if (backgroundRepair) void tick();

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    await server.stop(true);
    database.close();
  };

  /**
   * Without this a supervisor's SIGTERM is ignored, the shutdown times out, and
   * the process is killed with the database still open. Every restart then pays
   * the timeout and SQLite recovers a WAL it did not need to. Registered only
   * when serving, so a test or CLI command that calls serve() directly and stops
   * it itself is unaffected.
   */
  const shutdown = () => {
    void stop().then(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  return {
    server,
    database,
    url: `http://${options.hostname}:${server.port}`,
    stop: async () => {
      process.off("SIGTERM", shutdown);
      process.off("SIGINT", shutdown);
      await stop();
    },
  };
}
