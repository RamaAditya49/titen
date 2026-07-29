import type { Db, Stmt } from "./db";
import { first } from "./db";
import { conflict } from "./errors";
import { sha256Hex } from "./ids";
import type { Principal } from "./auth";

export interface IdempotentWrite {
  status: number;
  data: unknown;
  statements: Stmt[];
}

interface StoredRow {
  request_hash: string;
  status: number;
  response: string;
}

export function idempotencyKey(request: Request): string | null {
  const value = request.headers.get("idempotency-key");
  return value && value.trim() !== "" ? value.trim().slice(0, 200) : null;
}

/**
 * Commits a mutation exactly once per `Idempotency-Key`.
 *
 * The replay record is inserted inside the same atomic batch as the canonical
 * rows, so a duplicate key makes the whole write fail and roll back instead of
 * producing a second copy.
 */
export async function commitIdempotent(
  db: Db,
  principal: Principal,
  endpoint: string,
  key: string | null,
  rawBody: string,
  build: () => Promise<IdempotentWrite>,
): Promise<{ status: number; data: unknown; replayed: boolean }> {
  if (!key) {
    const write = await build();
    await db.batch(write.statements);
    return { status: write.status, data: write.data, replayed: false };
  }

  const keyHash = await sha256Hex(key);
  const requestHash = await sha256Hex(rawBody);
  const stored = await loadStored(db, principal.orgId, endpoint, keyHash);
  if (stored) return replay(stored, requestHash);

  const write = await build();
  const statements = [
    ...write.statements,
    {
      sql: `INSERT INTO idempotency (org_id, endpoint, key_hash, request_hash, status, response, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        principal.orgId,
        endpoint,
        keyHash,
        requestHash,
        write.status,
        JSON.stringify(write.data),
        new Date().toISOString(),
      ] as (string | number)[],
    },
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    const raced = await loadStored(db, principal.orgId, endpoint, keyHash);
    if (raced) return replay(raced, requestHash);
    throw error;
  }
  return { status: write.status, data: write.data, replayed: false };
}

async function loadStored(
  db: Db,
  orgId: string,
  endpoint: string,
  keyHash: string,
): Promise<StoredRow | undefined> {
  return first<StoredRow>(
    db,
    `SELECT request_hash, status, response FROM idempotency
       WHERE org_id = ? AND endpoint = ? AND key_hash = ?`,
    [orgId, endpoint, keyHash],
  );
}

function replay(stored: StoredRow, requestHash: string) {
  if (stored.request_hash !== requestHash)
    throw conflict("Idempotency-Key was reused with a different request body.");
  return {
    status: stored.status,
    data: JSON.parse(stored.response) as unknown,
    replayed: true,
  };
}
