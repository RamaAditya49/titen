import { first, type Stmt } from "./db";
import { recordAccessParams, recordAccessSql, authorizeRecordWorkspace } from "./authorization";
import { conflict, notFound, validationError } from "./errors";
import { sha256Hex } from "./ids";
import { auditStatement } from "./audit";
import { eventStatement } from "./events";
import { historyStatement } from "./observations";
import type { RequestContext, Result } from "./http";
import {
  LIMITS,
  optionalString,
  requireInteger,
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
  const expectedVersion = requireInteger(body, "expected_version", 1, Number.MAX_SAFE_INTEGER);

  const claim = await first<{ id: string; status: string; version: number; subject_id: string; project_id: string | null; workspace_id: string | null; kind: string; visibility: "private" | "team" | "organization" }>(
    ctx.app.db,
    `SELECT c.id, c.status, c.version, c.subject_id, c.project_id, c.workspace_id, c.kind, c.visibility
       FROM claims c WHERE c.id = ? AND c.org_id = ? AND ${recordAccessSql("c", "?", "write")}`,
    [claimId, principal.orgId, ...recordAccessParams(principal)],
  );
  if (!claim) throw notFound();
  if (newClaimId === claimId) throw validationError("A claim cannot supersede itself.");
  await authorizeRecordWorkspace(ctx.app.db, principal, claim.workspace_id, claim.visibility);
  if (claim.version !== expectedVersion) throw conflict("Claim version changed; reload it and retry.");
  if (claim.status !== "active" && claim.status !== "disputed")
    throw validationError(`Only active or disputed claims can be superseded (current: ${claim.status}).`);

  const replacement = await first<{ id: string; status: string; subject_id: string; project_id: string | null; workspace_id: string | null; kind: string; visibility: string }>(
    ctx.app.db,
    `SELECT c.id, c.status, c.subject_id, c.project_id, c.workspace_id, c.kind, c.visibility
       FROM claims c WHERE c.id = ? AND c.org_id = ? AND ${recordAccessSql("c", "?", "write")}`,
    [newClaimId, principal.orgId, ...recordAccessParams(principal)],
  );
  if (!replacement) throw notFound();
  if (replacement.status !== "active")
    throw validationError("The replacement claim must be active.");
  if (
    replacement.subject_id !== claim.subject_id
    || replacement.project_id !== claim.project_id
    || replacement.workspace_id !== claim.workspace_id
    || replacement.kind !== claim.kind
    || replacement.visibility !== claim.visibility
  ) throw validationError("A replacement claim must match the original claim domain and visibility.");
  const cycle = await first<{ found: number }>(
    ctx.app.db,
    `WITH RECURSIVE chain(id) AS (
       SELECT ?
       UNION
       SELECT c.superseded_by FROM claims c JOIN chain ON c.id = chain.id
        WHERE c.superseded_by IS NOT NULL
     ) SELECT 1 AS found FROM chain WHERE id = ? LIMIT 1`,
    [newClaimId, claimId],
  );
  if (cycle) throw validationError("Supersession would create a cycle.");

  const at = ctx.app.now().toISOString();
  const version = expectedVersion + 1;
  const dependentStatements = await revokeReflectionDependents(ctx, claimId, at);
  await lifecycleBatch(ctx, claimId, expectedVersion, [
    {
      sql: `UPDATE claims SET status = 'superseded', superseded_by = ?, version = ?
             WHERE id = ? AND org_id = ? AND version = ? AND status IN ('active', 'disputed')`,
      params: [newClaimId, version, claimId, principal.orgId, expectedVersion],
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
    ...dependentStatements,
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
  const expectedVersion = requireInteger(body, "expected_version", 1, Number.MAX_SAFE_INTEGER);

  const claim = await first<{ id: string; status: string; version: number; workspace_id: string | null; visibility: "private" | "team" | "organization" }>(
    ctx.app.db,
    `SELECT c.id, c.status, c.version, c.workspace_id, c.visibility
       FROM claims c WHERE c.id = ? AND c.org_id = ? AND ${recordAccessSql("c", "?", "write")}`,
    [claimId, principal.orgId, ...recordAccessParams(principal)],
  );
  if (!claim) throw notFound();
  await authorizeRecordWorkspace(ctx.app.db, principal, claim.workspace_id, claim.visibility);
  if (claim.version !== expectedVersion) throw conflict("Claim version changed; reload it and retry.");
  if (claim.status === "revoked")
    return { data: { claim_id: claimId, status: "revoked", already_revoked: true } };
  if (claim.status === "superseded")
    throw validationError("A superseded claim cannot be revoked; revoke its replacement instead.");

  const at = ctx.app.now().toISOString();
  const version = expectedVersion + 1;
  const dependentStatements = await revokeReflectionDependents(ctx, claimId, at);
  await lifecycleBatch(ctx, claimId, expectedVersion, [
    {
      sql: `UPDATE claims SET status = 'revoked', version = ?
             WHERE id = ? AND org_id = ? AND version = ? AND status != 'superseded'`,
      params: [version, claimId, principal.orgId, expectedVersion],
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
    ...dependentStatements,
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
  const expectedVersion = requireInteger(body, "expected_version", 1, Number.MAX_SAFE_INTEGER);

  const claim = await first<{ id: string; status: string; version: number; workspace_id: string | null; visibility: "private" | "team" | "organization"; valid_to: string | null }>(
    ctx.app.db,
    `SELECT c.id, c.status, c.version, c.workspace_id, c.visibility, c.valid_to
       FROM claims c WHERE c.id = ? AND c.org_id = ? AND ${recordAccessSql("c", "?", "write")}`,
    [claimId, principal.orgId, ...recordAccessParams(principal)],
  );
  if (!claim) throw notFound();
  await authorizeRecordWorkspace(ctx.app.db, principal, claim.workspace_id, claim.visibility);
  if (claim.version !== expectedVersion) throw conflict("Claim version changed; reload it and retry.");
  if (claim.status === "expired")
    return { data: { claim_id: claimId, status: "expired", already_expired: true } };
  if (claim.status !== "active" && claim.status !== "disputed")
    throw validationError(`Only active or disputed claims can be expired (current: ${claim.status}).`);

  const at = ctx.app.now().toISOString();
  const version = expectedVersion + 1;
  const dependentStatements = await revokeReflectionDependents(ctx, claimId, at);
  await lifecycleBatch(ctx, claimId, expectedVersion, [
    {
      sql: `UPDATE claims SET status = 'expired', valid_to = ?, version = ?
             WHERE id = ? AND org_id = ? AND version = ? AND status IN ('active', 'disputed')`,
      params: [at, version, claimId, principal.orgId, expectedVersion],
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
    ...dependentStatements,
  ]);

  return {
    data: { claim_id: claimId, status: "expired", valid_to: at, version, reason },
  };
}

async function revokeReflectionDependents(
  ctx: RequestContext,
  premiseId: string,
  at: string,
): Promise<Stmt[]> {
  const principal = ctx.principal!;
  const dependent = `c.status IN ('active', 'disputed') AND EXISTS (
    SELECT 1 FROM claim_links link
    JOIN enrichment_jobs job
      ON job.id = link.job_id AND job.org_id = link.org_id
    JOIN enrichment_commits commit_row ON commit_row.job_id = job.id
   WHERE link.org_id = c.org_id
     AND link.source_claim_id = c.id
     AND link.target_claim_id = ?
     AND link.relation = 'derived_from'
     AND job.id = c.enrichment_job_id
     AND job.lane = 'reflection'
     AND job.state = 'done'
     AND commit_row.result_kind = 'add'
  )`;
  const snapshotHash = await sha256Hex(`${premiseId}|reflection_premise_noncurrent|${at}`);
  return [
    {
      sql: `INSERT INTO lifecycle_fences (claim_id, expected_version, created_at)
            SELECT c.id, c.version, ? FROM claims c
             WHERE c.org_id = ? AND ${dependent}`,
      params: [at, principal.orgId, premiseId],
    },
    {
      sql: `INSERT INTO record_history
              (id, org_id, record_type, record_id, version, change_kind,
               actor_id, snapshot_hash, changed_at)
            SELECT 'hist_' || lower(hex(randomblob(16))), c.org_id, 'claim', c.id,
                   c.version + 1, 'revoke', ?, ?, ?
              FROM claims c WHERE c.org_id = ? AND ${dependent}`,
      params: [principal.principalId, snapshotHash, at, principal.orgId, premiseId],
    },
    ...(ctx.app.vectors ? [
      {
        sql: `UPDATE index_outbox SET state = 'done'
               WHERE org_id = ? AND record_type = 'claim' AND state = 'pending'
                 AND operation = 'upsert' AND record_id IN (
                   SELECT c.id FROM claims c WHERE c.org_id = ? AND ${dependent}
                 )`,
        params: [principal.orgId, principal.orgId, premiseId],
      },
      {
        sql: `INSERT INTO index_outbox
                (id, org_id, record_type, record_id, operation, state, attempts,
                 created_at)
              SELECT 'obx_' || lower(hex(randomblob(16))), c.org_id, 'claim', c.id,
                     'delete', 'pending', 0, ?
                FROM claims c WHERE c.org_id = ? AND ${dependent}`,
        params: [at, principal.orgId, premiseId],
      },
    ] satisfies Stmt[] : []),
    {
      sql: `INSERT INTO events
              (id, org_id, kind, actor_id, resource_type, resource_id, payload,
               created_at)
            SELECT 'evt_' || lower(hex(randomblob(16))), c.org_id, 'claim.revoked', ?,
                   'claim', c.id, '{"reason":"premise_noncurrent"}', ?
              FROM claims c WHERE c.org_id = ? AND ${dependent}`,
      params: [principal.principalId, at, principal.orgId, premiseId],
    },
    {
      sql: `DELETE FROM claims_fts WHERE claim_id IN (
              SELECT c.id FROM claims c WHERE c.org_id = ? AND ${dependent}
            )`,
      params: [principal.orgId, premiseId],
    },
    {
      sql: `UPDATE claims AS c SET status = 'revoked', version = version + 1
             WHERE c.org_id = ? AND ${dependent}`,
      params: [principal.orgId, premiseId],
    },
  ];
}

async function lifecycleBatch(
  ctx: RequestContext,
  claimId: string,
  expectedVersion: number,
  statements: Parameters<RequestContext["app"]["db"]["batch"]>[0],
): Promise<void> {
  try {
    await ctx.app.db.batch([
      {
        sql: `INSERT INTO lifecycle_fences (claim_id, expected_version, created_at) VALUES (?, ?, ?)`,
        params: [claimId, expectedVersion, ctx.app.now().toISOString()],
      },
      ...statements,
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw conflict("Claim version changed; reload it and retry.");
    throw error;
  }
}
