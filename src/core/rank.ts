import { TRUST_RANK, type Trust } from "./validate";

export const RANK_WEIGHTS = {
  relevance: 0.4,
  trust: 0.2,
  recency: 0.15,
  utility: 0.1,
  conflict: 0.05,
  confidence: 0.1,
} as const;

/** Feedback only moves ranking once enough signals exist (FRD CTX-002). */
export const UTILITY_MIN_SIGNALS = 3;
export const RECENCY_HALF_LIFE_DAYS = 90;

export interface RankInput {
  id: string;
  kind: string;
  trust: Trust;
  confidence: number;
  status: string;
  created_at: string;
  bm25: number;
  disputed: boolean;
  feedback_positive: number;
  feedback_negative: number;
  feedback_total: number;
  /** Semantic similarity from the optional vector store, 0..1. */
  vector_boost?: number;
}

export interface ScoreComponents {
  relevance: number;
  trust: number;
  recency: number;
  utility: number;
  conflict: number;
  confidence: number;
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * bm25() returns smaller (more negative) values for better matches, and its
 * absolute scale is not portable, so relevance is normalized inside the
 * candidate set only. That keeps the component explainable without promising a
 * stable provider score (FRD RET-001).
 */
export function normalizeRelevance(candidates: RankInput[]): Map<string, number> {
  // A candidate the lexical index never matched carries bm25 = 0, because bm25()
  // is negative for a real match. Those are normalized to zero rather than
  // included in the span: otherwise a set with no lexical signal at all has a
  // zero span and every candidate scores 1, which silently discards the ordering
  // a vector store just provided.
  const lexical = candidates.filter((candidate) => candidate.bm25 !== 0);
  const scores = lexical.map((candidate) => -candidate.bm25);
  const best = Math.max(...scores, 0);
  const worst = Math.min(...scores, 0);
  const span = best - worst;
  const byId = new Map(
    lexical.map((candidate, index) => [
      candidate.id,
      span === 0 ? 1 : (scores[index]! - worst) / span,
    ]),
  );
  return new Map(
    candidates.map((candidate) => [candidate.id, byId.get(candidate.id) ?? 0]),
  );
}

/** Vector scores are provider-relative, so calibrate them inside this result set. */
export function normalizeVectorSimilarity(candidates: RankInput[]): Map<string, number> {
  const semantic = candidates.filter((candidate) => (candidate.vector_boost ?? 0) > 0);
  if (semantic.length === 0) return new Map();
  const scores = semantic.map((candidate) => candidate.vector_boost!);
  const best = Math.max(...scores);
  const worst = Math.min(...scores);
  const span = best - worst;
  return new Map(
    semantic.map((candidate, index) => [
      candidate.id,
      span === 0 ? 1 : (scores[index]! - worst) / span,
    ]),
  );
}

/** Age uses whole days so repeated compilation inside a day is stable. */
export function recencyScore(createdAt: string, now: Date): number {
  const ageDays = Math.max(
    0,
    Math.floor((now.getTime() - Date.parse(createdAt)) / 86_400_000),
  );
  return 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
}

export function utilityScore(candidate: RankInput): number {
  if (candidate.feedback_total < UTILITY_MIN_SIGNALS) return 0.5;
  const net =
    (candidate.feedback_positive - candidate.feedback_negative) / candidate.feedback_total;
  return (net + 1) / 2;
}

export function scoreCandidate(
  candidate: RankInput,
  relevance: number,
  vectorRelevance: number | undefined,
  now: Date,
): { score: number; components: ScoreComponents } {
  // A semantic hit is relevance evidence, so it competes with the lexical score
  // rather than forming a sixth weighted term. Taking the stronger of the two is
  // the point of hybrid retrieval: a vector match rescues a weak keyword match.
  // With no vector capability the value is undefined and the result is
  // arithmetically identical to lexical-only ranking.
  //
  // Both retrieval signals are normalized within the same authorized candidate
  // set before max(), avoiding provider-specific absolute similarity scales.
  // Upgrade path: learn the blend weight from context feedback.
  const effectiveRelevance = Math.max(relevance, vectorRelevance ?? 0);

  const components: ScoreComponents = {
    relevance: round(effectiveRelevance),
    trust: round(TRUST_RANK[candidate.trust] / 3),
    recency: round(recencyScore(candidate.created_at, now)),
    utility: round(utilityScore(candidate)),
    conflict: candidate.disputed ? 0 : 1,
    confidence: round(candidate.confidence),
  };
  const score =
    components.relevance * RANK_WEIGHTS.relevance +
    components.trust * RANK_WEIGHTS.trust +
    components.recency * RANK_WEIGHTS.recency +
    components.utility * RANK_WEIGHTS.utility +
    components.conflict * RANK_WEIGHTS.conflict +
    components.confidence * RANK_WEIGHTS.confidence;
  return { score: round(score), components };
}

export interface Ranked<T extends RankInput> {
  candidate: T;
  score: number;
  components: ScoreComponents;
}

/** Ties break on id so two identical states rank identically. */
export function rankCandidates<T extends RankInput>(candidates: T[], now: Date): Ranked<T>[] {
  const relevance = normalizeRelevance(candidates);
  const vectorRelevance = normalizeVectorSimilarity(candidates);
  return candidates
    .map((candidate) => ({
      candidate,
      ...scoreCandidate(
        candidate,
        relevance.get(candidate.id) ?? 0,
        vectorRelevance.get(candidate.id),
        now,
      ),
    }))
    .sort((left, right) =>
      right.score === left.score
        ? left.candidate.id.localeCompare(right.candidate.id)
        : right.score - left.score,
    );
}

/**
 * Two deterministic passes cover each available kind, then fill by rank under
 * the hard budget. Content is never truncated into misleading text (FRD CTX-001).
 */
export function packUnderBudget<T>(
  entries: { value: T; kind: string; tokens: number; dedupeKey?: string }[],
  budget: number,
): { selected: T[]; usedTokens: number } {
  const ranked: T[] = [];
  const rankedDedupe = new Set<string>();
  let rankedTokens = 0;
  let allFit = true;
  for (const entry of entries) {
    if (entry.dedupeKey && rankedDedupe.has(entry.dedupeKey)) continue;
    if (rankedTokens + entry.tokens > budget) {
      allFit = false;
      break;
    }
    ranked.push(entry.value);
    rankedTokens += entry.tokens;
    if (entry.dedupeKey) rankedDedupe.add(entry.dedupeKey);
  }
  if (allFit) return { selected: ranked, usedTokens: rankedTokens };

  const selected: T[] = [];
  const kinds = new Set<string>();
  const dedupeKeys = new Set<string>();
  const taken = new Set<number>();
  let usedTokens = 0;

  const take = (entry: (typeof entries)[number], index: number): boolean => {
    if (taken.has(index) || (entry.dedupeKey && dedupeKeys.has(entry.dedupeKey))) return false;
    if (usedTokens + entry.tokens > budget) return false;
    selected.push(entry.value);
    usedTokens += entry.tokens;
    kinds.add(entry.kind);
    if (entry.dedupeKey) dedupeKeys.add(entry.dedupeKey);
    taken.add(index);
    return true;
  };

  for (const [index, entry] of entries.entries()) {
    if (!kinds.has(entry.kind)) take(entry, index);
  }
  for (const [index, entry] of entries.entries()) take(entry, index);
  return { selected, usedTokens };
}
