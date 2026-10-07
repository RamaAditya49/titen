import type { Db } from "./db";
import { validationError } from "./errors";

export const JOB_STATUSES = ["pending", "leased", "done", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface JobCommandResult {
  status: JobStatus;
  matched: number;
  job_ids: string[];
}

/** `terminal_error` is the readiness name for a failed enrichment job. */
export function parseJobStatus(value: string): JobStatus {
  if (value === "terminal_error") return "failed";
  if ((JOB_STATUSES as readonly string[]).includes(value)) return value as JobStatus;
  throw validationError(`Status must be one of: ${JOB_STATUSES.join(", ")}, terminal_error.`);
}

function filters(status: JobStatus, orgId: string | null, id: string | null, acked: "open" | "any") {
  const clauses = ["state = ?"];
  const params: Array<string | null> = [status];
  if (acked === "open" && status === "failed") clauses.push("acked_at IS NULL");
  if (orgId) {
    clauses.push("org_id = ?");
    params.push(orgId);
  }
  if (id) {
    clauses.push("id = ?");
    params.push(id);
  }
  return { where: clauses.join(" AND "), params };
}

export async function listEnrichmentJobs(
  db: Db,
  status: JobStatus,
  orgId: string | null = null,
): Promise<Array<Record<string, unknown>>> {
  return db.all(
    `SELECT id, org_id, lane, state, error_class, attempts, updated_at, acked_at
       FROM enrichment_jobs
      WHERE state = ?
        AND (? IS NULL OR org_id = ?)
      ORDER BY updated_at, id
      LIMIT 200`,
    [status, orgId, orgId],
  );
}

async function matchingIds(
  db: Db,
  status: JobStatus,
  orgId: string | null,
  id: string | null,
): Promise<string[]> {
  const filter = filters(status, orgId, id, "open");
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM enrichment_jobs WHERE ${filter.where} ORDER BY id LIMIT 200`,
    filter.params,
  );
  return rows.map((row) => row.id);
}

export async function retryEnrichmentJobs(
  db: Db,
  status: JobStatus,
  at: string,
  orgId: string | null = null,
  id: string | null = null,
): Promise<JobCommandResult> {
  if (status !== "failed")
    throw validationError("retry applies to failed jobs (status terminal_error).");
  const ids = await matchingIds(db, status, orgId, id);
  if (ids.length === 0) return { status, matched: 0, job_ids: [] };
  const marks = ids.map(() => "?").join(", ");
  await db.batch([{
    sql: `UPDATE enrichment_jobs
             SET state = 'pending', attempts = 0, error_class = NULL,
                 next_attempt_at = ?, updated_at = ?, acked_at = NULL,
                 lease_token = NULL, lease_expires_at = NULL
           WHERE id IN (${marks}) AND state = 'failed'`,
    params: [at, at, ...ids],
  }]);
  return { status, matched: ids.length, job_ids: ids };
}

export async function ackEnrichmentJobs(
  db: Db,
  status: JobStatus,
  at: string,
  orgId: string | null = null,
  id: string | null = null,
): Promise<JobCommandResult> {
  if (status !== "failed")
    throw validationError("ack applies to failed jobs (status terminal_error).");
  const ids = await matchingIds(db, status, orgId, id);
  if (ids.length === 0) return { status, matched: 0, job_ids: [] };
  const marks = ids.map(() => "?").join(", ");
  await db.batch([{
    sql: `UPDATE enrichment_jobs SET acked_at = ?, updated_at = ?
           WHERE id IN (${marks}) AND state = 'failed' AND acked_at IS NULL`,
    params: [at, at, ...ids],
  }]);
  return { status, matched: ids.length, job_ids: ids };
}

export async function purgeEnrichmentJobs(
  db: Db,
  status: JobStatus,
  orgId: string | null = null,
  id: string | null = null,
): Promise<JobCommandResult> {
  if (status !== "failed")
    throw validationError("purge applies to failed jobs (status terminal_error).");
  const filter = filters(status, orgId, id, "any");
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM enrichment_jobs WHERE ${filter.where} ORDER BY id LIMIT 200`,
    filter.params,
  );
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return { status, matched: 0, job_ids: [] };
  const marks = ids.map(() => "?").join(", ");
  const cited = await db.all<{ id: string }>(
    `SELECT id FROM enrichment_jobs
      WHERE id IN (${marks})
        AND (
          EXISTS (SELECT 1 FROM claims claim WHERE claim.enrichment_job_id = enrichment_jobs.id)
          OR EXISTS (SELECT 1 FROM claim_links link WHERE link.job_id = enrichment_jobs.id)
        )`,
    ids,
  );
  if (cited.length > 0)
    throw validationError("Purge refused because a claim still cites the job. Ack it instead.");
  await db.batch([
    {
      sql: `DELETE FROM enrichment_commits WHERE job_id IN (${marks})`,
      params: ids,
    },
    {
      sql: `DELETE FROM enrichment_jobs WHERE id IN (${marks}) AND state = 'failed'`,
      params: ids,
    },
  ]);
  return { status, matched: ids.length, job_ids: ids };
}
