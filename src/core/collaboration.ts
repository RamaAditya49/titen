import { first } from "./db";
import { notFound, validationError, conflict } from "./errors";
import { eventStatement } from "./events";
import { newId } from "./ids";
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
  const { orgId } = ctx.principal!;
  const body = requireObject(await ctx.json());
  const workspaceId = optionalString(body, "workspace_id", LIMITS.identifier);
  const memberPrincipalId = requireString(body, "principal_id", LIMITS.identifier);
  const principalKind = requireEnum(body, "principal_kind", PRINCIPAL_KINDS);
  const role = requireEnum(body, "role", MEMBER_ROLES);
  const id = newId("mbr");
  const now = ctx.app.now().toISOString();

  await ctx.app.db.batch([{
    sql: `INSERT INTO memberships (id, org_id, workspace_id, principal_id, principal_kind, role, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [id, orgId, workspaceId, memberPrincipalId, principalKind, role, now],
  }]);

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
  const { orgId } = ctx.principal!;
  const id = ctx.params.id!;
  const row = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM memberships WHERE id = ? AND org_id = ? AND removed_at IS NULL`,
    [id, orgId],
  );
  if (!row) throw notFound();
  const now = ctx.app.now().toISOString();
  await ctx.app.db.batch([{
    sql: `UPDATE memberships SET removed_at = ? WHERE id = ?`,
    params: [now, id],
  }]);
  return { data: { membership_id: id, removed_at: now } };
}

// --- Leases ---

export async function acquireLease(ctx: RequestContext): Promise<Result> {
  const { orgId, principalId } = ctx.principal!;
  const body = requireObject(await ctx.json());
  const resourceType = requireString(body, "resource_type", LIMITS.label);
  const resourceId = requireString(body, "resource_id", LIMITS.identifier);
  const purpose = requireString(body, "purpose", LIMITS.label);
  const ttlSeconds = requireInteger(body, "ttl_seconds", 10, 86400);

  const now = ctx.app.now();
  const nowIso = now.toISOString();

  const existing = await first<{ id: string; holder_id: string; expires_at: string }>(
    ctx.app.db,
    `SELECT id, holder_id, expires_at FROM leases
     WHERE org_id = ? AND resource_type = ? AND resource_id = ? AND released_at IS NULL`,
    [orgId, resourceType, resourceId],
  );

  if (existing) {
    if (existing.holder_id !== principalId && new Date(existing.expires_at) > now)
      throw conflict(`Resource is leased by another principal until ${existing.expires_at}.`);
    // Expired or same holder — release old
    await ctx.app.db.batch([{
      sql: `UPDATE leases SET released_at = ? WHERE id = ?`,
      params: [nowIso, existing.id],
    }]);
  }

  const id = newId("lease");
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  await ctx.app.db.batch([
    {
      sql: `INSERT INTO leases (id, org_id, resource_type, resource_id, holder_id, purpose, ttl_seconds, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, orgId, resourceType, resourceId, principalId, purpose, ttlSeconds, expiresAt, nowIso],
    },
    eventStatement(orgId, "lease.acquired", principalId, "lease", id,
      { resource_type: resourceType, resource_id: resourceId, purpose, expires_at: expiresAt }, nowIso),
  ]);

  return { status: 201, data: { lease_id: id, expires_at: expiresAt } };
}

export async function releaseLease(ctx: RequestContext): Promise<Result> {
  const { orgId } = ctx.principal!;
  const id = ctx.params.id!;
  const row = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM leases WHERE id = ? AND org_id = ? AND released_at IS NULL`,
    [id, orgId],
  );
  if (!row) throw notFound();
  const now = ctx.app.now().toISOString();
  await ctx.app.db.batch([{
    sql: `UPDATE leases SET released_at = ? WHERE id = ?`,
    params: [now, id],
  }]);
  return { data: { lease_id: id, released_at: now } };
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
  await ctx.app.db.batch([
    {
      sql: `UPDATE handoffs SET status = ?, resolved_at = ? WHERE id = ?`,
      params: [status, now, id],
    },
    eventStatement(orgId, `handoff.${status}`, principalId, "handoff", id, { status }, now),
  ]);

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
