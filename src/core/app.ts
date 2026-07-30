import { authenticate, requireScope } from "./auth";
import { saveCheckpoint, getCheckpoint, deleteCheckpoint } from "./checkpoints";
import { claimEvidence } from "./evidence";
import { compileContext, recordFeedback } from "./context";
import { consolidate } from "./claims";
import { createKey, listKeys, revokeKey } from "./keys";
import { exportRecords, importRecords } from "./portability";
import { expireClaim, revokeClaim, supersedeClaim } from "./lifecycle";
import { createWorkspace, listWorkspaces, addMember, listMembers, removeMember, acquireLease, releaseLease, createHandoff, resolveHandoff, listHandoffs } from "./collaboration";
import { listEvents, getEvent } from "./events";
import { drainIndex } from "./indexing";
import { handleMcp } from "./mcp";
import { compileView } from "./atlas";
import { createPolicy, listPolicies, createRelease, publishRelease, revokeRelease, queryRelease, channelContext } from "./governance";
import { listAudit, exportAudit } from "./audit";
import { registerPeer, listPeers, suspendPeer, addFilter, listFilters, pullEvents, pushEvents, federationLog } from "./federation";
import { registerWebhook, listWebhooks, deleteWebhook, pauseWebhook, resumeWebhook, listDeliveries, drainWebhooks } from "./webhooks";
import { appendObservation } from "./observations";
import { resolveProject } from "./projects";
import { schemaState } from "./migrations";
import { ApiError, unavailable, validationError } from "./errors";
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
import type { VectorCapability } from "./vectors";

export interface AppContext {
  db: Db;
  now: () => Date;
  /** Non-secret build marker reported by health and readiness. */
  revision: string;
  /** Deployment target label, e.g. `cloudflare-d1` or `bun-sqlite`. */
  runtime: string;
  /** Optional vector capability. Absent means FTS-only retrieval. */
  vectors?: VectorCapability;
}

/** Capabilities are reported honestly based on what's configured. */
export function capabilities(app: AppContext) {
  return {
    fts: "enabled",
    vector: app.vectors ? "enabled" : "disabled",
    model: app.vectors ? "enabled" : "disabled",
    background_repair: "disabled",
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
    method: "DELETE",
    path: "/v1/checkpoints/:id",
    scope: "checkpoints:write",
    handler: deleteCheckpoint,
  },
  { method: "POST", path: "/v1/keys", scope: "keys:manage", handler: createKey },
  { method: "GET", path: "/v1/keys", scope: "keys:manage", handler: listKeys },
  { method: "DELETE", path: "/v1/keys/:id", scope: "keys:manage", handler: revokeKey },
  { method: "GET", path: "/v1/export", scope: "export:read", handler: exportRecords },
  { method: "POST", path: "/v1/import", scope: "import:write", handler: importRecords },
  { method: "POST", path: "/v1/workspaces", scope: "workspaces:write", handler: createWorkspace },
  { method: "GET", path: "/v1/workspaces", scope: "workspaces:read", handler: listWorkspaces },
  { method: "POST", path: "/v1/memberships", scope: "memberships:write", handler: addMember },
  { method: "GET", path: "/v1/memberships", scope: "memberships:read", handler: listMembers },
  { method: "DELETE", path: "/v1/memberships/:id", scope: "memberships:write", handler: removeMember },
  { method: "POST", path: "/v1/leases", scope: "leases:write", handler: acquireLease },
  { method: "DELETE", path: "/v1/leases/:id", scope: "leases:write", handler: releaseLease },
  { method: "POST", path: "/v1/handoffs", scope: "handoffs:write", handler: createHandoff },
  { method: "POST", path: "/v1/handoffs/:id/resolve", scope: "handoffs:write", handler: resolveHandoff },
  { method: "GET", path: "/v1/handoffs", scope: "handoffs:read", handler: listHandoffs },
  { method: "POST", path: "/mcp", scope: "mcp:call", handler: handleMcp },
  { method: "GET", path: "/v1/events", scope: "events:read", handler: listEvents },
  { method: "GET", path: "/v1/events/:id", scope: "events:read", handler: getEvent },
  { method: "POST", path: "/v1/memory-views/compile", scope: "views:compile", handler: compileView },
  { method: "POST", path: "/v1/policies", scope: "policies:write", handler: createPolicy },
  { method: "GET", path: "/v1/policies", scope: "policies:read", handler: listPolicies },
  { method: "POST", path: "/v1/channel-releases", scope: "releases:write", handler: createRelease },
  { method: "POST", path: "/v1/channel-releases/:id/publish", scope: "releases:write", handler: publishRelease },
  { method: "POST", path: "/v1/channel-releases/:id/revoke", scope: "releases:write", handler: revokeRelease },
  { method: "GET", path: "/v1/channel-releases/:id", scope: "releases:read", handler: queryRelease },
  { method: "POST", path: "/v1/channel-context", scope: "channel:read", handler: channelContext },
  { method: "GET", path: "/v1/audit", scope: "audit:read", handler: listAudit },
  { method: "GET", path: "/v1/audit/export", scope: "audit:export", handler: exportAudit },
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
];

export const ROUTE_INVENTORY: RouteInventoryEntry[] = ROUTES.map(({ method, path, scope }) => ({ method, path, scope: scope ?? null }));

async function readiness(ctx: RequestContext): Promise<Result> {
  const checks: Record<string, string> = {};
  let ready = true;
  try {
    await ctx.app.db.all(`SELECT 1 AS ok`);
    checks.canonical_sql = "ok";
  } catch {
    checks.canonical_sql = "unavailable";
    ready = false;
  }
  const schema = await schemaState(ctx.app.db);
  checks.migrations =
    schema.applied === schema.expected
      ? "ok"
      : `pending (applied ${schema.applied}, expected ${schema.expected})`;
  if (schema.applied !== schema.expected) ready = false;

  const caps = capabilities(ctx.app);
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

export function createApp(context: {
  db: Db;
  now?: () => Date;
  revision?: string;
  runtime: string;
  vectors?: VectorCapability;
}): (request: Request) => Promise<Response> {
  const app: AppContext = {
    db: context.db,
    now: context.now ?? (() => new Date()),
    revision: context.revision ?? "dev",
    runtime: context.runtime,
    vectors: context.vectors,
  };

  return async function handle(request: Request): Promise<Response> {
    const requestId = newRequestId();
    try {
      const url = new URL(request.url);
      const matched = matchRoute(compiled, request.method, url.pathname);
      if (!matched) throw new ApiError(404, "NOT_FOUND", "Unknown endpoint.");
      if ("allowed" in matched)
        throw new ApiError(405, "METHOD_NOT_ALLOWED", `Allowed methods: ${matched.allowed.join(", ")}.`);

      let cachedBody: string | undefined;
      const rawBody = async () => {
        if (cachedBody !== undefined) return cachedBody;
        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > MAX_BODY_BYTES)
          throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
        const text = await request.text();
        if (text.length > MAX_BODY_BYTES)
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
          try {
            return JSON.parse(text) as T;
          } catch {
            throw validationError("Request body must be valid JSON.");
          }
        },
      };

      if (matched.route.scope) {
        ctx.principal = await authenticate(app.db, request);
        requireScope(ctx.principal, matched.route.scope);
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
