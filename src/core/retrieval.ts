import type { Db } from "./db";
import type { Principal } from "./auth";
import { LIMITS } from "./validate";
import type { RankInput } from "./rank";

/**
 * Builds a bounded FTS5 MATCH expression from free task text.
 *
 * Every term is quoted, so FTS5 operators inside user input are data rather
 * than query syntax. Returns null when the task has no indexable term.
 */
export function ftsQuery(task: string, maxTerms = LIMITS.queryTerms): string | null {
  const matches = task.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}_'-]*/gu);
  const terms = [...new Set([...matches].map((match) => match[0]))].filter(
    (term) => term.length > 1,
  );
  if (terms.length === 0) return null;
  return terms
    .slice(0, maxTerms)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" OR ");
}

export interface ClaimCandidate extends RankInput {
  statement: string;
  confidence: number;
  valid_from: string;
  valid_to: string | null;
  visibility: string;
  observer_id: string | null;
}

export interface RetrievalScope {
  subjectId: string;
  projectId: string | null;
  at: string;
  limit?: number;
}

/**
 * Authorization, scope, lifecycle, and temporal eligibility are part of the
 * candidate query itself, not a filter applied to results. A record the caller
 * may not read never reaches ranking, counts, or score metadata.
 */
export async function retrieveClaimCandidates(
  db: Db,
  principal: Principal,
  match: string,
  scope: RetrievalScope,
): Promise<ClaimCandidate[]> {
  const limit = scope.limit ?? LIMITS.candidates;
  return db.all<ClaimCandidate>(
    `SELECT c.id,
            c.kind,
            c.statement,
            c.confidence,
            c.trust,
            c.status,
            c.visibility,
            c.observer_id,
            c.valid_from,
            c.valid_to,
            c.created_at,
            bm25(claims_fts) AS bm25,
            CASE
              WHEN c.status = 'disputed' THEN 1
              WHEN EXISTS (
                SELECT 1 FROM claim_sources s
                 WHERE s.claim_id = c.id AND s.relation = 'contradicts'
              ) THEN 1
              ELSE 0
            END AS disputed,
            (SELECT COUNT(*) FROM context_feedback f
              WHERE f.claim_id = c.id AND f.outcome IN ('used', 'useful')) AS feedback_positive,
            (SELECT COUNT(*) FROM context_feedback f
              WHERE f.claim_id = c.id AND f.outcome IN ('irrelevant', 'incorrect', 'harmful')) AS feedback_negative,
            (SELECT COUNT(*) FROM context_feedback f WHERE f.claim_id = c.id) AS feedback_total
       FROM claims_fts
       JOIN claims c ON c.id = claims_fts.claim_id
      WHERE claims_fts MATCH ?
        AND c.org_id = ?
        AND c.subject_id = ?
        AND (? IS NULL OR c.project_id = ?)
        AND c.status IN ('active', 'disputed')
        AND c.valid_from <= ?
        AND (c.valid_to IS NULL OR c.valid_to > ?)
        AND (c.visibility <> 'private' OR c.actor_id = ?)
      ORDER BY bm25(claims_fts)
      LIMIT ?`,
    [
      match,
      principal.orgId,
      scope.subjectId,
      scope.projectId,
      scope.projectId,
      scope.at,
      scope.at,
      principal.principalId,
      limit,
    ],
  );
}
