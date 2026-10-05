import assert from "node:assert/strict";
import { newOperatorAccount } from "../../src/core/accounts";
import { createApp } from "../../src/core/app";
import { organizationStatement } from "../../src/core/auth";
import type { Db } from "../../src/core/db";
import { sha256Hex } from "../../src/core/ids";
import { migrate } from "../../src/core/migrations";
import type { WebAuthnCapability } from "../../src/core/webauthn";
import { clientVia } from "./harness";

function fakeWebAuthn(): WebAuthnCapability {
  let sequence = 0;
  return {
    configuration: {
      state: "enabled",
      rpId: "memory.example.com",
      origin: "https://memory.example.com",
      rpName: "Titen",
    },
    async registrationOptions({ username, credentials }) {
      sequence += 1;
      return {
        challenge: `register-${sequence}`,
        rp: { id: "memory.example.com", name: "Titen" },
        user: { id: `user-${sequence}`, name: username, displayName: username },
        excludeCredentials: credentials.map((credential) => ({ id: credential.id })),
      };
    },
    async verifyRegistration({ response, challengeHash }) {
      const input = response as { id?: string; challenge?: string };
      if (!input.id || !input.challenge || await sha256Hex(input.challenge) !== challengeHash)
        return { verified: false };
      return {
        verified: true,
        credential: {
          id: input.id,
          publicKey: new Uint8Array([1, 2, 3, sequence]),
          counter: 0,
          transports: ["internal"],
          deviceType: "multiDevice",
          backedUp: true,
        },
      };
    },
    async authenticationOptions({ credentials }) {
      sequence += 1;
      return {
        challenge: `authenticate-${sequence}`,
        rpId: "memory.example.com",
        allowCredentials: credentials.map((credential) => ({ id: credential.id })),
      };
    },
    async verifyAuthentication({ response, challengeHash, credential }) {
      const input = response as { id?: string; challenge?: string; counter?: number };
      if (
        input.id !== credential.id || !input.challenge
        || await sha256Hex(input.challenge) !== challengeHash
        || (input.counter ?? 0) <= credential.counter
      ) return { verified: false };
      return { verified: true, newCounter: input.counter! };
    },
  };
}

