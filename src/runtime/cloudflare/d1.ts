import type { Db, Param, Stmt } from "../../core/db";

/**
 * Minimal structural view of the D1 binding.
 *
 * Declared locally so the Worker needs no `@cloudflare/workers-types`
 * dependency and the shared core stays free of platform types.
 */
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<Row>(): Promise<{ results: Row[] }>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export function createD1Db(binding: D1Database): Db {
  return {
    async all<Row>(sql: string, params: Param[] = []): Promise<Row[]> {
      const result = await binding.prepare(sql).bind(...params).all<Row>();
      return result.results ?? [];
    },
    async batch(stmts: Stmt[]): Promise<void> {
      // D1 has no interactive transaction; batch() is its atomic unit.
      if (stmts.length === 0) return;
      await binding.batch(
        stmts.map((stmt) => binding.prepare(stmt.sql).bind(...(stmt.params ?? []))),
      );
    },
    async exec(sql: string): Promise<void> {
      await binding.prepare(sql).run();
    },
  };
}
