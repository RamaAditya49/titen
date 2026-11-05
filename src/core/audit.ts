import { first } from "./db";
import type { Db, Stmt } from "./db";
import { newId } from "./ids";
import { notFound, validationError } from "./errors";
import type { RequestContext, Result } from "./http";

/**
 * Returns the statement that records one audit entry, so a caller folds it into
 * the same atomic batch as the action it describes. The audit trail cannot
 * disagree with what actually committed.
 */
export function auditStatement(
  orgId: string,
  actorId: string,
  action: string,
  resourceType: string,
  at: string,
  resourceId?: string | null,
  detail?: string | null,
): Stmt {
  return {
    sql: `INSERT INTO audit_log (id, org_id, actor_id, action, resource_type, resource_id, detail, ip_hint, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    params: [
      newId("aud"), orgId, actorId, action, resourceType,
      resourceId ?? null, detail ?? null, at,
    ],
  };
}

/** Standalone write for callers that have no batch of their own. */
export async function recordAudit(
  db: Db,
  orgId: string,
  actorId: string,
  action: string,
  resourceType: string,
  resourceId?: string | null,
  detail?: string | null,
): Promise<void> {
  await db.batch([
    auditStatement(
      orgId, actorId, action, resourceType,
      new Date().toISOString(), resourceId, detail,
    ),
  ]);
}

export async function listAudit(ctx: RequestContext): Promise<Result> {
  const { orgId } = ctx.principal!;
  const after = ctx.url.searchParams.get("after") ?? "";
  const action = ctx.url.searchParams.get("action") ?? null;
  const limitParam = Number(ctx.url.searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limitParam) || limitParam < 1 || limitParam > 500)
    throw validationError('Query "limit" must be an integer between 1 and 500.');

  const params: (string | number)[] = [orgId];
  let sql = `SELECT id, actor_id, action, resource_type, resource_id, detail, ip_hint, created_at
             FROM audit_log WHERE org_id = ?`;
  if (action) { sql += ` AND action = ?`; params.push(action); }
  // The cursor lookup keeps the organization filter, so a foreign id acts like an unknown id.
  if (after) {
    sql += ` AND (created_at, id) > ((SELECT created_at FROM audit_log WHERE id = ? AND org_id = ?), ?)`;
    params.push(after, orgId, after);
  }
  sql += ` ORDER BY created_at, id LIMIT ?`;
  params.push(limitParam);

  const rows = await ctx.app.db.all<Record<string, unknown>>(sql, params);
  const cursor = rows.length > 0 ? (rows[rows.length - 1]!.id as string) : null;

  return { data: { entries: rows, cursor } };
}

export async function exportAudit(ctx: RequestContext): Promise<Result> {
  const { orgId } = ctx.principal!;
  const after = ctx.url.searchParams.get("after") ?? "";
  const limitParam = Number(ctx.url.searchParams.get("limit") ?? "1000");
  if (!Number.isInteger(limitParam) || limitParam < 1 || limitParam > 5000)
    throw validationError('Query "limit" must be an integer between 1 and 5000.');

  // Page on the same (created_at, id) key the rows are ordered by. Audit ids are
  // random, so an id-only predicate would skip and repeat rows across pages.
  const params: (string | number)[] = [orgId];
  let sql = `SELECT id, actor_id, action, resource_type, resource_id, detail, ip_hint, created_at
             FROM audit_log WHERE org_id = ?`;
  if (after) {
    const anchor = await first<{ created_at: string }>(
      ctx.app.db,
      `SELECT created_at FROM audit_log WHERE id = ? AND org_id = ?`,
      [after, orgId],
    );
    // An empty page would read as a finished export, so an unknown cursor is an error.
    if (!anchor) throw validationError('Query "after" references an unknown audit entry.');
    sql += ` AND (created_at, id) > (?, ?)`;
    params.push(anchor.created_at, after);
  }
  sql += ` ORDER BY created_at, id LIMIT ?`;
  params.push(limitParam);
  const rows = await ctx.app.db.all<Record<string, unknown>>(sql, params);

  const lines: string[] = [];
  let cursor = "";
  const header = {
    type: "titen.audit.header",
    format_version: 1,
    org_id: orgId,
    exported_at: ctx.app.now().toISOString(),
    count: rows.length,
    next_cursor: rows.length === limitParam ? (rows[rows.length - 1]!.id as string) : null,
    complete: rows.length < limitParam,
  };
  lines.push(JSON.stringify(header));
  for (const row of rows) {
    cursor = row.id as string;
    lines.push(JSON.stringify({ type: "audit_entry", ...row }));
  }

  return {
    raw: new Response(`${lines.join("\n")}\n`, {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        "x-request-id": ctx.requestId,
      },
    }),
    data: null,
  };
}
