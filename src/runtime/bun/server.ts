import { createApp, parseMcpOrigin } from "../../core/app";
import { migrate, schemaState } from "../../core/migrations";
import { runMaintenance } from "../../core/maintenance";
import {
  prepareSemanticReadiness,
  releaseSemanticIndexLease,
  type VectorCapability,
} from "../../core/vectors";
import { createSqliteDb, openDatabase } from "./sqlite";
import { tryCreateVectors } from "./vectors";
import type { WebhookSecurity } from "../../core/webhook-security";
import { prepareSigningSecrets, type SecretCipher } from "../../core/secrets";
import {
  snapshotExtractionCapability,
  type ExtractionCapability,
  type ExtractionConfigurationState,
} from "../../core/extraction";
import { createWebAuthnRuntime, parseWebAuthnConfig } from "../../core/webauthn";

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
  extraction?: ExtractionCapability;
  extractionState?: ExtractionConfigurationState;
  extractionApiKeySet?: boolean;
  vecDbPath?: string;
  embedBaseUrl?: string;
  embedModel?: string;
  embedDims?: number | string;
  embedRevision?: string;
  embedProfile?: string;
  embedMinCosine?: number | string;
  embedApiKey?: string;
  webhookSecurity?: WebhookSecurity;
  secretCipher?: SecretCipher;
  /** Exact public MCP origin when TLS terminates at a trusted reverse proxy. */
  mcpOrigin?: string;
  webauthnRpId?: string;
  webauthnOrigin?: string;
  webauthnRpName?: string;
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
  const vectorInitialization = options.vectors
    ? {
        vectors: options.vectors,
        readiness: { embedding: "enabled", vector: "enabled" } as const,
      }
    : tryCreateVectors({
        canonicalDbPath: options.dbPath,
        vecDbPath: options.vecDbPath,
        embedBaseUrl: options.embedBaseUrl,
        embedModel: options.embedModel,
        embedDims: options.embedDims,
        embedRevision: options.embedRevision,
        embedProfile: options.embedProfile,
        embedMinCosine: options.embedMinCosine,
        embedApiKey: options.embedApiKey,
      });
  const semanticReadiness = migrationsReady
    ? await prepareSemanticReadiness(db, vectorInitialization, new Date().toISOString())
    : vectorInitialization.readiness;
  const vectors = semanticReadiness.vector === "enabled"
    ? vectorInitialization.vectors
    : undefined;
  const intervalMs = options.maintenanceIntervalMs ?? 15_000;
  const backgroundRepair = intervalMs > 0 && migrationsReady && secretStorageReady;
  const extractionSnapshot = snapshotExtractionCapability(options.extraction);
  const extractionValid = options.extraction === undefined || extractionSnapshot !== undefined;
  const extractionState = options.extractionState === "configured_error"
    || !extractionValid
    || (options.extractionState === "enabled" && !options.extraction)
    ? "configured_error"
    : options.extractionState ?? (options.extraction ? "enabled" : "disabled");
  const extraction = extractionState === "enabled" ? extractionSnapshot : undefined;
  const app = createApp({
    db,
    revision: options.revision ?? "dev",
    runtime: "bun-sqlite",
    vectors,
    semanticReadiness,
    semanticPrepared: true,
    extraction,
    modelCapabilities: {
      extraction: extractionState,
      backgroundEnrichment: extractionState === "configured_error"
        ? "configured_error"
        : extractionState === "enabled" && intervalMs > 0
          ? "enabled"
          : "disabled",
    },
    modelConfiguration: {
      extraction: {
        baseUrl: extraction?.providerIdentity,
        model: extraction?.modelId,
        modelFingerprint: extraction?.modelFingerprint,
        responseMode: extraction?.responseMode,
        apiKeySet: Boolean(options.extractionApiKeySet),
      },
      embedding: {
        baseUrl: options.embedBaseUrl,
        model: options.embedModel,
        dimensions: options.embedDims === undefined ? undefined : Number(options.embedDims),
        revision: options.embedRevision,
        profile: options.embedProfile,
        minimumCosine: options.embedMinCosine === undefined ? undefined : Number(options.embedMinCosine),
        apiKeySet: Boolean(options.embedApiKey),
      },
    },
    backgroundRepair: {
      configured: backgroundRepair,
      staleAfterMs: Math.max(1_000, intervalMs * 3),
    },
    migrationsReady,
    secretStorageReady,
    webhookSecurity: options.webhookSecurity,
    secretCipher: options.secretCipher,
    mcpOrigin,
    webauthn: createWebAuthnRuntime(parseWebAuthnConfig({
      rpId: options.webauthnRpId,
      origin: options.webauthnOrigin,
      rpName: options.webauthnRpName,
    })),
  });

  // Bun/SQLite is the documented one-process deployment profile. Horizontal
  // scaling uses the Cloudflare runtime so this adapter needs no coordinator.
  // @ts-ignore - Bun global is provided by the runtime.
  let server: ReturnType<typeof Bun.serve>;
  try {
    // @ts-ignore - Bun global is provided by the runtime.
    server = Bun.serve({
      port: options.port,
      hostname: options.hostname,
      // Extraction may wait up to 45s; keep bounded response headroom above it.
      idleTimeout: 60,
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
  } catch (error) {
    database.close();
    throw error;
  }

  let stopped = false;

  /**
   * Maintenance runs in-process because the alternative is that it does not run
   * at all: a deployment with a vector capability whose index is never populated
   * searches nothing, and that was the behavior before this existed. Disable with
   * an interval of 0 when an external scheduler owns the work instead.
   */
  let activeTick: Promise<void> | undefined;
  let activeSemanticLeases: Set<string> | undefined;
  const tick = () => {
    // Skip rather than queue: a slow model must not stack overlapping passes.
    if (activeTick || stopped) return;
    const leases = new Set<string>();
    activeSemanticLeases = leases;
    activeTick = (async () => {
      try {
        const result = await runMaintenance({
          db,
          vectors,
          extraction,
          webhookSecurity: options.webhookSecurity,
          secretCipher: options.secretCipher,
          expectedIntervalMs: intervalMs,
          onSemanticLease: (token) => leases.add(token),
        });
        if (!options.quiet && (
          result.enriched > 0 || result.indexed > 0 || result.delivered > 0 || result.errors.length
        ))
          console.log(
            `maintenance enriched=${result.enriched} indexed=${result.indexed} delivered=${result.delivered}${
              result.errors.length ? ` errors=${result.errors.join(",")}` : ""
            }`,
          );
      } catch {
        // runMaintenance already contains its own failures; this is a backstop so a
        // timer callback can never take the process down.
      } finally {
        activeTick = undefined;
        if (activeSemanticLeases === leases) activeSemanticLeases = undefined;
      }
    })();
  };
  const timer = backgroundRepair ? setInterval(tick, intervalMs) : undefined;
  // Never hold the process open on account of maintenance.
  timer?.unref?.();
  if (backgroundRepair) tick();

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    await server.stop(true);
    const pass = activeTick;
    const releaseActiveSemanticWork = async () => {
      for (const token of activeSemanticLeases ?? [])
        await releaseSemanticIndexLease(db, token);
    };
    try {
      await releaseActiveSemanticWork();
      if (pass) await Promise.race([
        pass,
        new Promise<void>((resolve) => setTimeout(resolve, 100)),
      ]);
    } catch {
      // Shutdown must still close SQLite; a restart reports unreclaimed work stale.
    } finally {
      // A pass may advance from removal to embedding during the bounded grace
      // period and acquire another token after the first sweep.
      try {
        await releaseActiveSemanticWork();
      } catch {
        // Closing SQLite remains the final bounded shutdown action.
      }
      database.close();
    }
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
    /**
     * The same handler the socket serves, exposed so an embedded consumer can
     * call it directly instead of paying a loopback round trip. See
     * docs/architecture/agent-integration.md.
     *
     * ponytail: this still binds a listening socket. Extracting the app,
     * maintenance timer, and shutdown wiring above into their own factory would
     * remove it — a ~75-line move for a port nobody connects to, so it waits
     * until an embedded consumer objects to the bound port.
     */
    app,
    url: `http://${options.hostname}:${server.port}`,
    stop: async () => {
      process.off("SIGTERM", shutdown);
      process.off("SIGINT", shutdown);
      await stop();
    },
  };
}
