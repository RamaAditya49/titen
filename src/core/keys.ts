import { createApiKey, hasScope, SCOPES, type Principal } from "./auth";
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
  requireObject,
  requireString,
  type Trust,
} from "./validate";

function requestedScopes(value: unknown, principal: Principal): string[] {
  if (!Array.isArray(value) || value.length === 0)
    throw validationError('Field "scopes" must be a non-empty array.');
  const scopes = value.map((entry) => {
    if (typeof entry !== "string") throw validationError("Each scope must be a string.");
    if (entry !== "*" && !SCOPES.includes(entry as never))
      throw validationError(`Unknown scope "${entry}".`);
    return entry;
  });
  // A key can never mint more authority than the key that created it.
  for (const scope of scopes)
    if (!hasScope(principal, scope))
      throw forbidden(`This credential may not grant scope "${scope}".`);
  return [...new Set(scopes)];
}

export async function createKey(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
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

  const created = await createApiKey(
    {
      orgId: principal.orgId,
      principalId: optionalString(body, "principal_id", LIMITS.identifier) ?? newId("agent"),
      principalKind,
      label,
      scopes,
      maxTrust,
    },
    ctx.app.now(),
  );
  await ctx.app.db.batch([created.statement]);

  return {
    status: 201,
    data: {
      key_id: created.id,
      // The only time the raw key exists outside the client's hands.
      api_key: created.key,
      label,
      scopes,
      max_trust: maxTrust,
      principal_kind: principalKind,
      warning: "Store this key now. Titen keeps only its hash and cannot show it again.",
    },
  };
}

export async function listKeys(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `SELECT id, principal_id, principal_kind, label, scopes, max_trust, created_at, revoked_at
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
        revoked_at: row.revoked_at,
        status: row.revoked_at ? "revoked" : "active",
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
    ]);
  return { data: { key_id: keyId, revoked_at: row.revoked_at ?? at, revoked: true } };
}
