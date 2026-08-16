import { recordAccessParams, recordAccessSql } from "./authorization";
import { auditStatement } from "./audit";
import { first, type Param } from "./db";
import { conflict, notFound, validationError } from "./errors";
import { newId } from "./ids";
import { requireOrgRole } from "./governance";
import type { RequestContext, Result } from "./http";
import {
  LIMITS,
  optionalString,
  optionalTimestamp,
  requireEnum,
  requireObject,
  requireString,
} from "./validate";

const SUBJECT_TYPES = ["human", "agent", "service", "organization", "repository", "artifact", "system", "concept"] as const;
const TARGET_TYPES = ["organization", "project", "subject"] as const;
const PERMISSIONS = ["read", "write", "approve", "admin"] as const;
type TargetType = (typeof TARGET_TYPES)[number];
type Permission = (typeof PERMISSIONS)[number];

function limit(ctx: RequestContext, maximum = 200): number {
  const raw = ctx.url.searchParams.get("limit") ?? "50";
  if (!/^\d+$/u.test(raw) || Number(raw) < 1 || Number(raw) > maximum)
    throw validationError(`Query "limit" must be an integer between 1 and ${maximum}.`);
  return Number(raw);
}

function query(ctx: RequestContext, name: string, max: number = LIMITS.identifier): string | null {
  const value = ctx.url.searchParams.get(name);
  if (value === null) return null;
  if (!value.trim() || value.length > max) throw validationError(`Query "${name}" is invalid.`);
  return value.trim();
}

function targetId(type: TargetType, value: unknown): string {
  if (type === "organization") {
    if (value !== undefined && value !== null && value !== "*")
      throw validationError('Organization grants do not accept a target_id other than "*".');
    return "*";
  }
  if (type === "project" && value === null) return "~";
  if (typeof value !== "string" || !value || value.length > LIMITS.identifier)
    throw validationError(`Field "target_id" is required for ${type} grants.`);
  return value;
}

function publicTargetId(type: string, value: string): string | null {
  return type === "project" && value === "~" ? null : type === "organization" ? null : value;
}

function parsePermissions(value: unknown): Permission[] {
  if (!Array.isArray(value) || !value.length) throw validationError('Field "permissions" must be a non-empty array.');
  const permissions = [...new Set(value.map((entry) => {
    if (typeof entry !== "string" || !PERMISSIONS.includes(entry as Permission))
      throw validationError("Grant permissions must be read, write, approve, or admin.");
    return entry as Permission;
  }))];
  return permissions;
}

async function heldPermissions(
  ctx: RequestContext,
  targetType: TargetType,
  id: string,
): Promise<Set<Permission>> {
  const principal = ctx.principal!;
  if (principal.dataTargetType && principal.dataTargetType !== "organization"
    && (principal.dataTargetType !== targetType || principal.dataTargetId !== id)) return new Set();
  const role = await first<{ role: string }>(ctx.app.db,
    `SELECT role FROM memberships
      WHERE org_id = ? AND workspace_id IS NULL AND principal_id = ?
        AND removed_at IS NULL LIMIT 1`,
    [principal.orgId, principal.principalId]);
  if (principal.scopes.includes("*") || role?.role === "owner"
    || (role?.role === "admin" && targetType !== "organization")) return new Set(PERMISSIONS);
  const rows = await ctx.app.db.all<{ permissions: string }>(
    `SELECT permissions FROM access_grants
      WHERE org_id = ? AND grantee_principal_id = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
        AND (target_type = 'organization' OR (target_type = ? AND target_id = ?))`,
    [principal.orgId, principal.issuedBy ?? principal.principalId, ctx.app.now().toISOString(), targetType, id],
  );
  const held = new Set(rows.flatMap((row) => row.permissions.split(" ")).filter((entry): entry is Permission => PERMISSIONS.includes(entry as Permission)));
  return held.has("admin") ? new Set(PERMISSIONS) : held;
}

