import { first } from "./db";
import type { Db, Stmt } from "./db";
import { notFound, validationError } from "./errors";
import { newId } from "./ids";
import type { RequestContext, Result } from "./http";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Returns the statement that records one event, so a caller folds it into the
 * same atomic batch as the canonical write it describes. An event can never
 * exist for a write that rolled back, and never be missing for one that
 * committed.
 */
export function eventStatement(
  orgId: string,
  kind: string,
  actorId: string,
  resourceType: string,
  resourceId: string,
  payload: Record<string, unknown>,
  at: string,
): Stmt & { id: string } {
  const id = newId("evt");
  return {
    id,
    sql: `INSERT INTO events (id, org_id, kind, actor_id, resource_type, resource_id, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [id, orgId, kind, actorId, resourceType, resourceId, JSON.stringify(payload), at],
  };
}

/** Standalone write for callers that have no batch of their own. */
export async function recordEvent(
  db: Db,
  orgId: string,
  kind: string,
  actorId: string,
  resourceType: string,
  resourceId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const stmt = eventStatement(
    orgId, kind, actorId, resourceType, resourceId, payload,
    new Date().toISOString(),
  );
  await db.batch([{ sql: stmt.sql, params: stmt.params }]);
  return stmt.id;
}

/**
 * GET /v1/events — cursor-based polling.
 * Query params: after (cursor), limit (default 50, max 200), kind (optional filter).
 */
export async function listEvents(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const after = ctx.url.searchParams.get("after");
  const kindFilter = ctx.url.searchParams.get("kind");

  let limit = DEFAULT_LIMIT;
  const limitParam = ctx.url.searchParams.get("limit");
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1)
      throw validationError('Query "limit" must be a positive integer.');
    limit = Math.min(parsed, MAX_LIMIT);
  }

  // When a cursor is provided, resolve its created_at to paginate correctly.
  let afterCreatedAt: string | null = null;
  let afterId: string | null = null;
  if (after) {
    const cursor = await first<{ created_at: string; id: string }>(
      ctx.app.db,
      `SELECT created_at, id FROM events WHERE id = ? AND org_id = ?`,
      [after, principal.orgId],
    );
    if (!cursor) throw validationError('Query "after" references an unknown event.');
    afterCreatedAt = cursor.created_at;
    afterId = cursor.id;
  }

  const conditions: string[] = ["org_id = ?"];
  const params: (string | number)[] = [principal.orgId];

  if (afterCreatedAt && afterId) {
    conditions.push("(created_at > ? OR (created_at = ? AND id > ?))");
    params.push(afterCreatedAt, afterCreatedAt, afterId);
  }

  if (kindFilter) {
    conditions.push("kind = ?");
    params.push(kindFilter);
  }

  params.push(limit);

  const sql = `SELECT id, kind, actor_id, resource_type, resource_id, payload, created_at
    FROM events
    WHERE ${conditions.join(" AND ")}
    ORDER BY created_at ASC, id ASC
    LIMIT ?`;

  const rows = await ctx.app.db.all<{
    id: string;
    kind: string;
    actor_id: string;
    resource_type: string;
    resource_id: string;
    payload: string;
    created_at: string;
  }>(sql, params);

  const events = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    actor_id: r.actor_id,
    resource_type: r.resource_type,
    resource_id: r.resource_id,
    payload: JSON.parse(r.payload),
    created_at: r.created_at,
  }));

  const cursor = events.length > 0 ? events[events.length - 1]!.id : null;

  return { data: { events, cursor } };
}

/**
 * GET /v1/events/:id — fetch a single event by id.
 */
export async function getEvent(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const eventId = ctx.params.id!;

  const row = await first<{
    id: string;
    kind: string;
    actor_id: string;
    resource_type: string;
    resource_id: string;
    payload: string;
    created_at: string;
  }>(
    ctx.app.db,
    `SELECT id, kind, actor_id, resource_type, resource_id, payload, created_at
       FROM events
      WHERE id = ? AND org_id = ?`,
    [eventId, principal.orgId],
  );
  if (!row) throw notFound();

  return {
    data: {
      id: row.id,
      kind: row.kind,
      actor_id: row.actor_id,
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      payload: JSON.parse(row.payload),
      created_at: row.created_at,
    },
  };
}
