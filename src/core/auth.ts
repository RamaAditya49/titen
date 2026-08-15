import type { Db } from "./db";
import { forbidden, unauthenticated, validationError } from "./errors";
import { newId, randomToken, sha256Hex } from "./ids";
import { TRUST_RANK, type Trust } from "./validate";

export const KEY_PREFIX = "titen_sk_";

/** Capabilities a key may hold. `*` grants all of them. */
export const SCOPES = [
  "projects:resolve",
  "projects:create",
  "observations:write",
  "observations:purge",
  "claims:write",
  "context:compile",
  "context:compile:all",
  "feedback:write",
  "evidence:read",
  "checkpoints:read",
  "checkpoints:write",
  "workspaces:read",
  "workspaces:write",
  "memberships:read",
  "memberships:write",
  "leases:read",
  "leases:write",
  "handoffs:read",
  "handoffs:write",
  "mcp:call",
  "events:read",
  "views:compile",
  "views:compile:all",
  "audit:read",
  "audit:export",
  "governance:read",
  "governance:write",
  "approvals:read",
  "approvals:write",
  "approvals:approve",
  "releases:read",
  "releases:write",
  "releases:approve",
  "channel:compile",
  "retention:write",
  "identity:read",
  "identity:write",
  "federation:read",
  "federation:write",
  "webhooks:read",
  "webhooks:write",
  "index:write",
  "enrichment:write",
  "keys:manage",
  "export:read",
  "export:all",
  "import:write",
] as const;
export type Scope = (typeof SCOPES)[number];

export interface Principal {
  keyId: string;
  orgId: string;
  principalId: string;
  principalKind: "human" | "agent" | "service";
  scopes: string[];
  maxTrust: Trust;
}

interface KeyRow {
  id: string;
  org_id: string;
  principal_id: string;
  principal_kind: "human" | "agent" | "service";
  scopes: string;
  max_trust: Trust;
  not_before: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header) return undefined;
  const [scheme, ...rest] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer") return undefined;
  const token = rest.join(" ").trim();
  return token === "" ? undefined : token;
}

/**
 * How stale `last_used_at` has to be before a request refreshes it.
 *
 * Every authenticated request runs the UPDATE below, so the only thing keeping
 * a `GET` from costing a durable write is that SQLite skips the page write
 * when the `CASE` leaves the stored value untouched. Measured on WAL with
 * `synchronous = FULL`: fifty updates whose `CASE` is a no-op grow the WAL by
 * **0 bytes**, fifty that actually change the value grow it by 206,032 —
 * 4,120 each, one page plus a frame header, each with its own fsync.
 *
 * Comparing against `now` meant the `CASE` fired on every request whose clock
 * had advanced by a millisecond, which in production is all of them: 25 of the
 * 27 `GET` routes paid a WAL frame and an fsync to record that they had been
 * read, and one billed write on D1. Comparing against `now - this` bounds that
 * to one write per key per interval.
 *
 * The value stays monotonic, which is what `GET /v1/keys` documents: the guard
 * only ever replaces a timestamp older than `staleBefore` with `now`, so a
 * request arriving out of order — or after the clock steps backwards — cannot
 * move it into the past. What it loses is resolution: a key used continuously
 * reports a `last_used_at` up to this interval stale. That is a reporting
 * field, not an authorization input, and nothing reads it back.
 */
export const LAST_USED_RESOLUTION_MS = 60_000;

/**
 * Verification is a single indexed lookup on the key hash. A revoked key stops
 * working on the next request because nothing about the principal is cached.
 */
export async function authenticate(
  db: Db,
  request: Request,
  now = new Date(),
): Promise<Principal> {
  const token = bearerToken(request);
  if (!token || !token.startsWith(KEY_PREFIX)) throw unauthenticated();
  const at = now.toISOString();
  const staleBefore = new Date(now.getTime() - LAST_USED_RESOLUTION_MS).toISOString();
  const rows = await db.all<KeyRow>(
    `UPDATE api_keys
        SET last_used_at = CASE
          WHEN last_used_at IS NULL OR last_used_at < ? THEN ?
          ELSE last_used_at
        END
      WHERE key_hash = ? AND revoked_at IS NULL
        AND not_before <= ? AND (expires_at IS NULL OR expires_at > ?)
      RETURNING id, org_id, principal_id, principal_kind, scopes, max_trust,
                not_before, expires_at, revoked_at`,
    [staleBefore, at, await sha256Hex(token), at, at],
  );
  const row = rows[0];
  if (!row) throw unauthenticated();
  return {
    keyId: row.id,
    orgId: row.org_id,
    principalId: row.principal_id,
    principalKind: row.principal_kind,
    scopes: row.scopes.split(" ").filter(Boolean),
    maxTrust: row.max_trust,
  };
}