export async function requireDelegableTarget(
  ctx: RequestContext,
  targetType: TargetType,
  id: string,
  permissions: readonly Permission[] = ["read"],
): Promise<void> {
  const held = await heldPermissions(ctx, targetType, id);
  if (permissions.some((permission) => !held.has(permission)))
    throw notFound();
  if (targetType === "organization" && !held.has("admin"))
    throw notFound();
}

export async function listPrincipals(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "principal.list");
  const q = query(ctx, "q", LIMITS.label)?.toLowerCase() ?? null;
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `WITH directory AS (
       SELECT principal_id, principal_kind, created_at FROM api_keys WHERE org_id = ?
       UNION ALL
       SELECT principal_id, principal_kind, created_at FROM memberships WHERE org_id = ?
     )
     SELECT d.principal_id, MIN(d.principal_kind) AS principal_kind,
            MIN(d.created_at) AS created_at,
            MAX(m.role) AS organization_role, MAX(a.username) AS username,
            COUNT(DISTINCT k.id) AS key_count
       FROM directory d
       LEFT JOIN memberships m ON m.org_id = ? AND m.workspace_id IS NULL
        AND m.principal_id = d.principal_id AND m.removed_at IS NULL
       LEFT JOIN operator_accounts a ON a.org_id = ? AND a.principal_id = d.principal_id
        AND a.disabled_at IS NULL
       LEFT JOIN api_keys k ON k.org_id = ? AND k.principal_id = d.principal_id
        AND k.revoked_at IS NULL
      WHERE (? IS NULL OR lower(d.principal_id) LIKE '%' || ? || '%'
        OR lower(COALESCE(a.username, '')) LIKE '%' || ? || '%')
      GROUP BY d.principal_id ORDER BY d.principal_id LIMIT ?`,
    [ctx.principal!.orgId, ctx.principal!.orgId, ctx.principal!.orgId,
      ctx.principal!.orgId, ctx.principal!.orgId, q, q, q, limit(ctx)],
  );
  return { data: { principals: rows } };
}

export async function listProjects(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const q = query(ctx, "q", LIMITS.label)?.toLowerCase() ?? null;
  const params: Param[] = [principal.orgId, ...recordAccessParams(principal), principal.orgId,
    ...recordAccessParams(principal), principal.orgId, q, q, limit(ctx)];
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `WITH authorized AS (
       SELECT c.project_id, c.subject_id, c.created_at FROM claims c
        WHERE c.org_id = ? AND ${recordAccessSql("c")}
       UNION ALL
       SELECT o.project_id, o.subject_id, o.ingested_at FROM observations o
        WHERE o.org_id = ? AND ${recordAccessSql("o")}
     ), counts AS (
       SELECT project_id, COUNT(*) AS record_count, COUNT(DISTINCT subject_id) AS subject_count,
              MAX(created_at) AS last_write FROM authorized GROUP BY project_id
     ), directory AS (
       SELECT p.id AS project_id, p.reference, p.created_at FROM projects p WHERE p.org_id = ?
       UNION ALL
       SELECT NULL, '(unscoped)', NULL WHERE EXISTS (SELECT 1 FROM counts WHERE project_id IS NULL)
     )
     SELECT d.project_id, d.reference, d.created_at,
            COALESCE(c.record_count, 0) AS record_count,
            COALESCE(c.subject_count, 0) AS subject_count, c.last_write
       FROM directory d JOIN counts c ON c.project_id IS d.project_id
      WHERE (? IS NULL OR lower(d.reference) LIKE '%' || ? || '%')
      ORDER BY d.reference, d.project_id LIMIT ?`,
    params,
  );
  return { data: { projects: rows } };
}

