import { ApiError } from "./errors";
import { sha256Hex } from "./ids";
import type { Db, Stmt } from "./db";
import type { RequestContext } from "./http";
import { auditStatement } from "./audit";

const WINDOW_MS = 15 * 60_000;
const MAX_BUCKETS = 4096;

export function loginLimited(): ApiError {
  return new ApiError(429, "LOGIN_RATE_LIMITED", "Too many sign-in attempts. Try again later.");
}

export function passwordCheckGuard(limit = 4) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new Error("Invalid password check limit.");
  let active = 0;
  return async <T>(run: () => Promise<T>): Promise<T> => {
    if (active >= limit) throw loginLimited();
    active++;
    try { return await run(); } finally { active--; }
  };
}

export function assertCanonicalPath(rawUrl: string): void {
  let path = rawUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/iu, "").split(/[?#]/u, 1)[0] ?? "/";
  for (let i = 0; i < 4; i++) {
    if (/\\|\0|%00|%2f|%5c|(?:^|\/)\.{1,2}(?:\/|$)/iu.test(path))
      throw new ApiError(400, "NON_CANONICAL_PATH", "Request path must be canonical.");
    let decoded: string;
    try { decoded = decodeURIComponent(path); } catch {
      throw new ApiError(400, "NON_CANONICAL_PATH", "Request path must be canonical.");
    }
    if (decoded === path) return;
    path = decoded;
  }
  throw new ApiError(400, "NON_CANONICAL_PATH", "Request path must be canonical.");
}

export async function accountAttemptKey(username: string | undefined): Promise<string> {
  return sha256Hex(`dashboard-login:${username ?? "__invalid_username__"}`);
}

export async function loginAttemptKeys(ctx: RequestContext, username: string | undefined) {
  const account = await accountAttemptKey(username);
  const client = await sha256Hex(ctx.app.loginClient?.(ctx.request) ?? "unknown-client");
  return { account, client: `${account}.${client}` };
}

export async function admitPasswordAttempt(ctx: RequestContext, keys: { account: string; client: string }, now: number) {
  const rows = await ctx.app.db.all<{ blocked_until_ms: number }>(
    "SELECT blocked_until_ms FROM login_throttles WHERE identity_hash IN (?, ?)", [keys.account, keys.client]);
  if (rows.some((row) => row.blocked_until_ms > now))
    throw new ApiError(401, "INVALID_LOGIN", "Username or password is invalid.");
  await ctx.app.db.batch([
    { sql: "DELETE FROM login_throttles WHERE blocked_until_ms <= ? AND touched_at_ms <= ?", params: [now, now - WINDOW_MS] },
    ...[keys.account, keys.client].map((key): Stmt => ({
      sql: `INSERT OR IGNORE INTO login_throttles (identity_hash, failures, blocked_until_ms, touched_at_ms)
        SELECT ?, 1, -1, ? WHERE (SELECT COUNT(*) FROM login_throttles) < ?`, params: [key, now, MAX_BUCKETS],
    })),
  ]);
  const admitted = await ctx.app.db.all<{ count: number }>(
    "SELECT COUNT(*) AS count FROM login_throttles WHERE identity_hash IN (?, ?)", [keys.account, keys.client]);
  if (Number(admitted[0]?.count) !== 2) throw loginLimited();
}

export async function recordLoginFailure(ctx: RequestContext, keys: { account: string; client: string }, now: number,
  account?: { id: string; org_id: string; principal_id: string }) {
  const statements: Stmt[] = [];
  for (const [key, limit, kind] of [[keys.account, 50, "account"], [keys.client, 5, "client"]] as const) {
    const count = `(CASE WHEN blocked_until_ms = -1 OR ? - touched_at_ms >= ${WINDOW_MS} THEN 1 ELSE failures + 1 END)`;
    statements.push({ sql: `UPDATE login_throttles SET
      blocked_until_ms = CASE
        WHEN ${count} < ? THEN 0
        WHEN ${count} = ? THEN ? + 30000
        WHEN ${count} = ? + 1 THEN ? + 60000
        WHEN ${count} = ? + 2 THEN ? + 300000
        WHEN ${count} = ? + 3 THEN ? + 900000
        ELSE ? + 1800000 END,
      failures = ${count}, touched_at_ms = ? WHERE identity_hash = ? AND blocked_until_ms <= ?`,
      params: [now, limit, now, limit, now, now, limit, now, now, limit, now, now, limit, now, now, now, now, key, now] });
    if (account) {
      const audit = auditStatement(account.org_id, account.principal_id, "operator_account.login_block", "operator_account", new Date(now).toISOString(), account.id);
      statements.push({ sql: `INSERT INTO audit_log (id, org_id, actor_id, action, resource_type, resource_id, detail, ip_hint, created_at)
        SELECT ?, ?, ?, ?, ?, ?, json_object('bucket', ?, 'bucket_hash', ?, 'failed_attempts', failures, 'blocked_until_ms', blocked_until_ms), NULL, ?
        FROM login_throttles WHERE identity_hash = ? AND blocked_until_ms > ?
        AND NOT EXISTS (SELECT 1 FROM audit_log WHERE org_id = ? AND action = 'operator_account.login_block'
          AND resource_id = ? AND detail = json_object('bucket', ?, 'bucket_hash', ?, 'failed_attempts', login_throttles.failures, 'blocked_until_ms', login_throttles.blocked_until_ms))`,
        params: [...audit.params!.slice(0, 6), kind, key, new Date(now).toISOString(), key, now, account.org_id, account.id, kind, key] });
    }
  }
  await ctx.app.db.batch(statements);
}

export async function failedLoginCount(db: Db, accountKey: string): Promise<number> {
  const rows = await db.all<{ failures: number }>("SELECT CASE WHEN blocked_until_ms = -1 THEN 0 ELSE failures END AS failures FROM login_throttles WHERE identity_hash = ?", [accountKey]);
  return Number(rows[0]?.failures ?? 0);
}

export function clearAccountAttempts(accountKey: string): Stmt {
  return { sql: "DELETE FROM login_throttles WHERE identity_hash = ? OR identity_hash LIKE ?", params: [accountKey, `${accountKey}.%`] };
}


export function guardedSessionInsert(statement: Stmt, account: {
  id: string; org_id: string; principal_id: string; password_verifier: string;
  must_change_password: number; scopes: string; max_trust: string; role: string; webauthn_credentials?: number;
}, stagedKey?: { id: string; now: string }): Stmt {
  const conditions = `EXISTS (SELECT 1 FROM operator_accounts a JOIN memberships m
    ON m.org_id = a.org_id AND m.principal_id = a.principal_id AND m.principal_kind = 'human'
    AND m.workspace_id IS NULL AND m.removed_at IS NULL
    WHERE a.id = ? AND a.org_id = ? AND a.principal_id = ? AND a.disabled_at IS NULL
    AND a.password_verifier = ? AND a.must_change_password = ? AND a.scopes = ? AND a.max_trust = ? AND m.role = ?)`;
  const params = [account.id, account.org_id, account.principal_id, account.password_verifier,
    account.must_change_password, account.scopes, account.max_trust, account.role];
  let where = conditions;
  if (account.webauthn_credentials !== undefined) {
    where += ` AND (SELECT COUNT(*) FROM webauthn_credentials WHERE account_id = ? AND revoked_at_ms IS NULL) = ?`;
    params.push(account.id, account.webauthn_credentials);
  }
  if (stagedKey) {
    where += ` AND EXISTS (SELECT 1 FROM api_keys WHERE id = ? AND org_id = ? AND principal_id = ?
      AND auth_stage = 'second_factor' AND revoked_at IS NULL AND expires_at > ?)`;
    params.push(stagedKey.id, account.org_id, account.principal_id, stagedKey.now);
  }
  return conditionalInsert(statement, where, params);
}

export function conditionalInsert(statement: Stmt, where: string, params: import("./db").Param[]): Stmt {
  return { sql: statement.sql.replace(/VALUES\s*\(([\s\S]*)\)\s*$/u, (_match, values: string) => `SELECT ${values} WHERE ${where}`),
    params: [...statement.params ?? [], ...params] };
}

export function sessionExists(): string {
  // The caller supplies the key identifier as a bound parameter.
  return "EXISTS (SELECT 1 FROM api_keys WHERE id = ? AND revoked_at IS NULL)";
}
