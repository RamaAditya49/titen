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
  if (agentId !== principal.principalId) throw notFound();
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

  const id = newId("ckpt");
  const saved = await first<{ id: string; created: number }>(
    ctx.app.db,
    `INSERT INTO checkpoints
       (id, org_id, subject_id, agent_id, run_id, kind, state, state_hash,
        ttl_seconds, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, subject_id, agent_id, kind) DO UPDATE SET
       state = excluded.state,
       state_hash = excluded.state_hash,
       run_id = excluded.run_id,
       ttl_seconds = excluded.ttl_seconds,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at
     RETURNING id, id = ? AS created`,
    [
      id, principal.orgId, subjectId, agentId, runId, kind,
      serialized, stateHash, ttlSeconds, expiresAt, at, at, id,
    ],
  );
  if (!saved) throw new Error("Checkpoint upsert returned no row.");
  const created = Number(saved.created) === 1;

  return {
    status: created ? 201 : 200,
    data: {
      checkpoint_id: saved.id,
      subject_id: subjectId,
      agent_id: agentId,
      kind,
      state_hash: stateHash,
      expires_at: expiresAt,
      updated: !created,
    },
  };
}

export async function getCheckpoint(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const now = ctx.app.now().toISOString();
  const checkpointId = ctx.params.id;
  const subjectId = ctx.url.searchParams.get("subject_id");
  const agentId = ctx.url.searchParams.get("agent_id") ?? principal.principalId;
  const kind = ctx.url.searchParams.get("kind");
  if (!checkpointId && !subjectId)
    throw validationError('Query "subject_id" is required.');
  if (!checkpointId && !kind)
    throw validationError('Query "kind" is required.');

  const row = await first<{
    id: string; subject_id: string; agent_id: string; run_id: string | null;
    kind: string; state: string; state_hash: string; ttl_seconds: number;
    expires_at: string; created_at: string; updated_at: string;
  }>(
    ctx.app.db,
    `SELECT id, subject_id, agent_id, run_id, kind, state, state_hash,
            ttl_seconds, expires_at, created_at, updated_at
       FROM checkpoints
      WHERE org_id = ?
        AND (? IS NULL OR id = ?)
        AND (? IS NOT NULL OR (subject_id = ? AND agent_id = ? AND kind = ?))
        AND expires_at > ?`,
    [
      principal.orgId,
      checkpointId ?? null,
      checkpointId ?? null,
      checkpointId ?? null,
      subjectId,
      agentId,
      kind,
      now,
    ],
  );
  if (!row) throw notFound();

  if (row.agent_id !== principal.principalId) {
    const delegated = await first<{ present: number }>(
      ctx.app.db,
      `SELECT 1 AS present FROM handoffs
        WHERE org_id = ? AND to_principal = ? AND checkpoint_id = ?
          AND status IN ('pending', 'accepted')
        LIMIT 1`,
      [principal.orgId, principal.principalId, row.id],
    );
    if (!delegated) throw notFound();
  }

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
    `SELECT id FROM checkpoints WHERE id = ? AND org_id = ? AND agent_id = ?`,
    [checkpointId, principal.orgId, principal.principalId],
  );
  if (!row) throw notFound();

  await ctx.app.db.batch([{
    sql: `DELETE FROM checkpoints WHERE id = ? AND org_id = ? AND agent_id = ?`,
    params: [checkpointId, principal.orgId, principal.principalId],
  }]);

  return { data: { checkpoint_id: checkpointId, deleted: true } };
}
