import { createApiKey, requestedScopes, requireScope } from "./auth";
import { auditStatement } from "./audit";
import { first, type Stmt } from "./db";
import { ApiError, forbidden, notFound, validationError } from "./errors";
import { newId, randomToken } from "./ids";
import { requireOrgRole } from "./governance";
import type { RequestContext, Result } from "./http";
import {
  TRUST_LEVELS,
  TRUST_RANK,
  optionalEnum,
  requireEnum,
  requireObject,
  type Trust,
} from "./validate";

const PASSWORD_ALGORITHM = "pbkdf2-sha256";
const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_ROUNDS = 6;
const PASSWORD_WORK_FACTOR = `${PASSWORD_ITERATIONS}x${PASSWORD_ROUNDS}`;
const LEGACY_PASSWORD_ITERATIONS = 600_000;
const PASSWORD_MIN_LENGTH = 15;
const PASSWORD_MAX_LENGTH = 128;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PASSWORD_CHANGE_TTL_MS = 15 * 60 * 1000;
const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPT_BUCKETS = 256;
const MEMBER_ROLES = ["owner", "admin", "member", "reader"] as const;
const encoder = new TextEncoder();
const COMMON_PASSWORDS = new Set([
  "123456789012345", "111111111111111", "adminadminadmin", "administrator",
  "changemechangeme", "correcthorsebatterystaple", "iloveyouiloveyou",
  "letmeinletmeinlet", "monkeymonkeymonkey", "password123456789",
  "passwordpassword", "qwerty1234567890", "qwertyuiopasdfgh",
  "titen-dashboard", "titenadministrator", "welcome123456789",
]);

interface AccountRow {
  id: string;
  org_id: string;
  principal_id: string;
  password_verifier: string;
  scopes: string;
  max_trust: Trust;
  role: (typeof MEMBER_ROLES)[number];
  must_change_password: number;
}

interface AttemptBucket { failures: number; blockedUntil: number; touchedAt: number }

const attempts = new Map<string, AttemptBucket>();
let dummyVerifier: Promise<string> | undefined;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function bytes(value: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return;
  }
}

async function derive(
  material: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  ));
}

async function derivePassword(password: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  let material = encoder.encode(password);
  for (let round = 0; round < PASSWORD_ROUNDS; round += 1) {
    const roundSalt = new Uint8Array(salt.length + 1);
    roundSalt.set(salt);
    roundSalt[salt.length] = round;
    material = await derive(material, roundSalt, PASSWORD_ITERATIONS);
  }
  return material;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password.normalize("NFC"), salt);
  return `${PASSWORD_ALGORITHM}$${PASSWORD_WORK_FACTOR}$${base64Url(salt)}$${base64Url(hash)}`;
}

export async function verifyPassword(password: string, verifier: string): Promise<boolean> {
  const [algorithm, rawIterations, rawSalt, rawHash, ...rest] = verifier.split("$");
  const iterations = Number(rawIterations);
  const salt = rawSalt ? bytes(rawSalt) : undefined;
  const expected = rawHash ? bytes(rawHash) : undefined;
  const chained = rawIterations === PASSWORD_WORK_FACTOR;
  if (algorithm !== PASSWORD_ALGORITHM
    || (!chained && (iterations < LEGACY_PASSWORD_ITERATIONS || iterations > 2_000_000))
    || salt?.length !== 16 || expected?.length !== 32 || rest.length) return false;
  let actual: Uint8Array;
  try {
    actual = chained
      ? await derivePassword(password.normalize("NFC"), salt)
      : await derive(encoder.encode(password.normalize("NFC")), salt, iterations);
  } catch (error) {
    if (!chained && error instanceof DOMException && error.name === "NotSupportedError") return false;
    throw error;
  }
  let mismatch = actual.length ^ expected.length;
  for (let index = 0; index < expected.length; index++) mismatch |= actual[index]! ^ expected[index]!;
  return mismatch === 0;
}

function username(value: unknown, disclose: boolean): string | undefined {
  if (typeof value !== "string") {
    if (disclose) throw validationError('Field "username" must be a string.');
    return;
  }
  const normalized = value.normalize("NFC").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(normalized)) {
    if (disclose) throw validationError('Field "username" must be 3-64 lowercase letters, numbers, dot, underscore, or hyphen.');
    return;
  }
  return normalized;
}

