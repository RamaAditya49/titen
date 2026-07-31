import { first } from "./db";
import { recordAccessParams, recordAccessSql } from "./authorization";
import { auditStatement } from "./audit";
import type { Principal } from "./auth";
import type { Db } from "./db";
import { notFound, validationError, conflict } from "./errors";
import { eventStatement } from "./events";
import { newId } from "./ids";
import { POLICY_SNAPSHOT } from "./context";
import type { RequestContext, Result } from "./http";
import {
  LIMITS,
  requireObject,
  requireString,
  optionalString,
  requireEnum,
  requireInteger,
} from "./validate";

const PRINCIPAL_KINDS = ["human", "agent", "service"] as const;
const MEMBER_ROLES = ["owner", "admin", "member", "reader"] as const;
const HANDOFF_RESOLUTIONS = ["accepted", "rejected"] as const;

// --- Workspaces ---

export async function createWorkspace(ctx: RequestContext): Promise<Result> {
  const { orgId } = ctx.principal!;
  const body = requireObject(await ctx.json());
  const name = requireString(body, "name", LIMITS.label);
  const id = newId("ws");
  const now = ctx.app.now().toISOString();

  try {
    await ctx.app.db.batch([{
      sql: `INSERT INTO workspaces (id, org_id, name, created_at) VALUES (?, ?, ?, ?)`,
      params: [id, orgId, name, now],
    }]);
  } catch (err) {
    if (err instanceof Error && /UNIQUE|constraint/i.test(err.message))
      throw conflict("A workspace with that name already exists.");
    throw err;
  }

  return { status: 201, data: { workspace_id: id, name } };
}

export async function listWorkspaces(ctx: RequestContext): Promise<Result> {
  const { orgId } = ctx.principal!;
  const rows = await ctx.app.db.all<{ id: string; name: string; created_at: string }>(
    `SELECT id, name, created_at FROM workspaces WHERE org_id = ? ORDER BY created_at`,
    [orgId],
  );
  return { data: { workspaces: rows.map(r => ({ workspace_id: r.id, name: r.name, created_at: r.created_at })) } };
}

// --- Memberships ---

