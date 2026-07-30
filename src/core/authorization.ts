import { first, type Db, type Param } from "./db";
import { notFound, validationError } from "./errors";
import type { Principal } from "./auth";
import type { Visibility } from "./validate";

type RecordAlias = "c" | "o";

/** SQL eligibility shared by every canonical memory projection. */
export function recordAccessSql(alias: RecordAlias): string {
  return `(
    ${alias}.visibility = 'organization'
    OR (${alias}.visibility = 'private' AND ${alias}.actor_id = ?)
    OR (
      ${alias}.visibility = 'team'
      AND ${alias}.workspace_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM memberships access_membership
         WHERE access_membership.org_id = ${alias}.org_id
           AND access_membership.workspace_id = ${alias}.workspace_id
           AND access_membership.principal_id = ?
           AND access_membership.removed_at IS NULL
      )
    )
  )`;
}

export function recordAccessParams(principalId: string): Param[] {
  return [principalId, principalId];
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

export async function canReadRecord(
  db: Db,
  principal: Principal,
  table: "claims" | "observations",
  id: string,
): Promise<boolean> {
  const alias: RecordAlias = table === "claims" ? "c" : "o";
  return Boolean(await first<{ id: string }>(
    db,
    `SELECT ${alias}.id FROM ${table} ${alias}
      WHERE ${alias}.id = ? AND ${alias}.org_id = ? AND ${recordAccessSql(alias)}`,
    [id, principal.orgId, ...recordAccessParams(principal.principalId)],
  ));
}