function password(value: unknown, login: boolean, usernameValue?: string): string | undefined {
  if (typeof value !== "string" || !value.isWellFormed()) {
    if (!login) throw validationError('Field "password" must be a well-formed string.');
    return;
  }
  const normalized = value.normalize("NFC");
  const length = [...normalized].length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    if (!login) throw validationError(`Field "password" must contain ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters.`);
    return;
  }
  if (!login) {
    const folded = normalized.toLowerCase();
    const contextual = usernameValue && [
      usernameValue,
      `${usernameValue}123456`,
      `${usernameValue}-password`,
      `${usernameValue}@titen`,
    ].includes(folded);
    if (contextual || COMMON_PASSWORDS.has(folded))
      throw validationError('Field "password" is too common; choose a longer passphrase.');
  }
  return normalized;
}

function invalidLogin(): ApiError {
  return new ApiError(401, "INVALID_LOGIN", "Username or password is invalid.");
}

function attemptKey(value: string | undefined): string {
  return value ?? "__invalid_username__";
}

function assertAttemptAllowed(key: string, now: number): void {
  const bucket = attempts.get(key);
  if (!bucket) return;
  if (bucket.blockedUntil > now)
    throw new ApiError(429, "LOGIN_RATE_LIMITED", "Too many sign-in attempts. Try again later.");
  if (now - bucket.touchedAt >= ATTEMPT_WINDOW_MS) attempts.delete(key);
}

function failedAttempt(key: string, now: number): void {
  const current = attempts.get(key);
  const failures = current && now - current.touchedAt < ATTEMPT_WINDOW_MS ? current.failures + 1 : 1;
  attempts.delete(key);
  attempts.set(key, {
    failures,
    blockedUntil: failures >= ATTEMPT_LIMIT ? now + ATTEMPT_WINDOW_MS : 0,
    touchedAt: now,
  });
  while (attempts.size > MAX_ATTEMPT_BUCKETS) attempts.delete(attempts.keys().next().value!);
}

export async function newOperatorAccount(input: {
  orgId: string;
  createdBy: string;
  username: string;
  role: (typeof MEMBER_ROLES)[number];
  scopes: string[];
  maxTrust: Trust;
  now?: Date;
  principalId?: string;
}): Promise<{
  accountId: string;
  membershipId: string;
  principalId: string;
  username: string;
  temporaryPassword: string;
  statements: Stmt[];
}> {
  const login = username(input.username, true)!;
  const accountId = newId("usr");
  const membershipId = newId("mbr");
  const principalId = input.principalId ?? newId("human");
  const now = (input.now ?? new Date()).toISOString();
  const temporaryPassword = randomToken(18);
  const verifier = await hashPassword(temporaryPassword);
  return {
    accountId,
    membershipId,
    principalId,
    username: login,
    temporaryPassword,
    statements: [
      {
        sql: `INSERT INTO memberships
                (id, org_id, workspace_id, principal_id, principal_kind, role, created_at)
              VALUES (?, ?, NULL, ?, 'human', ?, ?)`,
        params: [membershipId, input.orgId, principalId, input.role, now],
      },
      {
        sql: `INSERT INTO operator_accounts
                (id, org_id, principal_id, username, password_verifier, scopes,
                 max_trust, must_change_password, created_by, created_at,
                 password_changed_at, disabled_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL)`,
        params: [accountId, input.orgId, principalId, login, verifier,
          input.scopes.join(" "), input.maxTrust, input.createdBy, now],
      },
    ],
  };
}

export async function createOperatorAccount(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  requireScope(principal, "memberships:write");
  const authority = await requireOrgRole(ctx, ["owner", "admin"], "operator_account.create");
  const body = requireObject(await ctx.json());
  const allowed = new Set(["username", "role", "scopes", "max_trust"]);
  const unknown = Object.keys(body).find((field) => !allowed.has(field));
  if (unknown) throw validationError(`Unknown operator account field "${unknown}".`);
  const login = username(body.username, true)!;
  const role = requireEnum(body, "role", MEMBER_ROLES);
  if (role === "owner" && authority === "admin") throw forbidden("Only an organization owner may assign the owner role.");
  const scopes = requestedScopes(body.scopes, principal);
  const maxTrust = optionalEnum(body, "max_trust", TRUST_LEVELS, "asserted") as Trust;
  if (TRUST_RANK[maxTrust] > TRUST_RANK[principal.maxTrust])
    throw forbidden("A human account may not exceed the creating credential's trust ceiling.");

  const now = ctx.app.now();
  const account = await newOperatorAccount({
    orgId: principal.orgId,
    createdBy: principal.principalId,
    username: login,
    role,
    scopes,
    maxTrust,
    now,
  });
  await ctx.app.db.batch([
    ...account.statements,
    auditStatement(principal.orgId, principal.principalId, "operator_account.create", "operator_account", now.toISOString(), account.accountId),
  ]);
  return { status: 201, data: {
    account_id: account.accountId,
    username: account.username,
    principal_id: account.principalId,
    principal_kind: "human",
    membership_id: account.membershipId,
    role,
    scopes,
    max_trust: maxTrust,
    temporary_password: account.temporaryPassword,
    password_change_required: true,
  } };
}

