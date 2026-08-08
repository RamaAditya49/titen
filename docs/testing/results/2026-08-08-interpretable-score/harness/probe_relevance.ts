/**
 * AC-INT-001 at the unit level: reproduce the pre-registration's three
 * candidate sets by calling `rankCandidates` directly, on whichever build this
 * file is run from.
 *
 *   bun probe_relevance.ts <worktree> <label>
 *
 * The served anchor lane answers the same gate over 500 real questions; this
 * exists because the pre-registration's own table was produced this way and a
 * gate should be scored against the artifact it was written against.
 *
 * Every field except `bm25` is held constant across the three sets, so any
 * difference in the reported score is the relevance term and nothing else.
 */
const [worktree, label] = process.argv.slice(2);
const { rankCandidates } = await import(`${worktree}/src/core/rank.ts`);

const NOW = new Date("2026-08-08T00:00:00Z");

const base = {
  kind: "episodic_event",
  trust: "asserted" as const,
  confidence: 0.8,
  status: "active",
  created_at: NOW.toISOString(),
  disputed: false,
  feedback_positive: 0,
  feedback_negative: 0,
  feedback_total: 0,
};

const sets: Array<[string, number[]]> = [
  ["strong lexical match", [-18.0, -2.0]],
  ["weak lexical match", [-0.4, -0.1]],
  ["single candidate", [-0.02]],
];

const rows = sets.map(([name, bm25s]) => {
  const candidates = bm25s.map((bm25, index) => ({
    ...base,
    id: `c${index}`,
    statement: `claim ${index}`,
    bm25,
  }));
  const ranked = rankCandidates(candidates, NOW);
  return {
    set: name,
    bm25: bm25s,
    rank1_score: ranked[0].score,
    rank1_relevance: ranked[0].components.relevance,
  };
});

const scores = rows.map((r) => r.rank1_score);
console.log(JSON.stringify({
  build: label,
  worktree,
  rows,
  spread_strong_minus_weak: Math.round((scores[0] - scores[1]) * 1e6) / 1e6,
  spread_max_minus_min: Math.round((Math.max(...scores) - Math.min(...scores)) * 1e6) / 1e6,
}, null, 2));
