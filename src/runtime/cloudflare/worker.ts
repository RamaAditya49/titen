import { createApp } from "../../core/app";
import { migrate, schemaState } from "../../core/migrations";
import { createD1Db, type D1Database } from "./d1";
import { runMaintenance } from "../../core/maintenance";
import { prepareSemanticReadiness, type CapabilityState } from "../../core/vectors";
import { tryCreateVectorize } from "./vectors";
import { parseSecretCipher, prepareSigningSecrets } from "../../core/secrets";
import type { WebhookSecurity } from "../../core/webhook-security";
import { configureHttpExtraction } from "../../core/extraction";
import { withD1Budget } from "./d1-budget";
import { newRequestId, success } from "../../core/http";

export interface Env {
  DB: D1Database;
  /** Non-secret build marker surfaced by health and readiness. */
  TITEN_REVISION?: string;
  /** Set to "1" to apply pending migrations from the Worker itself. */
  TITEN_AUTO_MIGRATE?: string;
  VECTORIZE?: unknown;
  AI?: unknown;
  TITEN_EMBED_MODEL?: string;
  TITEN_EMBED_DIMS?: string;
  TITEN_EMBED_REVISION?: string;
  TITEN_EMBED_PROFILE?: string;
  TITEN_EMBED_MIN_COSINE?: string;
  TITEN_EXTRACT_BASE_URL?: string;
  TITEN_EXTRACT_MODEL?: string;
  TITEN_EXTRACT_MODEL_FINGERPRINT?: string;
  TITEN_EXTRACT_API_KEY?: string;
  TITEN_EXTRACT_TIMEOUT_MS?: string;
  TITEN_EXTRACT_RESPONSE_MODE?: string;
  /** Explicit declared D1 plan required before enrichment can mutate. */
  TITEN_D1_PLAN?: string;
  /** Set to "1" only when an enrichment Cron Trigger is provisioned. */
  TITEN_ENRICHMENT_BACKGROUND?: string;
  /** Secret JSON keyring; keep in a Worker secret, never vars or D1. */
  TITEN_SECRET_KEYS?: string;
  /** Test-only fixed resolution; production has no generic address-pinned fetch. */
  TITEN_WEBHOOK_ALLOWED_HOSTNAMES?: string;
  TITEN_WEBHOOK_TEST_ADDRESSES?: string;
}

function extraction(env: Env): ReturnType<typeof configureHttpExtraction> {
  const configured = configureHttpExtraction({
    baseUrl: env.TITEN_EXTRACT_BASE_URL,
    model: env.TITEN_EXTRACT_MODEL,
    modelFingerprint: env.TITEN_EXTRACT_MODEL_FINGERPRINT,
    apiKey: env.TITEN_EXTRACT_API_KEY,
    timeoutMs: env.TITEN_EXTRACT_TIMEOUT_MS === undefined
      ? undefined
      : Number(env.TITEN_EXTRACT_TIMEOUT_MS),
    responseMode: env.TITEN_EXTRACT_RESPONSE_MODE,
  });
  if (
    configured.state === "enabled"
    && (env.TITEN_D1_PLAN !== "paid" || env.TITEN_AUTO_MIGRATE === "1")
  ) return { state: "configured_error" as const };
  return configured;
}

export function backgroundEnrichment(env: Env, state: CapabilityState): CapabilityState {
  if (state === "configured_error") return state;
  if (env.TITEN_ENRICHMENT_BACKGROUND === undefined || env.TITEN_ENRICHMENT_BACKGROUND === "0")
    return "disabled";
  return env.TITEN_ENRICHMENT_BACKGROUND === "1" && state === "enabled"
    ? "enabled"
    : "configured_error";
}

function testWebhookSecurity(env: Env): WebhookSecurity | undefined {
  if (!env.TITEN_WEBHOOK_TEST_ADDRESSES) return undefined;
  try {
    const addresses = JSON.parse(env.TITEN_WEBHOOK_TEST_ADDRESSES) as unknown;
    const hosts = env.TITEN_WEBHOOK_ALLOWED_HOSTNAMES?.split(",").map((value) => value.trim()).filter(Boolean);
    if (!hosts?.length || !Array.isArray(addresses) || !addresses.every((value) => typeof value === "string"))
      return undefined;
    return {
      allowedHostnames: hosts,
      resolve: async () => addresses,
      dispatch: async () => ({
        response: new Response("test transport refusal", { status: 503 }),
        connectedAddress: addresses[0]!,
      }),
    };
  } catch {
    return undefined;
  }
}

