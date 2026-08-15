import { first, type Db, type Param } from "./db";
import { notFound, validationError } from "./errors";
import type { Principal } from "./auth";
import type { Visibility } from "./validate";

type RecordAlias = "c" | "o";

function retentionAccessSql(alias: RecordAlias): string {
  return `NOT EXISTS (
    SELECT 1 FROM retention_exclusions retention
     WHERE retention.org_id = ${alias}.org_id
       AND retention.resource_type = '${alias === "c" ? "claim" : "observation"}'
       AND retention.resource_id = ${alias}.id
  )`;
}

/** SQL eligibility shared by every canonical memory projection. */
export function recordAccessSql(alias: RecordAlias, principalSql = "?"): string {
  return `(
    ${alias}.visibility = 'organization'
    OR (${alias}.visibility = 'private' AND ${alias}.actor_id = ${principalSql})
    OR (
      ${alias}.visibility = 'team'
      AND ${alias}.workspace_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM memberships access_membership
         WHERE access_membership.org_id = ${alias}.org_id
           AND access_membership.workspace_id = ${alias}.workspace_id
           AND access_membership.principal_id = ${principalSql}
           AND access_membership.removed_at IS NULL
      )
    )
  ) AND ${retentionAccessSql(alias)}`;
}

export function recordAccessParams(principalId: string): Param[] {
  return [principalId, principalId];
}

/** Explicit organization-administrator view; callers must bind org authority first. */
export function organizationRecordAccessSql(alias: RecordAlias): string {
  return `${alias}.visibility IN ('organization', 'team', 'private')
    AND ${retentionAccessSql(alias)}`;
}

/**
 * Whether a claim has contradicting evidence *the caller may read*.
 *
 * The authorization predicate is the whole point. Without it the flag answers
 * "does a contradiction exist" rather than "may this caller know one exists",
 * and since `disputed` carries a weighted rank term and populates `conflicts[]`,
 * an unreadable source would demote the claim and announce itself while its id
 * stayed filtered out of the citations (#291). Takes `recordAccessParams` at the
 * position the fragment appears in the statement.
 *
 * The nested `EXISTS` is load-bearing and not a style choice. Written as a join
 * — `FROM claim_sources s JOIN observations o ON o.id = s.observation_id` — the
 * planner drives from `observations` on `observations_workspace_scope
 * (org_id=?)` and scans every observation in the organization, evaluating the
 * membership and retention predicates for each, once per candidate. Measured on
 * a 424,168-claim store: **79 seconds** per compile against 17.8 ms. This shape
 * seeks `claim_sources` on its primary key and probes `observations` by rowid,
 * so a claim with no contradicting source costs one index seek, which is what
 * the unfiltered query cost. `loadAuthorizedSources` uses the same shape.
 *
 * That comment was true of the intent and false of the code until 2026-08-08:
 * the fix shipped in 0.7.1 wrote the join spelling while claiming the nested
 * one, and a join *inside* `EXISTS` is still a join the planner may reorder.
 * SQLite 3.53.0 — the version Bun 1.3.14 links — did reorder it, choosing
 * `SEARCH o USING INDEX observations_workspace_scope (org_id=?)` ahead of the
 * `claim_sources` seek: the 79-second shape, back in a release that believed it
 * had prevented it. Only the genuinely nested form below survives that planner.
 * Any future edit here needs `EXPLAIN QUERY PLAN` from `bun:sqlite` against a
 * store with a realistic row count; the contract suite cannot see this.
 */
export function contradictedSql(claimAlias: "c", organizationWide = false): string {
  return `EXISTS (
    SELECT 1 FROM claim_sources s
    WHERE s.claim_id = ${claimAlias}.id AND s.relation = 'contradicts'
      AND EXISTS (
        SELECT 1 FROM observations o
         WHERE o.id = s.observation_id
           AND o.org_id = ${claimAlias}.org_id
           AND ${organizationWide ? organizationRecordAccessSql("o") : recordAccessSql("o")}
      )
  )`;
}

/** A team write needs a concrete workspace and a non-reader membership. */
export async function authorizeRecordWorkspace(
  db: Db,
  principal: Principal,
  workspaceId: string | null,
  visibility: Visibility,
): Promise<void> {
  if (visibility === "team" && !workspaceId)
    throw validationError('Field "workspace_id" is required for team visibility.');
  if (!workspaceId) return;

  const membership = await first<{ role: string }>(
    db,
    `SELECT m.role
       FROM memberships m
       JOIN workspaces w ON w.id = m.workspace_id AND w.org_id = m.org_id
      WHERE m.org_id = ? AND m.workspace_id = ? AND m.principal_id = ?
        AND m.removed_at IS NULL`,
    [principal.orgId, workspaceId, principal.principalId],
  );
  if (!membership || membership.role === "reader") throw notFound();
}