export async function addMember(ctx: RequestContext): Promise<Result> {
  const { orgId, principalId } = ctx.principal!;
  const body = requireObject(await ctx.json());
  const workspaceId = optionalString(body, "workspace_id", LIMITS.identifier);
  const memberPrincipalId = requireString(body, "principal_id", LIMITS.identifier);
  const principalKind = requireEnum(body, "principal_kind", PRINCIPAL_KINDS);
  const role = requireEnum(body, "role", MEMBER_ROLES);
  const id = newId("mbr");
  const now = ctx.app.now().toISOString();

  if (workspaceId) {
    const workspace = await first<{ id: string }>(
      ctx.app.db,
      `SELECT id FROM workspaces WHERE id = ? AND org_id = ?`,
      [workspaceId, orgId],
    );
    if (!workspace) throw notFound();
  }

  await ctx.app.db.batch([
    {
      sql: `INSERT INTO memberships (id, org_id, workspace_id, principal_id, principal_kind, role, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [id, orgId, workspaceId, memberPrincipalId, principalKind, role, now],
    },
    auditStatement(orgId, principalId, "membership.add", "membership", now, id),
  ]);

  return { status: 201, data: { membership_id: id } };
}

export async function listMembers(ctx: RequestContext): Promise<Result> {
  const { orgId } = ctx.principal!;
  const workspaceId = ctx.url.searchParams.get("workspace_id") || null;

  const sql = workspaceId
    ? `SELECT id, workspace_id, principal_id, principal_kind, role, created_at
       FROM memberships WHERE org_id = ? AND workspace_id = ? AND removed_at IS NULL`
    : `SELECT id, workspace_id, principal_id, principal_kind, role, created_at
       FROM memberships WHERE org_id = ? AND removed_at IS NULL`;

  const params = workspaceId ? [orgId, workspaceId] : [orgId];
  const rows = await ctx.app.db.all<Record<string, unknown>>(sql, params);
  return { data: { memberships: rows.map(r => ({ membership_id: r.id, ...r })) } };
}

export async function removeMember(ctx: RequestContext): Promise<Result> {
  const { orgId, principalId } = ctx.principal!;
  const id = ctx.params.id!;
  const row = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM memberships WHERE id = ? AND org_id = ? AND removed_at IS NULL`,
    [id, orgId],
  );
  if (!row) throw notFound();
  const now = ctx.app.now().toISOString();
  await ctx.app.db.batch([
    {
      sql: `UPDATE memberships SET removed_at = ? WHERE id = ?`,
      params: [now, id],
    },
    auditStatement(orgId, principalId, "membership.remove", "membership", now, id),
  ]);
  return { data: { membership_id: id, removed_at: now } };
}

// --- Leases ---

interface LeaseInput {
  resourceType: string;
  resourceId: string;
  purpose: string;
  ttlSeconds: number;
}

export async function acquireLeaseForPrincipal(
  db: Db,
  principal: Principal,
  input: LeaseInput,
  now: Date,
): Promise<{ lease_id: string; expires_at: string; renewed: boolean }> {
  const { orgId, principalId } = principal;
  const { resourceType, resourceId, purpose, ttlSeconds } = input;
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const existing = await first<{ id: string; holder_id: string; expires_at: string }>(
    db,
    `SELECT id, holder_id, expires_at FROM leases
     WHERE org_id = ? AND resource_type = ? AND resource_id = ? AND released_at IS NULL`,
    [orgId, resourceType, resourceId],
  );

  if (existing?.holder_id === principalId) {
    await db.batch([
      {
        sql: `UPDATE leases SET purpose = ?, ttl_seconds = ?, expires_at = ?
              WHERE id = ? AND org_id = ? AND holder_id = ? AND released_at IS NULL`,
        params: [purpose, ttlSeconds, expiresAt, existing.id, orgId, principalId],
      },
      eventStatement(orgId, "lease.renewed", principalId, "lease", existing.id,
        { resource_type: resourceType, resource_id: resourceId, purpose, expires_at: expiresAt }, nowIso),
    ]);
    return { lease_id: existing.id, expires_at: expiresAt, renewed: true };
  }

  if (existing && new Date(existing.expires_at) > now)
    throw conflict(`Resource is leased by another principal until ${existing.expires_at}.`);

  const id = newId("lease");
  const statements = existing
    ? [{
        sql: `UPDATE leases SET released_at = ?
              WHERE id = ? AND org_id = ? AND released_at IS NULL AND expires_at <= ?`,
        params: [nowIso, existing.id, orgId, nowIso],
      }]
    : [];
  statements.push(
    {
      sql: `INSERT INTO leases (id, org_id, resource_type, resource_id, holder_id, purpose, ttl_seconds, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, orgId, resourceType, resourceId, principalId, purpose, ttlSeconds, expiresAt, nowIso],
    },
    eventStatement(orgId, "lease.acquired", principalId, "lease", id,
      { resource_type: resourceType, resource_id: resourceId, purpose, expires_at: expiresAt }, nowIso),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw conflict("Resource was leased by another principal.");
    throw error;
  }
  return { lease_id: id, expires_at: expiresAt, renewed: false };
}

export async function acquireLease(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const resourceType = requireString(body, "resource_type", LIMITS.label);
  const resourceId = requireString(body, "resource_id", LIMITS.identifier);
  const purpose = requireString(body, "purpose", LIMITS.label);
  const ttlSeconds = requireInteger(body, "ttl_seconds", 10, 86400);

  const lease = await acquireLeaseForPrincipal(
    ctx.app.db,
    principal,
    { resourceType, resourceId, purpose, ttlSeconds },
    ctx.app.now(),
  );
  return { status: lease.renewed ? 200 : 201, data: lease };
}

export async function releaseLease(ctx: RequestContext): Promise<Result> {
  const { orgId, principalId } = ctx.principal!;
  const id = ctx.params.id!;
  const row = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM leases WHERE id = ? AND org_id = ? AND holder_id = ? AND released_at IS NULL`,
    [id, orgId, principalId],
  );
  if (!row) throw notFound();
  const now = ctx.app.now().toISOString();
  await ctx.app.db.batch([
    {
      sql: `UPDATE leases SET released_at = ?
            WHERE id = ? AND org_id = ? AND holder_id = ? AND released_at IS NULL`,
      params: [now, id, orgId, principalId],
    },
    eventStatement(orgId, "lease.released", principalId, "lease", id, {}, now),
  ]);
  return { data: { lease_id: id, released_at: now } };
}

/** GET /v1/leases — bounded organization-scoped active lease inventory. */
export async function listLeases(ctx: RequestContext): Promise<Result> {
  const { orgId } = ctx.principal!;
  const rawLimit = ctx.url.searchParams.get("limit") ?? "50";
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw validationError('Query "limit" must be an integer between 1 and 200.');

  const after = ctx.url.searchParams.get("after");
  let afterCreatedAt: string | null = null;
  if (after) {
    const cursor = await first<{ created_at: string }>(
      ctx.app.db,
      `SELECT created_at FROM leases
        WHERE id = ? AND org_id = ?`,
      [after, orgId],
    );
    if (!cursor) throw validationError('Query "after" references an unknown lease.');
    afterCreatedAt = cursor.created_at;
  }

  const rows = await ctx.app.db.all<{
    id: string;
    resource_type: string;
    resource_id: string;
    holder_id: string;
    purpose: string;
    ttl_seconds: number;
    expires_at: string;
    created_at: string;
  }>(
    `SELECT id, resource_type, resource_id, holder_id, purpose, ttl_seconds,
            expires_at, created_at
       FROM leases
      WHERE org_id = ? AND released_at IS NULL
        AND (? IS NULL OR created_at > ? OR (created_at = ? AND id > ?))
      ORDER BY created_at, id
      LIMIT ?`,
    [orgId, afterCreatedAt, afterCreatedAt, afterCreatedAt, after, limit + 1],
  );
  const page = rows.slice(0, limit);
  const now = ctx.app.now().toISOString();
  return {
    data: {
      leases: page.map((row) => ({
        lease_id: row.id,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        holder_id: row.holder_id,
        purpose: row.purpose,
        ttl_seconds: row.ttl_seconds,
        expires_at: row.expires_at,
        created_at: row.created_at,
        status: row.expires_at <= now ? "expired" : "active",
      })),
      limit,
      cursor: rows.length > limit ? page[page.length - 1]!.id : null,
    },
  };
}

/** Organization owners/admins may recover a lease held by a failed agent. */
export async function forceReleaseLease(ctx: RequestContext): Promise<Result> {
  const { orgId, principalId } = ctx.principal!;
  const role = await first<{ role: string }>(
    ctx.app.db,
    `SELECT role FROM memberships
      WHERE org_id = ? AND workspace_id IS NULL AND principal_id = ?
        AND role IN ('owner', 'admin') AND removed_at IS NULL
      LIMIT 1`,
    [orgId, principalId],
  );
  if (!role) throw notFound();

  const id = ctx.params.id!;
  const lease = await first<{ id: string; holder_id: string }>(
    ctx.app.db,
    `SELECT id, holder_id FROM leases
      WHERE id = ? AND org_id = ? AND released_at IS NULL`,
    [id, orgId],
  );
  if (!lease) throw notFound();

  const now = ctx.app.now().toISOString();
  await ctx.app.db.batch([
    {
      sql: `UPDATE leases SET released_at = ?
            WHERE id = ? AND org_id = ? AND released_at IS NULL`,
      params: [now, id, orgId],
    },
    eventStatement(orgId, "lease.force_released", principalId, "lease", id,
      { holder_id: lease.holder_id }, now),
  ]);
  return { data: { lease_id: id, released_at: now, forced: true } };
}

// --- Handoffs ---

export async function createHandoff(ctx: RequestContext): Promise<Result> {
  const { orgId, principalId } = ctx.principal!;
  const body = requireObject(await ctx.json());
  const toPrincipal = requireString(body, "to_principal", LIMITS.identifier);
  const subjectId = requireString(body, "subject_id", LIMITS.identifier);
  const contextId = optionalString(body, "context_id", LIMITS.identifier);
  const checkpointId = optionalString(body, "checkpoint_id", LIMITS.identifier);
  const message = optionalString(body, "message", LIMITS.statement);

  const recipient = await first<{ principal_id: string }>(
    ctx.app.db,
    `SELECT principal_id FROM api_keys
      WHERE org_id = ? AND principal_id = ? AND revoked_at IS NULL
      UNION
     SELECT principal_id FROM memberships
      WHERE org_id = ? AND principal_id = ? AND removed_at IS NULL
      LIMIT 1`,
    [orgId, toPrincipal, orgId, toPrincipal],
  );
  if (!recipient) throw notFound();

  if (contextId) {
    const context = await first<{
      id: string;
      project_id: string | null;
      policy_snapshot: string;
    }>(
      ctx.app.db,
      `SELECT id, project_id, policy_snapshot FROM context_runs
        WHERE id = ? AND org_id = ? AND subject_id = ?`,
      [contextId, orgId, subjectId],
    );
    if (!context) throw notFound();
    const crossProject =
      context.policy_snapshot === `${POLICY_SNAPSHOT}:cross_project`;
    const items = await first<{ total: number; authorized: number }>(
      ctx.app.db,
      `SELECT COUNT(*) AS total,
              COUNT(CASE WHEN c.id IS NOT NULL
                              AND c.org_id = ?
                              AND c.subject_id = ?
                              AND (? = 1 OR c.project_id IS ?)
                              AND ${recordAccessSql("c")}
                              AND ${recordAccessSql("c")}
                         THEN 1 END) AS authorized
         FROM context_run_items i
         LEFT JOIN claims c ON c.id = i.claim_id
        WHERE i.context_id = ?`,
      [
        orgId,
        subjectId,
        Number(crossProject),
        context.project_id,
        ...recordAccessParams(principalId),
        ...recordAccessParams(toPrincipal),
        contextId,
      ],
    );
    if (Number(items?.total ?? 0) !== Number(items?.authorized ?? 0)) throw notFound();
  }

  if (checkpointId) {
    const checkpoint = await first<{ id: string }>(
      ctx.app.db,
      `SELECT id FROM checkpoints
        WHERE id = ? AND org_id = ? AND agent_id = ? AND subject_id = ?
          AND expires_at > ?`,
      [checkpointId, orgId, principalId, subjectId, ctx.app.now().toISOString()],
    );
    if (!checkpoint) throw notFound();
  }

  const id = newId("hoff");
  const now = ctx.app.now().toISOString();

  await ctx.app.db.batch([
    {
      sql: `INSERT INTO handoffs (id, org_id, from_principal, to_principal, subject_id, context_id, checkpoint_id, message, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      params: [id, orgId, principalId, toPrincipal, subjectId, contextId, checkpointId, message, now],
    },
    eventStatement(orgId, "handoff.created", principalId, "handoff", id,
      { to_principal: toPrincipal, subject_id: subjectId }, now),
    auditStatement(orgId, principalId, "handoff.create", "handoff", now, id),
  ]);

  return { status: 201, data: { handoff_id: id, status: "pending" } };
}

export async function resolveHandoff(ctx: RequestContext): Promise<Result> {
  const { orgId, principalId } = ctx.principal!;
  const id = ctx.params.id!;
  const body = requireObject(await ctx.json());
  const status = requireEnum(body, "status", HANDOFF_RESOLUTIONS);

  const row = await first<{ id: string; to_principal: string }>(
    ctx.app.db,
    `SELECT id, to_principal FROM handoffs WHERE id = ? AND org_id = ? AND status = 'pending'`,
    [id, orgId],
  );
  if (!row) throw notFound();
  if (row.to_principal !== principalId)
    throw validationError("Only the target principal can resolve a handoff.");

  const now = ctx.app.now().toISOString();
  try {
    await ctx.app.db.batch([
      {
        sql: `INSERT INTO handoff_resolutions
                (handoff_id, org_id, actor_id, status, resolved_at)
              VALUES (?, ?, ?, ?, ?)`,
        params: [id, orgId, principalId, status, now],
      },
      {
        sql: `UPDATE handoffs SET status = ?, resolved_at = ?
              WHERE id = ? AND org_id = ? AND to_principal = ? AND status = 'pending'`,
        params: [status, now, id, orgId, principalId],
      },
      eventStatement(orgId, `handoff.${status}`, principalId, "handoff", id, { status }, now),
      auditStatement(orgId, principalId, "handoff.resolve", "handoff", now, id),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|PRIMARY KEY|constraint/i.test(error.message))
      throw conflict("Handoff was already resolved.");
    throw error;
  }

  return { data: { handoff_id: id, status, resolved_at: now } };
}

export async function listHandoffs(ctx: RequestContext): Promise<Result> {
  const { orgId, principalId } = ctx.principal!;
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `SELECT id, from_principal, to_principal, subject_id, context_id, checkpoint_id, message, status, created_at
     FROM handoffs WHERE org_id = ? AND to_principal = ? AND status = 'pending'
     ORDER BY created_at`,
    [orgId, principalId],
  );
  return { data: { handoffs: rows.map(r => ({ handoff_id: r.id, ...r })) } };
}
