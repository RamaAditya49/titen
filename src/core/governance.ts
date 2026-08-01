import { hasScope, type Principal } from "./auth";
import { auditStatement, recordAudit } from "./audit";
import { first, type Param, type Stmt } from "./db";
import { conflict, forbidden, notFound, unavailable, validationError } from "./errors";
import { eventStatement } from "./events";
import { newId, sha256Hex } from "./ids";
import type { RequestContext, Result } from "./http";
import { estimateTokens } from "./tokens";
import {
  CLAIM_KINDS,
  LIMITS,
  TRUST_LEVELS,
  TRUST_RANK,
  optionalEnum,
  optionalString,
  optionalTimestamp,
  requireEnum,
  requireInteger,
  requireObject,
  requireString,
  type Trust,
} from "./validate";
import { signPayload } from "./webhooks";
import { historyStatement } from "./writes";
import { recordAccessParams, recordAccessSql } from "./authorization";

const ROLES = ["owner", "admin", "member", "reader"] as const;
const POLICY_KINDS = ["claim_approval", "retention"] as const;
const SCOPE_TYPES = ["organization", "workspace", "project", "subject"] as const;
const RECORD_TYPES = ["observation", "claim"] as const;
const AUDIENCES = ["anonymous", "authenticated_customer", "partner"] as const;
const CHANNEL_STATUSES = ["active", "paused", "disabled"] as const;
const APPROVAL_DECISIONS = ["approve", "reject", "revoke"] as const;

type Role = (typeof ROLES)[number];
type Audience = (typeof AUDIENCES)[number];

function hasRoot(principal: Principal): boolean {
  return principal.scopes.includes("*");
}

/** Explicit capabilities remain the first gate; roles are the second gate. */
export async function requireOrgRole(
  ctx: RequestContext,
  allowed: readonly Role[],
  action: string,
): Promise<Role | "root"> {
  const principal = ctx.principal!;
  if (hasRoot(principal)) return "root";
  const membership = await first<{ role: Role }>(
    ctx.app.db,
    `SELECT role FROM memberships
      WHERE org_id = ? AND workspace_id IS NULL AND principal_id = ?
        AND principal_kind = ?
        AND removed_at IS NULL LIMIT 1`,
    [principal.orgId, principal.principalId, principal.principalKind],
  );
  if (membership && allowed.includes(membership.role)) return membership.role;
  await recordAudit(
    ctx.app.db,
    principal.orgId,
    principal.principalId,
    `${action}.denied`,
    "policy_decision",
    null,
    JSON.stringify({ allowed_roles: allowed }),
  );
  throw notFound();
}

function expectedVersion(body: Record<string, unknown>): number {
  return requireInteger(body, "expected_version", 1, 2_147_483_647);
}

function versionFence(resourceType: string, resourceId: string, version: number, at: string): Stmt {
  return {
    sql: `INSERT INTO governance_version_fences
            (resource_type, resource_id, expected_version, created_at)
          VALUES (?, ?, ?, ?)`,
    params: [resourceType, resourceId, version, at],
  };
}

async function commitVersioned(ctx: RequestContext, statements: Stmt[], message: string): Promise<void> {
  try {
    await ctx.app.db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /RELEASE_SOURCE_INELIGIBLE/i.test(error.message))
      throw conflict("Release source or channel state changed concurrently.");
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw conflict(message);
    throw error;
  }
}

function enumArray<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T[] {
  const raw = body[field];
  if (!Array.isArray(raw) || raw.length === 0)
    throw validationError(`Field "${field}" must be a non-empty array.`);
  if (raw.length > allowed.length)
    throw validationError(`Field "${field}" contains too many values.`);
  const values = raw.map((value) => {
    if (typeof value !== "string" || !allowed.includes(value as T))
      throw validationError(`Field "${field}" contains an unsupported value.`);
    return value as T;
  });
  return [...new Set(values)].sort();
}

async function assertPolicyScope(
  ctx: RequestContext,
  scopeType: (typeof SCOPE_TYPES)[number],
  scopeId: string | null,
): Promise<void> {
  if (scopeType === "organization") {
    if (scopeId !== null) throw validationError('Field "scope_id" must be omitted for organization scope.');
    return;
  }
  if (!scopeId) throw validationError('Field "scope_id" is required outside organization scope.');
  if (scopeType === "subject") return;
  const table = scopeType === "workspace" ? "workspaces" : "projects";
  const found = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM ${table} WHERE id = ? AND org_id = ?`,
    [scopeId, ctx.principal!.orgId],
  );
  if (!found) throw notFound();
}

// --- Typed policies -------------------------------------------------------

export async function createPolicy(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "policy.create");
  const body = requireObject(await ctx.json());
  const kind = requireEnum(body, "kind", POLICY_KINDS);
  const scopeType = requireEnum(body, "scope_type", SCOPE_TYPES);
  const scopeId = optionalString(body, "scope_id", LIMITS.identifier);
  await assertPolicyScope(ctx, scopeType, scopeId);

  const claimKind = kind === "claim_approval"
    ? requireEnum(body, "claim_kind", CLAIM_KINDS)
    : null;
  const recordType = kind === "retention"
    ? requireEnum(body, "record_type", RECORD_TYPES)
    : null;
  const minimumTrust = kind === "claim_approval"
    ? optionalEnum(body, "minimum_trust", TRUST_LEVELS, "verified")
    : null;
  const retentionDays = kind === "retention"
    ? requireInteger(body, "retention_days", 1, 36_500)
    : null;
  const independentApproval = body.independent_approval === false ? 0 : 1;
  if (body.independent_approval !== undefined && typeof body.independent_approval !== "boolean")
    throw validationError('Field "independent_approval" must be a boolean.');

  const principal = ctx.principal!;
  const id = newId("pol");
  const now = ctx.app.now().toISOString();
  const storedKind = kind === "claim_approval" ? "approval_required" : "retention";
  const config = kind === "claim_approval"
    ? { claim_kind: claimKind, minimum_trust: minimumTrust, independent_approval: Boolean(independentApproval) }
    : { record_type: recordType, retention_days: retentionDays };
  await ctx.app.db.batch([
    {
      sql: `INSERT INTO policies
              (id, org_id, kind, target_type, target_id, config, enabled,
               version, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
      params: [id, principal.orgId, storedKind, scopeType, scopeId,
        JSON.stringify(config), principal.principalId, now, now],
    },
    auditStatement(principal.orgId, principal.principalId, "policy.create", "governance_policy", now, id,
      JSON.stringify({ kind, scope_type: scopeType, scope_id: scopeId, version: 1 })),
    eventStatement(principal.orgId, "policy.created", principal.principalId, "governance_policy", id,
      { kind, scope_type: scopeType, scope_id: scopeId, version: 1 }, now),
  ]);
  return { status: 201, data: { policy_id: id, kind, scope_type: scopeType, scope_id: scopeId, version: 1, enabled: true } };
}

