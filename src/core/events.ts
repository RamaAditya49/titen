import { first } from "./db";
import type { Db, Stmt } from "./db";
import { recordAccessSql } from "./authorization";
import { notFound, validationError } from "./errors";
import { newId } from "./ids";
import type { RequestContext, Result } from "./http";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Visibility for event projections follows the canonical resource, not org alone. */
export function eventAccessSql(alias = "e"): string {
  return `(
    (${alias}.resource_type = 'observation' AND EXISTS (
      SELECT 1 FROM observations o WHERE o.id = ${alias}.resource_id
        AND o.org_id = ${alias}.org_id AND ${recordAccessSql("o")}
    ))
    OR (${alias}.resource_type = 'claim' AND EXISTS (
      SELECT 1 FROM claims c WHERE c.id = ${alias}.resource_id
        AND c.org_id = ${alias}.org_id AND ${recordAccessSql("c")}
    ))
    OR (${alias}.resource_type = 'handoff' AND EXISTS (
      SELECT 1 FROM handoffs h WHERE h.id = ${alias}.resource_id
        AND h.org_id = ${alias}.org_id AND (h.from_principal = ? OR h.to_principal = ?)
    ))
    OR (${alias}.resource_type = 'lease' AND EXISTS (
      SELECT 1 FROM leases l WHERE l.id = ${alias}.resource_id
        AND l.org_id = ${alias}.org_id AND l.holder_id = ?
    ))
    OR (${alias}.resource_type NOT IN ('observation', 'claim', 'handoff', 'lease') AND ${alias}.actor_id = ?)
  )`;
}

export function eventAccessParams(principalId: string): string[] {
  return [principalId, principalId, principalId, principalId, principalId, principalId, principalId, principalId];
}

export async function canPrincipalReadEvent(db: Db, orgId: string, principalId: string, eventId: string): Promise<boolean> {
  return Boolean(await first<{ id: string }>(
    db,
    `SELECT e.id FROM events e WHERE e.id = ? AND e.org_id = ? AND ${eventAccessSql("e")}`,
    [eventId, orgId, ...eventAccessParams(principalId)],
  ));
}

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
      `SELECT e.created_at, e.id FROM events e
        WHERE e.id = ? AND e.org_id = ? AND ${eventAccessSql("e")}`,
      [after, principal.orgId, ...eventAccessParams(principal.principalId)],
    );
    if (!cursor) throw validationError('Query "after" references an unknown event.');
    afterCreatedAt = cursor.created_at;
    afterId = cursor.id;
  }

  const conditions: string[] = ["e.org_id = ?", eventAccessSql("e")];
  const params: (string | number)[] = [principal.orgId, ...eventAccessParams(principal.principalId)];

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
    FROM events e
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
       FROM events e
      WHERE e.id = ? AND e.org_id = ? AND ${eventAccessSql("e")}`,
    [eventId, principal.orgId, ...eventAccessParams(principal.principalId)],
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
