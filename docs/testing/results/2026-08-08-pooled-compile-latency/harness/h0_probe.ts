/**
 * H0 for the pooled-compile-latency spec: capture HEAD's real candidate SQL and
 * split the spans, on the runtime that actually serves it.
 *
 * The SQL is obtained by calling `retrieveClaimCandidates` with a capturing Db
 * stub, never by pasting: a pasted copy drifts from the shipped query the moment
 * anyone edits it, which is exactly the failure this spec exists to avoid.
 *
 * The workload is the real benchmark question set, not synthesised text: a long
 * claim statement produces sixteen corpus-common terms whose disjunction matches
 * a large fraction of the store, which measures a pathological case the product
 * never serves.
 *
 * Usage: copy to `scripts/` and run `bun h0_probe.ts <db-path> <questions.json>
 * <out.json>` — the relative import above resolves from there.
 *
 * Env: H0_SAMPLES (default 20), H0_PLAN_ONLY=1 to skip timing, H0_CROSS_PROJECT=1.
 */
import { Database } from "bun:sqlite";
import { retrieveClaimCandidates, planFtsQuery } from "../src/core/retrieval.ts";
import type { Principal } from "../src/core/auth.ts";

const [dbPath, questionsPath, outPath] = process.argv.slice(2);
if (!dbPath || !questionsPath || !outPath)
  throw new Error("usage: bun h0_probe.ts <db-path> <questions.json> <out.json>");

const db = new Database(dbPath, { readonly: true });
db.exec("PRAGMA query_only = ON");

// ---- identities from the store, so the plan is bound with real values -------
const org = db.query<{ id: string }, []>("SELECT id FROM organizations LIMIT 1").get();
const principalRow = db
  .query<{ principal_id: string; org_id: string }, []>(
    "SELECT principal_id, org_id FROM api_keys WHERE revoked_at IS NULL LIMIT 1",
  )
  .get();
const subject = db
  .query<{ subject_id: string; n: number }, []>(
    "SELECT subject_id, COUNT(*) AS n FROM claims GROUP BY subject_id ORDER BY n DESC LIMIT 1",
  )
  .get();
if (!org || !principalRow || !subject) throw new Error("store is missing org/principal/claims");

const principal: Principal = {
  keyId: "h0-probe",
  orgId: principalRow.org_id,
  principalId: principalRow.principal_id,
  principalKind: "service",
  scopes: ["memory:read"],
  maxTrust: "verified",
};

// ---- capture the shipped SQL + params ---------------------------------------
let captured: { sql: string; params: unknown[] } | null = null;
const capturingDb = {
  all: async (sql: string, params?: unknown[]) => {
    captured = { sql, params: params ?? [] };
    return [];
  },
  batch: async () => {},
  exec: async () => {},
};

const questions: string[] = (
  (await Bun.file(questionsPath).json()) as { question: string }[]
).map((q) => q.question.slice(0, 4000));

const match = planFtsQuery(questions[0]!)!.match!;
await retrieveClaimCandidates(capturingDb as never, principal, match, {
  subjectId: subject.subject_id,
  projectId: null,
  // The served path derives crossProject from the request body; the harness
  // sends no cross_project, so it is false with a null project. Binding true
  // here would measure a query the product never issues.
  crossProject: Boolean(process.env.H0_CROSS_PROJECT),
  at: new Date().toISOString(),
  limit: 1000,
});
if (!captured) throw new Error("capture failed: retrieveClaimCandidates did not query");
const { sql: fullSql, params: fullParams } = captured as { sql: string; params: unknown[] };

// ---- plans -------------------------------------------------------------------
const explain = (sql: string, params: unknown[]) =>
  db.query(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[]));

// The CTE alone: everything before the closing paren of candidate_ids, re-formed
// as a standalone SELECT so its cost is measurable in isolation.
const cteBody = fullSql.slice(
  fullSql.indexOf("WITH candidate_ids AS (") + "WITH candidate_ids AS (".length,
  fullSql.indexOf("\n     )\n"),
);
const cteParamCount = (cteBody.match(/\?/g) ?? []).length;
const cteParams = fullParams.slice(0, cteParamCount);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

// The FTS match expression is the 3rd bound parameter (org, subject, statement).
const matchParamIndex = 2;

const timeQuery = (sql: string, params: unknown[], label: string) => {
  const stmt = db.query(sql);
  stmt.all(...(params as never[])); // warm
  const samples: number[] = [];
  let rows = 0;
  const n = Number(process.env.H0_SAMPLES ?? "20");
  for (const q of questions.slice(0, n)) {
    const plan = planFtsQuery(q);
    if (!plan.match) continue;
    const bound = params.map((p, i) => (i === matchParamIndex ? plan.match : p));
    const t0 = performance.now();
    const out = stmt.all(...(bound as never[]));
    const ms = performance.now() - t0;
    samples.push(ms);
    rows = out.length;
    console.error(`  ${label} ${samples.length}/${n} ${ms.toFixed(1)}ms rows=${out.length}`);
  }
  return { label, median_ms: Number(median(samples).toFixed(2)), samples: samples.length, rows };
};

const result = {
  spec: "2026-08-08-pooled-compile-latency",
  phase: "H0",
  runtime: {
    bun: Bun.version,
    sqlite: db.query<{ v: string }, []>("SELECT sqlite_version() AS v").get()?.v,
  },
  workload: { source: questionsPath, timed_questions: Number(process.env.H0_SAMPLES ?? "20"), of: questions.length },
  store: {
    path: dbPath,
    claims: db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM claims").get()?.n,
    observations: db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM observations").get()?.n,
    subject: subject.subject_id,
    subject_claims: subject.n,
    visibility_histogram: db
      .query("SELECT visibility, COUNT(*) AS n FROM claims GROUP BY visibility")
      .all(),
    claim_sources: db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM claim_sources").get()?.n,
    contradicts: db
      .query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM claim_sources WHERE relation = 'contradicts'",
      )
      .get()?.n,
    feedback: db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM context_feedback").get()?.n,
  },
  captured_sql: fullSql,
  captured_param_count: fullParams.length,
  cte_param_count: cteParamCount,
  explain_full: explain(fullSql, fullParams),
  explain_cte: explain(`SELECT * FROM (${cteBody})`, cteParams),
  spans: process.env.H0_PLAN_ONLY
    ? []
    : [
        timeQuery(`SELECT * FROM (${cteBody})`, cteParams, "cte_only"),
        timeQuery(fullSql, fullParams, "full_query"),
      ],
};

await Bun.write(outPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, captured_sql: "<in artifact>", explain_full: `${result.explain_full.length} rows`, explain_cte: `${result.explain_cte.length} rows` }, null, 2));