export async function listPolicies(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin", "reader"], "policy.list");
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `SELECT id, kind, target_type, target_id, config, enabled, version,
            created_by, created_at, updated_at
       FROM policies WHERE org_id = ? AND kind IN ('approval_required', 'retention')
       ORDER BY created_at, id`,
    [ctx.principal!.orgId],
  );
  return { data: { policies: rows.map((row) => ({
    policy_id: row.id,
    kind: row.kind === "approval_required" ? "claim_approval" : row.kind,
    scope_type: row.target_type,
    scope_id: row.target_id,
    ...JSON.parse(String(row.config)),
    enabled: Boolean(row.enabled),
    version: row.version,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  })) } };
}

export async function updatePolicy(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "policy.update");
  const body = requireObject(await ctx.json());
  const version = expectedVersion(body);
  if (body.enabled === undefined || typeof body.enabled !== "boolean")
    throw validationError('Field "enabled" must be a boolean.');
  const principal = ctx.principal!;
  const id = ctx.params.id!;
  const row = await first<{ id: string; version: number }>(
    ctx.app.db,
    `SELECT id, version FROM policies
      WHERE id = ? AND org_id = ? AND kind IN ('approval_required', 'retention')`,
    [id, principal.orgId],
  );
  if (!row) throw notFound();
  if (row.version !== version) throw conflict("Policy version is stale.");
  const now = ctx.app.now().toISOString();
  await commitVersioned(ctx, [
    versionFence("policy", id, version, now),
    {
      sql: `UPDATE policies SET enabled = ?, version = version + 1, updated_at = ?
             WHERE id = ? AND org_id = ? AND version = ?`,
      params: [body.enabled ? 1 : 0, now, id, principal.orgId, version],
    },
    auditStatement(principal.orgId, principal.principalId, "policy.update", "governance_policy", now, id,
      JSON.stringify({ enabled: body.enabled, version: version + 1 })),
    eventStatement(principal.orgId, "policy.updated", principal.principalId, "governance_policy", id,
      { enabled: body.enabled, version: version + 1 }, now),
  ], "Policy state changed concurrently.");
  return { data: { policy_id: id, enabled: body.enabled, version: version + 1 } };
}

// --- Claim approvals -----------------------------------------------------

interface ClaimForApproval {
  id: string;
  subject_id: string;
  project_id: string | null;
  workspace_id: string | null;
  kind: (typeof CLAIM_KINDS)[number];
  statement: string;
  trust: Trust;
  status: string;
  version: number;
  visibility: string;
}

async function approvalPolicy(ctx: RequestContext, claim: ClaimForApproval) {
  return first<{
    id: string;
    version: number;
    minimum_trust: Trust;
    independent_approval: number;
  }>(
    ctx.app.db,
    `SELECT id, version,
            json_extract(config, '$.minimum_trust') AS minimum_trust,
            CASE json_extract(config, '$.independent_approval') WHEN 1 THEN 1 ELSE 0 END AS independent_approval
       FROM policies
      WHERE org_id = ? AND kind = 'approval_required' AND enabled = 1
        AND json_extract(config, '$.claim_kind') = ?
        AND (
          target_type = 'organization'
          OR (target_type = 'project' AND target_id = ?)
          OR (target_type = 'workspace' AND target_id = ?)
          OR (target_type = 'subject' AND target_id = ?)
        )
      ORDER BY CASE target_type WHEN 'subject' THEN 4 WHEN 'project' THEN 3
                 WHEN 'workspace' THEN 2 ELSE 1 END DESC, updated_at DESC, id
      LIMIT 1`,
    [ctx.principal!.orgId, claim.kind, claim.project_id, claim.workspace_id, claim.subject_id],
  );
}

