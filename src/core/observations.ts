import { assertTrustCeiling, type Principal } from "./auth";
import { first, type Db, type Stmt } from "./db";
import { eventStatement } from "./events";
import { conflict, notFound, validationError } from "./errors";
import { newId, sha256Hex } from "./ids";
import { canonicalJson, commitIdempotent, idempotencyKey } from "./idempotency";
import { requireProject } from "./projects";
import { authorizeRecordTarget, authorizeRecordWorkspace, recordAccessParams, recordAccessSql } from "./authorization";
import type { RequestContext, Result } from "./http";
import { derivationJobStatement } from "./enrichment";
import { historyStatement, outboxStatement } from "./writes";
export { historyStatement, outboxStatement } from "./writes";
import {
  LIMITS,
  OBSERVATION_KINDS,
  RECALLED_SOURCE_TYPE,
  TRUST_LEVELS,
  VISIBILITIES,
  optionalEnum,
  optionalString,
  optionalTimestamp,
  requireEnum,
  requireObject,
  requireString,
} from "./validate";

export const ENDPOINT = "POST /v1/observations";
export const REDACTED_CLAIM_STATEMENT = "[redacted: purged evidence]";

interface ObservationReplayRow {
  id: string;
  subject_id: string;
  project_id: string | null;
  workspace_id: string | null;
  agent_id: string | null;
  run_id: string | null;
  kind: string;
  trust: string;
  visibility: string;
  content_hash: string;
  occurred_at: string | null;
  ingested_at: string;
}

function replayData(row: ObservationReplayRow) {
  return {
    observation_id: row.id,
    subject_id: row.subject_id,
    project_id: row.project_id,
    agent_id: row.agent_id,
    run_id: row.run_id,
    kind: row.kind,
    trust: row.trust,
    visibility: row.visibility,
    workspace_id: row.workspace_id,
    content_hash: row.content_hash,
    occurred_at: row.occurred_at,
    ingested_at: row.ingested_at,
  };
}

export function redactedObservationContent(contentHash: string): string {
  return `[redacted sha256:${contentHash}]`;
}

export function isRedactedObservation(content: string, contentHash: string): boolean {
  return /^[a-f0-9]{64}$/u.test(contentHash)
    && content === redactedObservationContent(contentHash);
}

/**
 * Private is the only safe implicit visibility. Team records require an
 * explicit workspace and active writer membership.
 */
const DEFAULT_VISIBILITY = "private";

/**
 * A context token is the identifier `POST /v1/context/compile` issued for a run
 * the caller is entitled to read, so it is verified against the same boundary
 * `getContext` enforces: own run, or one delegated by a live handoff.
 *
 * Deliberately not an HMAC. Titen's signing keyring (`TITEN_SECRET_KEYS`) is
 * optional, so a stateless token would be unavailable in exactly the
 * zero-configuration deployments that need this most, and a token a caller can
 * always mint by compiling gains nothing from a signature it cannot forge
 * anyway. The row already exists; one primary-key lookup replaces a key
 * dependency, a migration, and an expiry policy.
 */
async function isIssuedContextToken(
  db: Db,
  principal: Principal,
  token: string,
): Promise<boolean> {
  return Boolean(await first<{ present: number }>(
    db,
    `SELECT 1 AS present FROM context_runs r
      WHERE r.id = ? AND r.org_id = ?
        AND (
          r.actor_id = ?
          OR EXISTS (
            SELECT 1 FROM handoffs h
             WHERE h.org_id = r.org_id AND h.context_id = r.id
               AND h.to_principal = ? AND h.status IN ('pending', 'accepted')
          )
        )
      LIMIT 1`,
    [token, principal.orgId, principal.principalId, principal.principalId],
  ));
}

