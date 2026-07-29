import { first } from "./db";
import { notFound, validationError } from "./errors";
import { newId, sha256Hex } from "./ids";
import type { RequestContext, Result } from "./http";
import {
  LIMITS,
  optionalString,
  requireInteger,
  requireObject,
  requireString,
} from "./validate";

const CHECKPOINT_KINDS = [
  "task_state",
  "conversation",
  "workflow",
  "cursor",
] as const;

const MAX_STATE_BYTES = 64_000;
const MAX_TTL = 86400 * 30; // 30 days
const MIN_TTL = 60; // 1 minute

export async function saveCheckpoint(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const subjectId = requireString(body, "subject_id", LIMITS.identifier);
  const agentId = optionalString(body, "agent_id", LIMITS.identifier) ?? principal.principalId;
  const runId = optionalString(body, "run_id", LIMITS.identifier);
  const kind = requireString(body, "kind", LIMITS.label);
  if (!CHECKPOINT_KINDS.includes(kind as never))
    throw validationError(`Field "kind" must be one of: ${CHECKPOINT_KINDS.join(", ")}.`);
  const state = body.state;
  if (state === undefined || state === null)
    throw validationError('Field "state" is required.');
  const serialized = JSON.stringify(state);
  if (serialized.length > MAX_STATE_BYTES)
    throw validationError(`Checkpoint state exceeds ${MAX_STATE_BYTES} bytes.`);
  const ttlSeconds = requireInteger(body, "ttl_seconds", MIN_TTL, MAX_TTL);

  const now = ctx.app.now();
  const at = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const stateHash = await sha256Hex(serialized);

  // Upsert: same org+subject+agent+kind replaces the previous checkpoint.
  const existing = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM checkpoints
       WHERE org_id = ? AND subject_id = ? AND agent_id = ? AND kind = ?`,
    [principal.orgId, subjectId, agentId, kind],
  );

  if (existing) {
    await ctx.app.db.batch([{
      sql: `UPDATE checkpoints
              SET state = ?, state_hash = ?, run_id = ?, ttl_seconds = ?,
                  expires_at = ?, updated_at = ?
            WHERE id = ?`,
      params: [serialized, stateHash, runId, ttlSeconds, expiresAt, at, existing.id],
    }]);
    return {
      data: {
        checkpoint_id: existing.id,
        subject_id: subjectId,
        agent_id: agentId,
        kind,
        state_hash: stateHash,
        expires_at: expiresAt,
        updated: true,
      },
    };
  }

  const id = newId("ckpt");
  await ctx.app.db.batch([{
    sql: `INSERT INTO checkpoints
            (id, org_id, subject_id, agent_id, run_id, kind, state, state_hash,
             ttl_seconds, expires_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      id, principal.orgId, subjectId, agentId, runId, kind,
      serialized, stateHash, ttlSeconds, expiresAt, at, at,
    ],
  }]);

  return {
    status: 201,
    data: {
      checkpoint_id: id,
      subject_id: subjectId,
      agent_id: agentId,
      kind,
      state_hash: stateHash,
      expires_at: expiresAt,
      updated: false,
    },
  };
}

export async function getCheckpoint(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const subjectId = ctx.url.searchParams.get("subject_id");
  const agentId = ctx.url.searchParams.get("agent_id") ?? principal.principalId;
  const kind = ctx.url.searchParams.get("kind");
  if (!subjectId) throw validationError('Query "subject_id" is required.');
  if (!kind) throw validationError('Query "kind" is required.');

  const now = ctx.app.now().toISOString();
  const row = await first<{
    id: string; subject_id: string; agent_id: string; run_id: string | null;
    kind: string; state: string; state_hash: string; ttl_seconds: number;
    expires_at: string; created_at: string; updated_at: string;
  }>(
    ctx.app.db,
    `SELECT id, subject_id, agent_id, run_id, kind, state, state_hash,
            ttl_seconds, expires_at, created_at, updated_at
       FROM checkpoints
      WHERE org_id = ? AND subject_id = ? AND agent_id = ? AND kind = ?
        AND expires_at > ?`,
    [principal.orgId, subjectId, agentId, kind, now],
  );
  if (!row) throw notFound();

  return {
    data: {
      checkpoint_id: row.id,
      subject_id: row.subject_id,
      agent_id: row.agent_id,
      run_id: row.run_id,
      kind: row.kind,
      state: JSON.parse(row.state),
      state_hash: row.state_hash,
      ttl_seconds: row.ttl_seconds,
      expires_at: row.expires_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  };
}

export async function deleteCheckpoint(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const checkpointId = ctx.params.id!;

  const row = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM checkpoints WHERE id = ? AND org_id = ?`,
    [checkpointId, principal.orgId],
  );
  if (!row) throw notFound();

  await ctx.app.db.batch([{
    sql: `DELETE FROM checkpoints WHERE id = ? AND org_id = ?`,
    params: [checkpointId, principal.orgId],
  }]);

  return { data: { checkpoint_id: checkpointId, deleted: true } };
}
