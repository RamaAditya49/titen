import { ApiError, supportGuidance } from "./errors";
import { newId } from "./ids";
import type { Principal } from "./auth";
import type { AppContext } from "./app";

export const MAX_BODY_BYTES = 1_048_576;

export interface RequestContext {
  app: AppContext;
  request: Request;
  url: URL;
  params: Record<string, string>;
  requestId: string;
  /** Present only on routes that require authentication. */
  principal?: Principal;
  json: <T>() => Promise<T>;
  rawBody: () => Promise<string>;
}

export interface Result {
  status?: number;
  data: unknown;
  meta?: Record<string, unknown>;
  /** Bypasses the JSON envelope. Used by the NDJSON export stream. */
  raw?: Response;
}

export interface RouteDef {
  method: string;
  path: string;
  /** Required capability. Omitted means the route is unauthenticated. */
  scope?: string;
  /** Authenticate without requiring an additional capability. */
  authenticated?: boolean;
  handler: (ctx: RequestContext) => Promise<Result>;
}

export function jsonResponse(
  status: number,
  body: unknown,
  requestId: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

export function success(result: Result, requestId: string): Response {
  return jsonResponse(
    result.status ?? 200,
    { data: result.data, meta: { request_id: requestId, ...result.meta } },
    requestId,
  );
}

export function failure(error: unknown, requestId: string): Response {
  const api =
    error instanceof ApiError
      ? error
      : new ApiError(500, "INTERNAL", "Request could not be completed.");
  return jsonResponse(
    api.status,
    {
      error: { code: api.code, message: api.message },
      meta: { ...api.meta, request_id: requestId, support: supportGuidance(api) },
    },
    requestId,
  );
}

export function newRequestId(): string {
  return newId("req");
}

const segmentsOf = (path: string) => path.split("/").filter(Boolean);

export interface CompiledRoute extends RouteDef {
  segments: string[];
}

export function compileRoutes(routes: RouteDef[]): CompiledRoute[] {
  return routes.map((route) => ({ ...route, segments: segmentsOf(route.path) }));
}

export function matchRoute(
  routes: CompiledRoute[],
  method: string,
  pathname: string,
): { route: CompiledRoute; params: Record<string, string> } | { allowed: string[] } | undefined {
  const parts = segmentsOf(pathname);
  const allowed = new Set<string>();
  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, segment] of route.segments.entries()) {
      const value = parts[index]!;
      if (segment.startsWith(":")) params[segment.slice(1)] = decodeURIComponent(value);
      else if (segment !== value) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (route.method === method) return { route, params };
    allowed.add(route.method);
  }
  return allowed.size ? { allowed: [...allowed].sort() } : undefined;
}