export async function appendObservation(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const raw = await ctx.rawBody();
  const body = requireObject(await ctx.json());

  const subjectId = requireString(body, "subject_id", LIMITS.identifier);
  const kind = requireEnum(body, "kind", OBSERVATION_KINDS);
  const content = requireString(body, "content", LIMITS.content);
  const trust = optionalEnum(body, "trust", TRUST_LEVELS, "asserted");
  const visibility = optionalEnum(body, "visibility", VISIBILITIES, DEFAULT_VISIBILITY);
  const workspaceId = optionalString(body, "workspace_id", LIMITS.identifier);
  const agentId = optionalString(body, "agent_id", LIMITS.identifier);
  const runId = optionalString(body, "run_id", LIMITS.identifier);
  const occurredAt = optionalTimestamp(body, "occurred_at");
  const source = requireObject(body.source, "source");
  const declaredSourceType = requireString(source, "type", LIMITS.label, "source.type");
  // A pointer back to the origin is mandatory, not advisory: an audit that
  // cannot trace an entry to where it came from cannot tell junk from evidence.
  // This is the obligation the MCP tool spec already stated (#280).
  const sourceRef = requireString(source, "ref", LIMITS.identifier, "source.ref");
  const sourceId = optionalString(source, "id", LIMITS.identifier, "source.id");

  /**
   * Provenance is the one field a caller may not author. `recalled` means Titen
   * itself returned this content through a context pack, which is the write that
   * turns a memory store into an echo chamber. It is stamped from a server-issued
   * context token, refused when merely declared, and not overridable by a caller
   * that holds one.
   *
   * Known ceiling: the stamp proves the write was made while holding a
   * Titen-issued pack, not that its content came out of that pack, and a caller
   * that simply omits the token is not stamped at all. `recalled` is therefore a
   * sound lower bound on the recall loop and never an upper one. Tightening it
   * means comparing written content against the pack's items, which is a
   * similarity decision this path has no business making synchronously; that
   * belongs in `titen audit`.
   */
  const contextToken = optionalString(body, "context_token", LIMITS.identifier);
  if (declaredSourceType === RECALLED_SOURCE_TYPE)
    throw validationError(
      `Source type "${RECALLED_SOURCE_TYPE}" is assigned by Titen from a "context_token" issued by POST /v1/context/compile and may not be declared by a caller.`,
    );
  // Fail closed: silently downgrading an unrecognized token to "new input" is
  // exactly the mislabelled recall loop this path exists to prevent.
  if (contextToken !== null && !(await isIssuedContextToken(ctx.app.db, principal, contextToken)))
    throw validationError('Field "context_token" is not a context token issued to this principal.');
  const sourceType = contextToken === null ? declaredSourceType : RECALLED_SOURCE_TYPE;

  // Trust is authority, not a payload field: a key cannot promote its evidence.
  assertTrustCeiling(principal, trust);
  if (trust === "policy_approved")
    throw validationError('Trust "policy_approved" is assigned only by the claim approval workflow.');
  const projectId = await requireProject(
    ctx.app.db,
    principal.orgId,
    optionalString(body, "project_id", LIMITS.identifier),
  );
  await authorizeRecordTarget(ctx.app.db, principal, subjectId, projectId);
  await authorizeRecordWorkspace(ctx.app.db, principal, workspaceId, visibility);

  const contentHash = await sha256Hex(content);
  const canonicalHash = sourceId ? await sha256Hex(canonicalJson({
    actor_id: principal.principalId,
    subject_id: subjectId,
    project_id: projectId,
    workspace_id: workspaceId,
    agent_id: agentId,
    run_id: runId,
    kind,
    content_hash: contentHash,
    source_type: sourceType,
    source_ref: sourceRef,
    source_id: sourceId,
    trust,
    visibility,
    occurred_at: occurredAt,
  })) : null;
  const existing = canonicalHash ? await first<ObservationReplayRow>(ctx.app.db,
    `SELECT id, subject_id, project_id, workspace_id, agent_id, run_id, kind,
            trust, visibility, content_hash, occurred_at, ingested_at
       FROM observations
      WHERE org_id = ? AND actor_id = ? AND canonical_hash = ? LIMIT 1`,
    [principal.orgId, principal.principalId, canonicalHash]) : undefined;
  if (existing) return { status: 200, data: replayData(existing), meta: { replayed: true } };

  try {
    const result = await commitIdempotent(
    ctx.app.db,
    principal,
    ctx.request,
    idempotencyKey(ctx.request),
    raw,
    ctx.app.now(),
    async () => {
      const id = newId("obs");
      const ingestedAt = ctx.app.now().toISOString();
      const enrichment = ctx.app.extraction
        ? [await derivationJobStatement(ctx.app.db, ctx.app.extraction, {
            id,
            orgId: principal.orgId,
            subjectId,
            projectId,
            workspaceId,
            actorId: principal.principalId,
            kind,
            contentHash,
            trust,
            visibility,
            occurredAt,
            at: ingestedAt,
          })]
        : [];
      const data = {
        observation_id: id,
        subject_id: subjectId,
        project_id: projectId,
        agent_id: agentId,
        run_id: runId,
        kind,
        trust,
        visibility,
        workspace_id: workspaceId,
        content_hash: contentHash,
        occurred_at: occurredAt,
        ingested_at: ingestedAt,
      };
      return {
        status: 201,
        data,
        statements: [
          {
            sql: `INSERT OR IGNORE INTO subjects
                    (id, org_id, type, label, status, created_by, created_at, updated_at)
                  VALUES (?, ?, 'concept', ?, 'active', ?, ?, ?)`,
            params: [subjectId, principal.orgId, subjectId, principal.principalId, ingestedAt, ingestedAt],
          },
          {
            sql: `INSERT INTO observations
                    (id, org_id, subject_id, project_id, workspace_id, agent_id, run_id, actor_id, kind, content,
                     content_hash, canonical_hash, source_type, source_ref, trust, visibility, occurred_at, ingested_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
              id,
              principal.orgId,
              subjectId,
              projectId,
              workspaceId,
              agentId,
              runId,
              principal.principalId,
              kind,
              content,
              contentHash,
              canonicalHash,
              sourceType,
              sourceRef,
              trust,
              visibility,
              occurredAt,
              ingestedAt,
            ],
          },
          {
            sql: `INSERT INTO observations_fts
                    (content, observation_id, org_scope, subject_scope)
                  VALUES (?, ?, lower(hex(?)) || '0', lower(hex(?)) || '0')`,
            params: [content, id, principal.orgId, subjectId],
          },
          historyStatement(
            principal.orgId,
            "observation",
            id,
            1,
            "append",
            principal.principalId,
            contentHash,
            ingestedAt,
          ),
          ...enrichment,
          ...(ctx.app.vectors
            ? [outboxStatement(principal.orgId, "observation", id, "upsert", ingestedAt)]
            : []),
          eventStatement(
            principal.orgId,
            "observation.appended",
            principal.principalId,
            "observation",
            id,
            { subject_id: subjectId, workspace_id: workspaceId, kind, trust, visibility },
            ingestedAt,
          ),
        ],
      };
    },
    );

    return {
      status: result.replayed ? 200 : result.status,
      data: result.data,
      meta: { replayed: result.replayed },
    };
  } catch (error) {
    if (canonicalHash && error instanceof Error && /UNIQUE.*canonical_hash/i.test(error.message)) {
      const raced = await first<ObservationReplayRow>(ctx.app.db,
        `SELECT id, subject_id, project_id, workspace_id, agent_id, run_id, kind,
                trust, visibility, content_hash, occurred_at, ingested_at
           FROM observations
          WHERE org_id = ? AND actor_id = ? AND canonical_hash = ? LIMIT 1`,
        [principal.orgId, principal.principalId, canonicalHash]);
      if (raced) return { status: 200, data: replayData(raced), meta: { replayed: true } };
    }
    throw error;
  }
}

/** Irreversibly removes readable evidence while retaining provenance hashes. */
export async function purgeObservation(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const observationId = ctx.params.id!;
  const observation = await first<{ id: string; content_hash: string }>(
    ctx.app.db,
    `SELECT o.id, o.content_hash FROM observations o
      WHERE o.id = ? AND o.org_id = ? AND ${recordAccessSql("o", "?", "write")}`,
    [observationId, principal.orgId, ...recordAccessParams(principal)],
  );
  if (!observation) throw notFound();
  const hold = await first<{ id: string }>(
    ctx.app.db,
    `SELECT h.id FROM legal_holds h
      WHERE h.org_id = ? AND h.released_at IS NULL
        AND (
          (h.resource_type = 'observation' AND h.resource_id = ?)
          OR (
            h.resource_type = 'claim'
            AND EXISTS (
              SELECT 1 FROM claim_sources s
              JOIN claims c ON c.id = s.claim_id AND c.org_id = h.org_id
               WHERE s.observation_id = ? AND s.claim_id = h.resource_id
            )
          )
        ) LIMIT 1`,
    [principal.orgId, observationId, observationId],
  );
  if (hold) throw conflict("Observation or a dependent claim is protected by an active legal hold.");

  const previousPurge = await first<{ version: number }>(
    ctx.app.db,
    `SELECT version FROM record_history
      WHERE org_id = ? AND record_type = 'observation' AND record_id = ? AND change_kind = 'purge'
      ORDER BY version DESC LIMIT 1`,
    [principal.orgId, observationId],
  );
  const at = ctx.app.now().toISOString();
  const marker = redactedObservationContent(observation.content_hash);
  const claimSnapshotHash = await sha256Hex(`${REDACTED_CLAIM_STATEMENT}|revoked`);
  const notPurged = `NOT EXISTS (
    SELECT 1 FROM record_history h
     WHERE h.org_id = ? AND h.record_type = 'observation'
       AND h.record_id = ? AND h.change_kind = 'purge'
  )`;
  const dependentClaim = `EXISTS (
    SELECT 1 FROM claim_sources s WHERE s.claim_id = c.id AND s.observation_id = ?
  )`;
  const statements: Stmt[] = [
    {
      sql: `UPDATE observations SET content = ?
             WHERE id = ? AND org_id = ? AND ${notPurged}`,
      params: [marker, observationId, principal.orgId, principal.orgId, observationId],
    },
    {
      sql: `DELETE FROM observations_fts WHERE observation_id = ?`,
      params: [observationId],
    },
    ...(ctx.app.vectors ? [
      {
        sql: `UPDATE index_outbox
                 SET state = 'done', lease_token = NULL, lease_expires_at = NULL
               WHERE org_id = ? AND record_type = 'observation' AND record_id = ?
                 AND operation = 'upsert' AND state = 'pending'`,
        params: [principal.orgId, observationId],
      },
      {
        sql: `INSERT INTO index_outbox
                (id, org_id, record_type, record_id, operation, state, attempts, created_at)
              SELECT ?, ?, 'observation', ?, 'delete', 'pending', 0, ? WHERE ${notPurged}`,
        params: [newId("obx"), principal.orgId, observationId, at, principal.orgId, observationId],
      },
    ] : []),
    {
      sql: `INSERT INTO events
              (id, org_id, kind, actor_id, resource_type, resource_id, payload, created_at)
            SELECT ?, ?, 'observation.purged', ?, 'observation', ?, ?, ? WHERE ${notPurged}`,
      params: [
        newId("evt"), principal.orgId, principal.principalId, observationId,
        '{"reason":"operator_purge"}', at, principal.orgId, observationId,
      ],
    },
    {
      sql: `INSERT INTO audit_log
              (id, org_id, actor_id, action, resource_type, resource_id, detail, ip_hint, created_at)
            SELECT ?, ?, ?, 'observation.purge', 'observation', ?, 'reason=operator_purge', NULL, ?
             WHERE ${notPurged}`,
      params: [newId("aud"), principal.orgId, principal.principalId, observationId, at, principal.orgId, observationId],
    },
    {
      sql: `INSERT INTO lifecycle_fences (claim_id, expected_version, created_at)
            SELECT c.id, c.version, ? FROM claims c
             WHERE c.org_id = ? AND ${dependentClaim}
               AND (c.status != 'revoked' OR c.statement != ?)`,
      params: [at, principal.orgId, observationId, REDACTED_CLAIM_STATEMENT],
    },
    {
      sql: `INSERT INTO record_history
              (id, org_id, record_type, record_id, version, change_kind, actor_id, snapshot_hash, changed_at)
            SELECT ?, ?, 'observation', ?,
                   COALESCE((SELECT MAX(version) + 1 FROM record_history
                              WHERE org_id = ? AND record_type = 'observation' AND record_id = ?), 1),
                   'purge', ?, ?, ?
             WHERE ${notPurged}`,
      params: [
        newId("hist"), principal.orgId, observationId, principal.orgId, observationId,
        principal.principalId, observation.content_hash, at, principal.orgId, observationId,
      ],
    },
    {
      sql: `INSERT INTO record_history
              (id, org_id, record_type, record_id, version, change_kind, actor_id, snapshot_hash, changed_at)
            SELECT 'hist_' || lower(hex(randomblob(16))), c.org_id, 'claim', c.id, c.version + 1,
                   'evidence_purged', ?, ?, ?
              FROM claims c
             WHERE c.org_id = ? AND ${dependentClaim}
               AND (c.status != 'revoked' OR c.statement != ?)`,
      params: [principal.principalId, claimSnapshotHash, at, principal.orgId, observationId, REDACTED_CLAIM_STATEMENT],
    },
    ...(ctx.app.vectors ? [
      {
        sql: `UPDATE index_outbox
                 SET state = 'done', lease_token = NULL, lease_expires_at = NULL
               WHERE org_id = ? AND record_type = 'claim' AND state = 'pending'
                 AND operation = 'upsert'
                 AND record_id IN (
                   SELECT c.id FROM claims c WHERE c.org_id = ? AND ${dependentClaim}
                 )`,
        params: [principal.orgId, principal.orgId, observationId],
      },
      {
        sql: `INSERT INTO index_outbox
                (id, org_id, record_type, record_id, operation, state, attempts, created_at)
              SELECT 'obx_' || lower(hex(randomblob(16))), c.org_id, 'claim', c.id,
                     'delete', 'pending', 0, ?
                FROM claims c
               WHERE c.org_id = ? AND ${dependentClaim}
                 AND (c.status != 'revoked' OR c.statement != ?)`,
        params: [at, principal.orgId, observationId, REDACTED_CLAIM_STATEMENT],
      },
    ] : []),
    {
      sql: `INSERT INTO events
              (id, org_id, kind, actor_id, resource_type, resource_id, payload, created_at)
            SELECT 'evt_' || lower(hex(randomblob(16))), c.org_id, 'claim.revoked', ?,
                   'claim', c.id, '{"reason":"evidence_purged"}', ?
              FROM claims c
             WHERE c.org_id = ? AND ${dependentClaim}
               AND (c.status != 'revoked' OR c.statement != ?)`,
      params: [principal.principalId, at, principal.orgId, observationId, REDACTED_CLAIM_STATEMENT],
    },
    {
      sql: `DELETE FROM claims_fts
             WHERE claim_id IN (
               SELECT c.id FROM claims c WHERE c.org_id = ? AND ${dependentClaim}
             )`,
      params: [principal.orgId, observationId],
    },
    {
      sql: `UPDATE claims AS c SET statement = ?, status = 'revoked', version = version + 1
             WHERE c.org_id = ? AND ${dependentClaim}
               AND (c.status != 'revoked' OR c.statement != ?)`,
      params: [REDACTED_CLAIM_STATEMENT, principal.orgId, observationId, REDACTED_CLAIM_STATEMENT],
    },
  ];

  try {
    await ctx.app.db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /ACTIVE_LEGAL_HOLD/i.test(error.message))
      throw conflict("Observation or a dependent claim is protected by an active legal hold.");
    throw error;
  }
  const dependent = await first<{ count: number }>(
    ctx.app.db,
    `SELECT COUNT(*) AS count FROM claims c
      WHERE c.org_id = ? AND ${dependentClaim}
        AND c.status = 'revoked' AND c.statement = ?`,
    [principal.orgId, observationId, REDACTED_CLAIM_STATEMENT],
  );
  return {
    data: {
      observation_id: observationId,
      purged: true,
      already_purged: Boolean(previousPurge),
      content_hash: observation.content_hash,
      dependent_claims_redacted: Number(dependent?.count ?? 0),
    },
  };
}