export async function assertWebAuthnContract(db: Db, runtime: string) {
  await migrate(db);
  let now = new Date("2026-08-30T02:00:00.000Z");
  const orgId = `org_webauthn_${runtime}`;
  const account = await newOperatorAccount({
    orgId,
    createdBy: `owner_webauthn_${runtime}`,
    username: `passkey-${runtime}`,
    role: "owner",
    scopes: ["views:compile", "memberships:read"],
    maxTrust: "verified",
    now,
  });
  await db.batch([
    organizationStatement(orgId, `WebAuthn ${runtime}`, now),
    ...account.statements,
  ]);
  const app = createApp({
    db,
    runtime: `webauthn-${runtime}`,
    now: () => now,
    webauthn: fakeWebAuthn(),
  });
  const client = clientVia(app, "https://memory.example.com");
  const call = client.call;

  const temporary = await call("POST", "/v1/dashboard-sessions", {
    body: { username: account.username, password: account.temporaryPassword },
  });
  assert.equal(temporary.status, 201);
  assert.equal(temporary.body.data.auth_stage, "password_change");
  const password = `correct horse battery ${runtime}`;
  const changed = await call("PATCH", "/v1/operator-accounts/current/password", {
    key: temporary.body.data.api_key,
    body: { password },
  });
  assert.equal(changed.status, 200);

  const established = await call("POST", "/v1/dashboard-sessions", {
    body: { username: account.username, password },
  });
  assert.equal(established.status, 201);
  assert.equal(established.body.data.auth_stage, "full");
  const supersededSession = await call("POST", "/v1/dashboard-sessions", {
    body: { username: account.username, password },
  });
  assert.equal(supersededSession.status, 201);

  const options = await call("POST", "/v1/operator-accounts/current/passkeys/options", {
    key: established.body.data.api_key,
    body: {},
  });
  assert.equal(options.status, 201);
  assert.match(options.body.data.challenge_id, /^wch_/);
  assert.equal(options.body.data.options.challenge, "register-1");
  const extraField = await call("POST", "/v1/operator-accounts/current/passkeys", {
    key: established.body.data.api_key,
    body: {
      challenge_id: options.body.data.challenge_id,
      label: "Primary device",
      response: { id: "credential-primary", challenge: "register-1" },
      ignored: true,
    },
  });
  assert.equal(extraField.status, 400);
  assert.equal(extraField.body.error.code, "VALIDATION_ERROR");
  const registration = await call("POST", "/v1/operator-accounts/current/passkeys", {
    key: established.body.data.api_key,
    body: {
      challenge_id: options.body.data.challenge_id,
      label: "Primary device",
      response: { id: "credential-primary", challenge: "register-1" },
    },
  });
  assert.equal(registration.status, 201);
  assert.match(registration.body.data.credential.id, /^wcr_/);
  assert.equal(registration.body.data.credential.label, "Primary device");
  assert.equal(registration.body.data.recovery_codes.length, 8);
  const recoveryCode = registration.body.data.recovery_codes[0] as string;
  assert.match(recoveryCode, /^[A-Za-z0-9_-]{22}$/);
  assert.equal((await call("GET", "/v1/principal", {
    key: supersededSession.body.data.api_key,
  })).status, 401, "first passkey enrollment must revoke older dashboard sessions");
  assert.equal((await call("GET", "/v1/principal", {
    key: established.body.data.api_key,
  })).status, 200, "first passkey enrollment must preserve its current dashboard session");

  const stored = await db.all<{
    credentials: number;
    recovery_codes: number;
    raw_recovery_matches: number;
    raw_challenge_matches: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM webauthn_credentials WHERE account_id = ?) AS credentials,
       (SELECT COUNT(*) FROM operator_recovery_codes WHERE account_id = ?) AS recovery_codes,
       (SELECT COUNT(*) FROM operator_recovery_codes WHERE code_hash = ?) AS raw_recovery_matches,
       (SELECT COUNT(*) FROM webauthn_challenges WHERE challenge_hash = ?) AS raw_challenge_matches`,
    [account.accountId, account.accountId, recoveryCode, "register-1"],
  );
  assert.deepEqual(stored[0], {
    credentials: 1,
    recovery_codes: 8,
    raw_recovery_matches: 0,
    raw_challenge_matches: 0,
  });

  const staged = await call("POST", "/v1/dashboard-sessions", {
    body: { username: account.username, password },
  });
  assert.equal(staged.status, 201);
  assert.equal(staged.body.data.auth_stage, "second_factor");
  assert.equal(staged.body.data.second_factor_required, true);
  assert.deepEqual(staged.body.data.scopes, []);
  const forbidden = await call("GET", "/v1/memories", { key: staged.body.data.api_key });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error.code, "STAGED_SESSION");

  const authenticationOptions = await call(
    "POST",
    "/v1/dashboard-sessions/current/passkey-options",
    { key: staged.body.data.api_key, body: {} },
  );
  assert.equal(authenticationOptions.status, 201);
  assert.equal(authenticationOptions.body.data.options.challenge, "authenticate-2");
  const completed = await call("POST", "/v1/dashboard-sessions/current/passkey", {
    key: staged.body.data.api_key,
    body: {
      challenge_id: authenticationOptions.body.data.challenge_id,
      response: { id: "credential-primary", challenge: "authenticate-2", counter: 1 },
    },
  });
  assert.equal(completed.status, 201);
  assert.equal(completed.body.data.auth_stage, "full");
  assert.match(completed.body.data.api_key, /^titen_sk_/);
  assert.equal((await call("GET", "/v1/memories", { key: completed.body.data.api_key })).status, 200);
  assert.equal((await call("GET", "/v1/principal", { key: staged.body.data.api_key })).status, 401);

  const [credential] = await db.all<{ counter: number }>(
    "SELECT counter FROM webauthn_credentials WHERE credential_id = ?",
    ["credential-primary"],
  );
  assert.equal(credential!.counter, 1);
  const [usedChallenge] = await db.all<{ used_at_ms: number | null }>(
    "SELECT used_at_ms FROM webauthn_challenges WHERE id = ?",
    [authenticationOptions.body.data.challenge_id],
  );
  assert.equal(usedChallenge!.used_at_ms, now.getTime());

  const recoveryStage = await call("POST", "/v1/dashboard-sessions", {
    body: { username: account.username, password },
  });
  const recovered = await call("POST", "/v1/dashboard-sessions/current/recovery-code", {
    key: recoveryStage.body.data.api_key,
    body: { recovery_code: recoveryCode },
  });
  assert.equal(recovered.status, 201);
  assert.equal(recovered.body.data.auth_stage, "full");
  const [consumed] = await db.all<{ count: number }>(
    "SELECT COUNT(*) AS count FROM operator_recovery_codes WHERE account_id = ? AND used_at_ms IS NOT NULL",
    [account.accountId],
  );
  assert.equal(Number(consumed!.count), 1);

  const secondRecoveryStage = await call("POST", "/v1/dashboard-sessions", {
    body: { username: account.username, password },
  });
  const replay = await call("POST", "/v1/dashboard-sessions/current/recovery-code", {
    key: secondRecoveryStage.body.data.api_key,
    body: { recovery_code: recoveryCode },
  });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error.code, "SECOND_FACTOR_INVALID");

  const concurrentCode = registration.body.data.recovery_codes[1] as string;
  const concurrentStages = await Promise.all([0, 1].map(() => call("POST", "/v1/dashboard-sessions", {
    body: { username: account.username, password },
  })));
  const concurrent = await Promise.all(concurrentStages.map((session) => call(
    "POST",
    "/v1/dashboard-sessions/current/recovery-code",
    { key: session.body.data.api_key, body: { recovery_code: concurrentCode } },
  )));
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 401]);

  const accountKey = await sha256Hex(`dashboard-login:${account.username}`);
  await db.batch([{ sql: "INSERT OR REPLACE INTO login_throttles VALUES (?, 50, ?, ?)", params: [accountKey, now.getTime() + 60_000, now.getTime()] }]);
  const blockedPassword = await call("POST", "/v1/dashboard-sessions", { body: { username: account.username, password } });
  assert.equal(blockedPassword.status, 401);
  const startRecovery = async (username = account.username) => call("POST", "/v1/dashboard-sessions/recovery", { body: { username } });
  const rescue = await startRecovery();
  assert.equal(rescue.status, 201);
  assert.deepEqual(Object.keys(rescue.body.data).sort(), ["api_key", "auth_stage", "expires_at"]);
  const unknownRescue = await startRecovery("unknown-rescue-user");
  assert.equal(unknownRescue.status, 201);
  assert.deepEqual(Object.keys(unknownRescue.body.data).sort(), Object.keys(rescue.body.data).sort());
  assert.equal((await call("GET", "/v1/memories", { key: rescue.body.data.api_key })).status, 403);
  const rescueOptions = await call("POST", "/v1/dashboard-sessions/current/passkey-options", { key: rescue.body.data.api_key, body: {} });
  const rescued = await call("POST", "/v1/dashboard-sessions/current/passkey", {
    key: rescue.body.data.api_key,
    body: { challenge_id: rescueOptions.body.data.challenge_id, response: { id: "credential-primary", challenge: rescueOptions.body.data.options.challenge, counter: 2 } },
  });
  assert.equal(rescued.status, 201);
  assert.equal(rescued.body.data.failed_attempts, 50);
  await db.batch([{ sql: "INSERT OR REPLACE INTO login_throttles VALUES (?, 50, ?, ?)", params: [accountKey, now.getTime() + 60_000, now.getTime()] }]);
  const rescueCodeSession = await startRecovery();
  assert.equal((await call("POST", "/v1/dashboard-sessions/current/recovery-code", { key: rescueCodeSession.body.data.api_key, body: { recovery_code: "invalid-recovery-code" } })).status, 401);
  const rescueCode = registration.body.data.recovery_codes[3] as string;
  const codeRescued = await call("POST", "/v1/dashboard-sessions/current/recovery-code", { key: rescueCodeSession.body.data.api_key, body: { recovery_code: rescueCode } });
  assert.equal(codeRescued.status, 201);
  assert.equal(codeRescued.body.data.auth_stage, "full");
  const replayRescue = await startRecovery();
  assert.equal((await call("POST", "/v1/dashboard-sessions/current/recovery-code", { key: replayRescue.body.data.api_key, body: { recovery_code: rescueCode } })).status, 401);
  const expiredRescue = await startRecovery();
  now = new Date(now.getTime() + 16 * 60_000);
  assert.equal((await call("POST", "/v1/dashboard-sessions/current/recovery-code", { key: expiredRescue.body.data.api_key, body: { recovery_code: registration.body.data.recovery_codes[4] } })).status, 401);
  const disabledRescue = await startRecovery();
  await db.batch([{ sql: "UPDATE operator_accounts SET disabled_at = ? WHERE id = ?", params: [now.toISOString(), account.accountId] }]);
  assert.equal((await call("POST", "/v1/dashboard-sessions/current/recovery-code", { key: disabledRescue.body.data.api_key, body: { recovery_code: registration.body.data.recovery_codes[4] } })).status, 401);
  await db.batch([{ sql: "UPDATE operator_accounts SET disabled_at = NULL, must_change_password = 1 WHERE id = ?", params: [account.accountId] }]);
  const rotateRescue = await startRecovery();
  const rotateSession = await call("POST", "/v1/dashboard-sessions/current/recovery-code", { key: rotateRescue.body.data.api_key, body: { recovery_code: registration.body.data.recovery_codes[4] } });
  assert.equal(rotateSession.status, 201);
  assert.equal(rotateSession.body.data.auth_stage, "password_change");
  assert.deepEqual(rotateSession.body.data.scopes, []);
  await db.batch([{ sql: "UPDATE operator_accounts SET must_change_password = 0 WHERE id = ?", params: [account.accountId] }]);

  const racedRecoveryStage = await startRecovery();
  let resetDuringRecovery = false;
  const racedRecoveryDb: Db = {
    ...db,
    async all<Row>(sql: string, params?: import("../../src/core/db").Param[]) {
      const rows = await db.all<Row>(sql, params);
      if (!resetDuringRecovery && sql.includes("a.must_change_password, m.role")) {
        resetDuringRecovery = true;
        await db.batch([
          { sql: "UPDATE operator_accounts SET must_change_password = 1 WHERE id = ?", params: [account.accountId] },
          { sql: "UPDATE api_keys SET revoked_at = ? WHERE principal_id = ? AND label = 'Dashboard session'", params: [now.toISOString(), account.principalId] },
        ]);
      }
      return rows;
    },
  };
  const raceCall = clientVia(createApp({ db: racedRecoveryDb, runtime, now: () => now }), "https://memory.example.com").call;
  assert.equal((await raceCall("POST", "/v1/dashboard-sessions/current/recovery-code", {
    key: racedRecoveryStage.body.data.api_key, body: { recovery_code: registration.body.data.recovery_codes[5] },
  })).status, 401, "reset must prevent stale recovery proof from issuing a session");
  assert.equal(resetDuringRecovery, true);
  await db.batch([{ sql: "UPDATE operator_accounts SET must_change_password = 0 WHERE id = ?", params: [account.accountId] }]);

  const disabledCall = clientVia(createApp({
    db,
    runtime: `webauthn-disabled-${runtime}`,
    now: () => now,
  }), "https://memory.example.com").call;
  const disabledStage = await disabledCall("POST", "/v1/dashboard-sessions", {
    body: { username: account.username, password },
  });
  assert.equal(disabledStage.body.data.auth_stage, "second_factor");
  const disabledRecovery = await disabledCall("POST", "/v1/dashboard-sessions/current/recovery-code", {
    key: disabledStage.body.data.api_key,
    body: { recovery_code: registration.body.data.recovery_codes[2] },
  });
  assert.equal(disabledRecovery.status, 201, "recovery must survive disabled WebAuthn configuration");

  const lastCredentialId = registration.body.data.credential.id as string;
  const noConfirmation = await call("DELETE", `/v1/operator-accounts/current/passkeys/${lastCredentialId}`, {
    key: disabledRecovery.body.data.api_key,
    body: {},
  });
  assert.equal(noConfirmation.status, 401);
  const removed = await disabledCall("DELETE", `/v1/operator-accounts/current/passkeys/${lastCredentialId}`, {
    key: disabledRecovery.body.data.api_key,
    body: { password },
  });
  assert.equal(removed.status, 200);
  const noSecondFactor = await disabledCall("POST", "/v1/dashboard-sessions", {
    body: { username: account.username, password },
  });
  assert.equal(noSecondFactor.status, 201);
  assert.equal(noSecondFactor.body.data.auth_stage, "full");
}
