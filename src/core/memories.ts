import { recordAccessParams, recordAccessSql } from "./authorization";
import type { Param } from "./db";
import { validationError } from "./errors";
import type { RequestContext, Result } from "./http";
import { LIMITS, CLAIM_KINDS, VISIBILITIES } from "./validate";
import { planFtsQuery } from "./retrieval";

const STATUSES = ["active", "disputed", "superseded", "expired", "revoked"] as const;
const DEFAULT_STATUSES = ["active", "disputed"] as const;
const MAX_PAGE_SIZE = 100;

interface MemoryCursor {
  createdAt: string;
  id: string;
}

interface MemoryRow {
  id: string;
  subject_id: string;
  project_id: string | null;
  kind: string;
  statement: string;
  confidence: number;
  trust: string;
  visibility: string;
  status: string;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
}

function encodeCursor(cursor: MemoryCursor): string {
  return btoa(JSON.stringify([cursor.createdAt, cursor.id]))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeCursor(value: string | null): MemoryCursor | null {
  if (!value) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(atob(padded));
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error();
    const [createdAt, id] = parsed;
    if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))
      || typeof id !== "string" || id.length === 0 || id.length > LIMITS.identifier) throw new Error();
    return { createdAt: new Date(createdAt).toISOString(), id };
  } catch {
    throw validationError('Query "after" is invalid.');
  }
}

function queryValue(ctx: RequestContext, name: string, max: number): string | null {
  const value = ctx.url.searchParams.get(name);
  if (value === null) return null;
  if (value.trim() === "" || value.length > max) throw validationError(`Query "${name}" is invalid.`);
  return value;
}

function parseLimit(ctx: RequestContext): number {
  const raw = queryValue(ctx, "limit", 12);
  if (raw === null) return 25;
  if (!/^\d+$/u.test(raw)) throw validationError('Query "limit" must be an integer between 1 and 100.');
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE)
    throw validationError('Query "limit" must be an integer between 1 and 100.');
  return limit;
}

function parseList<T extends string>(raw: string | null, allowed: readonly T[], name: string): T[] {
  if (raw === null) return [];
  const values = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
  if (values.length === 0 || values.some((value) => !allowed.includes(value as T)))
    throw validationError(`Query "${name}" contains an unsupported value.`);
  return values as T[];
}

/**
 * Lists canonical claims without compiling an Atlas view. Authorization,
 * retention, lifecycle, and scope remain SQL predicates before pagination.
 */