export async function listProjectReferences(ctx: RequestContext): Promise<Result> {
  const id = ctx.params.id!;
  const principal = ctx.principal!;
  const project = id === "~" ? await first<{ id: string }>(ctx.app.db,
    `SELECT '~' AS id WHERE EXISTS (
       SELECT 1 FROM claims c WHERE c.org_id = ? AND c.project_id IS NULL AND ${recordAccessSql("c")}
     ) OR EXISTS (
       SELECT 1 FROM observations o WHERE o.org_id = ? AND o.project_id IS NULL AND ${recordAccessSql("o")}
     )`, [principal.orgId, ...recordAccessParams(principal), principal.orgId, ...recordAccessParams(principal)])
    : await first<{ id: string }>(ctx.app.db,
    `SELECT p.id FROM projects p WHERE p.org_id = ? AND p.id = ? AND (
       EXISTS (SELECT 1 FROM claims c WHERE c.org_id = p.org_id AND c.project_id = p.id AND ${recordAccessSql("c")})
       OR EXISTS (SELECT 1 FROM observations o WHERE o.org_id = p.org_id AND o.project_id = p.id AND ${recordAccessSql("o")})
     )`, [principal.orgId, id, ...recordAccessParams(principal), ...recordAccessParams(principal)]);
  if (!project) throw notFound();
  if (id === "~") return { data: { project_id: null, references: [{ namespace: "canonical", value: "(unscoped)" }] } };
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `SELECT id AS reference_id, namespace, value, created_by, created_at
       FROM project_references WHERE org_id = ? AND project_id = ?
       ORDER BY namespace, value LIMIT 200`, [ctx.principal!.orgId, id]);
  return { data: { project_id: id, references: rows } };
}

export async function listSubjects(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const q = query(ctx, "q", LIMITS.label)?.toLowerCase() ?? null;
  const type = ctx.url.searchParams.get("type");
  if (type !== null && !SUBJECT_TYPES.includes(type as never)) throw validationError('Query "type" is invalid.');
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `WITH authorized AS (
       SELECT c.subject_id, c.created_at FROM claims c WHERE c.org_id = ? AND ${recordAccessSql("c")}
       UNION ALL
       SELECT o.subject_id, o.ingested_at FROM observations o WHERE o.org_id = ? AND ${recordAccessSql("o")}
     ), counts AS (
       SELECT subject_id, COUNT(*) AS record_count, MAX(created_at) AS last_write
         FROM authorized GROUP BY subject_id
     )
     SELECT s.id AS subject_id, s.type, s.label, s.status, s.created_at,
            c.record_count, c.last_write,
            (SELECT COUNT(*) FROM subject_references r
              WHERE r.org_id = s.org_id AND r.subject_id = s.id) AS reference_count
       FROM subjects s JOIN counts c ON c.subject_id = s.id
      WHERE s.org_id = ? AND (? IS NULL OR s.type = ?)
        AND (? IS NULL OR lower(s.label) LIKE '%' || ? || '%' OR lower(s.id) LIKE '%' || ? || '%')
      ORDER BY s.label, s.id LIMIT ?`,
    [principal.orgId, ...recordAccessParams(principal), principal.orgId,
      ...recordAccessParams(principal), principal.orgId, type, type, q, q, q, limit(ctx)],
  );
  return { data: { subjects: rows } };
}

export async function listSubjectReferences(ctx: RequestContext): Promise<Result> {
  const id = ctx.params.id!;
  const principal = ctx.principal!;
  const subject = await first<{ id: string }>(ctx.app.db,
    `SELECT s.id FROM subjects s WHERE s.org_id = ? AND s.id = ? AND (
       EXISTS (SELECT 1 FROM claims c WHERE c.org_id = s.org_id AND c.subject_id = s.id AND ${recordAccessSql("c")})
       OR EXISTS (SELECT 1 FROM observations o WHERE o.org_id = s.org_id AND o.subject_id = s.id AND ${recordAccessSql("o")})
     )`, [principal.orgId, id, ...recordAccessParams(principal), ...recordAccessParams(principal)]);
  if (!subject) throw notFound();
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `SELECT id AS reference_id, namespace, value, created_by, created_at
       FROM subject_references WHERE org_id = ? AND subject_id = ?
       ORDER BY namespace, value LIMIT 200`, [ctx.principal!.orgId, id]);
  return { data: { subject_id: id, references: rows } };
}

