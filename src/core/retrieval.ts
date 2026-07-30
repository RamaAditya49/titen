import { MAX_BOUND_PARAMS, chunk } from "./db";
import type { Db } from "./db";
import type { Principal } from "./auth";
import { LIMITS } from "./validate";
import type { RankInput } from "./rank";
import { recordAccessParams, recordAccessSql } from "./authorization";

/**
 * Builds a bounded FTS5 MATCH expression from free task text.
 *
 * Every term is quoted, so FTS5 operators inside user input are data rather
 * than query syntax. Returns null when the task has no indexable term.
 */
export interface FtsQueryPlan {
  match: string | null;
  termsUsed: number;
  termsDropped: number;
}

function termSignal(term: string): number {
  return (/[0-9]/u.test(term) ? 10_000 : 0)
    + (/[_'-]/u.test(term) ? 5_000 : 0)
    + Math.min(term.length, 1_000);
}

export function planFtsQuery(task: string, maxTerms = LIMITS.queryTerms): FtsQueryPlan {
  const matches = task.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}_'-]*/gu);
  const terms = [...new Set([...matches].map((match) => match[0]))].filter(
    (term) => term.length > 1,
  );
  if (terms.length === 0) return { match: null, termsUsed: 0, termsDropped: 0 };
  const selected = terms
    .sort((left, right) => {
      const bySignal = termSignal(right) - termSignal(left);
      if (bySignal !== 0) return bySignal;
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .slice(0, maxTerms);
  return {
    match: selected
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" OR "),
    termsUsed: selected.length,
    termsDropped: terms.length - selected.length,
  };
}

export function ftsQuery(task: string, maxTerms = LIMITS.queryTerms): string | null {
  return planFtsQuery(task, maxTerms).match;
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
/**
 * Hydrates claims the vector index proposed.
 *
 * The index is not an authority: it can only nominate ids. Eligibility is still
 * decided here, by the same organization, subject, project, status, temporal and
 * visibility predicates the lexical path uses, so a vector hit can never widen
 * what a caller may read. Lexical relevance is zero because these candidates
 * were not matched on words; their similarity arrives separately as a boost.
 */
export async function retrieveClaimsByIds(
  db: Db,
  principal: Principal,
  ids: string[],
  scope: RetrievalScope,
): Promise<ClaimCandidate[]> {
  if (ids.length === 0) return [];
  const found: ClaimCandidate[] = [];
  for (const group of chunk(ids, MAX_BOUND_PARAMS - 8)) {
    const rows = await db.all<ClaimCandidate>(
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
              0.0 AS bm25,
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
         FROM claims c
        WHERE c.id IN (${group.map(() => "?").join(", ")})
          AND c.org_id = ?
          AND c.subject_id = ?
          AND (? IS NULL OR c.project_id = ?)
          AND c.status IN ('active', 'disputed')
          AND c.valid_from <= ?
          AND (c.valid_to IS NULL OR c.valid_to > ?)
          AND ${recordAccessSql("c")}`,
      [
        ...group,
        principal.orgId,
        scope.subjectId,
        scope.projectId,
        scope.projectId,
        scope.at,
        scope.at,
        ...recordAccessParams(principal.principalId),
      ],
    );
    found.push(...rows);
  }
  return found;
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
        AND ${recordAccessSql("c")}
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
      ...recordAccessParams(principal.principalId),
      limit,
    ],
  );
}