export async function submitClaimApproval(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin", "member"], "approval.submit");
  const body = requireObject(await ctx.json());
  const claimId = requireString(body, "claim_id", LIMITS.identifier);
  const claimVersion = requireInteger(body, "claim_version", 1, 2_147_483_647);
  const reason = requireString(body, "reason", LIMITS.statement);
  const principal = ctx.principal!;
  const claim = await first<ClaimForApproval>(
    ctx.app.db,
    `SELECT c.id, c.subject_id, c.project_id, c.workspace_id, c.kind, c.statement,
            c.trust, c.status, c.version, c.visibility
       FROM claims c
      WHERE c.id = ? AND c.org_id = ? AND c.actor_id = ?
        AND ${recordAccessSql("c")}`,
    [claimId, principal.orgId, principal.principalId,
      ...recordAccessParams(principal.principalId)],
  );
  if (!claim) throw notFound();
  if (claim.version !== claimVersion || claim.status !== "active")
    throw conflict("Claim version is not current and active.");
  if (claim.visibility !== "organization")
    throw validationError("Only organization-visible claims may enter organization approval.");
  if (claim.trust === "policy_approved") throw conflict("Claim is already policy approved.");
  const source = await first<{ id: string }>(
    ctx.app.db,
    `SELECT o.id FROM claim_sources s JOIN observations o ON o.id = s.observation_id
      WHERE s.claim_id = ? AND s.relation = 'supports' AND o.org_id = ?
        AND ${recordAccessSql("o")} LIMIT 1`,
    [claim.id, principal.orgId,
      ...recordAccessParams(principal.principalId)],
  );
  if (!source) throw validationError("Approval requires visible supporting evidence.");
  const policy = await approvalPolicy(ctx, claim);
  if (!policy) throw validationError("No enabled approval policy applies to this claim.");
  if (TRUST_RANK[claim.trust] < TRUST_RANK[policy.minimum_trust])
    throw validationError(`Claim trust must be at least ${policy.minimum_trust} before approval.`);

  const id = newId("apr");
  const now = ctx.app.now().toISOString();
  try {
    await ctx.app.db.batch([
      {
        sql: `INSERT INTO claim_approvals
                (id, org_id, claim_id, claim_version, policy_id, policy_version,
                 status, original_trust, submitted_by, submission_reason,
                 version, submitted_at)
              VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, 1, ?)`,
        params: [
          id, principal.orgId, claim.id, claim.version, policy.id, policy.version,
          claim.trust, principal.principalId, reason, now,
        ],
      },
      auditStatement(principal.orgId, principal.principalId, "approval.submit", "claim_approval", now, id,
        JSON.stringify({ claim_id: claim.id, claim_version: claim.version, policy_id: policy.id, policy_version: policy.version })),
      eventStatement(principal.orgId, "approval.submitted", principal.principalId, "claim_approval", id,
        { claim_id: claim.id, claim_version: claim.version, policy_id: policy.id }, now),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw conflict("This claim version already has an approval workflow.");
    throw error;
  }
  return { status: 201, data: { approval_id: id, status: "pending", version: 1, policy_id: policy.id } };
}

export async function listClaimApprovals(ctx: RequestContext): Promise<Result> {
  const role = await requireOrgRole(ctx, ["owner", "admin", "member", "reader"], "approval.list");
  const status = ctx.url.searchParams.get("status");
  if (status && !["pending", "approved", "rejected", "revoked"].includes(status))
    throw validationError('Query "status" is invalid.');
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `SELECT a.id, a.claim_id, a.claim_version, a.policy_id, a.policy_version,
            a.status, a.submitted_by, a.submission_reason, a.decided_by,
            a.decision_reason, a.version, a.submitted_at, a.decided_at
       FROM claim_approvals a
       JOIN claims c ON c.id = a.claim_id AND c.org_id = a.org_id
      WHERE a.org_id = ? AND (? IS NULL OR a.status = ?)
        AND ${recordAccessSql("c")}
        AND (? = 1 OR a.submitted_by = ?)
       ORDER BY a.submitted_at, a.id LIMIT 200`,
    [ctx.principal!.orgId, status, status,
      ...recordAccessParams(ctx.principal!.principalId),
      role === "root" || role === "owner" || role === "admin" ? 1 : 0,
      ctx.principal!.principalId],
  );
  return { data: { approvals: rows.map((row) => ({ approval_id: row.id, ...row, id: undefined })) } };
}

export async function decideClaimApproval(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "approval.decide");
  const body = requireObject(await ctx.json());
  const decision = requireEnum(body, "decision", APPROVAL_DECISIONS);
  const reason = requireString(body, "reason", LIMITS.statement);
  const expected = expectedVersion(body);
  const principal = ctx.principal!;
  const approvalId = ctx.params.id!;
  const row = await first<{
    id: string; claim_id: string; claim_version: number; status: string;
    original_trust: Trust; submitted_by: string; version: number;
    independent_approval: number; statement: string; claim_status: string;
    current_claim_version: number; current_trust: Trust;
  }>(
    ctx.app.db,
    `SELECT a.id, a.claim_id, a.claim_version, a.status, a.original_trust,
            a.submitted_by, a.version,
            CASE json_extract(p.config, '$.independent_approval') WHEN 1 THEN 1 ELSE 0 END AS independent_approval,
            c.statement,
            c.status AS claim_status, c.version AS current_claim_version,
            c.trust AS current_trust
       FROM claim_approvals a
       JOIN policies p ON p.id = a.policy_id AND p.org_id = a.org_id
       JOIN claims c ON c.id = a.claim_id AND c.org_id = a.org_id
      WHERE a.id = ? AND a.org_id = ? AND ${recordAccessSql("c")}`,
    [approvalId, principal.orgId, ...recordAccessParams(principal.principalId)],
  );
  if (!row) throw notFound();
  if (row.version !== expected) throw conflict("Approval version is stale.");
  if (row.independent_approval === 1 && row.submitted_by === principal.principalId)
    throw forbidden("The submitter cannot decide this approval.");
  if (decision === "revoke" ? row.status !== "approved" : row.status !== "pending")
    throw conflict(`Approval cannot transition from ${row.status} using ${decision}.`);
  if (decision === "approve" && (row.claim_status !== "active" || row.current_claim_version !== row.claim_version))
    throw conflict("Source claim version is no longer current and active.");
  if (decision === "revoke" && (
    row.claim_status !== "active"
    || row.current_claim_version !== row.claim_version
    || row.current_trust !== "policy_approved"
  )) throw conflict("Policy-approved claim state changed before revocation.");

  const now = ctx.app.now().toISOString();
  const nextStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "revoked";
  const statements: Stmt[] = [];
  statements.push(versionFence("claim_approval", approvalId, expected, now));
  let approvedClaimVersion = row.claim_version;
  if (decision === "approve") {
    approvedClaimVersion += 1;
    statements.push(
      {
        sql: `INSERT INTO lifecycle_fences (claim_id, expected_version, created_at)
              VALUES (?, ?, ?)`,
        params: [row.claim_id, row.claim_version, now],
      },
      {
        sql: `UPDATE claims SET trust = 'policy_approved', version = version + 1
               WHERE id = ? AND org_id = ? AND version = ? AND status = 'active'`,
        params: [row.claim_id, principal.orgId, row.claim_version],
      },
      {
        sql: `UPDATE claim_approvals
                 SET status = 'approved', claim_version = ?, decided_by = ?,
                     decision_reason = ?, decided_at = ?, version = version + 1
               WHERE id = ? AND org_id = ? AND version = ? AND status = 'pending'`,
        params: [approvedClaimVersion, principal.principalId, reason, now, approvalId, principal.orgId, expected],
      },
      historyStatement(principal.orgId, "claim", row.claim_id, approvedClaimVersion,
        "policy_approved", principal.principalId,
        await sha256Hex(`${row.statement}|policy_approved`), now),
    );
  } else if (decision === "revoke") {
    statements.push(
      {
        sql: `INSERT INTO lifecycle_fences (claim_id, expected_version, created_at)
              VALUES (?, ?, ?)`,
        params: [row.claim_id, row.claim_version, now],
      },
      {
        sql: `UPDATE claims SET trust = ?, version = version + 1
               WHERE id = ? AND org_id = ? AND version = ? AND trust = 'policy_approved'`,
        params: [row.original_trust, row.claim_id, principal.orgId, row.claim_version],
      },
      {
        sql: `UPDATE claim_approvals
                 SET status = 'revoked', decided_by = ?, decision_reason = ?,
                     decided_at = ?, version = version + 1
               WHERE id = ? AND org_id = ? AND version = ? AND status = 'approved'`,
        params: [principal.principalId, reason, now, approvalId, principal.orgId, expected],
      },
      historyStatement(principal.orgId, "claim", row.claim_id, row.claim_version + 1,
        "policy_approval_revoked", principal.principalId,
        await sha256Hex(`${row.statement}|${row.original_trust}`), now),
    );
  } else {
    statements.push({
      sql: `UPDATE claim_approvals
               SET status = 'rejected', decided_by = ?, decision_reason = ?,
                   decided_at = ?, version = version + 1
             WHERE id = ? AND org_id = ? AND version = ? AND status = 'pending'`,
      params: [principal.principalId, reason, now, approvalId, principal.orgId, expected],
    });
  }
  statements.push(
    auditStatement(principal.orgId, principal.principalId, `approval.${decision}`, "claim_approval", now, approvalId,
      JSON.stringify({ claim_id: row.claim_id, status: nextStatus, version: expected + 1 })),
    eventStatement(principal.orgId, `approval.${nextStatus}`, principal.principalId, "claim_approval", approvalId,
      { claim_id: row.claim_id, status: nextStatus, version: expected + 1 }, now),
  );
  try {
    await ctx.app.db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw conflict("Approval or claim state changed concurrently.");
    throw error;
  }
  return { data: { approval_id: approvalId, claim_id: row.claim_id, claim_version: decision === "approve" ? approvedClaimVersion : row.claim_version, status: nextStatus, version: expected + 1 } };
}