export async function createDashboardSession(ctx: RequestContext): Promise<Result> {
  const body = requireObject(await ctx.json());
  const unknown = Object.keys(body).find((field) => field !== "username" && field !== "password");
  if (unknown) throw validationError(`Unknown dashboard session field "${unknown}".`);
  const login = username(body.username, false);
  const secret = password(body.password, true);
  const key = attemptKey(login);
  const now = ctx.app.now();
  assertAttemptAllowed(key, now.getTime());
  const account = login ? await first<AccountRow>(ctx.app.db,
    `SELECT a.id, a.org_id, a.principal_id, a.password_verifier, a.scopes,
            a.max_trust, a.must_change_password, m.role
       FROM operator_accounts a
       JOIN memberships m ON m.org_id = a.org_id
        AND m.workspace_id IS NULL AND m.principal_id = a.principal_id
        AND m.principal_kind = 'human' AND m.removed_at IS NULL
      WHERE a.username = ? AND a.disabled_at IS NULL LIMIT 1`, [login]) : undefined;
  dummyVerifier ??= hashPassword(`${randomToken()}-dummy-password`);
  const valid = await verifyPassword(secret ?? "invalid password candidate", account?.password_verifier ?? await dummyVerifier);
  if (!account || !secret || !valid) {
    failedAttempt(key, now.getTime());
    if (ctx.app.loginRateLimit && !(await ctx.app.loginRateLimit.limit(key)).success)
      throw new ApiError(429, "LOGIN_RATE_LIMITED", "Too many sign-in attempts. Try again later.");
    throw invalidLogin();
  }
  attempts.delete(key);
  const passwordChangeRequired = account.must_change_password === 1;
  const expiresAt = new Date(now.getTime() + (passwordChangeRequired ? PASSWORD_CHANGE_TTL_MS : SESSION_TTL_MS));
  const scopes = passwordChangeRequired ? [] : account.scopes.split(" ").filter(Boolean);
  const created = await createApiKey({
    orgId: account.org_id,
    principalId: account.principal_id,
    principalKind: "human",
    label: "Dashboard session",
    scopes,
    maxTrust: account.max_trust,
    expiresAt,
  }, now);
  await ctx.app.db.batch([
    created.statement,
    auditStatement(account.org_id, account.principal_id, "dashboard_session.create", "api_key", now.toISOString(), created.id),
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
    password_change_required: passwordChangeRequired,
  } };
}

export async function changeOperatorPassword(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const unknown = Object.keys(body).find((field) => field !== "password");
  if (unknown) throw validationError(`Unknown password change field "${unknown}".`);
  const account = await first<{ id: string; username: string; password_verifier: string }>(ctx.app.db,
    `SELECT id, username, password_verifier FROM operator_accounts
      WHERE org_id = ? AND principal_id = ? AND disabled_at IS NULL LIMIT 1`,
    [principal.orgId, principal.principalId]);
  if (!account) throw notFound();
  const secret = password(body.password, false, account.username)!;
  if (await verifyPassword(secret, account.password_verifier))
    throw validationError('Field "password" must differ from the temporary or current password.');
  const now = ctx.app.now().toISOString();
  const verifier = await hashPassword(secret);
  await ctx.app.db.batch([
    {
      sql: `UPDATE operator_accounts
               SET password_verifier = ?, must_change_password = 0, password_changed_at = ?
             WHERE id = ? AND org_id = ? AND disabled_at IS NULL`,
      params: [verifier, now, account.id, principal.orgId],
    },
    {
      sql: `UPDATE api_keys SET revoked_at = ?
             WHERE org_id = ? AND principal_id = ? AND label = 'Dashboard session'
               AND revoked_at IS NULL`,
      params: [now, principal.orgId, principal.principalId],
    },
    auditStatement(principal.orgId, principal.principalId, "operator_account.password_change", "operator_account", now, account.id),
  ]);
  return { data: { password_changed: true, login_required: true } };
}

export async function revokeDashboardSession(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const now = ctx.app.now().toISOString();
  await ctx.app.db.batch([
    { sql: `UPDATE api_keys SET revoked_at = ? WHERE id = ? AND org_id = ? AND revoked_at IS NULL`, params: [now, principal.keyId, principal.orgId] },
    auditStatement(principal.orgId, principal.principalId, "dashboard_session.revoke", "api_key", now, principal.keyId),
  ]);
  return { data: { logged_out: true, key_id: principal.keyId, revoked_at: now } };
}
