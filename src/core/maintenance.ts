import type { Db } from "./db";
import { processWebhooks } from "./webhooks";
import type { VectorCapability } from "./vectors";
import type { WebhookSecurity } from "./webhook-security";
import type { SecretCipher } from "./secrets";
import { eventAccessSql } from "./events";

/**
 * Background maintenance: the work that must happen for configured features to
 * actually function, rather than waiting for an operator to remember.
 *
 * Neither job can run inside a canonical write. Embedding calls a model and
 * delivery calls someone else's server, so both are pulled from a queue after the
 * fact. Before this existed a deployment with a vector capability searched a
 * permanently empty index, and a registered webhook never received anything,
 * unless something external called the drain endpoints on a schedule.
 *
 * ponytail: one pass over every organization per tick, ordered by queue age and
 * bounded per tick. The ceiling is that a very busy tenant can delay others
 * within a tick; the upgrade path is per-organization cursors, which the outbox
 * schema already supports.
 */
export interface MaintenanceResult {
  indexed: number;
  delivered: number;
  errors: string[];
}

export type BackgroundRepairState = "enabled" | "stale" | "disabled";

/** Cheap canonical scheduler evidence for readiness; never performs network I/O. */
export async function backgroundRepairState(options: {
  db: Db;
  configured: boolean;
  now: Date;
  staleAfterMs: number;
}): Promise<BackgroundRepairState> {
  if (!options.configured) return "disabled";
  let rows: Array<{
    last_success_at: string | null;
    last_error_at: string | null;
    expected_interval_ms: number;
  }>;
  try {
    rows = await options.db.all(
      `SELECT last_success_at, last_error_at, expected_interval_ms
         FROM maintenance_state WHERE id = 'background'`,
    );
  } catch {
    return "stale";
  }
  const row = rows[0];
  if (!row) return "stale";
  if (!row.last_success_at) return "stale";
  const success = Date.parse(row.last_success_at);
  const error = row.last_error_at ? Date.parse(row.last_error_at) : 0;
  if (
    !Number.isFinite(success) ||
    (row.last_error_at !== null && (!Number.isFinite(error) || error >= success))
  ) return "stale";
  const recorded = Number(row.expected_interval_ms);
  const staleAfter = Math.min(
    86_400_000,
    Math.max(options.staleAfterMs, Number.isFinite(recorded) ? recorded * 3 : 0),
  );
  return options.now.getTime() - success <= staleAfter ? "enabled" : "stale";
}

async function recordMaintenance(
  db: Db,
  result: MaintenanceResult,
  now: Date,
  expectedIntervalMs: number,
): Promise<void> {
  const timestamp = now.toISOString();
  const success = result.errors.length === 0 ? timestamp : null;
  const error = result.errors.length === 0 ? null : timestamp;
  await db.batch([
    {
      sql: `INSERT INTO maintenance_state
              (id, last_attempt_at, last_success_at, last_error_at, indexed, delivered, expected_interval_ms)
            VALUES ('background', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              last_attempt_at = excluded.last_attempt_at,
              last_success_at = CASE
                WHEN excluded.last_success_at IS NULL THEN maintenance_state.last_success_at
                ELSE excluded.last_success_at
              END,
              last_error_at = excluded.last_error_at,
              indexed = excluded.indexed,
              delivered = excluded.delivered,
              expected_interval_ms = excluded.expected_interval_ms`,
      params: [
        timestamp,
        success,
        error,
        result.indexed,
        result.delivered,
        Math.max(1, Math.floor(expectedIntervalMs)),
      ],
    },
  ]);
}

/** Organizations with queued indexing work, oldest queue first. */
async function orgsWithPendingIndex(db: Db, limit: number): Promise<string[]> {
  const rows = await db.all<{ org_id: string }>(
    `SELECT org_id FROM index_outbox WHERE state = 'pending'
      GROUP BY org_id ORDER BY MIN(created_at) LIMIT ?`,
    [limit],
  );
  return rows.map((row) => row.org_id);
}