// --- Channels and immutable knowledge releases --------------------------

async function activeServicePrincipal(ctx: RequestContext, principalId: string): Promise<boolean> {
  const now = ctx.app.now().toISOString();
  return Boolean(await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM api_keys
      WHERE org_id = ? AND principal_id = ? AND principal_kind = 'service'
        AND revoked_at IS NULL AND not_before <= ? AND (expires_at IS NULL OR expires_at > ?)
      LIMIT 1`,
    [ctx.principal!.orgId, principalId, now, now],
  ));
}

export async function createChannel(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "channel.create");
  const body = requireObject(await ctx.json());
  const label = requireString(body, "label", LIMITS.label);
  const gatewayPrincipalId = requireString(body, "gateway_principal_id", LIMITS.identifier);
  const audiences = enumArray(body, "allowed_audiences", AUDIENCES);
  const minimumTrust = optionalEnum(body, "minimum_trust", TRUST_LEVELS, "policy_approved");
  if (!await activeServicePrincipal(ctx, gatewayPrincipalId)) throw notFound();

  const assertionSecret = optionalString(body, "assertion_secret", 512);
  if (audiences.includes("authenticated_customer") && (!assertionSecret || assertionSecret.length < 32))
    throw validationError('Field "assertion_secret" must be at least 32 characters for authenticated_customer.');
  if (assertionSecret && !ctx.app.secretCipher)
    throw unavailable("Signing-secret encryption is not configured.");

  const principal = ctx.principal!;
  const id = newId("chn");
  const now = ctx.app.now().toISOString();
  const encrypted = assertionSecret
    ? await ctx.app.secretCipher!.encrypt(assertionSecret, `channel:${id}`)
    : null;
  try {
    await ctx.app.db.batch([
      {
        sql: `INSERT INTO channels
                (id, org_id, label, gateway_principal_id, allowed_audiences,
                 minimum_trust, assertion_secret_hash, assertion_secret, status,
                 version, created_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
        params: [
          id, principal.orgId, label, gatewayPrincipalId, JSON.stringify(audiences),
          minimumTrust, assertionSecret ? await sha256Hex(assertionSecret) : null,
          encrypted, principal.principalId, now, now,
        ],
      },
      auditStatement(principal.orgId, principal.principalId, "channel.create", "channel", now, id,
        JSON.stringify({ gateway_principal_id: gatewayPrincipalId, allowed_audiences: audiences, minimum_trust: minimumTrust })),
      eventStatement(principal.orgId, "channel.created", principal.principalId, "channel", id,
        { gateway_principal_id: gatewayPrincipalId, allowed_audiences: audiences, minimum_trust: minimumTrust }, now),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw conflict("A channel with that label already exists.");
    throw error;
  }
  return { status: 201, data: { channel_id: id, label, gateway_principal_id: gatewayPrincipalId, allowed_audiences: audiences, minimum_trust: minimumTrust, status: "active", version: 1 } };
}

export async function listChannels(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin", "reader"], "channel.list");
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `SELECT id, label, gateway_principal_id, allowed_audiences, minimum_trust,
            status, version, created_by, created_at, updated_at
       FROM channels WHERE org_id = ? ORDER BY created_at, id`,
    [ctx.principal!.orgId],
  );
  return { data: { channels: rows.map((row) => ({ channel_id: row.id, ...row, id: undefined, allowed_audiences: JSON.parse(String(row.allowed_audiences)) })) } };
}

export async function updateChannel(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "channel.update");
  const body = requireObject(await ctx.json());
  const status = requireEnum(body, "status", CHANNEL_STATUSES);
  const expected = expectedVersion(body);
  const principal = ctx.principal!;
  const id = ctx.params.id!;
  const row = await first<{ version: number }>(ctx.app.db,
    `SELECT version FROM channels WHERE id = ? AND org_id = ?`, [id, principal.orgId]);
  if (!row) throw notFound();
  if (row.version !== expected) throw conflict("Channel version is stale.");
  const now = ctx.app.now().toISOString();
  await commitVersioned(ctx, [
    versionFence("channel", id, expected, now),
    { sql: `UPDATE channels SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND org_id = ? AND version = ?`, params: [status, now, id, principal.orgId, expected] },
    auditStatement(principal.orgId, principal.principalId, "channel.update", "channel", now, id, JSON.stringify({ status, version: expected + 1 })),
    eventStatement(principal.orgId, "channel.updated", principal.principalId, "channel", id, { status, version: expected + 1 }, now),
  ], "Channel state changed concurrently.");
  return { data: { channel_id: id, status, version: expected + 1 } };
}

interface ChannelRow {
  id: string; gateway_principal_id: string; allowed_audiences: string;
  minimum_trust: Trust; status: string; assertion_secret: string | null;
}

async function channelInOrg(ctx: RequestContext, id: string): Promise<ChannelRow> {
  const row = await first<ChannelRow>(ctx.app.db,
    `SELECT id, gateway_principal_id, allowed_audiences, minimum_trust, status, assertion_secret
       FROM channels WHERE id = ? AND org_id = ?`, [id, ctx.principal!.orgId]);
  if (!row) throw notFound();
  return row;
}

function assertAudience(channel: ChannelRow, audience: Audience): void {
  const allowed = JSON.parse(channel.allowed_audiences) as string[];
  if (!allowed.includes(audience)) throw notFound();
}

