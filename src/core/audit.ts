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
  if (after) { sql += ` AND (created_at, id) > ((SELECT created_at FROM audit_log WHERE id = ?), ?)`; params.push(after, after); }
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

  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `SELECT id, actor_id, action, resource_type, resource_id, detail, ip_hint, created_at
     FROM audit_log WHERE org_id = ? AND id > ? ORDER BY created_at, id LIMIT ?`,
    [orgId, after, limitParam],
  );

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
