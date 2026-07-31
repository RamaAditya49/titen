// @ts-ignore - bun:sqlite types ship with the Bun runtime, not with this package.
import { Database } from "bun:sqlite";
import type { Db, Param, Stmt } from "../../core/db";

/** Opens a canonical database with the durability settings a VPS needs. */
export function openDatabase(path: string): Database {
  const database = new Database(path, { create: true });
  database.run("PRAGMA journal_mode = WAL");
  // SQLite's 1,000-page checkpoint keeps a 4 KiB-page WAL near 4.2 MiB when
  // no long-lived reader prevents recycling. Keep it explicit and tested.
  database.run("PRAGMA wal_autocheckpoint = 1000");
  database.run("PRAGMA foreign_keys = ON");
  database.run("PRAGMA busy_timeout = 5000");
  // ponytail: `synchronous` is left at SQLite's FULL default rather than set
  // explicitly. The ceiling is an fsync on every commit, which dominates write
  // latency; NORMAL in WAL mode risks only the last committed transaction on
  // power loss and never corruption. Upgrade path: set it explicitly with an
  // env override so the durability trade is a recorded decision rather than an
  // inherited default (#124).
  return database;
}

export function createSqliteDb(database: Database): Db {
  return {
    async all<Row>(sql: string, params: Param[] = []): Promise<Row[]> {
      return database.query(sql).all(...params) as Row[];
    },
    async batch(stmts: Stmt[]): Promise<void> {
      // bun:sqlite has real transactions, so the atomic-batch contract is native.
      database.transaction((list: Stmt[]) => {
        for (const stmt of list) database.query(stmt.sql).run(...(stmt.params ?? []));
      })(stmts);
    },
    async exec(sql: string): Promise<void> {
      database.run(sql);
    },
  };
}
