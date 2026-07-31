import type { Stmt } from "./db";
import { newId } from "./ids";

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

/** Durable work for a configured vector projection. */
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

/** Abort the enclosing batch if evidence was purged after preflight. */
export function purgedEvidenceGuardStatement(
  orgId: string,
  claimId: string,
  observationIds: string[],
  at: string,
): Stmt {
  return {
    sql: `INSERT INTO claim_sources (claim_id, observation_id, relation, created_at)
          SELECT ?, ?, 'supports', ?
           WHERE EXISTS (
             SELECT 1 FROM record_history h
              WHERE h.org_id = ? AND h.record_type = 'observation'
                AND h.change_kind = 'purge'
                AND h.record_id IN (${observationIds.map(() => "?").join(", ")})
           )`,
    params: [claimId, observationIds[0]!, at, orgId, ...observationIds],
  };
}
