/**
 * Distribution of every signal in the pre-registered inventory, read straight
 * out of an ingested Bun/SQLite store.
 *
 * The claim that LongMemEval-S carries no evidence variation is the whole
 * finding, so it is measured rather than argued from the ingest script.
 *
 * usage: bun signal-distribution.ts <db-path>
 */
import { Database } from "bun:sqlite";

const path = process.argv[2];
if (!path) {
  console.error("usage: bun signal-distribution.ts <db-path>");
  process.exit(2);
}

const db = new Database(path, { readonly: true });
const all = (sql: string) => db.query(sql).all();

const report = {
  store: path,
  claims: all("SELECT COUNT(*) AS n FROM claims"),
  observations: all("SELECT COUNT(*) AS n FROM observations"),
  trust: all("SELECT trust, COUNT(*) AS n FROM claims GROUP BY trust"),
  status: all("SELECT status, COUNT(*) AS n FROM claims GROUP BY status"),
  visibility: all("SELECT visibility, COUNT(*) AS n FROM claims GROUP BY visibility"),
  kind: all("SELECT kind, COUNT(*) AS n FROM claims GROUP BY kind"),
  confidence: all("SELECT confidence, COUNT(*) AS n FROM claims GROUP BY confidence"),
  version: all("SELECT version, COUNT(*) AS n FROM claims GROUP BY version"),
  distinct_actors: all("SELECT COUNT(DISTINCT actor_id) AS n FROM claims"),
  created_at_span: all(
    "SELECT COUNT(DISTINCT substr(created_at, 1, 10)) AS distinct_days,"
    + " MIN(created_at) AS earliest, MAX(created_at) AS latest FROM claims",
  ),
  claim_source_relations: all("SELECT relation, COUNT(*) AS n FROM claim_sources GROUP BY relation"),
  observation_provenance: all(
    "SELECT source_type, COUNT(*) AS n FROM observations GROUP BY source_type",
  ),
  feedback_rows: all("SELECT COUNT(*) AS n FROM context_feedback"),
  supporting_depth_histogram: all(
    "SELECT depth, COUNT(*) AS claims FROM ("
    + "  SELECT claim_id, COUNT(*) AS depth FROM claim_sources"
    + "   WHERE relation = 'supports' GROUP BY claim_id"
    + ") GROUP BY depth ORDER BY depth",
  ),
};

console.log(JSON.stringify(report, null, 2));