export async function listMemories(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const q = queryValue(ctx, "q", LIMITS.statement);
  const subjectId = queryValue(ctx, "subject_id", LIMITS.identifier);
  const projectQuery = queryValue(ctx, "project_id", LIMITS.identifier);
  const projectId = projectQuery === "~" ? null : projectQuery;
  const workspaceId = queryValue(ctx, "workspace_id", LIMITS.identifier);
  const statuses = parseList(queryValue(ctx, "status", 120), STATUSES, "status");
  const visibilities = parseList(queryValue(ctx, "visibility", 80), VISIBILITIES, "visibility");
  const kinds = parseList(queryValue(ctx, "kind", 240), CLAIM_KINDS, "kind");
  const after = decodeCursor(queryValue(ctx, "after", 1000));
  const limit = parseLimit(ctx);
  const conditions = ["c.org_id = ?"];
  const params: Param[] = [principal.orgId];
  const activeStatuses = statuses.length > 0 ? statuses : [...DEFAULT_STATUSES];
  conditions.push(`c.status IN (${activeStatuses.map(() => "?").join(", ")})`);
  params.push(...activeStatuses);
  if (subjectId) { conditions.push("c.subject_id = ?"); params.push(subjectId); }
  if (projectQuery) { conditions.push("c.project_id IS ?"); params.push(projectId); }
  if (workspaceId) { conditions.push("(c.workspace_id IS ? OR c.visibility = 'organization')"); params.push(workspaceId); }
  if (visibilities.length > 0) {
    conditions.push(`c.visibility IN (${visibilities.map(() => "?").join(", ")})`);
    params.push(...visibilities);
  }
  if (kinds.length > 0) {
    conditions.push(`c.kind IN (${kinds.map(() => "?").join(", ")})`);
    params.push(...kinds);
  }
  if (activeStatuses.every((status) => status === "active" || status === "disputed")) {
    const now = ctx.app.now().toISOString();
    conditions.push("c.valid_from <= ? AND (c.valid_to IS NULL OR c.valid_to > ?)");
    params.push(now, now);
  }
  const plan = q ? planFtsQuery(q) : { match: null, termsUsed: 0, termsDropped: 0 };
  const join = plan.match ? "JOIN claims_fts f ON f.claim_id = c.id" : "";
  if (plan.match) {
    conditions.push("claims_fts MATCH ('org_scope : \"' || lower(hex(?)) || '0\" AND statement : (' || ? || ')')");
    params.push(principal.orgId, plan.match);
  }
  conditions.push(recordAccessSql("c"));
  params.push(...recordAccessParams(principal));
  if (after) {
    conditions.push("(c.created_at < ? OR (c.created_at = ? AND c.id < ?))");
    params.push(after.createdAt, after.createdAt, after.id);
  }
  params.push(limit + 1);
  const rows = await ctx.app.db.all<MemoryRow>(
    `SELECT c.id, c.subject_id, c.project_id, c.kind, c.statement, c.confidence,
            c.trust, c.visibility, c.status, c.valid_from, c.valid_to, c.created_at
       FROM claims c ${join}
      WHERE ${conditions.join(" AND ")}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ?`,
    params,
  );
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const tail = items.at(-1);
  const facetConditions = ["c.org_id = ?"];
  const facetParams: Param[] = [principal.orgId];
  if (subjectId) { facetConditions.push("c.subject_id = ?"); facetParams.push(subjectId); }
  if (projectQuery) { facetConditions.push("c.project_id IS ?"); facetParams.push(projectId); }
  if (workspaceId) { facetConditions.push("(c.workspace_id IS ? OR c.visibility = 'organization')"); facetParams.push(workspaceId); }
  if (visibilities.length > 0) {
    facetConditions.push(`c.visibility IN (${visibilities.map(() => "?").join(", ")})`);
    facetParams.push(...visibilities);
  }
  if (plan.match) {
    facetConditions.push("claims_fts MATCH ('org_scope : \"' || lower(hex(?)) || '0\" AND statement : (' || ? || ')')");
    facetParams.push(principal.orgId, plan.match);
  }
  facetConditions.push(recordAccessSql("c"));
  facetParams.push(...recordAccessParams(principal));
  const facets = await ctx.app.db.all<{ status: string; kind: string; count: number }>(
    `SELECT c.status, c.kind, COUNT(*) AS count FROM claims c
       ${plan.match ? "JOIN claims_fts f ON f.claim_id = c.id" : ""}
      WHERE ${facetConditions.join(" AND ")} GROUP BY c.status, c.kind`, facetParams);
  const counts = (field: "status" | "kind") => Object.fromEntries(facets.reduce((entries, row) => {
    const key = row[field];
    entries.set(key, (entries.get(key) ?? 0) + Number(row.count));
    return entries;
  }, new Map<string, number>()));
  return {
    data: {
      items,
      page: {
        limit,
        has_more: hasMore,
        next_cursor: hasMore && tail ? encodeCursor({ createdAt: tail.created_at, id: tail.id }) : null,
      },
      query: { q, subject_id: subjectId, project_id: projectQuery === "~" ? null : projectId,
        workspace_id: workspaceId, status: activeStatuses, visibility: visibilities,
        kind: kinds, terms_used: plan.termsUsed, terms_dropped: plan.termsDropped },
      facets: { status: counts("status"), kind: counts("kind") },
      authorization: { principal_id: principal.principalId, access_mode: "principal" },
    },
  };
}