export async function listGrants(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const grantee = query(ctx, "principal_id");
  const authorityId = principal.issuedBy ?? principal.principalId;
  const role = await first<{ role: string }>(ctx.app.db,
    `SELECT role FROM memberships WHERE org_id = ? AND workspace_id IS NULL
      AND principal_id = ? AND removed_at IS NULL LIMIT 1`,
    [principal.orgId, principal.principalId]);
  const organizationAdmin = principal.scopes.includes("*") || role?.role === "owner" || role?.role === "admin";
  const credentialTargetType = principal.dataTargetType ?? null;
  const credentialTargetId = principal.dataTargetId ?? null;
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `SELECT id, grantee_principal_id, target_type, target_id, permissions,
            created_by, created_at, expires_at, revoked_at
       FROM access_grants g WHERE org_id = ? AND (? IS NULL OR grantee_principal_id = ?)
        AND (? IS NULL OR ? = 'organization' OR (g.target_type = ? AND g.target_id = ?))
        AND (? = 1 OR EXISTS (
          SELECT 1 FROM access_grants authority
           WHERE authority.org_id = g.org_id AND authority.grantee_principal_id = ?
             AND authority.revoked_at IS NULL
             AND (authority.expires_at IS NULL OR authority.expires_at > ?)
             AND instr(' ' || authority.permissions || ' ', ' admin ') > 0
             AND (authority.target_type = 'organization' OR
               (authority.target_type = g.target_type AND authority.target_id = g.target_id))))
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    [principal.orgId, grantee, grantee, credentialTargetType, credentialTargetType,
      credentialTargetType, credentialTargetId, Number(organizationAdmin), authorityId,
      ctx.app.now().toISOString(), limit(ctx, 500)],
  );
  return { data: { grants: rows.map((row) => ({
    grant_id: row.id,
    principal_id: row.grantee_principal_id,
    target_type: row.target_type,
    target_id: publicTargetId(String(row.target_type), String(row.target_id)),
    permissions: String(row.permissions).split(" ").filter(Boolean),
    created_by: row.created_by,
    created_at: row.created_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
  })) } };
}

export async function createGrant(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const grantee = requireString(body, "principal_id", LIMITS.identifier);
  const type = requireEnum(body, "target_type", TARGET_TYPES);
  const id = targetId(type, body.target_id);
  const permissions = parsePermissions(body.permissions);
  const expiresAt = optionalTimestamp(body, "expires_at");
  if (expiresAt && expiresAt <= ctx.app.now().toISOString())
    throw validationError('Field "expires_at" must be in the future.');
  await requireDelegableTarget(ctx, type, id, permissions);
  if (!await first(ctx.app.db,
    `SELECT 1 FROM api_keys WHERE org_id = ? AND principal_id = ?
       UNION SELECT 1 FROM memberships WHERE org_id = ? AND principal_id = ? LIMIT 1`,
    [principal.orgId, grantee, principal.orgId, grantee])) throw notFound();
  if (type === "project" && id !== "~" && !await first(ctx.app.db,
    `SELECT 1 FROM projects WHERE org_id = ? AND id = ?`, [principal.orgId, id])) throw notFound();
  if (type === "subject" && !await first(ctx.app.db,
    `SELECT 1 FROM subjects WHERE org_id = ? AND id = ?`, [principal.orgId, id])) throw notFound();
  const grantId = newId("grant");
  const now = ctx.app.now().toISOString();
  try {
    await ctx.app.db.batch([{
      sql: `INSERT INTO access_grants
              (id, org_id, grantee_principal_id, target_type, target_id,
               permissions, created_by, created_at, expires_at, revoked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      params: [grantId, principal.orgId, grantee, type, id, permissions.join(" "),
        principal.principalId, now, expiresAt],
    }, auditStatement(principal.orgId, principal.principalId, "grant.created",
      "access_grant", now, grantId, JSON.stringify({ principal_id: grantee, target_type: type, target_id: publicTargetId(type, id), permissions }))]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw conflict("An identical active grant already exists.");
    throw error;
  }
  return { status: 201, data: { grant_id: grantId, principal_id: grantee,
    target_type: type, target_id: publicTargetId(type, id), permissions, expires_at: expiresAt } };
}

