/**
 * C1 for the pooled-candidate-generation spec: where do the top-10 misses live?
 *
 * The published 49.2% is misses from the *returned pack* (token-budget bounded,
 * median 62 sessions). This splits them three ways using the shipped query
 * builder against a read-only copy of the pooled store:
 *
 *   in_pack_below_10  gold ranked 11..N of the returned pack   -> deep re-ranking
 *   in_pool_not_pack  gold inside the 1000-candidate pool but  -> packing/budget
 *                     below the token budget's cut
 *   outside_pool      gold never entered the candidate pool    -> candidate generation
 *
 * Falsifier 0 of the spec reads directly off these three counts.
 *
 * Usage: bun c1_depth.ts <db-path> <questions.json> <ranked.json> <out.json>
 *   questions.json: [{qid, question, gold: [sid...], qtype}]
 */
import { Database } from "bun:sqlite";
import { planFtsQuery } from "../src/core/retrieval.ts";

const [dbPath, questionsPath, rankedPath, outPath] = process.argv.slice(2);
const db = new Database(dbPath, { readonly: true });
db.exec("PRAGMA query_only = ON");

const questions: { qid: string; question: string; gold: string[]; qtype: string }[] =
  await Bun.file(questionsPath).json();
const rankedArtifact = await Bun.file(rankedPath).json();
const ranked: Record<string, string[]> = rankedArtifact.ranked ?? rankedArtifact;

const org = db.query<{ org_id: string }, []>("SELECT org_id FROM claims LIMIT 1").get()!;
const subject = db
  .query<{ subject_id: string }, []>(
    "SELECT subject_id FROM claims GROUP BY subject_id ORDER BY COUNT(*) DESC LIMIT 1",
  )
  .get()!;

// The shipped candidate query, minus the authorization/temporal predicates that
// cannot change which *sessions* are reachable in this single-principal store
// (verified: one org, one subject, zero retention exclusions). Ranking order is
// the shipped bm25 over the same MATCH expression, so a rank here is the rank
// the product would produce.
const poolStmt = db.query<{ observer_id: string; r: number }, [string, string, string, number]>(
  `WITH pool AS (
     SELECT claims_fts.claim_id,
            bm25(claims_fts, 1.0, 0.0, 0.0, 0.0) AS lexical_bm25
       FROM claims_fts
       JOIN claims c ON c.id = claims_fts.claim_id
      WHERE claims_fts MATCH (
              'org_scope : "' || lower(hex(?)) || '0" AND '
              || 'subject_scope : "' || lower(hex(?)) || '0" AND '
              || 'statement : (' || ? || ')'
            )
      ORDER BY bm25(claims_fts, 1.0, 0.0, 0.0, 0.0)
      LIMIT ?
   )
   SELECT c.observer_id AS observer_id,
          ROW_NUMBER() OVER (ORDER BY pool.lexical_bm25) AS r
     FROM pool JOIN claims c ON c.id = pool.claim_id`,
);

const POOL_LIMIT = 1000;
const out: Record<string, unknown>[] = [];
let done = 0;

for (const inst of questions) {
  const gold = new Set(inst.gold);
  const packed = ranked[inst.qid] ?? [];
  const packRank = packed.findIndex((s) => gold.has(s)); // -1 when absent
  const row: Record<string, unknown> = {
    qid: inst.qid,
    qtype: inst.qtype,
    pack_depth: packed.length,
    pack_rank: packRank < 0 ? null : packRank + 1,
  };

  if (packRank >= 0 && packRank < 10) {
    row.klass = "hit_top10";
  } else {
    // Only misses need the pool probe.
    const plan = planFtsQuery(inst.question.slice(0, 4000));
    if (!plan.match) {
      row.klass = "no_query_terms";
    } else {
      const rows = poolStmt.all(org.org_id, subject.subject_id, plan.match, POOL_LIMIT);
      let best: number | null = null;
      const seen = new Set<string>();
      let sessionRank = 0;
      for (const r of rows) {
        if (!r.observer_id || seen.has(r.observer_id)) continue;
        seen.add(r.observer_id);
        sessionRank += 1;
        if (gold.has(r.observer_id) && best === null) best = sessionRank;
      }
      row.pool_claims = rows.length;
      row.pool_sessions = seen.size;
      row.pool_gold_session_rank = best;
      row.klass =
        best === null
          ? "outside_pool"
          : packRank >= 0
            ? "in_pack_below_10"
            : "in_pool_not_pack";
    }
  }
  out.push(row);
  done += 1;
  if (done % 50 === 0) console.error(`probed ${done}/${questions.length}`);
}

const tally = (pred: (r: Record<string, unknown>) => boolean) => out.filter(pred).length;
const klasses = [...new Set(out.map((r) => r.klass as string))];
const summary: Record<string, unknown> = {
  spec: "2026-08-08-pooled-candidate-generation",
  phase: "C1",
  n: out.length,
  pool_limit: POOL_LIMIT,
  by_class: Object.fromEntries(klasses.map((k) => [k, tally((r) => r.klass === k)])),
  misses: tally((r) => r.klass !== "hit_top10"),
  by_type: Object.fromEntries(
    [...new Set(out.map((r) => r.qtype as string))].map((t) => [
      t,
      Object.fromEntries(
        klasses.map((k) => [k, tally((r) => r.qtype === t && r.klass === k)]),
      ),
    ]),
  ),
  rows: out,
};
await Bun.write(outPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, rows: `${out.length} rows in artifact` }, null, 2));
