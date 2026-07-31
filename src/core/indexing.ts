import { first } from "./db";
import { unavailable, validationError } from "./errors";
import type { RequestContext, Result } from "./http";
import {
  claimSemanticIndexWork,
  compensateStaleSemanticIndexWrites,
  completeSemanticIndexWork,
  completeSemanticIndexWrites,
  embedForRetrieval,
  prepareSemanticIndexWrites,
  preserveSemanticIndexReconciliation,
  recordSemanticDependencyFailure,
} from "./vectors";

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
  const at = ctx.app.now().toISOString();

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
        AND (lease_expires_at IS NULL OR lease_expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ORDER BY CASE WHEN operation = 'delete' THEN 0 ELSE 1 END, created_at, id
      LIMIT ?`,
    [principal.orgId, limitParam],
  );
  if (pending.length === 0) {
    const remaining = await first<{ count: number }>(
      ctx.app.db,
      `SELECT COUNT(*) AS count FROM index_outbox WHERE org_id = ? AND state = 'pending'`,
      [principal.orgId],
    );
    return {
      data: {
        drained: 0,
        indexed: 0,
        removed: 0,
        skipped: 0,
        remaining: Number(remaining?.count ?? 0),
      },
    };
  }

  const claimRows = pending.filter((row) => row.record_type === "claim" && row.operation !== "delete");
  const removals = pending.filter(
    (row) => row.record_type === "claim" && row.operation === "delete",
  );
  const others = pending.filter((row) => row.record_type !== "claim");

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

  const removalLease = await claimSemanticIndexWork(
    ctx.app.db,
    removals.map((row) => row.id),
  );
  const ownedRemovalIds = new Set(removalLease.ids);
  const ownedRemovals = removals.filter((row) => ownedRemovalIds.has(row.id));
  const preparedRemovals = await prepareSemanticIndexWrites(
    ctx.app.db,
    ownedRemovals.map((row) => ({ outboxId: row.id, recordId: row.record_id })),
    removalLease.token,
  );
  let removed = 0;
  if (preparedRemovals.length > 0) {
    try {
      await ctx.app.vectors.store.remove([
        ...new Set(preparedRemovals.map((write) => write.recordId)),
      ]);
    } catch {
      await recordSemanticDependencyFailure(
        ctx.app.db,
        "vector_store",
        removalLease.acquiredAt,
        preparedRemovals.map((write) => write.outboxId),
        removalLease.token,
      );
      await preserveSemanticIndexReconciliation(
        ctx.app.db,
        preparedRemovals,
        principal.orgId,
        removalLease.token,
      );
      throw unavailable("Indexing dependency is unavailable.", {
        dependency: "vector_store",
        retryable: true,
        pending: pending.length,
      });
    }
    const confirmed = new Set(await completeSemanticIndexWrites(
      ctx.app.db,
      preparedRemovals,
      "vector_store",
      removalLease.token,
    ));
    const stale = preparedRemovals.filter(({ outboxId }) => !confirmed.has(outboxId));
    await preserveSemanticIndexReconciliation(
      ctx.app.db,
      stale,
      principal.orgId,
      removalLease.token,
    );
    removed = confirmed.size;
  }

  let indexed = 0;
  const eligibleLease = await claimSemanticIndexWork(
    ctx.app.db,
    eligible.map((entry) => entry.outboxId),
  );
  const ownedEligibleIds = new Set(eligibleLease.ids);
  const ownedEligible = eligible.filter((entry) => ownedEligibleIds.has(entry.outboxId));
  if (ownedEligible.length > 0) {
    // One embedding request for the batch, then one index write.
    let vectors;
    try {
      vectors = await embedForRetrieval(
        ctx.app.vectors,
        "document",
        ownedEligible.map((entry) => entry.statement),
      );
    } catch {
      await recordSemanticDependencyFailure(
        ctx.app.db,
        "embedder",
        eligibleLease.acquiredAt,
        ownedEligible.map((entry) => entry.outboxId),
        eligibleLease.token,
      );
      throw unavailable("Indexing dependency is unavailable.", {
        dependency: "embedder",
        retryable: true,
        pending: pending.length,
      });
    }
    const prepared = await prepareSemanticIndexWrites(
      ctx.app.db,
      ownedEligible.map((entry) => ({
        outboxId: entry.outboxId,
        recordId: entry.claimId,
      })),
      eligibleLease.token,
    );
    const eligibleById = new Map(ownedEligible.map((entry, index) => [
      entry.outboxId,
      { entry, vector: vectors[index]! },
    ]));
    try {
      if (prepared.length > 0) await ctx.app.vectors.store.upsert(
        prepared.map((write) => ({
          id: write.recordId,
          vector: eligibleById.get(write.sourceOutboxId)!.vector,
          metadata: {
            org_id: principal.orgId,
            subject_id: eligibleById.get(write.sourceOutboxId)!.entry.subjectId,
            project_id: eligibleById.get(write.sourceOutboxId)!.entry.projectId ?? "",
          },
        })),
      );
    } catch {
      await recordSemanticDependencyFailure(
        ctx.app.db,
        "vector_store",
        eligibleLease.acquiredAt,
        prepared.map((write) => write.outboxId),
        eligibleLease.token,
      );
      await preserveSemanticIndexReconciliation(
        ctx.app.db,
        prepared,
        principal.orgId,
        eligibleLease.token,
      );
      throw unavailable("Indexing dependency is unavailable.", {
        dependency: "vector_store",
        retryable: true,
        pending: pending.length,
      });
    }
    const confirmed = new Set(await completeSemanticIndexWrites(
      ctx.app.db,
      prepared,
      "all",
      eligibleLease.token,
    ));
    const stale = prepared.filter(({ outboxId }) => !confirmed.has(outboxId));
    if (stale.length > 0) {
      try {
        await compensateStaleSemanticIndexWrites(
          ctx.app.db,
          ctx.app.vectors.store,
          stale,
          principal.orgId,
          eligibleLease.token,
        );
      } catch {
        throw unavailable("Indexing dependency is unavailable.", {
          dependency: "vector_store",
          retryable: true,
          pending: pending.length,
        });
      }
    }
    const staleRecords = new Set(stale.map(({ recordId }) => recordId));
    indexed = prepared.filter(
      ({ outboxId, recordId }) => confirmed.has(outboxId) && !staleRecords.has(recordId),
    ).length;
  }

  const otherLease = await claimSemanticIndexWork(
    ctx.app.db,
    others.map((row) => row.id),
  );
  const skipped = (await completeSemanticIndexWork(
    ctx.app.db,
    otherLease.ids,
    false,
    otherLease.token,
  )).length;
  const drained = indexed + removed + skipped;

  const remaining = await first<{ count: number }>(
    ctx.app.db,
    `SELECT COUNT(*) AS count FROM index_outbox WHERE org_id = ? AND state = 'pending'`,
    [principal.orgId],
  );

  return {
    data: {
      drained,
      indexed,
      removed,
      skipped,
      remaining: Number(remaining?.count ?? 0),
      model: ctx.app.vectors.embedder.model,
      dimensions: ctx.app.vectors.embedder.dimensions,
      at,
    },
  };
}
