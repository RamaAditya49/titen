import type { Db, Stmt } from "../../core/db";

/** Leaves 100 of the Paid plan's 1,000 queries for platform/runtime overhead. */
export const D1_ENRICHMENT_QUERY_BUDGET = 900;
export const D1_BOUND_PARAMETER_LIMIT = 100;

/** Fail before D1 receives a query or statement that exceeds the declared budget. */
export function withD1Budget(
  db: Db,
  limit = D1_ENRICHMENT_QUERY_BUDGET,
): { db: Db; used(): number } {
  let queries = 0;
  const reserve = (statements: Stmt[]) => {
    if (statements.some((statement) => (statement.params?.length ?? 0) > D1_BOUND_PARAMETER_LIMIT))
      throw new Error("D1_PARAMETER_BUDGET_EXCEEDED");
    if (queries + statements.length > limit) throw new Error("D1_QUERY_BUDGET_EXCEEDED");
    queries += statements.length;
  };
  return {
    used: () => queries,
    db: {
      async all<Row>(sql: string, params = []) {
        reserve([{ sql, params }]);
        return db.all<Row>(sql, params);
      },
      async batch(statements) {
        reserve(statements);
        return db.batch(statements);
      },
      async exec(sql) {
        reserve([{ sql }]);
        return db.exec(sql);
      },
    },
  };
}
