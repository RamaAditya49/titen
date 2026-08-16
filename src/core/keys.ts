import { createApiKey, keyLifecycleStatus, requestedScopes, requireScope } from "./auth";
import { auditStatement } from "./audit";
import { first } from "./db";
import { forbidden, notFound, validationError } from "./errors";
import { newId } from "./ids";
import { requireOrgRole } from "./governance";
import { requireDelegableTarget } from "./directory";
import type { RequestContext, Result } from "./http";
import {
  LIMITS,
  TRUST_LEVELS,
  TRUST_RANK,
  optionalEnum,
  optionalString,
  optionalTimestamp,
  requireEnum,
  requireObject,
  requireString,
  type Trust,
} from "./validate";

const MEMBER_ROLES = ["owner", "admin", "member", "reader"] as const;

export async function getPrincipal(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const membership = principal.scopes.includes("*") ? undefined : await first<{ role: string }>(
    ctx.app.db,
    `SELECT role FROM memberships
      WHERE org_id = ? AND workspace_id IS NULL AND principal_id = ?
        AND principal_kind = ? AND removed_at IS NULL LIMIT 1`,
    [principal.orgId, principal.principalId, principal.principalKind],
  );
  return { data: {
    organization_id: principal.orgId,
    principal_id: principal.principalId,
    principal_kind: principal.principalKind,
    key_id: principal.keyId,
    scopes: principal.scopes,
    max_trust: principal.maxTrust,
    issued_by: principal.issuedBy ?? principal.principalId,
    data_target_type: principal.dataTargetType ?? "organization",
    data_target_id: principal.dataTargetType === "project" && principal.dataTargetId === "~"
      ? null : principal.dataTargetId ?? null,
    organization_role: principal.scopes.includes("*") ? "root" : membership?.role ?? null,
  } };
}

export async function createKey(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const allowed = new Set([
    "label", "scopes", "max_trust", "principal_kind", "principal_id",
    "not_before", "expires_at", "membership_role",
    "data_target_type", "data_target_id",
  ]);
  const unknown = Object.keys(body).find((field) => !allowed.has(field));
  if (unknown) throw validationError(`Unknown key creation field "${unknown}".`);
  const label = requireString(body, "label", LIMITS.label);
  const scopes = requestedScopes(body.scopes, principal);
  const maxTrust = optionalEnum(body, "max_trust", TRUST_LEVELS, "asserted") as Trust;
  if (TRUST_RANK[maxTrust] > TRUST_RANK[principal.maxTrust])
    throw forbidden("A new credential may not exceed the creating credential's trust ceiling.");
  const requestedPrincipalId = optionalString(body, "principal_id", LIMITS.identifier);
  const membershipRole = body.membership_role === undefined
    ? null
    : requireEnum(body, "membership_role", MEMBER_ROLES);
  const principalKind = optionalEnum(
    body,
    "principal_kind",
    ["human", "agent", "service"] as const,
    membershipRole ? "human" : requestedPrincipalId === principal.principalId ? principal.principalKind : "agent",
  );
  if (membershipRole && principalKind !== "human")
    throw validationError('Field "membership_role" requires principal_kind "human".');
  if (!principal.scopes.includes("*") && requestedPrincipalId !== null) {
    if (requestedPrincipalId !== principal.principalId || principalKind !== principal.principalKind)
      throw forbidden("A managed credential may only reuse its own principal identity.");
  }
  const principalId = requestedPrincipalId ?? newId(membershipRole ? "human" : "agent");
  const dataTargetType = optionalEnum(body, "data_target_type", ["organization", "project", "subject"] as const, "organization");
  const dataTargetId = dataTargetType === "organization"
    ? null
    : dataTargetType === "project" && body.data_target_id === null
      ? "~"
      : requireString(body, "data_target_id", LIMITS.identifier);
  const dataPermissions: Array<"read" | "write" | "approve" | "admin"> = ["read"];
  if (scopes.some((scope) => /:(?:write|manage|create|purge)$/u.test(scope))) dataPermissions.push("write");
  if (scopes.some((scope) => scope.endsWith(":approve"))) dataPermissions.push("approve");
  if (scopes.includes("grants:write")) dataPermissions.push("admin");
  if (body.data_target_type !== undefined || body.data_target_id !== undefined)
    await requireDelegableTarget(ctx, dataTargetType, dataTargetType === "organization" ? "*" : dataTargetId!, dataPermissions);
  let membershipId: string | null = null;
  if (membershipRole) {
    requireScope(principal, "memberships:write");
    const authority = await requireOrgRole(ctx, ["owner", "admin"], "membership.add");
    if (membershipRole === "owner" && authority === "admin")
      throw forbidden("Only an organization owner may assign the owner role.");
    membershipId = newId("mbr");
  }

  const now = ctx.app.now();
  const notBefore = optionalTimestamp(body, "not_before") ?? now.toISOString();
  const expiresAt = optionalTimestamp(body, "expires_at");
  if (expiresAt !== null && notBefore >= expiresAt)
    throw validationError('Field "not_before" must be earlier than "expires_at".');
  const created = await createApiKey(
    {
      orgId: principal.orgId,
      principalId,
      principalKind,
      label,
      scopes,
      maxTrust,
      notBefore: new Date(notBefore),
      expiresAt: expiresAt === null ? null : new Date(expiresAt),
      issuedBy: principal.principalId,
      dataTargetType,
      dataTargetId: dataTargetType === "organization" ? null : dataTargetId,
    },
    now,
  );
  await ctx.app.db.batch([
    created.statement,
    ...(membershipId ? [{
      sql: `INSERT INTO memberships
              (id, org_id, workspace_id, principal_id, principal_kind, role, created_at)
            VALUES (?, ?, NULL, ?, 'human', ?, ?)`,
      params: [membershipId, principal.orgId, principalId, membershipRole!, now.toISOString()],
    }] : []),
    auditStatement(
      principal.orgId,
      principal.principalId,
      "key.create",
      "api_key",
      now.toISOString(),
      created.id,
      JSON.stringify({ not_before: notBefore, expires_at: expiresAt }),
    ),
    ...(membershipId ? [auditStatement(
      principal.orgId,
      principal.principalId,
      "membership.add",
      "membership",
      now.toISOString(),
      membershipId,
    )] : []),
  ]);

  return {
    status: 201,
    data: {
      key_id: created.id,
      // The only time the raw key exists outside the client's hands.
      api_key: created.key,
      principal_id: principalId,
      label,
      scopes,
      max_trust: maxTrust,
      principal_kind: principalKind,
      not_before: notBefore,
      expires_at: expiresAt,
      data_target_type: dataTargetType,
      data_target_id: dataTargetType === "project" && dataTargetId === "~" ? null : dataTargetId,
      last_used_at: null,
      ...(membershipId ? { membership_id: membershipId, membership_role: membershipRole } : {}),
      warning: "Store this key now. Titen keeps only its hash and cannot show it again.",
    },
  };
}

