import type { Db } from "../../core/db";
import { first } from "../../core/db";
import { hashPassword } from "../../core/accounts";
import { accountAttemptKey, clearAccountAttempts } from "../../core/login-security";
import { auditStatement } from "../../core/audit";
import { randomToken } from "../../core/ids";

export async function listHostAccounts(db: Db) {
  return db.all(`SELECT a.username, a.disabled_at, a.must_change_password,
    (SELECT COUNT(*) FROM webauthn_credentials c WHERE c.account_id = a.id AND c.revoked_at_ms IS NULL) AS passkey_count
    FROM operator_accounts a ORDER BY a.username`);
}

export async function recoverHostAccount(db: Db, username: string, reset: boolean) {
  const normalized = username.normalize("NFC").toLowerCase();
  const account = await first<{ id: string; org_id: string; principal_id: string }>(db,
    "SELECT id, org_id, principal_id FROM operator_accounts WHERE username = ?", [normalized]);
  if (!account) throw new Error("Account was not found.");
  const temporaryPassword = reset ? randomToken(18) : undefined;
  const verifier = temporaryPassword ? await hashPassword(temporaryPassword) : undefined;
  const at = new Date().toISOString();
  await db.batch([
    clearAccountAttempts(await accountAttemptKey(normalized)),
    ...(verifier ? [
      { sql: "UPDATE operator_accounts SET password_verifier = ?, must_change_password = 1, password_changed_at = ? WHERE id = ?", params: [verifier, at, account.id] },
      { sql: `UPDATE api_keys SET revoked_at = ? WHERE org_id = ? AND principal_id = ?
        AND principal_kind = 'human' AND label = 'Dashboard session' AND revoked_at IS NULL`, params: [at, account.org_id, account.principal_id] },
    ] : []),
    auditStatement(account.org_id, "host_operator", reset ? "operator_account.host_password_reset" : "operator_account.host_unlock", "operator_account", at, account.id),
  ]);
  return { username: normalized, temporaryPassword };
}
