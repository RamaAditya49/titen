import { auditStatement } from "./audit";
import { requireScope } from "./auth";
import { first, type Db } from "./db";
import { conflict, validationError } from "./errors";
import { requireOrgRole } from "./governance";
import type { RequestContext, Result } from "./http";
import { LIMITS, requireObject, requireString } from "./validate";

export interface PrincipalReassignResult {
  from: string;
  to: string;
  dry_run: boolean;
  observations: number;
  claims: number;
  warning: string | null;
}

async function collisionCount(
  db: Db,
  table: "observations" | "claims",
  orgId: string,
  from: string,
  to: string,
  column: "canonical_hash" | "enrichment_key",
): Promise<number> {
  const extra = column === "enrichment_key"
    ? "AND source.enrichment_key IS NOT NULL AND source.status IN ('active', 'disputed')"
    : "AND source.canonical_hash IS NOT NULL";
  const row = await first<{ count: number }>(
    db,
    `SELECT COUNT(*) AS count
       FROM ${table} source
       JOIN ${table} target
         ON target.org_id = source.org_id
        AND target.actor_id = ?
        AND target.${column} = source.${column}
      WHERE source.org_id = ? AND source.actor_id = ? AND source.visibility = 'private'
        ${extra}`,
    [to, orgId, from],
  );
  return Number(row?.count ?? 0);
}

/**
 * Moves private observation and claim ownership from one principal to another.
 * Source fields, content, and evidence links stay. Organization and team rows
 * stay with the principal that wrote them.
 */
export async function reassignPrivatePrincipal(
  db: Db,
  orgId: string,
  actorId: string,
  from: string,
  to: string,
  at: string,
  dryRun: boolean,
): Promise<PrincipalReassignResult> {
  if (from === to) throw validationError('Fields "from" and "to" must name different principals.');
  const observations = Number((await first<{ count: number }>(
    db,
    `SELECT COUNT(*) AS count FROM observations
      WHERE org_id = ? AND actor_id = ? AND visibility = 'private'`,
    [orgId, from],
  ))?.count ?? 0);
  const claims = Number((await first<{ count: number }>(
    db,
    `SELECT COUNT(*) AS count FROM claims
      WHERE org_id = ? AND actor_id = ? AND visibility = 'private'`,
    [orgId, from],
  ))?.count ?? 0);
  const key = await first<{ present: number }>(
    db,
    `SELECT 1 AS present FROM api_keys
      WHERE org_id = ? AND principal_id = ? AND revoked_at IS NULL LIMIT 1`,
    [orgId, to],
  );
  const warning = key
    ? null
    : "No active key currently uses the destination principal.";
  if (!dryRun && (observations > 0 || claims > 0)) {
    const observationCollisions = await collisionCount(db, "observations", orgId, from, to, "canonical_hash");
    const claimHashCollisions = await collisionCount(db, "claims", orgId, from, to, "canonical_hash");
    const claimKeyCollisions = await collisionCount(db, "claims", orgId, from, to, "enrichment_key");
    if (observationCollisions + claimHashCollisions + claimKeyCollisions > 0)
      throw conflict(
        "Reassign would collide with an existing private record for the destination principal.",
      );
    await db.batch([
      {
        sql: `UPDATE observations SET actor_id = ?
               WHERE org_id = ? AND actor_id = ? AND visibility = 'private'`,
        params: [to, orgId, from],
      },
      {
        sql: `UPDATE claims SET actor_id = ?
               WHERE org_id = ? AND actor_id = ? AND visibility = 'private'`,
        params: [to, orgId, from],
      },
      auditStatement(
        orgId,
        actorId,
        "principal.reassign",
        "principal",
        at,
        to,
        JSON.stringify({ from, to, observations, claims }),
      ),
    ]);
  }
  return { from, to, dry_run: dryRun, observations, claims, warning };
}

export async function reassignPrincipal(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  requireScope(principal, "keys:manage");
  await requireOrgRole(ctx, ["owner", "admin"], "principal.reassign");
  const body = requireObject(await ctx.json());
  const from = requireString(body, "from", LIMITS.identifier);
  const to = requireString(body, "to", LIMITS.identifier);
  const dryRun = body.dry_run === undefined || body.dry_run === null
    ? false
    : body.dry_run;
  if (typeof dryRun !== "boolean") throw validationError('Field "dry_run" must be a boolean.');
  const data = await reassignPrivatePrincipal(
    ctx.app.db,
    principal.orgId,
    principal.principalId,
    from,
    to,
    ctx.app.now().toISOString(),
    dryRun,
  );
  return { data };
}