export function hasScope(principal: Principal, scope: string): boolean {
  return principal.scopes.includes("*") || principal.scopes.includes(scope);
}

export function requireScope(principal: Principal, scope: string): void {
  if (!hasScope(principal, scope)) throw forbidden(`Missing required scope "${scope}".`);
}

export function requestedScopes(value: unknown, principal: Principal): string[] {
  if (!Array.isArray(value) || value.length === 0)
    throw validationError('Field "scopes" must be a non-empty array.');
  const scopes = value.map((entry) => {
    if (typeof entry !== "string") throw validationError("Each scope must be a string.");
    if (entry !== "*" && !SCOPES.includes(entry as never))
      throw validationError(`Unknown scope "${entry}".`);
    return entry;
  });
  // No credential creation or restore path may exceed its caller's authority.
  for (const scope of scopes)
    if (!hasScope(principal, scope))
      throw forbidden(`This credential may not grant scope "${scope}".`);
  return [...new Set(scopes)];
}

export type KeyLifecycleStatus = "pending" | "active" | "expired" | "revoked";

export function keyLifecycleStatus(
  key: { notBefore: string; expiresAt: string | null; revokedAt: string | null },
  at: string,
): KeyLifecycleStatus {
  if (key.revokedAt) return "revoked";
  if (key.notBefore > at) return "pending";
  if (key.expiresAt !== null && key.expiresAt <= at) return "expired";
  return "active";
}

/** A principal can never assert evidence more trusted than its own ceiling. */
export function assertTrustCeiling(principal: Principal, trust: Trust): void {
  if (TRUST_RANK[trust] > TRUST_RANK[principal.maxTrust])
    throw forbidden(`This credential may not assert "${trust}" trust.`);
}

export interface NewKey {
  orgId: string;
  principalId: string;
  principalKind: "human" | "agent" | "service";
  label: string;
  scopes: string[];
  maxTrust: Trust;
  notBefore?: Date;
  expiresAt?: Date | null;
}

/**
 * Returns the raw key exactly once. Only its SHA-256 hash reaches storage, so a
 * database copy cannot be replayed as a credential.
 */
export async function createApiKey(
  key: NewKey,
  now = new Date(),
): Promise<{ id: string; key: string; statement: { sql: string; params: (string | null)[] } }> {
  const id = newId("key");
  const raw = `${KEY_PREFIX}${randomToken()}`;
  const notBefore = key.notBefore ?? now;
  const expiresAt = key.expiresAt ?? null;
  if (Number.isNaN(notBefore.getTime()) || (expiresAt && Number.isNaN(expiresAt.getTime())))
    throw new TypeError("Key lifecycle timestamps must be valid dates.");
  if (expiresAt && notBefore.getTime() >= expiresAt.getTime())
    throw new TypeError("Key not-before must be earlier than its expiry.");
  const statement = {
    sql: `INSERT INTO api_keys
            (id, org_id, principal_id, principal_kind, key_hash, label, scopes, max_trust,
             created_at, not_before, expires_at, last_used_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    params: [
      id,
      key.orgId,
      key.principalId,
      key.principalKind,
      await sha256Hex(raw),
      key.label,
      key.scopes.join(" "),
      key.maxTrust,
      now.toISOString(),
      notBefore.toISOString(),
      expiresAt?.toISOString() ?? null,
    ],
  };
  return { id, key: raw, statement };
}

export function organizationStatement(
  orgId: string,
  name: string,
  now = new Date(),
): { sql: string; params: string[] } {
  return {
    sql: `INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)`,
    params: [orgId, name, now.toISOString()],
  };
}
