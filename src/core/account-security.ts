import { createApiKey } from "./auth";
import { auditStatement } from "./audit";
import { first, type Stmt } from "./db";
import { ApiError, conflict, notFound, validationError } from "./errors";
import { newId, randomToken, sha256Hex } from "./ids";
import type { RequestContext, Result } from "./http";
import { verifyPassword } from "./accounts";
import {
  base64UrlDecode,
  base64UrlEncode,
  type WebAuthnCapability,
  type WebAuthnStoredCredential,
} from "./webauthn";
import type { Trust } from "./validate";

const CHALLENGE_TTL_MS = 5 * 60_000;
const FULL_SESSION_TTL_MS = 8 * 60 * 60_000;
const RECOVERY_CODE_COUNT = 8;

interface SecurityAccountRow {
  id: string;
  org_id: string;
  principal_id: string;
  username: string;
  password_verifier: string;
  scopes: string;
  max_trust: Trust;
  role: string;
}

interface CredentialRow {
  id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string;
  device_type: "singleDevice" | "multiDevice";
  backed_up: number;
  label: string;
  created_at_ms: number;
  last_used_at_ms: number | null;
}

function secondFactorInvalid(): ApiError {
  return new ApiError(401, "SECOND_FACTOR_INVALID", "Second-factor verification failed.");
}

function webauthnInvalid(): ApiError {
  return new ApiError(400, "WEBAUTHN_INVALID", "WebAuthn verification failed.");
}

function confirmationInvalid(): ApiError {
  return new ApiError(401, "PASSWORD_CONFIRMATION_REQUIRED", "Current password confirmation is required.");
}

function capability(ctx: RequestContext): WebAuthnCapability {
  if (ctx.app.webauthn.configuration.state !== "enabled")
    throw new ApiError(409, "WEBAUTHN_UNAVAILABLE", "WebAuthn is not available.");
  return ctx.app.webauthn as WebAuthnCapability;
}

async function accountForPrincipal(ctx: RequestContext): Promise<SecurityAccountRow> {
  const principal = ctx.principal!;
  const account = await first<SecurityAccountRow>(ctx.app.db,
    `SELECT a.id, a.org_id, a.principal_id, a.username, a.password_verifier,
            a.scopes, a.max_trust, m.role
       FROM operator_accounts a
       JOIN memberships m ON m.org_id = a.org_id
        AND m.workspace_id IS NULL AND m.principal_id = a.principal_id
        AND m.principal_kind = 'human' AND m.removed_at IS NULL
      WHERE a.org_id = ? AND a.principal_id = ? AND a.disabled_at IS NULL
      LIMIT 1`,
    [principal.orgId, principal.principalId]);
  if (!account) throw notFound();
  return account;
}

function parseTransports(value: string): WebAuthnStoredCredential["transports"] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is NonNullable<WebAuthnStoredCredential["transports"]>[number] =>
      typeof entry === "string" && ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"].includes(entry)) : [];
  } catch {
    return [];
  }
}

function storedCredential(row: CredentialRow): WebAuthnStoredCredential {
  return {
    id: row.credential_id,
    publicKey: base64UrlDecode(row.public_key),
    counter: Number(row.counter),
    transports: parseTransports(row.transports),
  };
}

async function credentialRows(ctx: RequestContext, accountId: string): Promise<CredentialRow[]> {
  return ctx.app.db.all<CredentialRow>(
    `SELECT id, credential_id, public_key, counter, transports, device_type,
            backed_up, label, created_at_ms, last_used_at_ms
       FROM webauthn_credentials
      WHERE org_id = ? AND account_id = ? AND revoked_at_ms IS NULL
      ORDER BY created_at_ms, id`,
    [ctx.principal!.orgId, accountId],
  );
}

function bodyString(body: Record<string, unknown>, field: string, max = 1_024): string {
  const value = body[field];
  if (typeof value !== "string" || !value.isWellFormed() || value.length < 1 || value.length > max)
    throw validationError(`Field "${field}" must be a non-empty string with at most ${max} characters.`);
  return value.normalize("NFC");
}

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw validationError('Field "response" must be an object.');
  return value as Record<string, unknown>;
}

function exactBodyFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(body).some((field) => !allowed.includes(field)))
    throw validationError("Request fields do not match the operation schema.");
}

