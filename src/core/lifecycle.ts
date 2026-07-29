import { first } from "./db";
import { forbidden, notFound, validationError } from "./errors";
import { sha256Hex } from "./ids";
import { auditStatement } from "./audit";
import { eventStatement } from "./events";
import { historyStatement } from "./observations";
import type { RequestContext, Result } from "./http";
import {
  LIMITS,
  optionalString,
  requireObject,
  requireString,
} from "./validate";

/**
 * Temporal supersession: a new claim replaces an older one. The old claim
 * becomes `superseded` and stops appearing in context compilation. Its evidence
 * is never deleted.
 */
export async function supersedeClaim(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const claimId = ctx.params.id!;
  const body = requireObject(await ctx.json());
  const newClaimId = requireString(body, "superseded_by", LIMITS.identifier);
  const reason = optionalString(body, "reason", LIMITS.statement);

  const claim = await first<{ id: string; org_id: string; status: string; actor_id: string; visibility: string }>(
    ctx.app.db,
    `SELECT id, org_id, status, actor_id, visibility FROM claims WHERE id = ? AND org_id = ?`,
    [claimId, principal.orgId],
  );
  if (!claim) throw notFound();
  if (claim.visibility === "private" && claim.actor_id !== principal.principalId) throw notFound();
  if (claim.status !== "active" && claim.status !== "disputed")
    throw validationError(`Only active or disputed claims can be superseded (current: ${claim.status}).`);

  const replacement = await first<{ id: string; status: string }>(
    ctx.app.db,
    `SELECT id, status FROM claims WHERE id = ? AND org_id = ?`,
    [newClaimId, principal.orgId],
  );
  if (!replacement) throw notFound();
  if (replacement.status !== "active")
    throw validationError("The replacement claim must be active.");

  const at = ctx.app.now().toISOString();
  const version = await nextVersion(ctx, claimId);
  await ctx.app.db.batch([
    {
      sql: `UPDATE claims SET status = 'superseded', superseded_by = ?, version = ? WHERE id = ? AND org_id = ?`,
      params: [newClaimId, version, claimId, principal.orgId],
    },
    historyStatement(
      principal.orgId, "claim", claimId, version, "supersede",
      principal.principalId,
      await sha256Hex(`superseded_by:${newClaimId}`), at,
    ),
    eventStatement(
      principal.orgId, "claim.superseded", principal.principalId, "claim", claimId,
      { superseded_by: newClaimId, version }, at,
    ),
    auditStatement(
      principal.orgId, principal.principalId, "claim.supersede", "claim", at, claimId, reason,
    ),
  ]);

  return {
    data: {
      claim_id: claimId,
      status: "superseded",
      superseded_by: newClaimId,
      version,
      reason,
    },
  };
}

/** Explicit revocation: an operator or agent withdraws a claim. */
export async function revokeClaim(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const claimId = ctx.params.id!;
  const body = requireObject(await ctx.json());
  const reason = optionalString(body, "reason", LIMITS.statement);

  const claim = await first<{ id: string; org_id: string; status: string; actor_id: string; visibility: string }>(
    ctx.app.db,
    `SELECT id, org_id, status, actor_id, visibility FROM claims WHERE id = ? AND org_id = ?`,
    [claimId, principal.orgId],
  );
  if (!claim) throw notFound();
  if (claim.visibility === "private" && claim.actor_id !== principal.principalId) throw notFound();
  if (claim.status === "revoked")
    return { data: { claim_id: claimId, status: "revoked", already_revoked: true } };
  if (claim.status === "superseded")
    throw validationError("A superseded claim cannot be revoked; revoke its replacement instead.");

  const at = ctx.app.now().toISOString();
  const version = await nextVersion(ctx, claimId);
  await ctx.app.db.batch([
    {
      sql: `UPDATE claims SET status = 'revoked', version = ? WHERE id = ? AND org_id = ?`,
      params: [version, claimId, principal.orgId],
    },
    historyStatement(
      principal.orgId, "claim", claimId, version, "revoke",
      principal.principalId,
      await sha256Hex(`revoked:${reason ?? "no reason"}`), at,
    ),
    eventStatement(
      principal.orgId, "claim.revoked", principal.principalId, "claim", claimId,
      { version }, at,
    ),
    auditStatement(
      principal.orgId, principal.principalId, "claim.revoke", "claim", at, claimId, reason,
    ),
  ]);

  return {
    data: { claim_id: claimId, status: "revoked", version, reason },
  };
}

/**
 * Expiry is enforced at compile time (temporal filter already exists:
 * `valid_to IS NULL OR valid_to > ?`). This endpoint lets an agent explicitly
 * expire a claim early.
 */
export async function expireClaim(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const claimId = ctx.params.id!;
  const body = requireObject(await ctx.json());
  const reason = optionalString(body, "reason", LIMITS.statement);

  const claim = await first<{ id: string; org_id: string; status: string; actor_id: string; visibility: string; valid_to: string | null }>(
    ctx.app.db,
    `SELECT id, org_id, status, actor_id, visibility, valid_to FROM claims WHERE id = ? AND org_id = ?`,
    [claimId, principal.orgId],
  );
  if (!claim) throw notFound();
  if (claim.visibility === "private" && claim.actor_id !== principal.principalId) throw notFound();
  if (claim.status === "expired")
    return { data: { claim_id: claimId, status: "expired", already_expired: true } };
  if (claim.status !== "active" && claim.status !== "disputed")
    throw validationError(`Only active or disputed claims can be expired (current: ${claim.status}).`);

  const at = ctx.app.now().toISOString();
  const version = await nextVersion(ctx, claimId);
  await ctx.app.db.batch([
    {
      sql: `UPDATE claims SET status = 'expired', valid_to = ?, version = ? WHERE id = ? AND org_id = ?`,
      params: [at, version, claimId, principal.orgId],
    },
    historyStatement(
      principal.orgId, "claim", claimId, version, "expire",
      principal.principalId,
      await sha256Hex(`expired:${at}`), at,
    ),
    eventStatement(
      principal.orgId, "claim.expired", principal.principalId, "claim", claimId,
      { version, valid_to: at }, at,
    ),
    auditStatement(
      principal.orgId, principal.principalId, "claim.expire", "claim", at, claimId, reason,
    ),
  ]);

  return {
    data: { claim_id: claimId, status: "expired", valid_to: at, version, reason },
  };
}

async function nextVersion(ctx: RequestContext, claimId: string): Promise<number> {
  const row = await first<{ version: number }>(
    ctx.app.db,
    `SELECT version FROM claims WHERE id = ?`,
    [claimId],
  );
  return (row?.version ?? 1) + 1;
}
