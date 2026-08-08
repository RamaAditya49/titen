/**
 * E-LAT2 ceiling probe — what is the candidate CTE's per-row authorization
 * actually worth, and where does the rest of compile time go?
 *
 * Run through `bun:sqlite`, which is the planner the product uses. The
 * 2026-08-08 EXPLAIN that opened #294 came from python3's SQLite 3.51.2 on a
 * read-only copy and was published as a lead rather than a diagnosis; this
 * closes that gap.
 *
 * L1 hoists the CTE's membership and retention predicates into per-request
 * sets. Deleting them outright is the most a hoist could ever recover, so the
 * ceiling is measured before any authorization code is written: an
 * authorization change that cannot pay for itself should not be attempted.
 *
 * This is a raw-SQL measurement on a store copy, not a served compile. Every
 * figure it produces is reconciled against the served p50/p95 in the report.
 */
import { Database } from "bun:sqlite";
import { planFtsQuery } from "../../titen-recovery/src/core/retrieval";

const dbPath = process.argv[2]!;
const fixture = process.argv[3]!;
const outPath = process.argv[4]!;
const subject = process.argv[5]!;

const db = new Database(dbPath, { readonly: true });
db.exec("PRAGMA query_only = ON");

const org = db.query<{ id: string }, []>("SELECT id FROM organizations LIMIT 1").get()!;
// The predicate compares `actor_id` against the caller's principal id, and on
// these bench stores every claim was written by the bootstrap owner, so taking
// the id from the data reproduces the served caller's branch rather than
// forcing the cheap non-matching one.
const principal = db
  .query<{ id: string }, []>("SELECT actor_id AS id FROM claims WHERE subject_id = ? LIMIT 1")
  .get(process.argv[5]!)!;

const ACCESS = (alias: string) => `(
    ${alias}.visibility = 'organization'
    OR (${alias}.visibility = 'private' AND ${alias}.actor_id = ?)
    OR (
      ${alias}.visibility = 'team'
      AND ${alias}.workspace_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM memberships access_membership
         WHERE access_membership.org_id = ${alias}.org_id
           AND access_membership.workspace_id = ${alias}.workspace_id
           AND access_membership.principal_id = ?
           AND access_membership.removed_at IS NULL
      )
    )
  ) AND NOT EXISTS (
    SELECT 1 FROM retention_exclusions retention
     WHERE retention.org_id = ${alias}.org_id
       AND retention.resource_type = 'claim'
       AND retention.resource_id = ${alias}.id
  )`;

const CONTRADICTED = `EXISTS (
    SELECT 1 FROM claim_sources s
    WHERE s.claim_id = c.id AND s.relation = 'contradicts'
      AND EXISTS (
        SELECT 1 FROM observations o
         WHERE o.id = s.observation_id
           AND o.org_id = c.org_id
           AND ${ACCESS("o").replaceAll("'claim'", "'observation'")}
      )
  )`;

const FEEDBACK = `,
            (SELECT COUNT(*) FROM context_feedback f
              WHERE f.claim_id = c.id AND f.outcome IN ('used', 'useful')) AS feedback_positive,
            (SELECT COUNT(*) FROM context_feedback f
              WHERE f.claim_id = c.id AND f.outcome IN ('irrelevant', 'incorrect', 'harmful')) AS feedback_negative,
            (SELECT COUNT(*) FROM context_feedback f WHERE f.claim_id = c.id) AS feedback_total`;

/** The product's own candidate query, with named parts switchable. */
const candidateSql = (opts: {
  access: boolean;
  contradicted: boolean;
  feedback: boolean;
  hydrate?: "none" | "no_statement";
  order?: boolean;
  join?: boolean;
}) => `
  WITH candidate_ids AS (
    SELECT claims_fts.claim_id,
           bm25(claims_fts, 1.0, 0.0, 0.0, 0.0) AS lexical_bm25
      FROM claims_fts
      ${opts.join === false ? "" : "JOIN claims c ON c.id = claims_fts.claim_id"}
     WHERE claims_fts MATCH (
             'org_scope : "' || lower(hex(?)) || '0" AND '
             || 'subject_scope : "' || lower(hex(?)) || '0" AND '
             || 'statement : (' || ? || ')'
           )
       ${opts.join === false ? "" : `
       AND c.org_id = ?
       AND c.subject_id = ?
       AND (? = 1 OR c.project_id IS ?)
       AND c.status IN ('active', 'disputed')
       AND c.valid_from <= ?
       AND (c.valid_to IS NULL OR c.valid_to > ?)
       ${opts.access ? `AND ${ACCESS("c")}` : ""}`}
     ${opts.order === false ? "" : "ORDER BY bm25(claims_fts, 1.0, 0.0, 0.0, 0.0)"}
     LIMIT ?
  )
  ${opts.hydrate === "none"
    ? "SELECT candidate_ids.claim_id, candidate_ids.lexical_bm25 FROM candidate_ids ORDER BY candidate_ids.lexical_bm25"
    : `
  SELECT c.id, c.kind, ${opts.hydrate === "no_statement" ? "'' AS statement" : "c.statement"},
         c.confidence, c.trust, c.status, c.visibility,
         c.observer_id, c.valid_from, c.valid_to, c.created_at,
         candidate_ids.lexical_bm25 AS bm25,
         ${opts.contradicted
           ? `CASE WHEN c.status = 'disputed' THEN 1 WHEN ${CONTRADICTED} THEN 1 ELSE 0 END`
           : `CASE WHEN c.status = 'disputed' THEN 1 ELSE 0 END`} AS disputed
         ${opts.feedback ? FEEDBACK : ", 0 AS feedback_positive, 0 AS feedback_negative, 0 AS feedback_total"}
    FROM candidate_ids
    JOIN claims c ON c.id = candidate_ids.claim_id
   ORDER BY candidate_ids.lexical_bm25`}
`;