export async function createKnowledgeRelease(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin", "member"], "release.create");
  const body = requireObject(await ctx.json());
  const claimId = requireString(body, "claim_id", LIMITS.identifier);
  const claimVersion = requireInteger(body, "claim_version", 1, 2_147_483_647);
  const channelId = requireString(body, "channel_id", LIMITS.identifier);
  const audience = requireEnum(body, "audience", AUDIENCES);
  const releasedContent = requireString(body, "released_content", LIMITS.content);
  const locale = optionalString(body, "locale", 32);
  const validFrom = optionalTimestamp(body, "valid_from") ?? ctx.app.now().toISOString();
  const validTo = optionalTimestamp(body, "valid_to");
  if (validTo && validTo <= validFrom) throw validationError('Field "valid_to" must be later than "valid_from".');
  const proposalReason = requireString(body, "proposal_reason", LIMITS.statement);
  const principal = ctx.principal!;
  const channel = await channelInOrg(ctx, channelId);
  if (channel.status === "disabled") throw conflict("Channel is disabled.");
  assertAudience(channel, audience);
  const claim = await first<{ id: string; statement: string; version: number; status: string }>(
    ctx.app.db,
    `SELECT c.id, c.statement, c.version, c.status FROM claims c
      WHERE c.id = ? AND c.org_id = ? AND c.actor_id = ?
        AND ${recordAccessSql("c")}`,
    [claimId, principal.orgId, principal.principalId,
      ...recordAccessParams(principal.principalId)],
  );
  if (!claim) throw notFound();
  if (claim.status !== "active" || claim.version !== claimVersion)
    throw conflict("Claim version is not current and active.");
  const id = newId("rel");
  const now = ctx.app.now().toISOString();
  const sourceHash = await sha256Hex(`${claim.id}:${claim.version}:${claim.statement}`);
  const releasedHash = await sha256Hex(releasedContent);
  const sequence = await first<{ next_version: number }>(
    ctx.app.db,
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM channel_releases WHERE org_id = ? AND channel = ? AND audience = ?`,
    [principal.orgId, channelId, audience],
  );
  const releaseVersion = Number(sequence?.next_version ?? 1);
  try {
    await ctx.app.db.batch([
      {
        sql: `INSERT INTO channel_releases
              (id, org_id, channel, audience, version, status, approved_by,
               published_at, revoked_at, created_at, channel_id, claim_id,
               claim_version, source_hash, released_content,
               released_content_hash, locale, valid_from, valid_to,
               lifecycle_status, proposed_by, proposal_reason, row_version,
               updated_at)
            VALUES (?, ?, ?, ?, ?, 'draft', NULL, NULL, NULL, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, 'draft', ?, ?, 1, ?)`,
        params: [id, principal.orgId, channelId, audience, releaseVersion, now,
          channelId, claim.id, claim.version, sourceHash, releasedContent,
          releasedHash, locale, validFrom, validTo, principal.principalId,
          proposalReason, now],
      },
      auditStatement(principal.orgId, principal.principalId, "release.create", "knowledge_release", now, id,
        JSON.stringify({ channel_id: channelId, audience, claim_id: claim.id, claim_version: claim.version, released_content_hash: releasedHash })),
      eventStatement(principal.orgId, "release.created", principal.principalId, "knowledge_release", id,
        { channel_id: channelId, audience, claim_id: claim.id, claim_version: claim.version }, now),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw conflict("Release version changed concurrently.");
    throw error;
  }
  return { status: 201, data: { release_id: id, release_version: releaseVersion, status: "draft", version: 1, source_hash: sourceHash, released_content_hash: releasedHash } };
}

export async function listKnowledgeReleases(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin", "reader"], "release.list");
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `SELECT id, channel_id, audience, claim_id, claim_version, source_hash,
            released_content, released_content_hash, locale, valid_from, valid_to,
            lifecycle_status AS status, proposed_by, proposal_reason, approved_by, approval_reason,
            approved_at, activated_at, revoked_at, revocation_reason,
            version AS release_version, row_version AS version,
            created_at, updated_at
       FROM channel_releases
      WHERE org_id = ? AND channel_id IS NOT NULL
      ORDER BY created_at, id LIMIT 500`,
    [ctx.principal!.orgId],
  );
  return { data: { releases: rows.map((row) => ({ release_id: row.id, ...row, id: undefined })) } };
}

async function releaseWithSource(ctx: RequestContext, id: string) {
  return first<{
    id: string; channel_id: string; audience: Audience; claim_id: string;
    claim_version: number; status: string; proposed_by: string; version: number;
    valid_from: string; valid_to: string | null; claim_status: string;
    current_claim_version: number; claim_trust: Trust; channel_status: string;
    minimum_trust: Trust;
  }>(
    ctx.app.db,
    `SELECT r.id, r.channel_id, r.audience, r.claim_id, r.claim_version,
            r.lifecycle_status AS status, r.proposed_by, r.row_version AS version,
            r.valid_from, r.valid_to,
            c.status AS claim_status, c.version AS current_claim_version,
            c.trust AS claim_trust, ch.status AS channel_status,
            ch.minimum_trust
       FROM channel_releases r
       JOIN claims c ON c.id = r.claim_id AND c.org_id = r.org_id
       JOIN channels ch ON ch.id = r.channel_id AND ch.org_id = r.org_id
      WHERE r.id = ? AND r.org_id = ? AND ${recordAccessSql("c")}`,
    [id, ctx.principal!.orgId,
      ...recordAccessParams(ctx.principal!.principalId)],
  );
}

function assertReleaseSource(row: NonNullable<Awaited<ReturnType<typeof releaseWithSource>>>): void {
  if (row.claim_status !== "active" || row.current_claim_version !== row.claim_version)
    throw conflict("Release source claim is no longer current and active.");
  if (TRUST_RANK[row.claim_trust] < TRUST_RANK[row.minimum_trust])
    throw conflict("Release source no longer satisfies channel trust policy.");
}

export async function approveKnowledgeRelease(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "release.approve");
  const body = requireObject(await ctx.json());
  const expected = expectedVersion(body);
  const reason = requireString(body, "reason", LIMITS.statement);
  const principal = ctx.principal!;
  const id = ctx.params.id!;
  const row = await releaseWithSource(ctx, id);
  if (!row) throw notFound();
  if (row.version !== expected) throw conflict("Release version is stale.");
  if (!(["draft", "suspended"] as string[]).includes(row.status)) throw conflict("Release is not approvable.");
  if (row.proposed_by === principal.principalId) throw forbidden("The release proposer cannot approve it.");
  assertReleaseSource(row);
  const now = ctx.app.now().toISOString();
  await commitVersioned(ctx, [
    versionFence("knowledge_release", id, expected, now),
    { sql: `UPDATE channel_releases
               SET status = 'draft', lifecycle_status = 'approved', approved_by = ?,
                   approval_reason = ?, approved_at = ?, row_version = row_version + 1,
                   updated_at = ?
             WHERE id = ? AND org_id = ? AND row_version = ?`, params: [principal.principalId, reason, now, now, id, principal.orgId, expected] },
    auditStatement(principal.orgId, principal.principalId, "release.approve", "knowledge_release", now, id, JSON.stringify({ version: expected + 1 })),
    eventStatement(principal.orgId, "release.approved", principal.principalId, "knowledge_release", id, { version: expected + 1 }, now),
  ], "Release state changed concurrently.");
  return { data: { release_id: id, status: "approved", version: expected + 1 } };
}

export async function activateKnowledgeRelease(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "release.activate");
  const body = requireObject(await ctx.json());
  const expected = expectedVersion(body);
  const principal = ctx.principal!;
  const id = ctx.params.id!;
  const row = await releaseWithSource(ctx, id);
  if (!row) throw notFound();
  if (row.version !== expected) throw conflict("Release version is stale.");
  if (row.status !== "approved" || row.channel_status !== "active")
    throw conflict("Release and channel must be approved and active.");
  assertReleaseSource(row);
  const now = ctx.app.now().toISOString();
  await commitVersioned(ctx, [
    versionFence("knowledge_release", id, expected, now),
    {
      sql: `UPDATE channel_releases
               SET status = 'draft', lifecycle_status = 'replaced',
                   row_version = row_version + 1, updated_at = ?
             WHERE org_id = ? AND channel_id = ? AND audience = ?
               AND claim_id = ? AND id <> ? AND lifecycle_status = 'active'`,
      params: [now, principal.orgId, row.channel_id, row.audience, row.claim_id, id],
    },
    { sql: `UPDATE channel_releases SET status = 'active', lifecycle_status = 'active',
             published_at = ?, activated_at = ?, row_version = row_version + 1,
             updated_at = ? WHERE id = ? AND org_id = ? AND row_version = ?`, params: [now, now, now, id, principal.orgId, expected] },
    auditStatement(principal.orgId, principal.principalId, "release.activate", "knowledge_release", now, id, JSON.stringify({ version: expected + 1 })),
    eventStatement(principal.orgId, "release.activated", principal.principalId, "knowledge_release", id, { version: expected + 1 }, now),
  ], "Release state changed concurrently.");
  return { data: { release_id: id, status: "active", version: expected + 1 } };
}

export async function revokeKnowledgeRelease(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "release.revoke");
  const body = requireObject(await ctx.json());
  const expected = expectedVersion(body);
  const reason = requireString(body, "reason", LIMITS.statement);
  const principal = ctx.principal!;
  const id = ctx.params.id!;
  const row = await first<{ id: string; status: string; version: number }>(
    ctx.app.db,
    `SELECT id, lifecycle_status AS status, row_version AS version
       FROM channel_releases WHERE id = ? AND org_id = ? AND channel_id IS NOT NULL`,
    [id, principal.orgId],
  );
  if (!row) throw notFound();
  if (row.version !== expected) throw conflict("Release version is stale.");
  if (!["approved", "active", "suspended"].includes(row.status)) throw conflict("Release is not revocable.");
  const now = ctx.app.now().toISOString();
  await commitVersioned(ctx, [
    versionFence("knowledge_release", id, expected, now),
    { sql: `UPDATE channel_releases SET status = 'revoked', lifecycle_status = 'revoked',
             revoked_at = ?, revocation_reason = ?, row_version = row_version + 1,
             updated_at = ? WHERE id = ? AND org_id = ? AND row_version = ?`, params: [now, reason, now, id, principal.orgId, expected] },
    auditStatement(principal.orgId, principal.principalId, "release.revoke", "knowledge_release", now, id, JSON.stringify({ version: expected + 1 })),
    eventStatement(principal.orgId, "release.revoked", principal.principalId, "knowledge_release", id, { version: expected + 1 }, now),
  ], "Release state changed concurrently.");
  return { data: { release_id: id, status: "revoked", version: expected + 1 } };
}

interface AssertionPayload {
  v: 1;
  channel_id: string;
  audience: "authenticated_customer";
  subject_id: string;
  exp: number;
  jti: string;
}

function decodeAssertionPayload(value: string): AssertionPayload {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)))) as Partial<AssertionPayload>;
    if (parsed.v !== 1 || parsed.audience !== "authenticated_customer" || typeof parsed.channel_id !== "string" || typeof parsed.subject_id !== "string" || typeof parsed.exp !== "number" || !Number.isInteger(parsed.exp) || typeof parsed.jti !== "string" || parsed.jti.length < 16 || parsed.jti.length > 200)
      throw new Error();
    return parsed as AssertionPayload;
  } catch {
    throw forbidden("Customer session assertion is invalid.");
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

async function verifyCustomerAssertion(ctx: RequestContext, channel: ChannelRow, assertion: string): Promise<string> {
  const [payloadText, signature, extra] = assertion.split(".");
  if (!payloadText || !signature || extra) throw forbidden("Customer session assertion is invalid.");
  if (!channel.assertion_secret || !ctx.app.secretCipher) throw unavailable("Channel assertion verification is unavailable.");
  const secret = await ctx.app.secretCipher.decrypt(channel.assertion_secret, `channel:${channel.id}`);
  const expected = await signPayload(secret, payloadText);
  if (!constantTimeEqual(signature, expected)) throw forbidden("Customer session assertion is invalid.");
  const payload = decodeAssertionPayload(payloadText);
  const nowSeconds = Math.floor(ctx.app.now().getTime() / 1000);
  if (payload.channel_id !== channel.id || payload.exp <= nowSeconds || payload.exp > nowSeconds + 900)
    throw forbidden("Customer session assertion is invalid or expired.");
  const nonceHash = await sha256Hex(payload.jti);
  try {
    await ctx.app.db.batch([{
      sql: `INSERT INTO customer_assertion_replays
              (org_id, channel_id, nonce_hash, expires_at, used_at)
            VALUES (?, ?, ?, ?, ?)`,
      params: [ctx.principal!.orgId, channel.id, nonceHash, new Date(payload.exp * 1000).toISOString(), ctx.app.now().toISOString()],
    }]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw forbidden("Customer session assertion was already used.");
    throw error;
  }
  return payload.subject_id;
}

export async function compileChannelContext(ctx: RequestContext): Promise<Result> {
  const body = requireObject(await ctx.json());
  const audience = requireEnum(body, "audience", AUDIENCES);
  const task = requireString(body, "task", LIMITS.statement);
  const maxTokens = requireInteger(body, "max_tokens", 128, LIMITS.maxTokens);
  const assertion = optionalString(body, "customer_session_assertion", 4096);
  const principal = ctx.principal!;
  const channel = await channelInOrg(ctx, ctx.params.id!);
  if (principal.principalKind !== "service" || channel.gateway_principal_id !== principal.principalId)
    throw notFound();
  if (channel.status !== "active") throw notFound();
  assertAudience(channel, audience);
  if (audience === "authenticated_customer") {
    if (!assertion) throw validationError('Field "customer_session_assertion" is required.');
    await verifyCustomerAssertion(ctx, channel, assertion);
  } else if (assertion) {
    throw validationError('Field "customer_session_assertion" is allowed only for authenticated_customer.');
  }

  const now = ctx.app.now().toISOString();
  const rows = await ctx.app.db.all<{
    id: string; claim_id: string; claim_version: number; released_content: string;
    released_content_hash: string; locale: string | null; valid_from: string;
    valid_to: string | null;
  }>(
    `SELECT r.id, r.claim_id, r.claim_version, r.released_content,
            r.released_content_hash, r.locale, r.valid_from, r.valid_to
       FROM channel_releases r
       JOIN claims c ON c.id = r.claim_id AND c.org_id = r.org_id
       JOIN channels ch ON ch.id = r.channel_id AND ch.org_id = r.org_id
      WHERE r.org_id = ? AND r.channel_id = ? AND r.audience = ?
        AND r.lifecycle_status = 'active' AND ch.status = 'active'
        AND r.valid_from <= ? AND (r.valid_to IS NULL OR r.valid_to > ?)
        AND c.status = 'active' AND c.version = r.claim_version
        AND CASE c.trust WHEN 'policy_approved' THEN 3 WHEN 'verified' THEN 2
                         WHEN 'asserted' THEN 1 ELSE 0 END
            >= CASE ch.minimum_trust WHEN 'policy_approved' THEN 3 WHEN 'verified' THEN 2
                                     WHEN 'asserted' THEN 1 ELSE 0 END
        AND NOT EXISTS (SELECT 1 FROM retention_exclusions x
                         WHERE x.org_id = c.org_id AND x.resource_type = 'claim'
                           AND x.resource_id = c.id)
      ORDER BY r.activated_at, r.id LIMIT 200`,
    [principal.orgId, channel.id, audience, now, now],
  );
  const items: Record<string, unknown>[] = [];
  let usedTokens = estimateTokens(task) + 32;
  for (const row of rows) {
    const tokens = estimateTokens(row.released_content) + 16;
    if (usedTokens + tokens > maxTokens) continue;
    usedTokens += tokens;
    items.push({
      release_id: row.id,
      content: row.released_content,
      content_hash: row.released_content_hash,
      locale: row.locale,
      citation: { claim_id: row.claim_id, claim_version: row.claim_version },
      untrusted: true,
    });
  }
  await ctx.app.db.batch([
    auditStatement(principal.orgId, principal.principalId, "channel_context.compile", "channel", now, channel.id,
      JSON.stringify({ audience, release_ids: items.map((item) => item.release_id), used_tokens: usedTokens })),
    eventStatement(principal.orgId, "channel_context.compiled", principal.principalId, "channel", channel.id,
      { audience, release_ids: items.map((item) => item.release_id), used_tokens: usedTokens }, now),
  ]);
  return { data: { channel_id: channel.id, audience, items, used_tokens: usedTokens, max_tokens: maxTokens, untrusted: true } };
}

// --- Retention, legal hold, and external identity boundary ---------------

export async function placeLegalHold(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "legal_hold.place");
  const body = requireObject(await ctx.json());
  const resourceType = requireEnum(body, "resource_type", RECORD_TYPES);
  const resourceId = requireString(body, "resource_id", LIMITS.identifier);
  const reason = requireString(body, "reason", LIMITS.statement);
  const principal = ctx.principal!;
  const table = resourceType === "observation" ? "observations" : "claims";
  const resource = await first<{ id: string }>(ctx.app.db,
    `SELECT id FROM ${table} WHERE id = ? AND org_id = ?`, [resourceId, principal.orgId]);
  if (!resource) throw notFound();
  const id = newId("hold");
  const now = ctx.app.now().toISOString();
  try {
    await ctx.app.db.batch([
      { sql: `INSERT INTO legal_holds
                (id, org_id, resource_type, resource_id, reason, placed_by, placed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`, params: [id, principal.orgId, resourceType, resourceId, reason, principal.principalId, now] },
      {
        sql: `INSERT INTO audit_log
                (id, org_id, actor_id, action, resource_type, resource_id,
                 detail, ip_hint, created_at)
              SELECT ?, x.org_id, ?, 'retention_exclusion.remove_for_hold',
                     'retention_exclusion', x.id, ?, NULL, ?
                FROM retention_exclusions x
               WHERE x.org_id = ? AND (
                 (x.resource_type = ? AND x.resource_id = ?)
                 OR (? = 'claim' AND x.resource_type = 'observation'
                   AND EXISTS (
                     SELECT 1 FROM claim_sources s
                      WHERE s.claim_id = ? AND s.observation_id = x.resource_id
                   ))
               ) LIMIT 1`,
        params: [newId("aud"), principal.principalId,
          JSON.stringify({ legal_hold_id: id }), now,
          principal.orgId, resourceType, resourceId, resourceType, resourceId],
      },
      {
        sql: `DELETE FROM retention_exclusions
               WHERE org_id = ? AND (
                 (resource_type = ? AND resource_id = ?)
                 OR (? = 'claim' AND resource_type = 'observation'
                   AND EXISTS (
                     SELECT 1 FROM claim_sources s
                      WHERE s.claim_id = ?
                        AND s.observation_id = retention_exclusions.resource_id
                   ))
               )`,
        params: [principal.orgId, resourceType, resourceId, resourceType, resourceId],
      },
      auditStatement(principal.orgId, principal.principalId, "legal_hold.place", "legal_hold", now, id, JSON.stringify({ resource_type: resourceType, resource_id: resourceId })),
      eventStatement(principal.orgId, "legal_hold.placed", principal.principalId, "legal_hold", id, { resource_type: resourceType, resource_id: resourceId }, now),
    ]);
  } catch (error) {
    if (error instanceof Error && /RESOURCE_ALREADY_PURGED/i.test(error.message))
      throw conflict("A purged resource cannot be placed under legal hold.");
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw conflict("That resource already has a legal hold record.");
    throw error;
  }
  return { status: 201, data: { legal_hold_id: id, resource_type: resourceType, resource_id: resourceId, active: true } };
}

export async function releaseLegalHold(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "legal_hold.release");
  const body = requireObject(await ctx.json());
  const reason = requireString(body, "reason", LIMITS.statement);
  const principal = ctx.principal!;
  const id = ctx.params.id!;
  const row = await first<{ id: string }>(ctx.app.db,
    `SELECT id FROM legal_holds WHERE id = ? AND org_id = ? AND released_at IS NULL`, [id, principal.orgId]);
  if (!row) throw notFound();
  const now = ctx.app.now().toISOString();
  await commitVersioned(ctx, [
    versionFence("legal_hold_release", id, 1, now),
    { sql: `UPDATE legal_holds SET released_by = ?, release_reason = ?, released_at = ?
             WHERE id = ? AND org_id = ? AND released_at IS NULL`, params: [principal.principalId, reason, now, id, principal.orgId] },
    auditStatement(principal.orgId, principal.principalId, "legal_hold.release", "legal_hold", now, id),
    eventStatement(principal.orgId, "legal_hold.released", principal.principalId, "legal_hold", id, {}, now),
  ], "Legal hold release changed concurrently.");
  return { data: { legal_hold_id: id, active: false, released_at: now } };
}

function retentionScopeSql(scopeType: string, alias: string): string {
  if (scopeType === "organization") return "1 = 1";
  if (scopeType === "workspace") return `${alias}.workspace_id = ?`;
  if (scopeType === "project") return `${alias}.project_id = ?`;
  return `${alias}.subject_id = ?`;
}

export async function applyRetention(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "retention.apply");
  const body = requireObject(await ctx.json());
  const policyId = requireString(body, "policy_id", LIMITS.identifier);
  const limit = body.limit === undefined ? 100 : requireInteger(body, "limit", 1, 500);
  const principal = ctx.principal!;
  const policy = await first<{
    id: string; scope_type: string; scope_id: string | null;
    record_type: "observation" | "claim"; retention_days: number;
  }>(
    ctx.app.db,
    `SELECT id, target_type AS scope_type, target_id AS scope_id,
            json_extract(config, '$.record_type') AS record_type,
            json_extract(config, '$.retention_days') AS retention_days
       FROM policies
      WHERE id = ? AND org_id = ? AND kind = 'retention' AND enabled = 1`,
    [policyId, principal.orgId],
  );
  if (!policy) throw notFound();
  const table = policy.record_type === "observation" ? "observations" : "claims";
  const alias = policy.record_type === "observation" ? "o" : "c";
  const timeColumn = policy.record_type === "observation" ? "ingested_at" : "created_at";
  const cutoff = new Date(ctx.app.now().getTime() - policy.retention_days * 86_400_000).toISOString();
  const params: Param[] = [principal.orgId, cutoff];
  if (policy.scope_type !== "organization") params.push(policy.scope_id);
  params.push(limit);
  const rows = await ctx.app.db.all<{ id: string }>(
    `SELECT ${alias}.id FROM ${table} ${alias}
      WHERE ${alias}.org_id = ? AND ${alias}.${timeColumn} < ?
        AND ${retentionScopeSql(policy.scope_type, alias)}
        AND NOT EXISTS (SELECT 1 FROM legal_holds h
                         WHERE h.org_id = ${alias}.org_id AND h.released_at IS NULL
                           AND (
                             (h.resource_type = '${policy.record_type}' AND h.resource_id = ${alias}.id)
                             OR ('${policy.record_type}' = 'observation'
                               AND h.resource_type = 'claim'
                               AND EXISTS (
                                 SELECT 1 FROM claim_sources held_source
                                  WHERE held_source.claim_id = h.resource_id
                                    AND held_source.observation_id = ${alias}.id
                               ))
                           ))
        AND NOT EXISTS (SELECT 1 FROM retention_exclusions x
                         WHERE x.org_id = ${alias}.org_id
                           AND x.resource_type = '${policy.record_type}'
                           AND x.resource_id = ${alias}.id)
      ORDER BY ${alias}.${timeColumn}, ${alias}.id LIMIT ?`,
    params,
  );
  const now = ctx.app.now().toISOString();
  const statements: Stmt[] = rows.map((row) => ({
    sql: `INSERT OR IGNORE INTO retention_exclusions
            (id, org_id, policy_id, resource_type, resource_id, excluded_at, actor_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [newId("ret"), principal.orgId, policy.id, policy.record_type, row.id, now, principal.principalId],
  }));
  statements.push(
    auditStatement(principal.orgId, principal.principalId, "retention.apply", "governance_policy", now, policy.id,
      JSON.stringify({ resource_type: policy.record_type, excluded_count: rows.length, cutoff })),
    eventStatement(principal.orgId, "retention.applied", principal.principalId, "governance_policy", policy.id,
      { resource_type: policy.record_type, excluded_count: rows.length, cutoff }, now),
  );
  try {
    await ctx.app.db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /ACTIVE_LEGAL_HOLD/i.test(error.message))
      throw conflict("Legal hold took precedence over retention.");
    throw error;
  }
  return { data: { policy_id: policy.id, resource_type: policy.record_type, excluded_count: rows.length, cutoff } };
}

