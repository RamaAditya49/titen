import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { expect, test } from "@playwright/test";

interface FixtureInfo {
  origin: string;
  username: string;
  temporaryPassword: string;
}

async function startFixture(): Promise<{ process: ChildProcessWithoutNullStreams; info: FixtureInfo }> {
  const child = spawn("bun", ["tests/fixtures/webauthn-server.ts"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const info = await new Promise<FixtureInfo>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebAuthn fixture startup timed out.")), 10_000);
    lines.once("line", (line) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(line) as FixtureInfo); } catch (error) { reject(error); }
    });
    child.once("exit", (code) => reject(new Error(`WebAuthn fixture exited with ${code}.`)));
  });
  lines.close();
  return { process: child, info };
}

test("a Chromium virtual authenticator completes the real WebAuthn library ceremony", async ({ page }) => {
  const fixture = await startFixture();
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    } });
    await page.goto(`${fixture.info.origin}/healthz`);
    const result = await page.evaluate(async ({ username, temporaryPassword }) => {
      const call = async (path: string, init: RequestInit = {}, key?: string) => {
        const response = await fetch(path, {
          ...init,
          headers: {
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...(key ? { authorization: `Bearer ${key}` } : {}),
            ...init.headers,
          },
        });
        const body = await response.json();
        if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
        return body.data as Record<string, any>;
      };
      const bytes = (value: string) => {
        const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/")
          .padEnd(Math.ceil(value.length / 4) * 4, "="));
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
      };
      const encoded = (value: ArrayBuffer) => {
        let binary = "";
        for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
        return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
      };
      const password = "real browser passkey password";
      const temporary = await call("/v1/dashboard-sessions", {
        method: "POST", body: JSON.stringify({ username, password: temporaryPassword }),
      });
      await call("/v1/operator-accounts/current/password", {
        method: "PATCH", body: JSON.stringify({ password }),
      }, temporary.api_key);
      const initial = await call("/v1/dashboard-sessions", {
        method: "POST", body: JSON.stringify({ username, password }),
      });
      const registration = await call("/v1/operator-accounts/current/passkeys/options", {
        method: "POST", body: "{}",
      }, initial.api_key);
      const creation = registration.options as any;
      const created = await navigator.credentials.create({ publicKey: {
        ...creation,
        challenge: bytes(creation.challenge),
        user: { ...creation.user, id: bytes(creation.user.id) },
        excludeCredentials: creation.excludeCredentials?.map((credential: any) => ({
          ...credential, id: bytes(credential.id),
        })),
      } as PublicKeyCredentialCreationOptions }) as PublicKeyCredential;
      const attestation = created.response as AuthenticatorAttestationResponse;
      const registered = await call("/v1/operator-accounts/current/passkeys", {
        method: "POST",
        body: JSON.stringify({
          challenge_id: registration.challenge_id,
          label: "Virtual authenticator",
          response: {
            id: created.id,
            rawId: encoded(created.rawId),
            response: {
              attestationObject: encoded(attestation.attestationObject),
              clientDataJSON: encoded(attestation.clientDataJSON),
              transports: attestation.getTransports(),
            },
            type: created.type,
            clientExtensionResults: created.getClientExtensionResults(),
            authenticatorAttachment: created.authenticatorAttachment,
          },
        }),
      }, initial.api_key);
      const staged = await call("/v1/dashboard-sessions", {
        method: "POST", body: JSON.stringify({ username, password }),
      });
      const authentication = await call("/v1/dashboard-sessions/current/passkey-options", {
        method: "POST", body: "{}",
      }, staged.api_key);
      const request = authentication.options as any;
      const asserted = await navigator.credentials.get({ publicKey: {
        ...request,
        challenge: bytes(request.challenge),
        allowCredentials: request.allowCredentials?.map((credential: any) => ({
          ...credential, id: bytes(credential.id),
        })),
      } as PublicKeyCredentialRequestOptions }) as PublicKeyCredential;
      const assertion = asserted.response as AuthenticatorAssertionResponse;
      const completed = await call("/v1/dashboard-sessions/current/passkey", {
        method: "POST",
        body: JSON.stringify({
          challenge_id: authentication.challenge_id,
          response: {
            id: asserted.id,
            rawId: encoded(asserted.rawId),
            response: {
              authenticatorData: encoded(assertion.authenticatorData),
              clientDataJSON: encoded(assertion.clientDataJSON),
              signature: encoded(assertion.signature),
              userHandle: assertion.userHandle ? encoded(assertion.userHandle) : undefined,
            },
            type: asserted.type,
            clientExtensionResults: asserted.getClientExtensionResults(),
            authenticatorAttachment: asserted.authenticatorAttachment,
          },
        }),
      }, staged.api_key);
      return {
        recoveryCodes: registered.recovery_codes.length,
        staged: staged.auth_stage,
        completed: completed.auth_stage,
        scopes: completed.scopes,
      };
    }, fixture.info);
    expect(result).toEqual({
      recoveryCodes: 8,
      staged: "second_factor",
      completed: "full",
      scopes: ["views:compile"],
    });
  } finally {
    fixture.process.kill("SIGTERM");
  }
});
