/**
 * The only storage boundary in the shared core.
 *
 * D1 has no interactive transactions, so every atomic write in Titen is
 * expressed as a statement batch that the driver commits all-or-nothing. That
 * constraint is deliberate: it is the smallest interface both runtimes can
 * honour without a second code path.
 */
export type Param = string | number | null;

export type Stmt = { sql: string; params?: Param[] };

export interface Db {
  /** Read rows for one statement. */
  all<Row>(sql: string, params?: Param[]): Promise<Row[]>;
  /** Commit every statement or none of them. */
  batch(stmts: Stmt[]): Promise<void>;
  /** Run one statement outside a batch. Used by migrations and DDL. */
  exec(sql: string): Promise<void>;
}

export async function first<Row>(
  db: Db,
  sql: string,
  params?: Param[],
): Promise<Row | undefined> {
  const rows = await db.all<Row>(sql, params);
  return rows[0];
}

/**
 * D1 caps bound parameters per statement at 100, so any dynamic `IN (...)` list
 * must be chunked. bun:sqlite is far more permissive, but the shared core keeps
 * the stricter limit so both runtimes execute the same statements.
 * Call sites subtract their fixed parameters from this tested safety ceiling.
 */
export const MAX_BOUND_PARAMS = 90;

export function chunk<Item>(items: Item[], size = MAX_BOUND_PARAMS): Item[][] {
  const chunks: Item[][] = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
}
