import { authenticate, requireScope } from "./auth";
import { saveCheckpoint, getCheckpoint, deleteCheckpoint } from "./checkpoints";
import { claimEvidence } from "./evidence";
import { compileContext, getContext, recordFeedback } from "./context";
import { consolidate } from "./claims";
import { createKey, getPrincipal, listKeys, revokeKey } from "./keys";
import { exportRecords, importRecords } from "./portability";
import { expireClaim, revokeClaim, supersedeClaim } from "./lifecycle";
import { createWorkspace, listWorkspaces, addMember, listMembers, removeMember, acquireLease, listLeases, releaseLease, forceReleaseLease, createHandoff, resolveHandoff, listHandoffs } from "./collaboration";
import { listEvents, getEvent } from "./events";
import { drainIndex } from "./indexing";
import { handleMcp } from "./mcp";
import { compileView } from "./atlas";
import { listAudit, exportAudit } from "./audit";
import { registerPeer, listPeers, suspendPeer, addFilter, listFilters, pullEvents, pushEvents, federationLog } from "./federation";
import { registerWebhook, listWebhooks, deleteWebhook, pauseWebhook, resumeWebhook, listDeliveries, drainWebhooks } from "./webhooks";
import { appendObservation, purgeObservation } from "./observations";
import { resolveProject } from "./projects";
import { schemaState } from "./migrations";
import { ApiError, forbidden, unavailable, validationError } from "./errors";
import { assertJsonDepth } from "./validate";
import {
  MAX_BODY_BYTES,
  compileRoutes,
  failure,
  matchRoute,
  newRequestId,
  success,
  type RequestContext,
  type Result,
  type RouteDef,
} from "./http";
import type { Db } from "./db";
import {
  CAPABILITY_VERSION,
  SEMANTIC_DISABLED,
  observedSemanticReadiness,
  prepareSemanticReadiness,
  type CapabilityState,
  type SemanticReadiness,
  type VectorCapability,
} from "./vectors";
import { backgroundRepairState } from "./maintenance";
import type { WebhookSecurity } from "./webhook-security";
import type { SecretCipher } from "./secrets";
import { snapshotExtractionCapability, type ExtractionCapability } from "./extraction";
import { drainEnrichmentRoute } from "./enrichment";
import {
  activateKnowledgeRelease,
  applyRetention,
  approveKnowledgeRelease,
  compileChannelContext,
  createChannel,
  createIdentityMapping,
  createKnowledgeRelease,
  createPolicy,
  decideClaimApproval,
  listChannels,
  listClaimApprovals,
  listIdentityMappings,
  listKnowledgeReleases,
  listPolicies,
  placeLegalHold,
  releaseLegalHold,
  removeIdentityMapping,
  revokeKnowledgeRelease,
  submitClaimApproval,
  updateChannel,
  updatePolicy,
} from "./governance";

export interface AppContext {
  db: Db;
  now: () => Date;
  /** Non-secret build marker reported by health and readiness. */
  revision: string;
  /** Deployment target label, e.g. `cloudflare-d1` or `bun-sqlite`. */
  runtime: string;
  /** Optional vector capability. Absent means FTS-only retrieval. */
  vectors?: VectorCapability;
  semanticReadiness: SemanticReadiness;
  modelCapabilities: {
    extraction: CapabilityState;
    backgroundEnrichment: CapabilityState;
  };
  /** Optional untrusted proposal boundary. Canonical writes never await it. */
  extraction?: ExtractionCapability;
  /** Scheduler intent; readiness still derives state from canonical evidence. */
  backgroundRepair: { configured: boolean; staleAfterMs: number };
  /** False only after a required startup migration failed. */
  migrationsReady: boolean;
  /** False when persisted signing secrets cannot be decrypted safely. */
  secretStorageReady: boolean;
  webhookSecurity?: WebhookSecurity;
  secretCipher?: SecretCipher;
}