export async function listKeys(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `SELECT id, principal_id, principal_kind, label, scopes, max_trust, created_at,
            not_before, expires_at, last_used_at, revoked_at,
            data_target_type, data_target_id, issued_by
       FROM api_keys WHERE org_id = ? ORDER BY created_at, id LIMIT 500`,
    [principal.orgId],
  );
  return {
    data: {
      keys: rows.map((row) => ({
        key_id: row.id,
        principal_id: row.principal_id,
        principal_kind: row.principal_kind,
        label: row.label,
        scopes: String(row.scopes).split(" ").filter(Boolean),
        max_trust: row.max_trust,
        created_at: row.created_at,
        not_before: row.not_before,
        expires_at: row.expires_at,
        last_used_at: row.last_used_at,
        revoked_at: row.revoked_at,
        issued_by: row.issued_by,
        data_target_type: row.data_target_type ?? "organization",
        data_target_id: row.data_target_type === "project" && row.data_target_id === "~"
          ? null : row.data_target_id,
        status: keyLifecycleStatus({
          notBefore: String(row.not_before),
          expiresAt: row.expires_at === null ? null : String(row.expires_at),
          revokedAt: row.revoked_at === null ? null : String(row.revoked_at),
        }, ctx.app.now().toISOString()),
      })),
    },
  };
}

export async function revokeKey(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const keyId = ctx.params.id!;
  const row = await first<{ id: string; revoked_at: string | null }>(
    ctx.app.db,
    `SELECT id, revoked_at FROM api_keys WHERE id = ? AND org_id = ?`,
    [keyId, principal.orgId],
  );
  if (!row) throw notFound();
  const at = ctx.app.now().toISOString();
  if (!row.revoked_at)
    await ctx.app.db.batch([
      {
        sql: `UPDATE api_keys SET revoked_at = ? WHERE id = ? AND org_id = ? AND revoked_at IS NULL`,
        params: [at, keyId, principal.orgId],
      },
      auditStatement(principal.orgId, principal.principalId, "key.revoke", "api_key", at, keyId),
    ]);
  return { data: { key_id: keyId, revoked_at: row.revoked_at ?? at, revoked: true } };
}
