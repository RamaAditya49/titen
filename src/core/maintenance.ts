import type { Db } from "./db";
import { deliverEvent, type Fetcher } from "./webhooks";
import type { VectorCapability } from "./vectors";

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
  const pending = await db.all<{ id: string; record_type: string; record_id: string }>(
    `SELECT id, record_type, record_id FROM index_outbox
      WHERE org_id = ? AND state = 'pending'
      ORDER BY created_at, id LIMIT ?`,
    [orgId, limit],
  );
  if (pending.length === 0) return 0;

  // Only claims are retrievable, so only claims need an embedding. Anything else
  // is retired so the queue cannot grow without bound.
  const retire: string[] = [];
  const eligible: { outboxId: string; claimId: string; statement: string }[] = [];
  for (const row of pending) {
    if (row.record_type !== "claim") {
      retire.push(row.id);
      continue;
    }
    const claim = await db.all<{ statement: string; status: string }>(
      `SELECT statement, status FROM claims WHERE id = ? AND org_id = ?`,
      [row.record_id, orgId],
    );
    const found = claim[0];
    // A claim superseded or expired since it was queued is no longer retrievable.
    if (found && (found.status === "active" || found.status === "disputed"))
      eligible.push({ outboxId: row.id, claimId: row.record_id, statement: found.statement });
    else retire.push(row.id);
  }

  let indexed = 0;
  if (eligible.length > 0) {
    const embeddings = await vectors.embedder.embed(eligible.map((entry) => entry.statement));
    await vectors.store.upsert(
      eligible.map((entry, index) => ({
        id: entry.claimId,
        vector: embeddings[index]!,
        metadata: { org_id: orgId },
      })),
    );
    indexed = eligible.length;
  }

  const done = [...eligible.map((entry) => entry.outboxId), ...retire];
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
  fetcher: Fetcher,
): Promise<number> {
  const orgs = await db.all<{ org_id: string }>(
    `SELECT DISTINCT org_id FROM webhooks WHERE status = 'active'`,
  );
  let delivered = 0;
  for (const { org_id: orgId } of orgs) {
    // Events with no delivery attempt yet, matched by event id. Matching on kind
    // instead is what limited delivery to the first event of each kind.
    const events = await db.all<{ id: string; kind: string; payload: string }>(
      `SELECT e.id, e.kind, e.payload FROM events e
        WHERE e.org_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM webhook_deliveries d
              JOIN webhooks w ON w.id = d.webhook_id
             WHERE w.org_id = e.org_id AND d.event_id = e.id
          )
        ORDER BY e.created_at, e.id LIMIT ?`,
      [orgId, limit],
    );
    for (const event of events) {
      await deliverEvent(
        db,
        orgId,
        { id: event.id, kind: event.kind },
        JSON.parse(event.payload),
        now,
        fetcher,
      );
      delivered += 1;
    }
  }
  return delivered;
}

/** One maintenance pass. Never throws: a bad tenant must not stop the others. */
export async function runMaintenance(options: {
  db: Db;
  vectors?: VectorCapability;
  limit?: number;
  now?: Date;
  fetcher?: Fetcher;
  deliverWebhooks?: boolean;
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
      result.delivered = await deliverPending(
        options.db,
        limit,
        now,
        options.fetcher ?? globalThis.fetch,
      );
    } catch {
      result.errors.push("deliver");
    }
  }

  return result;
}