/** Capabilities are reported honestly based on what's configured. */
export async function capabilities(
  app: AppContext,
  semanticReadiness = app.semanticReadiness,
) {
  return {
    version: CAPABILITY_VERSION,
    fts: "enabled",
    vector: semanticReadiness.vector,
    embedding: semanticReadiness.embedding,
    extraction: app.modelCapabilities.extraction,
    extraction_response_mode: app.modelCapabilities.extraction === "configured_error"
      ? "configured_error"
      : app.extraction?.responseMode
        ?? (app.modelCapabilities.extraction === "enabled" ? "custom" : "disabled"),
    background_enrichment: app.modelCapabilities.backgroundEnrichment,
    /** @deprecated Use `embedding`; this alias remains for the 0.3.x API. */
    model: semanticReadiness.embedding,
    background_repair: await backgroundRepairState({
      db: app.db,
      configured: app.backgroundRepair.configured,
      now: app.now(),
      staleAfterMs: app.backgroundRepair.staleAfterMs,
    }),
    export_import: "enabled",
  } as const;
}

export interface RouteInventoryEntry { method: string; path: string; scope: string | null }

export const ROUTES: RouteDef[] = [
  {
    method: "GET",
    path: "/healthz",
    handler: async (ctx) => ({
      data: { status: "ok", runtime: ctx.app.runtime, revision: ctx.app.revision },
    }),
  },
  { method: "GET", path: "/readyz", handler: readiness },
  {
    method: "POST",
    path: "/v1/projects/resolve",
    scope: "projects:resolve",
    handler: resolveProject,
  },
  {
    method: "POST",
    path: "/v1/observations",
    scope: "observations:write",
    handler: appendObservation,
  },
  {
    method: "DELETE",
    path: "/v1/observations/:id",
    scope: "observations:purge",
    handler: purgeObservation,
  },
  {
    method: "POST",
    path: "/v1/consolidations",
    scope: "claims:write",
    handler: consolidate,
  },
  {
    method: "POST",
    path: "/v1/context/compile",
    scope: "context:compile",
    handler: compileContext,
  },
  {
    method: "GET",
    path: "/v1/context/:id",
    scope: "handoffs:read",
    handler: getContext,
  },
  {
    method: "POST",
    path: "/v1/context/:id/feedback",
    scope: "feedback:write",
    handler: recordFeedback,
  },
  {
    method: "GET",
    path: "/v1/claims/:id/evidence",
    scope: "evidence:read",
    handler: claimEvidence,
  },
  {
    method: "POST",
    path: "/v1/claims/:id/supersede",
    scope: "claims:write",
    handler: supersedeClaim,
  },
  {
    method: "POST",
    path: "/v1/claims/:id/revoke",
    scope: "claims:write",
    handler: revokeClaim,
  },
  {
    method: "POST",
    path: "/v1/claims/:id/expire",
    scope: "claims:write",
    handler: expireClaim,
  },
  {
    method: "POST",
    path: "/v1/checkpoints",
    scope: "checkpoints:write",
    handler: saveCheckpoint,
  },
  {
    method: "GET",
    path: "/v1/checkpoints",
    scope: "checkpoints:read",
    handler: getCheckpoint,
  },
  {
    method: "GET",
    path: "/v1/checkpoints/:id",
    scope: "checkpoints:read",
    handler: getCheckpoint,
  },
  {
    method: "DELETE",
    path: "/v1/checkpoints/:id",
    scope: "checkpoints:write",
    handler: deleteCheckpoint,
  },
  { method: "POST", path: "/v1/keys", scope: "keys:manage", handler: createKey },
  { method: "GET", path: "/v1/keys", scope: "keys:manage", handler: listKeys },
  { method: "DELETE", path: "/v1/keys/:id", scope: "keys:manage", handler: revokeKey },
  { method: "GET", path: "/v1/principal", authenticated: true, handler: getPrincipal },
  { method: "GET", path: "/v1/export", scope: "export:read", handler: exportRecords },
  { method: "POST", path: "/v1/import", scope: "import:write", handler: importRecords },
  { method: "POST", path: "/v1/workspaces", scope: "workspaces:write", handler: createWorkspace },
  { method: "GET", path: "/v1/workspaces", scope: "workspaces:read", handler: listWorkspaces },
  { method: "POST", path: "/v1/memberships", scope: "memberships:write", handler: addMember },
  { method: "GET", path: "/v1/memberships", scope: "memberships:read", handler: listMembers },
  { method: "DELETE", path: "/v1/memberships/:id", scope: "memberships:write", handler: removeMember },
  { method: "POST", path: "/v1/leases", scope: "leases:write", handler: acquireLease },
  { method: "GET", path: "/v1/leases", scope: "leases:read", handler: listLeases },
  { method: "DELETE", path: "/v1/leases/:id", scope: "leases:write", handler: releaseLease },
  { method: "POST", path: "/v1/leases/:id/force-release", scope: "leases:write", handler: forceReleaseLease },
  { method: "POST", path: "/v1/handoffs", scope: "handoffs:write", handler: createHandoff },
  { method: "POST", path: "/v1/handoffs/:id/resolve", scope: "handoffs:write", handler: resolveHandoff },
  { method: "GET", path: "/v1/handoffs", scope: "handoffs:read", handler: listHandoffs },
  { method: "POST", path: "/mcp", scope: "mcp:call", handler: handleMcp },
  { method: "GET", path: "/v1/events", scope: "events:read", handler: listEvents },
  { method: "GET", path: "/v1/events/:id", scope: "events:read", handler: getEvent },
  { method: "POST", path: "/v1/memory-views/compile", scope: "views:compile", handler: compileView },
  { method: "GET", path: "/v1/audit", scope: "audit:read", handler: listAudit },
  { method: "GET", path: "/v1/audit/export", scope: "audit:export", handler: exportAudit },
  { method: "POST", path: "/v1/policies", scope: "governance:write", handler: createPolicy },
  { method: "GET", path: "/v1/policies", scope: "governance:read", handler: listPolicies },
  { method: "PATCH", path: "/v1/policies/:id", scope: "governance:write", handler: updatePolicy },
  { method: "POST", path: "/v1/claim-approvals", scope: "approvals:write", handler: submitClaimApproval },
  { method: "GET", path: "/v1/claim-approvals", scope: "approvals:read", handler: listClaimApprovals },
  { method: "POST", path: "/v1/claim-approvals/:id/decide", scope: "approvals:approve", handler: decideClaimApproval },
  { method: "POST", path: "/v1/channels", scope: "releases:write", handler: createChannel },
  { method: "GET", path: "/v1/channels", scope: "releases:read", handler: listChannels },
  { method: "PATCH", path: "/v1/channels/:id", scope: "releases:write", handler: updateChannel },
  { method: "POST", path: "/v1/knowledge-releases", scope: "releases:write", handler: createKnowledgeRelease },
  { method: "GET", path: "/v1/knowledge-releases", scope: "releases:read", handler: listKnowledgeReleases },
  { method: "POST", path: "/v1/knowledge-releases/:id/approve", scope: "releases:approve", handler: approveKnowledgeRelease },
  { method: "POST", path: "/v1/knowledge-releases/:id/activate", scope: "releases:approve", handler: activateKnowledgeRelease },
  { method: "POST", path: "/v1/knowledge-releases/:id/revoke", scope: "releases:approve", handler: revokeKnowledgeRelease },
  { method: "POST", path: "/v1/channels/:id/context/compile", scope: "channel:compile", handler: compileChannelContext },
  { method: "POST", path: "/v1/legal-holds", scope: "retention:write", handler: placeLegalHold },
  { method: "POST", path: "/v1/legal-holds/:id/release", scope: "retention:write", handler: releaseLegalHold },
  { method: "POST", path: "/v1/retention/apply", scope: "retention:write", handler: applyRetention },
  { method: "POST", path: "/v1/identity-mappings", scope: "identity:write", handler: createIdentityMapping },
  { method: "GET", path: "/v1/identity-mappings", scope: "identity:read", handler: listIdentityMappings },
  { method: "DELETE", path: "/v1/identity-mappings/:id", scope: "identity:write", handler: removeIdentityMapping },
  { method: "POST", path: "/v1/federation/peers", scope: "federation:write", handler: registerPeer },
  { method: "GET", path: "/v1/federation/peers", scope: "federation:read", handler: listPeers },
  { method: "POST", path: "/v1/federation/peers/:id/suspend", scope: "federation:write", handler: suspendPeer },
  { method: "POST", path: "/v1/federation/peers/:id/filters", scope: "federation:write", handler: addFilter },
  { method: "GET", path: "/v1/federation/peers/:id/filters", scope: "federation:read", handler: listFilters },
  { method: "POST", path: "/v1/federation/pull", scope: "federation:write", handler: pullEvents },
  { method: "POST", path: "/v1/federation/push", scope: "federation:write", handler: pushEvents },
  { method: "GET", path: "/v1/federation/log", scope: "federation:read", handler: federationLog },
  { method: "POST", path: "/v1/webhooks", scope: "webhooks:write", handler: registerWebhook },
  { method: "GET", path: "/v1/webhooks", scope: "webhooks:read", handler: listWebhooks },
  { method: "DELETE", path: "/v1/webhooks/:id", scope: "webhooks:write", handler: deleteWebhook },
  { method: "POST", path: "/v1/webhooks/:id/pause", scope: "webhooks:write", handler: pauseWebhook },
  { method: "POST", path: "/v1/webhooks/:id/resume", scope: "webhooks:write", handler: resumeWebhook },
  { method: "GET", path: "/v1/webhooks/:id/deliveries", scope: "webhooks:read", handler: listDeliveries },
  { method: "POST", path: "/v1/webhooks/deliver", scope: "webhooks:write", handler: drainWebhooks },
  { method: "POST", path: "/v1/index/drain", scope: "index:write", handler: drainIndex },
  {
    method: "POST",
    path: "/v1/enrichment/drain",
    scope: "enrichment:write",
    handler: drainEnrichmentRoute,
  },
];

