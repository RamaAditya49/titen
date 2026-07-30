import { assertTrustCeiling } from "./auth";
import type { Stmt } from "./db";
import { eventStatement } from "./events";
import { validationError } from "./errors";
import { newId, sha256Hex } from "./ids";
import { commitIdempotent, idempotencyKey } from "./idempotency";
import { requireProject } from "./projects";
import type { RequestContext, Result } from "./http";
import {
  LIMITS,
  OBSERVATION_KINDS,
  TRUST_LEVELS,
  VISIBILITIES,
  isRecord,
  optionalEnum,
  optionalString,
  optionalTimestamp,
  requireEnum,
  requireObject,
  requireString,
} from "./validate";

export const ENDPOINT = "POST /v1/observations";

/**
 * P0 has no membership model yet, so `team` resolves to the authenticated
 * organization. `private` is enforced against the creating principal.
 */
const DEFAULT_VISIBILITY = "team";

export function historyStatement(
  orgId: string,
  recordType: string,
  recordId: string,
  version: number,
  changeKind: string,
  actorId: string,
  snapshotHash: string,
  at: string,
): Stmt {
  return {
    sql: `INSERT INTO record_history
            (id, org_id, record_type, record_id, version, change_kind, actor_id, snapshot_hash, changed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      newId("hist"),
      orgId,
      recordType,
      recordId,
      version,
      changeKind,
      actorId,
      snapshotHash,
      at,
    ],
  };
}

/**
 * Every canonical write queues its own reindex work. P0 ships no consumer
 * because vector retrieval is disabled.
 *
 * ponytail: an outbox without a worker. The ceiling is that rows only
 * accumulate; the upgrade path is the vector indexer in v0.1, which drains
 * `pending` rows and needs no schema change.
 */
export function outboxStatement(
  orgId: string,
  recordType: string,
  recordId: string,
  operation: string,
  at: string,
): Stmt {
  return {
    sql: `INSERT INTO index_outbox
            (id, org_id, record_type, record_id, operation, state, attempts, created_at)
          VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`,
    params: [newId("obx"), orgId, recordType, recordId, operation, at],
  };
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
  const agentId = optionalString(body, "agent_id", LIMITS.identifier);
  const runId = optionalString(body, "run_id", LIMITS.identifier);
  const occurredAt = optionalTimestamp(body, "occurred_at");
  const source = body.source;
  if (!isRecord(source)) throw validationError('Field "source" must be an object.');
  const sourceType = requireString(source, "type", LIMITS.label);
  const sourceRef = optionalString(source, "ref", LIMITS.identifier);

  // Trust is authority, not a payload field: a key cannot promote its evidence.
  assertTrustCeiling(principal, trust);
  const projectId = await requireProject(
    ctx.app.db,
    principal.orgId,
    optionalString(body, "project_id", LIMITS.identifier),
  );

  const result = await commitIdempotent(
    ctx.app.db,
    principal,
    ENDPOINT,
    idempotencyKey(ctx.request),
    raw,
    async () => {
      const id = newId("obs");
      const ingestedAt = ctx.app.now().toISOString();
      const contentHash = await sha256Hex(content);
      const data = {
        observation_id: id,
        subject_id: subjectId,
        project_id: projectId,
        agent_id: agentId,
        run_id: runId,
        kind,
        trust,
        visibility,
        content_hash: contentHash,
        occurred_at: occurredAt,
        ingested_at: ingestedAt,
      };
      return {
        status: 201,
        data,
        statements: [
          {
            sql: `INSERT INTO observations
                    (id, org_id, subject_id, project_id, agent_id, run_id, actor_id, kind, content,
                     content_hash, source_type, source_ref, trust, visibility, occurred_at, ingested_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
              id,
              principal.orgId,
              subjectId,
              projectId,
              agentId,
              runId,
              principal.principalId,
              kind,
              content,
              contentHash,
              sourceType,
              sourceRef,
              trust,
              visibility,
              occurredAt,
              ingestedAt,
            ],
          },
          {
            sql: `INSERT INTO observations_fts (content, observation_id) VALUES (?, ?)`,
            params: [content, id],
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
          outboxStatement(principal.orgId, "observation", id, "upsert", ingestedAt),
          eventStatement(
            principal.orgId,
            "observation.appended",
            principal.principalId,
            "observation",
            id,
            {
              subject_id: subjectId, project_id: projectId, agent_id: agentId, run_id: runId,
              kind, content, content_hash: contentHash, source_type: sourceType,
              source_ref: sourceRef, trust, visibility, occurred_at: occurredAt,
              external_actor_subject: principal.principalId,
            },
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
}
