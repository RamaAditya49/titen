import { first } from "./db";
import { unavailable, validationError } from "./errors";
import type { RequestContext, Result } from "./http";

/**
 * Drains the indexing outbox into the vector store.
 *
 * Every canonical write queues an outbox row. Until something consumes them the
 * vector index stays empty, which means semantic retrieval can never find
 * anything no matter how well configured it is. This is that consumer.
 *
 * It is pull-driven for the same reason webhook delivery is: embedding calls a
 * model over the network, and a canonical write must not wait on one. An
 * operator runs this from a cron trigger or a timer.
 *
 * ponytail: claims only, and re-embeds a claim's current statement rather than
 * tracking which version was indexed. The ceiling is wasted embedding calls when
 * a claim is written repeatedly; the upgrade path is storing the indexed
 * statement hash on the outbox row and skipping unchanged ones.
 */
const MAX_BATCH = 100;

export async function drainIndex(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  if (!ctx.app.vectors)
    throw validationError("No vector capability is configured on this deployment.");

  const limitParam = Number(ctx.url.searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limitParam) || limitParam < 1 || limitParam > MAX_BATCH)
    throw validationError(`Query "limit" must be an integer between 1 and ${MAX_BATCH}.`);

  // Only claims are searchable, so only claims need vectors. Other record types
  // are marked done so the queue cannot grow without bound.
  const pending = await ctx.app.db.all<{
    id: string;
    record_type: string;
    record_id: string;
    operation: string;
  }>(
    `SELECT id, record_type, record_id, operation FROM index_outbox
      WHERE org_id = ? AND state = 'pending'
      ORDER BY created_at, id LIMIT ?`,
    [principal.orgId, limitParam],
  );
  if (pending.length === 0)
    return { data: { drained: 0, indexed: 0, skipped: 0, remaining: 0 } };

  const claimRows = pending.filter((row) => row.record_type === "claim" && row.operation !== "delete");
  const removals = pending.filter((row) => row.operation === "delete");
  const others = pending.filter((row) => row.record_type !== "claim" && row.operation !== "delete");

  // A claim may have been superseded or expired since it was queued; only
  // retrievable claims are worth an embedding call.
  const eligible: {
    outboxId: string;
    claimId: string;
    statement: string;
    subjectId: string;
    projectId: string | null;
  }[] = [];
  for (const row of claimRows) {
    const claim = await first<{
      statement: string;
      status: string;
      subject_id: string;
      project_id: string | null;
    }>(
      ctx.app.db,
      `SELECT statement, status, subject_id, project_id
         FROM claims WHERE id = ? AND org_id = ?`,
      [row.record_id, principal.orgId],
    );
    if (claim && (claim.status === "active" || claim.status === "disputed"))
      eligible.push({
        outboxId: row.id,
        claimId: row.record_id,
        statement: claim.statement,
        subjectId: claim.subject_id,
        projectId: claim.project_id,
      });
    else removals.push(row);
  }

  if (removals.length > 0) {
    try {
      await ctx.app.vectors.store.remove([...new Set(removals.map((row) => row.record_id))]);
    } catch {
      throw unavailable("Indexing dependency is unavailable.", {
        dependency: "vector_store",
        retryable: true,
        pending: pending.length,
      });
    }
  }

  let indexed = 0;
  if (eligible.length > 0) {
    // One embedding request for the batch, then one index write.
    let vectors;
    try {
      vectors = await ctx.app.vectors.embedder.embed(
        eligible.map((entry) => entry.statement),
      );
    } catch {
      throw unavailable("Indexing dependency is unavailable.", {
        dependency: "embedder",
        retryable: true,
        pending: pending.length,
      });
    }
    try {
      await ctx.app.vectors.store.upsert(
        eligible.map((entry, index) => ({
          id: entry.claimId,
          vector: vectors[index]!,
          metadata: {
            org_id: principal.orgId,
            subject_id: entry.subjectId,
            project_id: entry.projectId ?? "",
          },
        })),
      );
    } catch {
      throw unavailable("Indexing dependency is unavailable.", {
        dependency: "vector_store",
        retryable: true,
        pending: pending.length,
      });
    }
    indexed = eligible.length;
  }

  // Marked done only after the index write succeeded, so a failed batch is
  // retried rather than silently dropped.
  const done = [
    ...eligible.map((entry) => entry.outboxId),
    ...removals.map((row) => row.id),
    ...others.map((row) => row.id),
  ];
  const at = ctx.app.now().toISOString();
  for (let index = 0; index < done.length; index += 50) {
    const group = done.slice(index, index + 50);
    await ctx.app.db.batch(
      group.map((id) => ({
        sql: `UPDATE index_outbox SET state = 'done', attempts = attempts + 1 WHERE id = ?`,
        params: [id],
      })),
    );
  }

  const remaining = await first<{ count: number }>(
    ctx.app.db,
    `SELECT COUNT(*) AS count FROM index_outbox WHERE org_id = ? AND state = 'pending'`,
    [principal.orgId],
  );

  return {
    data: {
      drained: done.length,
      indexed,
      removed: removals.length,
      skipped: others.length,
      remaining: Number(remaining?.count ?? 0),
      model: ctx.app.vectors.embedder.model,
      dimensions: ctx.app.vectors.embedder.dimensions,
      at,
    },
  };
}
