import { createApiKey, keyLifecycleStatus, requestedScopes } from "./auth";
import { auditStatement } from "./audit";
import { first } from "./db";
import { forbidden, notFound, validationError } from "./errors";
import { newId } from "./ids";
import type { RequestContext, Result } from "./http";
import {
  LIMITS,
  TRUST_LEVELS,
  TRUST_RANK,
  optionalEnum,
  optionalString,
  optionalTimestamp,
  requireObject,
  requireString,
  type Trust,
} from "./validate";

export async function createKey(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const allowed = new Set([
    "label", "scopes", "max_trust", "principal_kind", "principal_id",
    "not_before", "expires_at",
  ]);
  const unknown = Object.keys(body).find((field) => !allowed.has(field));
  if (unknown) throw validationError(`Unknown key creation field "${unknown}".`);
  const label = requireString(body, "label", LIMITS.label);
  const scopes = requestedScopes(body.scopes, principal);
  const maxTrust = optionalEnum(body, "max_trust", TRUST_LEVELS, "asserted") as Trust;
  if (TRUST_RANK[maxTrust] > TRUST_RANK[principal.maxTrust])
    throw forbidden("A new credential may not exceed the creating credential's trust ceiling.");
  const principalKind = optionalEnum(
    body,
    "principal_kind",
    ["human", "agent", "service"] as const,
    "agent",
  );
  const principalId = optionalString(body, "principal_id", LIMITS.identifier) ?? newId("agent");

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
    },
    now,
  );
  await ctx.app.db.batch([
    created.statement,
    auditStatement(
      principal.orgId,
      principal.principalId,
      "key.create",
      "api_key",
      now.toISOString(),
      created.id,
      JSON.stringify({ not_before: notBefore, expires_at: expiresAt }),
    ),
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
      last_used_at: null,
      warning: "Store this key now. Titen keeps only its hash and cannot show it again.",
    },
  };
}

export async function listKeys(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `SELECT id, principal_id, principal_kind, label, scopes, max_trust, created_at,
            not_before, expires_at, last_used_at, revoked_at
       FROM api_keys WHERE org_id = ? ORDER BY created_at, id`,
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