export const ROUTE_INVENTORY: RouteInventoryEntry[] = ROUTES.map(({ method, path, scope }) => ({ method, path, scope: scope ?? null }));

async function readiness(ctx: RequestContext): Promise<Result> {
  const checks: Record<string, unknown> = {};
  let ready = true;
  let canonicalReady = true;
  try {
    await ctx.app.db.all(`SELECT 1 AS ok`);
    checks.canonical_sql = "ok";
  } catch {
    checks.canonical_sql = "unavailable";
    canonicalReady = false;
    ready = false;
  }
  const schema = await schemaState(ctx.app.db);
  const schemaReady = schema.applied === schema.expected && schema.verified;
  checks.migrations =
    schemaReady
      ? "ok"
      : `invalid or pending (applied ${schema.applied}, expected ${schema.expected})`;
  if (!schemaReady) ready = false;
  if (!ctx.app.migrationsReady) {
    checks.migrations = "failed";
    ready = false;
  }
  checks.signing_secrets = ctx.app.secretStorageReady ? "ok" : "failed";
  if (!ctx.app.secretStorageReady) ready = false;

  let semanticReadiness = ctx.app.semanticReadiness;
  if (canonicalReady && schemaReady && ctx.app.migrationsReady) {
    try {
      semanticReadiness = await observedSemanticReadiness(
        ctx.app.db,
        semanticReadiness,
      );
    } catch {
      semanticReadiness = {
        embedding: "enabled",
        vector: "configured_error",
        diagnostic: "index_metadata_unavailable",
      };
    }
  }
  const caps = await capabilities(ctx.app, semanticReadiness);
  checks.semantic_index = semanticReadiness.diagnostic ??
    (semanticReadiness.vector === "enabled" ? "ok" : "disabled");
  if (
    semanticReadiness.diagnostic ||
    semanticReadiness.embedding === "configured_error" ||
    semanticReadiness.vector === "configured_error"
  )
    ready = false;
  checks.extraction = ctx.app.modelCapabilities.extraction;
  checks.background_enrichment = ctx.app.modelCapabilities.backgroundEnrichment;
  if (canonicalReady && schemaReady && ctx.app.migrationsReady) {
    try {
      const [jobs] = await ctx.app.db.all<{
        failed: number;
        backlog: number;
      }>(
        `SELECT
           EXISTS(SELECT 1 FROM enrichment_jobs WHERE state = 'failed') AS failed,
           EXISTS(SELECT 1 FROM enrichment_jobs
                   WHERE state IN ('pending', 'leased')) AS backlog`,
      );
      checks.enrichment_jobs = {
        state: ctx.app.modelCapabilities.extraction === "configured_error"
          ? "configured_error"
          : Number(jobs?.failed ?? 0) > 0
            ? "terminal_error"
            : Number(jobs?.backlog ?? 0) > 0
              ? "backlog"
              : ctx.app.modelCapabilities.extraction === "enabled"
                ? "idle"
                : "disabled",
      };
    } catch {
      checks.enrichment_jobs = { state: "unavailable" };
      ready = false;
    }
  }
  if (
    ctx.app.modelCapabilities.extraction === "configured_error" ||
    ctx.app.modelCapabilities.backgroundEnrichment === "configured_error"
  )
    ready = false;
  const body = {
    ready,
    runtime: ctx.app.runtime,
    revision: ctx.app.revision,
    schema,
    checks,
    capabilities: caps,
  };
  if (!ready) throw new ApiError(503, "NOT_READY", "Service is not ready.", body);
  return { data: body };
}