export async function revokeGrant(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const id = ctx.params.id!;
  const row = await first<{ target_type: TargetType; target_id: string; revoked_at: string | null }>(ctx.app.db,
    `SELECT target_type, target_id, revoked_at FROM access_grants WHERE id = ? AND org_id = ?`, [id, principal.orgId]);
  if (!row) throw notFound();
  await requireDelegableTarget(ctx, row.target_type, row.target_id, ["admin"]);
  const now = ctx.app.now().toISOString();
  if (!row.revoked_at) await ctx.app.db.batch([{
    sql: `UPDATE access_grants SET revoked_at = ? WHERE id = ? AND org_id = ? AND revoked_at IS NULL`,
    params: [now, id, principal.orgId],
  }, auditStatement(principal.orgId, principal.principalId, "grant.revoked", "access_grant", now, id)]);
  return { data: { grant_id: id, revoked_at: row.revoked_at ?? now } };
}

export async function simulateAccess(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner"], "access.simulate");
  const body = requireObject(await ctx.json());
  const resourceType = requireEnum(body, "resource_type", ["claim", "observation"] as const);
  const resourceId = requireString(body, "resource_id", LIMITS.identifier);
  const principalId = requireString(body, "principal_id", LIMITS.identifier);
  const operation = requireEnum(body, "operation", ["read", "write", "approve"] as const);
  const table = resourceType === "claim" ? "claims" : "observations";
  const alias = resourceType === "claim" ? "c" : "o";
  const visible = await first<{ visibility_gate: number; grant_gate: number; allowed: number }>(ctx.app.db,
    `SELECT CASE WHEN (
       ${alias}.visibility = 'organization'
       OR (${alias}.visibility = 'private' AND ${alias}.actor_id = ?)
       OR (${alias}.visibility = 'team' AND EXISTS (
         SELECT 1 FROM memberships m WHERE m.org_id = ${alias}.org_id
          AND m.workspace_id = ${alias}.workspace_id AND m.principal_id = ? AND m.removed_at IS NULL
       ))) THEN 1 ELSE 0 END AS visibility_gate,
       CASE WHEN EXISTS (
         SELECT 1 FROM access_grants g WHERE g.org_id = ${alias}.org_id
          AND g.grantee_principal_id = ? AND g.revoked_at IS NULL
          AND (g.expires_at IS NULL OR g.expires_at > ?)
          AND instr(' ' || g.permissions || ' ', ' ' || ? || ' ') > 0
          AND (g.target_type = 'organization'
            OR (g.target_type = 'project' AND g.target_id = COALESCE(${alias}.project_id, '~'))
            OR (g.target_type = 'subject' AND g.target_id = ${alias}.subject_id))
       ) THEN 1 ELSE 0 END AS grant_gate,
       CASE WHEN ${recordAccessSql(alias, "?", operation)} THEN 1 ELSE 0 END AS allowed
       FROM ${table} ${alias} WHERE ${alias}.org_id = ? AND ${alias}.id = ?`,
    [principalId, principalId, principalId, ctx.app.now().toISOString(), operation,
      ...recordAccessParams(principalId), ctx.principal!.orgId, resourceId]);
  if (!visible) throw notFound();
  return { data: { resource_type: resourceType, resource_id: resourceId,
    principal_id: principalId, operation, visibility_gate: Boolean(visible.visibility_gate),
    grant_gate: Boolean(visible.grant_gate), allowed: Boolean(visible.allowed) } };
}
