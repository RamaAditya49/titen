import type { Principal } from "./auth";
import type { Db, Stmt } from "./db";
import { first } from "./db";
import { conflict } from "./errors";
import { sha256Hex } from "./ids";

export interface IdempotentWrite {
  status: number;
  data: unknown;
  statements: Stmt[];
}

interface StoredRow {
  request_identity: string;
  request_hash: string;
  status: number;
  response: string;
  expires_at: string;
}

// Request keys cover retry storms; canonical hashes on observations and claims
// independently make stable re-syncs converge after this bounded window.
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export function idempotencyKey(request: Request): string | null {
  const value = request.headers.get("idempotency-key");
  return value && value.trim() !== "" ? value.trim().slice(0, 200) : null;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function requestIdentity(request: Request): string {
  const url = new URL(request.url);
  const query = [...url.searchParams.entries()]
    .sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${request.method.toUpperCase()} ${url.pathname}${query ? `?${query}` : ""}`;
}

/** Commit a mutation and its replay record in the same cross-runtime batch. */
export async function commitIdempotent(
  db: Db,
  principal: Principal,
  request: Request,
  key: string | null,
  rawBody: string,
  now: Date,
  build: () => Promise<IdempotentWrite>,
): Promise<{ status: number; data: unknown; replayed: boolean }> {
  if (!key) {
    const write = await build();
    if (write.statements.length > 0) await db.batch(write.statements);
    return { status: write.status, data: write.data, replayed: false };
  }

  const keyHash = await sha256Hex(key);
  const identity = requestIdentity(request);
  let parsed: unknown = rawBody;
  try { parsed = JSON.parse(rawBody); } catch { /* handlers reject malformed JSON */ }
  const requestHash = await sha256Hex(canonicalJson(parsed));
  const nowIso = now.toISOString();
  const stored = await loadStored(db, principal, identity, keyHash);
  if (stored && stored.expires_at > nowIso) return replay(stored, identity, requestHash);

  // Old rows lack principal and expiry dimensions. Never replay them across an
  // identity boundary; force a fresh key instead.
  const legacy = await first<{ present: number }>(
    db,
    `SELECT 1 AS present FROM idempotency WHERE org_id = ? AND key_hash = ? LIMIT 1`,
    [principal.orgId, keyHash],
  );
  if (legacy) throw conflict("Idempotency-Key belongs to a legacy replay record; use a new key.");

  const write = await build();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString();
  const statements: Stmt[] = [
    {
      sql: `DELETE FROM idempotency_v3
             WHERE org_id = ? AND principal_id = ? AND key_hash = ? AND expires_at <= ?`,
      params: [principal.orgId, principal.principalId, keyHash, nowIso],
    },
    ...write.statements,
    {
      sql: `INSERT INTO idempotency_v3
              (org_id, principal_id, key_id, request_identity, key_hash,
               request_hash, status, response, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        principal.orgId,
        principal.principalId,
        principal.keyId,
        identity,
        keyHash,
        requestHash,
        write.status,
        JSON.stringify(write.data),
        nowIso,
        expiresAt,
      ],
    },
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    const raced = await loadStored(db, principal, identity, keyHash);
    if (raced && raced.expires_at > nowIso) return replay(raced, identity, requestHash);
    throw error;
  }
  return { status: write.status, data: write.data, replayed: false };
}

async function loadStored(
  db: Db,
  principal: Principal,
  identity: string,
  keyHash: string,
): Promise<StoredRow | undefined> {
  return first<StoredRow>(
    db,
    `SELECT request_identity, request_hash, status, response, expires_at FROM idempotency_v3
      WHERE org_id = ? AND principal_id = ? AND key_hash = ?`,
    [principal.orgId, principal.principalId, keyHash],
  );
}

function replay(stored: StoredRow, identity: string, requestHash: string) {
  if (stored.request_identity !== identity || stored.request_hash !== requestHash)
    throw conflict("Idempotency-Key was reused for a different request.");
  return {
    status: stored.status,
    data: JSON.parse(stored.response) as unknown,
    replayed: true,
  };
}
