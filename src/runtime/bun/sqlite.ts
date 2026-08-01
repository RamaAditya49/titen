// @ts-ignore - bun:sqlite types ship with the Bun runtime, not with this package.
import { Database } from "bun:sqlite";
import { chmodSync, existsSync } from "node:fs";
import type { Db, Param, Stmt } from "../../core/db";

function protectDatabaseFiles(path: string): void {
  if (path === ":memory:" || path.startsWith("file::memory:")) return;
  for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`])
    if (existsSync(file)) chmodSync(file, 0o600);
}

/** Opens a canonical database with the durability settings a VPS needs. */
export function openDatabase(
  path: string,
  options: { create?: boolean; readonly?: boolean } = {},
): Database {
  const readonly = options.readonly ?? false;
  const open = readonly
    ? { readonly: true }
    : options.create === false
      ? { readwrite: true }
      : { create: true };
  const previousUmask = process.umask(0o077);
  let database: Database | undefined;
  try {
    database = new Database(path, open);
    if (!readonly) protectDatabaseFiles(path);
    if (!readonly) {
      database.run("PRAGMA journal_mode = WAL");
      // A successful response means its canonical transaction survived process,
      // OS, and power loss. Keep that durability choice explicit rather than
      // inheriting a host/library default; NORMAL is an operator-visible contract
      // change, not a hidden latency optimization.
      database.run("PRAGMA synchronous = FULL");
      // SQLite's 1,000-page checkpoint keeps a 4 KiB-page WAL near 4.2 MiB when
      // no long-lived reader prevents recycling. Keep it explicit and tested.
      database.run("PRAGMA wal_autocheckpoint = 1000");
      database.run("PRAGMA foreign_keys = ON");
      database.run("PRAGMA busy_timeout = 5000");
      protectDatabaseFiles(path);
    }
    return database;
  } catch (error) {
    database?.close();
    throw error;
  } finally {
    process.umask(previousUmask);
  }
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