/** Dropping the outer SELECT drops the contradicted subquery's parameters with it. */
const bindOpts = (opts: {
  access: boolean; contradicted: boolean; hydrate?: string; join?: boolean;
}) => ({
  access: opts.access,
  contradicted: opts.contradicted && opts.hydrate !== "none",
  join: opts.join,
});

const params = (
  match: string,
  opts: { access: boolean; contradicted: boolean; join?: boolean },
) => [
  org.id, subject, match,
  ...(opts.join === false
    ? []
    : [org.id, subject, 1, null, new Date().toISOString(), new Date().toISOString(),
       ...(opts.access ? [principal.id, principal.id] : [])]),
  1000,
  ...(opts.contradicted ? [principal.id, principal.id] : []),
];

const questions: { question: string }[] = JSON.parse(await Bun.file(fixture).text());
// Every fifth instance, which is the sampling the 2026-08-08 scope-price probe
// used, so the two figures are comparable.
const sample = questions.filter((_, index) => index % 5 === 0);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round((s[Math.floor(s.length / 2)] ?? 0) * 1000) / 1000;
};
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round((s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0) * 1000) / 1000;
};

const cells: Record<
  string,
  {
    access: boolean; contradicted: boolean; feedback: boolean;
    hydrate?: "none" | "no_statement"; order?: boolean; join?: boolean;
  }
> = {
  product: { access: true, contradicted: true, feedback: true },
  no_access: { access: false, contradicted: true, feedback: true },
  no_contradicted: { access: true, contradicted: false, feedback: true },
  no_feedback: { access: true, contradicted: true, feedback: false },
  fts_only: { access: false, contradicted: false, feedback: false },
  // The three switches above together move under 3%, so the residual has to be
  // in the parts none of them touch. These two find it: `cte_only` is the bare
  // candidate scan the 2026-08-08 cycle timed at a median 65.6 ms, and
  // `no_statement` keeps every subquery but stops fetching the claim text.
  cte_only: { access: true, contradicted: true, feedback: true, hydrate: "none" },
  no_statement: { access: true, contradicted: true, feedback: true, hydrate: "no_statement" },
  // `cte_only` lands on top of `product`, so the whole cost is the candidate
  // scan. These two split it: the bm25 ordering sorts every matched row, not
  // the 1,000 the LIMIT keeps, and the join to claims applies the scope
  // conjunction to each of them.
  cte_no_order: { access: true, contradicted: true, feedback: true, hydrate: "none", order: false },
  fts_match_only: {
    access: true, contradicted: true, feedback: true, hydrate: "none",
    order: false, join: false,
  },
};

const timings: Record<string, { median_ms: number; p95_ms: number; rows_median: number }> = {};
const plans: Record<string, string[]> = {};

for (const [name, opts] of Object.entries(cells)) {
  const sql = candidateSql(opts);
  const statement = db.query(sql);
  const ms: number[] = [];
  const rows: number[] = [];
  for (const instance of sample) {
    const plan = planFtsQuery(instance.question);
    if (!plan.match) continue;
    const bound = params(plan.match, bindOpts(opts)) as never[];
    const t0 = Bun.nanoseconds();
    const got = statement.all(...bound);
    ms.push((Bun.nanoseconds() - t0) / 1e6);
    rows.push((got as unknown[]).length);
  }
  timings[name] = { median_ms: median(ms), p95_ms: pct(ms, 0.95), rows_median: median(rows) };
  const first = planFtsQuery(sample[0]!.question);
  plans[name] = db
    .query(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...(params(first.match!, bindOpts(opts)) as never[]))
    .map((row) => (row as { detail: string }).detail);
  console.log(name, JSON.stringify(timings[name]));
}

await Bun.write(
  outPath,
  JSON.stringify(
    {
      spec: "2026-08-08-pooled-recall-recovery",
      phase: "R5 E-LAT2 ceiling probe",
      note:
        "raw SQL through bun:sqlite on a read-only store copy, not a served compile; " +
        "the L1 ceiling is (product - no_access), because a hoist cannot beat deletion",
      runtime: `bun ${Bun.version}, bun:sqlite ${db.query<{ v: string }, []>("SELECT sqlite_version() AS v").get()!.v}`,
      db: dbPath,
      subject,
      sample_instances: sample.length,
      candidate_limit: 1000,
      timings,
      plans,
    },
    null,
    2,
  ),
);
console.log("wrote", outPath);