async function issueChallenge(
  ctx: RequestContext,
  account: SecurityAccountRow,
  purpose: "registration" | "authentication",
  options: object & { challenge: string },
): Promise<Result> {
  const now = ctx.app.now().getTime();
  const id = newId("wch");
  await ctx.app.db.batch([
    {
      sql: `DELETE FROM webauthn_challenges
             WHERE account_id = ? AND (expires_at_ms <= ? OR used_at_ms IS NOT NULL)`,
      params: [account.id, now],
    },
    {
      sql: `INSERT INTO webauthn_challenges
              (id, org_id, account_id, session_key_id, purpose, challenge_hash,
               created_at_ms, expires_at_ms, used_at_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      params: [id, account.org_id, account.id, ctx.principal!.keyId, purpose,
        await sha256Hex(options.challenge), now, now + CHALLENGE_TTL_MS],
    },
  ]);
  return { status: 201, data: { challenge_id: id, options } };
}

async function consumeChallenge(
  ctx: RequestContext,
  account: SecurityAccountRow,
  purpose: "registration" | "authentication",
  challengeId: string,
): Promise<string> {
  const now = ctx.app.now().getTime();
  const [claimed] = await ctx.app.db.all<{ challenge_hash: string }>(
    `UPDATE webauthn_challenges SET used_at_ms = ?
      WHERE id = ? AND org_id = ? AND account_id = ? AND session_key_id = ?
        AND purpose = ? AND used_at_ms IS NULL AND expires_at_ms > ?
      RETURNING challenge_hash`,
    [now, challengeId, account.org_id, account.id, ctx.principal!.keyId, purpose, now],
  );
  if (!claimed) throw purpose === "registration" ? webauthnInvalid() : secondFactorInvalid();
  return claimed.challenge_hash;
}

function recoverySet(account: SecurityAccountRow, generationId: string, now: number) {
  const raw = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomToken(16));
  return Promise.all(raw.map(async (code) => ({
    code,
    statement: {
      sql: `INSERT INTO operator_recovery_codes
              (id, org_id, account_id, generation_id, code_hash, created_at_ms, used_at_ms)
            SELECT ?, ?, ?, ?, ?, ?, NULL
             WHERE EXISTS (
               SELECT 1 FROM operator_recovery_generations
                WHERE account_id = ? AND generation_id = ?
             )`,
      params: [newId("rcv"), account.org_id, account.id, generationId,
        await sha256Hex(`recovery:${account.id}:${code}`), now, account.id, generationId],
    } satisfies Stmt,
  })));
}

async function completeFullSession(ctx: RequestContext, account: SecurityAccountRow): Promise<Result> {
  const now = ctx.app.now();
  const expiresAt = new Date(now.getTime() + FULL_SESSION_TTL_MS);
  const scopes = account.scopes.split(" ").filter(Boolean);
  const created = await createApiKey({
    orgId: account.org_id,
    principalId: account.principal_id,
    principalKind: "human",
    label: "Dashboard session",
    scopes,
    maxTrust: account.max_trust,
    expiresAt,
    authStage: "full",
  }, now);
  await ctx.app.db.batch([
    created.statement,
    {
      sql: `UPDATE api_keys SET revoked_at = ?
             WHERE id = ? AND org_id = ? AND auth_stage = 'second_factor'
               AND revoked_at IS NULL`,
      params: [now.toISOString(), ctx.principal!.keyId, account.org_id],
    },
    auditStatement(account.org_id, account.principal_id, "dashboard_session.second_factor_complete", "api_key", now.toISOString(), created.id),
  ]);
  return { status: 201, data: {
    api_key: created.key,
    expires_at: expiresAt.toISOString(),
    organization_id: account.org_id,
    principal_id: account.principal_id,
    principal_kind: "human",
    key_id: created.id,
    scopes,
    max_trust: account.max_trust,
    organization_role: account.role,
    password_change_required: false,
    second_factor_required: false,
    auth_stage: "full",
  } };
}

export async function createPasskeyRegistrationOptions(ctx: RequestContext): Promise<Result> {
  const webauthn = capability(ctx);
  const account = await accountForPrincipal(ctx);
  const credentials = (await credentialRows(ctx, account.id)).map(storedCredential);
  const options = await webauthn.registrationOptions({
    accountId: account.id,
    username: account.username,
    credentials,
  });
  return issueChallenge(ctx, account, "registration", options);
}

export async function registerPasskey(ctx: RequestContext): Promise<Result> {
  const webauthn = capability(ctx);
  const account = await accountForPrincipal(ctx);
  const body = await ctx.json<Record<string, unknown>>();
  exactBodyFields(body, ["challenge_id", "label", "response"]);
  const challengeId = bodyString(body, "challenge_id", 96);
  const label = bodyString(body, "label", 80);
  const response = bodyObject(body.response);
  const challengeHash = await consumeChallenge(ctx, account, "registration", challengeId);
  const verified = await webauthn.verifyRegistration({ response, challengeHash });
  if (!verified.verified || !verified.credential) throw webauthnInvalid();
  const credential = verified.credential;
  if (!/^[A-Za-z0-9_-]{1,1024}$/u.test(credential.id)) throw webauthnInvalid();
  const before = await credentialRows(ctx, account.id);
  const now = ctx.app.now().getTime();
  const credentialId = newId("wcr");
  const generationId = newId("rcg");
  const recovery = before.length === 0 ? await recoverySet(account, generationId, now) : [];
  const statements: Stmt[] = [];
  if (before.length === 0) {
    statements.push({
      sql: `INSERT OR IGNORE INTO operator_recovery_generations
              (account_id, generation_id, generation, created_at_ms)
            VALUES (?, ?, 1, ?)`,
      params: [account.id, generationId, now],
    });
    statements.push({
      sql: `UPDATE api_keys SET revoked_at = ?
             WHERE org_id = ? AND principal_id = ? AND principal_kind = 'human'
               AND label = 'Dashboard session' AND auth_stage = 'full'
               AND id <> ? AND revoked_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM operator_recovery_generations
                  WHERE account_id = ? AND generation_id = ?
               )`,
      params: [new Date(now).toISOString(), account.org_id, account.principal_id,
        ctx.principal!.keyId, account.id, generationId],
    });
  }
  statements.push({
    sql: `INSERT INTO webauthn_credentials
            (id, org_id, account_id, credential_id, public_key, counter,
             transports, device_type, backed_up, label, created_at_ms,
             last_used_at_ms, revoked_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    params: [credentialId, account.org_id, account.id, credential.id,
      base64UrlEncode(credential.publicKey), credential.counter,
      JSON.stringify(credential.transports ?? []), credential.deviceType,
      credential.backedUp ? 1 : 0, label, now],
  });
  statements.push(...recovery.map((entry) => entry.statement));
  statements.push(auditStatement(account.org_id, account.principal_id,
    "operator_account.passkey_register", "webauthn_credential", new Date(now).toISOString(), credentialId));
  await ctx.app.db.batch(statements);
  const generation = before.length === 0
    ? await first<{ generation_id: string }>(ctx.app.db,
      "SELECT generation_id FROM operator_recovery_generations WHERE account_id = ?", [account.id])
    : undefined;
  return { status: 201, data: {
    credential: {
      id: credentialId,
      label,
      device_type: credential.deviceType,
      backed_up: credential.backedUp,
      created_at: new Date(now).toISOString(),
    },
    recovery_codes: generation?.generation_id === generationId
      ? recovery.map((entry) => entry.code)
      : [],
  } };
}

export async function listPasskeys(ctx: RequestContext): Promise<Result> {
  const account = await accountForPrincipal(ctx);
  const credentials = await credentialRows(ctx, account.id);
  return { data: { credentials: credentials.map((credential) => ({
    id: credential.id,
    label: credential.label,
    device_type: credential.device_type,
    backed_up: credential.backed_up === 1,
    created_at: new Date(credential.created_at_ms).toISOString(),
    last_used_at: credential.last_used_at_ms === null
      ? null
      : new Date(credential.last_used_at_ms).toISOString(),
  })) } };
}

export async function removePasskey(ctx: RequestContext): Promise<Result> {
  const account = await accountForPrincipal(ctx);
  const credentials = await credentialRows(ctx, account.id);
  const selected = credentials.find((credential) => credential.id === ctx.params.id);
  if (!selected) throw notFound();
  const body = await ctx.json<Record<string, unknown>>();
  exactBodyFields(body, ["password"]);
  if (credentials.length === 1) {
    const confirmation = typeof body.password === "string" && body.password.length <= 128
      ? body.password.normalize("NFC")
      : undefined;
    if (!confirmation || !(await verifyPassword(confirmation, account.password_verifier)))
      throw confirmationInvalid();
  }
  const now = ctx.app.now();
  await ctx.app.db.batch([
    {
      sql: `UPDATE webauthn_credentials SET revoked_at_ms = ?
             WHERE id = ? AND org_id = ? AND account_id = ? AND revoked_at_ms IS NULL`,
      params: [now.getTime(), selected.id, account.org_id, account.id],
    },
    ...(credentials.length === 1 ? [{
      sql: `DELETE FROM operator_recovery_generations WHERE account_id = ?`,
      params: [account.id],
    }] : []),
    auditStatement(account.org_id, account.principal_id,
      "operator_account.passkey_revoke", "webauthn_credential", now.toISOString(), selected.id),
  ]);
  return { data: { credential_id: selected.id, revoked: true } };
}

export async function regenerateRecoveryCodes(ctx: RequestContext): Promise<Result> {
  const account = await accountForPrincipal(ctx);
  if ((await credentialRows(ctx, account.id)).length === 0)
    throw conflict("Register a passkey before generating recovery codes.");
  const now = ctx.app.now().getTime();
  const previous = await first<{ generation: number }>(ctx.app.db,
    "SELECT generation FROM operator_recovery_generations WHERE account_id = ?", [account.id]);
  const generationId = newId("rcg");
  const recovery = await recoverySet(account, generationId, now);
  await ctx.app.db.batch([
    { sql: `DELETE FROM operator_recovery_generations WHERE account_id = ?`, params: [account.id] },
    {
      sql: `INSERT INTO operator_recovery_generations
              (account_id, generation_id, generation, created_at_ms)
            VALUES (?, ?, ?, ?)`,
      params: [account.id, generationId, Number(previous?.generation ?? 0) + 1, now],
    },
    ...recovery.map((entry) => entry.statement),
    auditStatement(account.org_id, account.principal_id,
      "operator_account.recovery_regenerate", "operator_account", new Date(now).toISOString(), account.id),
  ]);
  return { status: 201, data: { recovery_codes: recovery.map((entry) => entry.code) } };
}

export async function createPasskeyAuthenticationOptions(ctx: RequestContext): Promise<Result> {
  const webauthn = capability(ctx);
  const account = await accountForPrincipal(ctx);
  const credentials = (await credentialRows(ctx, account.id)).map(storedCredential);
  if (credentials.length === 0) throw secondFactorInvalid();
  const options = await webauthn.authenticationOptions({ credentials });
  return issueChallenge(ctx, account, "authentication", options);
}

export async function completePasskeyAuthentication(ctx: RequestContext): Promise<Result> {
  const webauthn = capability(ctx);
  const account = await accountForPrincipal(ctx);
  const body = await ctx.json<Record<string, unknown>>();
  exactBodyFields(body, ["challenge_id", "response"]);
  const challengeId = bodyString(body, "challenge_id", 96);
  const response = bodyObject(body.response);
  const responseCredentialId = typeof response.id === "string" ? response.id : "";
  const row = (await credentialRows(ctx, account.id))
    .find((credential) => credential.credential_id === responseCredentialId);
  if (!row) throw secondFactorInvalid();
  const challengeHash = await consumeChallenge(ctx, account, "authentication", challengeId);
  const verified = await webauthn.verifyAuthentication({
    response,
    challengeHash,
    credential: storedCredential(row),
  });
  if (!verified.verified || verified.newCounter === undefined) throw secondFactorInvalid();
  const now = ctx.app.now().getTime();
  const [updated] = await ctx.app.db.all<{ id: string }>(
    `UPDATE webauthn_credentials SET counter = ?, last_used_at_ms = ?
      WHERE id = ? AND org_id = ? AND account_id = ? AND counter = ?
        AND revoked_at_ms IS NULL
      RETURNING id`,
    [verified.newCounter, now, row.id, account.org_id, account.id, row.counter],
  );
  if (!updated) throw secondFactorInvalid();
  return completeFullSession(ctx, account);
}

export async function completeRecoveryAuthentication(ctx: RequestContext): Promise<Result> {
  const account = await accountForPrincipal(ctx);
  const body = await ctx.json<Record<string, unknown>>();
  exactBodyFields(body, ["recovery_code"]);
  const code = bodyString(body, "recovery_code", 64);
  const now = ctx.app.now().getTime();
  const codeHash = await sha256Hex(`recovery:${account.id}:${code}`);
  const [claimed] = await ctx.app.db.all<{ id: string }>(
    `UPDATE operator_recovery_codes SET used_at_ms = ?
      WHERE org_id = ? AND account_id = ? AND code_hash = ? AND used_at_ms IS NULL
      RETURNING id`,
    [now, account.org_id, account.id, codeHash],
  );
  if (!claimed) throw secondFactorInvalid();
  return completeFullSession(ctx, account);
}