/**
 * Embeds and indexes queued claims for one organization.
 *
 * Rows are marked done only after the index write succeeds, so a model outage
 * leaves them queued for the next tick instead of dropping them.
 */
export async function indexPendingForOrg(
  db: Db,
  orgId: string,
  vectors: VectorCapability,
  limit: number,
): Promise<number> {
  const pending = await db.all<{ id: string; record_type: string; record_id: string; operation: string }>(
    `SELECT id, record_type, record_id, operation FROM index_outbox
      WHERE org_id = ? AND state = 'pending'
      ORDER BY created_at, id LIMIT ?`,
    [orgId, limit],
  );
  if (pending.length === 0) return 0;

  // Only claims are retrievable, so only claims need an embedding. Anything else
  // is retired so the queue cannot grow without bound.
  const retire: string[] = [];
  const removals: { outboxId: string; recordId: string }[] = [];
  const eligible: {
    outboxId: string;
    claimId: string;
    statement: string;
    subjectId: string;
    projectId: string | null;
  }[] = [];
  for (const row of pending) {
    if (row.operation === "delete") {
      removals.push({ outboxId: row.id, recordId: row.record_id });
      continue;
    }
    if (row.record_type !== "claim") {
      retire.push(row.id);
      continue;
    }
    const claim = await db.all<{
      statement: string;
      status: string;
      subject_id: string;
      project_id: string | null;
    }>(
      `SELECT statement, status, subject_id, project_id
         FROM claims WHERE id = ? AND org_id = ?`,
      [row.record_id, orgId],
    );
    const found = claim[0];
    // A claim superseded or expired since it was queued is no longer retrievable.
    if (found && (found.status === "active" || found.status === "disputed"))
      eligible.push({
        outboxId: row.id,
        claimId: row.record_id,
        statement: found.statement,
        subjectId: found.subject_id,
        projectId: found.project_id,
      });
    else removals.push({ outboxId: row.id, recordId: row.record_id });
  }

  if (removals.length > 0)
    await vectors.store.remove([...new Set(removals.map((entry) => entry.recordId))]);

  let indexed = 0;
  if (eligible.length > 0) {
    const embeddings = await vectors.embedder.embed(eligible.map((entry) => entry.statement));
    await vectors.store.upsert(
      eligible.map((entry, index) => ({
        id: entry.claimId,
        vector: embeddings[index]!,
        metadata: {
          org_id: orgId,
          subject_id: entry.subjectId,
          project_id: entry.projectId ?? "",
        },
      })),
    );
    indexed = eligible.length;
  }

  const done = [...eligible.map((entry) => entry.outboxId), ...removals.map((entry) => entry.outboxId), ...retire];
  for (let index = 0; index < done.length; index += 50)
    await db.batch(
      done.slice(index, index + 50).map((id) => ({
        sql: `UPDATE index_outbox SET state = 'done', attempts = attempts + 1 WHERE id = ?`,
        params: [id],
      })),
    );

  return indexed;
}

/**
 * Delivers events recorded since the last delivery for each organization with an
 * active webhook. Uses the webhook's own last_delivery_at as the watermark so a
 * restart does not replay history.
 */
async function deliverPending(
  db: Db,
  limit: number,
  now: Date,
  security?: WebhookSecurity,
  cipher?: SecretCipher,
): Promise<{ delivered: number; errors: string[] }> {
  const nowString = now.toISOString();
  const orgs = await db.all<{ org_id: string }>(
    `SELECT org_id FROM (
       SELECT w.org_id, COALESCE(d.next_retry_at, d.created_at) AS due_at
         FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
        WHERE w.status = 'active' AND w.principal_id IS NOT NULL
          AND d.status = 'pending'
          AND (d.next_retry_at IS NULL OR d.next_retry_at <= ?)
          AND (d.lease_expires_at IS NULL OR d.lease_expires_at <= ?)
       UNION ALL
       SELECT w.org_id, e.created_at AS due_at
         FROM webhooks w JOIN events e ON e.org_id = w.org_id
        WHERE w.status = 'active' AND w.principal_id IS NOT NULL
          AND ${eventAccessSql("e", "w.principal_id")}
          AND w.created_at <= e.created_at
          AND ((',' || w.events || ',') LIKE '%,*,%' OR (',' || w.events || ',') LIKE '%,' || e.kind || ',%')
          AND NOT EXISTS (
            SELECT 1 FROM webhook_deliveries d
             WHERE d.webhook_id = w.id AND d.event_id = e.id
          )
     ) work GROUP BY org_id ORDER BY MIN(due_at), org_id LIMIT 20`,
    [nowString, nowString],
  );
  let delivered = 0;
  const errors: string[] = [];
  for (const { org_id: orgId } of orgs) {
    try {
      const result = await processWebhooks({ db, orgId, now, limit, security, cipher });
      delivered += result.delivered;
    } catch {
      errors.push(`deliver:${orgId.slice(0, 12)}`);
    }
  }
  return { delivered, errors };
}