const compiled = compileRoutes(ROUTES);

/** Canonical origin trusted for browser-originated MCP requests. */
export function parseMcpOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || value !== url.origin)
      throw new Error();
    return url.origin;
  } catch {
    throw new Error(
      "TITEN_MCP_ORIGIN must be an exact HTTP(S) origin without credentials, path, query, hash, or trailing slash.",
    );
  }
}

export function createApp(context: {
  db: Db;
  now?: () => Date;
  revision?: string;
  runtime: string;
  vectors?: VectorCapability;
  semanticReadiness?: SemanticReadiness;
  /** Runtime adapter already completed the local semantic readiness check. */
  semanticPrepared?: boolean;
  modelCapabilities?: {
    extraction?: CapabilityState;
    backgroundEnrichment?: CapabilityState;
  };
  extraction?: ExtractionCapability;
  backgroundRepair?: { configured: boolean; staleAfterMs: number };
  migrationsReady?: boolean;
  secretStorageReady?: boolean;
  webhookSecurity?: WebhookSecurity;
  secretCipher?: SecretCipher;
  mcpOrigin?: string;
}): (request: Request) => Promise<Response> {
  const mcpOrigin = parseMcpOrigin(context.mcpOrigin);
  const configuredVectors = context.vectors;
  const initialSemanticReadiness = context.semanticReadiness ??
    (configuredVectors
      ? { embedding: "enabled", vector: "enabled" }
      : SEMANTIC_DISABLED);
  const semanticPrepared = context.semanticPrepared === true;
  const suppliedExtraction = context.extraction;
  const extractionSnapshot = snapshotExtractionCapability(suppliedExtraction);
  const validExtraction = suppliedExtraction === undefined || extractionSnapshot !== undefined;
  const requestedExtractionState = context.modelCapabilities?.extraction;
  const extractionState = !validExtraction
      || (requestedExtractionState === "enabled" && !suppliedExtraction)
    ? "configured_error"
    : requestedExtractionState ?? (suppliedExtraction ? "enabled" : "disabled");
  const extraction = extractionState === "enabled" && extractionSnapshot
    ? extractionSnapshot
    : undefined;
  const requestedBackgroundState = context.modelCapabilities?.backgroundEnrichment ?? "disabled";
  const backgroundEnrichmentState = requestedBackgroundState === "enabled" && !extraction
    ? "configured_error"
    : requestedBackgroundState;
  const app: AppContext = {
    db: context.db,
    now: context.now ?? (() => new Date()),
    revision: context.revision ?? "dev",
    runtime: context.runtime,
    vectors:
      semanticPrepared && initialSemanticReadiness.vector === "enabled"
        ? configuredVectors
        : undefined,
    semanticReadiness: initialSemanticReadiness,
    modelCapabilities: {
      extraction: extractionState,
      backgroundEnrichment: backgroundEnrichmentState,
    },
    extraction,
    backgroundRepair: context.backgroundRepair ?? { configured: false, staleAfterMs: 60_000 },
    migrationsReady: context.migrationsReady ?? true,
    secretStorageReady: context.secretStorageReady ?? true,
    webhookSecurity: context.webhookSecurity,
    secretCipher: context.secretCipher,
  };
  let semanticPreparation: Promise<SemanticReadiness> | undefined;

  const prepareSemantic = async () => {
    if (semanticPrepared) return;
    if (!app.migrationsReady) {
      app.vectors = undefined;
      return;
    }
    semanticPreparation ??= prepareSemanticReadiness(
      app.db,
      { vectors: configuredVectors, readiness: initialSemanticReadiness },
      app.now().toISOString(),
    );
    app.semanticReadiness = await semanticPreparation;
    app.vectors = app.semanticReadiness.vector === "enabled"
      ? configuredVectors
      : undefined;
  };

  return async function handle(request: Request): Promise<Response> {
    const requestId = newRequestId();
    try {
      const url = new URL(request.url);
      if (url.pathname === "/mcp") {
        const rawOrigin = request.headers.get("origin");
        if (rawOrigin) {
          let origin: string;
          try {
            origin = parseMcpOrigin(rawOrigin)!;
          } catch {
            throw forbidden("Invalid MCP Origin header.");
          }
          if (origin !== (mcpOrigin ?? url.origin))
            throw forbidden("Cross-origin MCP requests are not allowed.");
        }
      }
      const matched = matchRoute(compiled, request.method, url.pathname);
      if (!matched) throw new ApiError(404, "NOT_FOUND", "Unknown endpoint.");
      if ("allowed" in matched)
        throw new ApiError(405, "METHOD_NOT_ALLOWED", `Allowed methods: ${matched.allowed.join(", ")}.`);
      if (
        (!app.migrationsReady || !app.secretStorageReady) &&
        matched.route.path !== "/healthz" &&
        matched.route.path !== "/readyz"
      )
        throw unavailable("Required database migration has not completed.");
      if (matched.route.path !== "/healthz") await prepareSemantic();

      let cachedBody: string | undefined;
      const rawBody = async () => {
        if (cachedBody !== undefined) return cachedBody;
        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > MAX_BODY_BYTES)
          throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
          throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
        cachedBody = text;
        return text;
      };

      const ctx: RequestContext = {
        app,
        request,
        url,
        params: matched.params,
        requestId,
        rawBody,
        json: async <T>() => {
          const text = await rawBody();
          if (text.trim() === "") throw validationError("Request body is required.");
          let parsed: T;
          try {
            parsed = JSON.parse(text) as T;
          } catch {
            throw validationError("Request body must be valid JSON.");
          }
          assertJsonDepth(parsed);
          return parsed;
        },
      };

      if (matched.route.scope || matched.route.authenticated) {
        ctx.principal = await authenticate(app.db, request, app.now());
        if (matched.route.scope) requireScope(ctx.principal, matched.route.scope);
      }

      const result = await matched.route.handler(ctx);
      return result.raw ?? success(result, requestId);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        // Only unique/primary-key failures are write collisions. Foreign-key
        // references are preflighted by their handlers and must not be
        // mislabeled as conflicts if an unexpected one reaches this boundary.
        const message = error instanceof Error ? error.message : "";
        if (/UNIQUE|SQLITE_CONSTRAINT_(?:UNIQUE|PRIMARYKEY)/i.test(message))
          return failure(
            new ApiError(409, "CONFLICT", "Write conflicted with an existing record."),
            requestId,
          );
        if (/no such table|unable to open database|readonly database/i.test(message))
          return failure(unavailable("Storage is unavailable."), requestId);
        // Never surface an unexpected message: it can carry SQL or content.
        console.error(`request ${requestId} failed`, error instanceof Error ? error.name : "unknown");
      }
      return failure(error, requestId);
    }
  };
}
