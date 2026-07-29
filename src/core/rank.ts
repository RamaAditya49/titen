import { TRUST_RANK, type Trust } from "./validate";

export const RANK_WEIGHTS = {
  relevance: 0.45,
  trust: 0.2,
  recency: 0.15,
  utility: 0.1,
  conflict: 0.1,
} as const;

/** Feedback only moves ranking once enough signals exist (FRD CTX-002). */
export const UTILITY_MIN_SIGNALS = 3;
export const RECENCY_HALF_LIFE_DAYS = 90;
export const MAX_ITEMS_PER_KIND = 3;

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
}

export interface ScoreComponents {
  relevance: number;
  trust: number;
  recency: number;
  utility: number;
  conflict: number;
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * bm25() returns smaller (more negative) values for better matches, and its
 * absolute scale is not portable, so relevance is normalized inside the
 * candidate set only. That keeps the component explainable without promising a
 * stable provider score (FRD RET-001).
 */
export function normalizeRelevance(candidates: RankInput[]): Map<string, number> {
  const scores = candidates.map((candidate) => -candidate.bm25);
  const best = Math.max(...scores, 0);
  const worst = Math.min(...scores, 0);
  const span = best - worst;
  return new Map(
    candidates.map((candidate, index) => [
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
  now: Date,
): { score: number; components: ScoreComponents } {
  const components: ScoreComponents = {
    relevance: round(relevance),
    trust: round(TRUST_RANK[candidate.trust] / 3),
    recency: round(recencyScore(candidate.created_at, now)),
    utility: round(utilityScore(candidate)),
    conflict: candidate.disputed ? 1 : 0,
  };
  const score =
    components.relevance * RANK_WEIGHTS.relevance +
    components.trust * RANK_WEIGHTS.trust +
    components.recency * RANK_WEIGHTS.recency +
    components.utility * RANK_WEIGHTS.utility +
    components.conflict * RANK_WEIGHTS.conflict;
  return { score: round(score * candidate.confidence), components };
}

export interface Ranked<T extends RankInput> {
  candidate: T;
  score: number;
  components: ScoreComponents;
}

/** Ties break on id so two identical states rank identically. */
export function rankCandidates<T extends RankInput>(candidates: T[], now: Date): Ranked<T>[] {
  const relevance = normalizeRelevance(candidates);
  return candidates
    .map((candidate) => ({
      candidate,
      ...scoreCandidate(candidate, relevance.get(candidate.id) ?? 0, now),
    }))
    .sort((left, right) =>
      right.score === left.score
        ? left.candidate.id.localeCompare(right.candidate.id)
        : right.score - left.score,
    );
}

/**
 * Greedy packing under a hard budget. An item that does not fit is skipped
 * whole; content is never truncated into misleading text (FRD CTX-001).
 */
export function packUnderBudget<T>(
  entries: { value: T; kind: string; tokens: number }[],
  budget: number,
): { selected: T[]; usedTokens: number } {
  const selected: T[] = [];
  const perKind = new Map<string, number>();
  let usedTokens = 0;
  for (const entry of entries) {
    const kindCount = perKind.get(entry.kind) ?? 0;
    if (kindCount >= MAX_ITEMS_PER_KIND) continue;
    if (usedTokens + entry.tokens > budget) continue;
    selected.push(entry.value);
    usedTokens += entry.tokens;
    perKind.set(entry.kind, kindCount + 1);
  }
  return { selected, usedTokens };
}