/** Delete only bounded, expired execution bookkeeping; canonical history stays append-only. */
async function sweepEphemeral(db: Db, now: Date, limit: number): Promise<void> {
  const at = now.toISOString();
  await db.batch([
    {
      sql: `DELETE FROM idempotency_v3
             WHERE (org_id, principal_id, key_hash) IN (
               SELECT org_id, principal_id, key_hash FROM idempotency_v3
                WHERE expires_at <= ?
                ORDER BY expires_at, org_id, principal_id, key_hash LIMIT ?
             )`,
      params: [at, limit],
    },
    {
      sql: `UPDATE handoffs SET checkpoint_id = NULL
             WHERE checkpoint_id IN (
               SELECT id FROM checkpoints WHERE expires_at <= ?
                ORDER BY expires_at, id LIMIT ?
             )`,
      params: [at, limit],
    },
    {
      sql: `DELETE FROM checkpoints WHERE id IN (
              SELECT id FROM checkpoints WHERE expires_at <= ?
               ORDER BY expires_at, id LIMIT ?
            )`,
      params: [at, limit],
    },
    {
      sql: `DELETE FROM leases WHERE id IN (
              SELECT id FROM leases
               WHERE released_at IS NOT NULL OR expires_at <= ?
               ORDER BY COALESCE(released_at, expires_at), id LIMIT ?
            )`,
      params: [at, limit],
    },
  ]);
}

/** One maintenance pass. Never throws: a bad tenant must not stop the others. */
export async function runMaintenance(options: {
  db: Db;
  vectors?: VectorCapability;
  limit?: number;
  now?: Date;
  webhookSecurity?: WebhookSecurity;
  secretCipher?: SecretCipher;
  deliverWebhooks?: boolean;
  expectedIntervalMs?: number;
}): Promise<MaintenanceResult> {
  const limit = options.limit ?? 50;
  const now = options.now ?? new Date();
  const result: MaintenanceResult = { indexed: 0, delivered: 0, errors: [] };

  if (options.vectors) {
    try {
      for (const orgId of await orgsWithPendingIndex(options.db, 20)) {
        try {
          result.indexed += await indexPendingForOrg(
            options.db,
            orgId,
            options.vectors,
            limit,
          );
        } catch (error) {
          // Named by organization, without the message, which can carry content.
          result.errors.push(`index:${orgId.slice(0, 12)}`);
        }
      }
    } catch {
      result.errors.push("index:scan");
    }
  }

  if (options.deliverWebhooks !== false) {
    try {
      const delivery = await deliverPending(
        options.db,
        limit,
        now,
        options.webhookSecurity,
        options.secretCipher,
      );
      result.delivered = delivery.delivered;
      result.errors.push(...delivery.errors);
    } catch {
      result.errors.push("deliver:scan");
    }
  }

  try {
    await sweepEphemeral(options.db, now, limit);
  } catch {
    result.errors.push("cleanup");
  }

  try {
    await recordMaintenance(
      options.db,
      result,
      now,
      options.expectedIntervalMs ?? 60_000,
    );
  } catch {
    result.errors.push("state");
  }

  return result;
}