export async function createIdentityMapping(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "identity_mapping.create");
  const body = requireObject(await ctx.json());
  const provider = requireString(body, "provider", LIMITS.label).toLowerCase();
  const externalSubject = requireString(body, "external_subject", LIMITS.identifier);
  const principalId = requireString(body, "principal_id", LIMITS.identifier);
  const principal = ctx.principal!;
  const target = await first<{ principal_id: string }>(
    ctx.app.db,
    `SELECT principal_id FROM api_keys WHERE org_id = ? AND principal_id = ?
     UNION
     SELECT principal_id FROM memberships WHERE org_id = ? AND principal_id = ? AND removed_at IS NULL
     LIMIT 1`,
    [principal.orgId, principalId, principal.orgId, principalId],
  );
  if (!target) throw notFound();
  const id = newId("idp");
  const now = ctx.app.now().toISOString();
  try {
    await ctx.app.db.batch([
      { sql: `INSERT INTO external_identity_mappings
                (id, org_id, provider, external_subject, principal_id, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`, params: [id, principal.orgId, provider, externalSubject, principalId, principal.principalId, now] },
      auditStatement(principal.orgId, principal.principalId, "identity_mapping.create", "identity_mapping", now, id, JSON.stringify({ provider, principal_id: principalId })),
      eventStatement(principal.orgId, "identity_mapping.created", principal.principalId, "identity_mapping", id, { provider, principal_id: principalId }, now),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw conflict("That external identity is already mapped.");
    throw error;
  }
  return { status: 201, data: { mapping_id: id, provider, external_subject: externalSubject, principal_id: principalId } };
}

export async function listIdentityMappings(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin", "reader"], "identity_mapping.list");
  const rows = await ctx.app.db.all<Record<string, unknown>>(
    `SELECT id, provider, external_subject, principal_id, created_by, created_at
       FROM external_identity_mappings WHERE org_id = ? AND removed_at IS NULL
       ORDER BY created_at, id`, [ctx.principal!.orgId]);
  return { data: { mappings: rows.map((row) => ({ mapping_id: row.id, ...row, id: undefined })) } };
}

export async function removeIdentityMapping(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "identity_mapping.remove");
  const principal = ctx.principal!;
  const id = ctx.params.id!;
  const row = await first<{ id: string }>(ctx.app.db,
    `SELECT id FROM external_identity_mappings WHERE id = ? AND org_id = ? AND removed_at IS NULL`, [id, principal.orgId]);
  if (!row) throw notFound();
  const now = ctx.app.now().toISOString();
  await commitVersioned(ctx, [
    versionFence("identity_mapping_remove", id, 1, now),
    { sql: `UPDATE external_identity_mappings SET removed_at = ? WHERE id = ? AND org_id = ? AND removed_at IS NULL`, params: [now, id, principal.orgId] },
    auditStatement(principal.orgId, principal.principalId, "identity_mapping.remove", "identity_mapping", now, id),
    eventStatement(principal.orgId, "identity_mapping.removed", principal.principalId, "identity_mapping", id, {}, now),
  ], "Identity mapping changed concurrently.");
  return { data: { mapping_id: id, removed_at: now } };
}