let migration: Promise<unknown> | undefined;
let schemaVerification: Promise<boolean> | undefined;
let secretPreparation: Promise<boolean> | undefined;

/**
 * The Worker owns bindings and nothing else. All behavior lives in the shared
 * core, so Cloudflare and Bun cannot drift apart.
 *
 * No account API token is present: D1 is reached through its native binding.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "GET" && new URL(request.url).pathname === "/healthz")
      return success({
        data: {
          status: "ok",
          runtime: "cloudflare-d1",
          revision: env.TITEN_REVISION ?? "dev",
        },
      }, newRequestId());
    const extractionConfig = extraction(env);
    const unbudgeted = createD1Db(env.DB);
    const db = extractionConfig.capability ? withD1Budget(unbudgeted).db : unbudgeted;
    let migrationsReady = false;
    try {
      if (env.TITEN_AUTO_MIGRATE === "1") {
        migration ??= migrate(db);
        await migration;
      }
      schemaVerification ??= schemaState(db).then(
        (schema) => schema.applied === schema.expected && schema.verified,
      );
      migrationsReady = await schemaVerification;
      if (!migrationsReady) schemaVerification = undefined;
    } catch {
      // Retry on the next request. Until then only health/readiness may pass.
      migration = undefined;
      schemaVerification = undefined;
      migrationsReady = false;
    }
    const vectorInitialization = tryCreateVectorize(env as any);
    let secretCipher;
    let secretStorageReady = false;
    try {
      secretCipher = parseSecretCipher(env.TITEN_SECRET_KEYS);
      if (migrationsReady) {
        secretPreparation ??= prepareSigningSecrets(db, secretCipher);
        secretStorageReady = await secretPreparation;
        if (!secretStorageReady) secretPreparation = undefined;
      }
    } catch {
      secretPreparation = undefined;
      secretCipher = undefined;
    }
    const app = createApp({
      db,
      revision: env.TITEN_REVISION ?? "dev",
      runtime: "cloudflare-d1",
      vectors: vectorInitialization.vectors,
      semanticReadiness: vectorInitialization.readiness,
      extraction: extractionConfig.capability,
      modelCapabilities: {
        extraction: extractionConfig.state,
        backgroundEnrichment: backgroundEnrichment(env, extractionConfig.state),
      },
      backgroundRepair: { configured: true, staleAfterMs: 180_000 },
      migrationsReady,
      secretStorageReady,
      secretCipher,
      webhookSecurity: testWebhookSecurity(env),
    });
    return app(request);
  },

  /**
   * Cron Trigger entry point. Cloudflare has no in-process timer, so the same
   * maintenance the Bun runtime runs on an interval is driven here by a schedule.
   * Configure it in wrangler.jsonc under `triggers.crons`; without one, indexing
   * and webhook delivery must be driven by calling their endpoints.
   */
  async scheduled(_event: unknown, env: Env, context: { waitUntil(p: Promise<unknown>): void }) {
    const extractionConfig = extraction(env);
    const backgroundState = backgroundEnrichment(env, extractionConfig.state);
    const unbudgeted = createD1Db(env.DB);
    const db = backgroundState === "enabled" ? withD1Budget(unbudgeted).db : unbudgeted;
    const vectorInitialization = tryCreateVectorize(env as never);
    const semanticReadiness = await prepareSemanticReadiness(
      db,
      vectorInitialization,
      new Date().toISOString(),
    );
    const vectors = semanticReadiness.vector === "enabled"
      ? vectorInitialization.vectors
      : undefined;
    const secretCipher = parseSecretCipher(env.TITEN_SECRET_KEYS);
    if (!(await prepareSigningSecrets(db, secretCipher)))
      throw new Error("Signing-secret storage is not ready.");
    // waitUntil so the platform does not cancel the pass when the handler returns.
    context.waitUntil(
      runMaintenance({
        db,
        vectors,
        extraction: backgroundState === "enabled" ? extractionConfig.capability : undefined,
        limit: 1,
        secretCipher,
        webhookSecurity: testWebhookSecurity(env),
        expectedIntervalMs: 60_000,
      }).then((result) => {
        if (result.enriched || result.indexed || result.delivered || result.errors.length)
          console.log(
            `maintenance enriched=${result.enriched} indexed=${result.indexed} delivered=${result.delivered}${
              result.errors.length ? ` errors=${result.errors.join(",")}` : ""
            }`,
          );
      }),
    );
  },
};
