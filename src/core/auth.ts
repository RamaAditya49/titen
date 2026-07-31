import { first, type Db } from "./db";
import { forbidden, unauthenticated } from "./errors";
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
  "audit:read",
  "audit:export",
  "federation:read",
  "federation:write",
  "webhooks:read",
  "webhooks:write",
  "index:write",
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
 * Verification is a single indexed lookup on the key hash. A revoked key stops
 * working on the next request because nothing about the principal is cached.
 */
export async function authenticate(db: Db, request: Request): Promise<Principal> {
  const token = bearerToken(request);
  if (!token || !token.startsWith(KEY_PREFIX)) throw unauthenticated();
  const row = await first<KeyRow>(
    db,
    `SELECT id, org_id, principal_id, principal_kind, scopes, max_trust, revoked_at
       FROM api_keys WHERE key_hash = ?`,
    [await sha256Hex(token)],
  );
  if (!row || row.revoked_at) throw unauthenticated();
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
  const statement = {
    sql: `INSERT INTO api_keys
            (id, org_id, principal_id, principal_kind, key_hash, label, scopes, max_trust, created_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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
