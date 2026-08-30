import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { sha256Hex } from "./ids";

export type WebAuthnConfiguration =
  | { state: "disabled" }
  | { state: "configured_error"; diagnostic: "webauthn_configuration_incomplete" | "webauthn_configuration_invalid" }
  | { state: "enabled"; rpId: string; origin: string; rpName: string };

export interface WebAuthnStoredCredential {
  id: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
}

export interface WebAuthnCapability {
  configuration: Extract<WebAuthnConfiguration, { state: "enabled" }>;
  registrationOptions(input: {
    accountId: string;
    username: string;
    credentials: WebAuthnStoredCredential[];
  }): Promise<object & { challenge: string }>;
  verifyRegistration(input: {
    response: unknown;
    challengeHash: string;
  }): Promise<{
    verified: boolean;
    credential?: WebAuthnStoredCredential & {
      deviceType: "singleDevice" | "multiDevice";
      backedUp: boolean;
    };
  }>;
  authenticationOptions(input: {
    credentials: WebAuthnStoredCredential[];
  }): Promise<object & { challenge: string }>;
  verifyAuthentication(input: {
    response: unknown;
    challengeHash: string;
    credential: WebAuthnStoredCredential;
  }): Promise<{ verified: boolean; newCounter?: number }>;
}

export type WebAuthnRuntime =
  | { configuration: Exclude<WebAuthnConfiguration, { state: "enabled" }> }
  | WebAuthnCapability;

export function parseWebAuthnConfig(input: {
  rpId?: string;
  origin?: string;
  rpName?: string;
}): WebAuthnConfiguration {
  const supplied = [input.rpId, input.origin, input.rpName].filter((value) => value !== undefined);
  if (supplied.length === 0) return { state: "disabled" };
  if (supplied.length !== 3)
    return { state: "configured_error", diagnostic: "webauthn_configuration_incomplete" };
  const rpId = input.rpId!.normalize("NFC").toLowerCase();
  const rpName = input.rpName!.normalize("NFC");
  if (
    rpId.length < 1 || rpId.length > 253 || rpName.length < 1 || rpName.length > 64
    || rpId.includes("*") || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u.test(rpId)
  ) return { state: "configured_error", diagnostic: "webauthn_configuration_invalid" };
  try {
    const url = new URL(input.origin!);
    const exactOrigin = input.origin === url.origin;
    const local = rpId === "localhost" && url.hostname === "localhost";
    const secure = url.protocol === "https:";
    const relatedHost = url.hostname === rpId || url.hostname.endsWith(`.${rpId}`);
    if (!exactOrigin || url.username || url.password || (!secure && !local) || !relatedHost)
      throw new Error("invalid origin");
    return { state: "enabled", rpId, origin: url.origin, rpName };
  } catch {
    return { state: "configured_error", diagnostic: "webauthn_configuration_invalid" };
  }
}

export function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function createWebAuthnRuntime(configuration: WebAuthnConfiguration): WebAuthnRuntime {
  if (configuration.state !== "enabled") return { configuration };
  return {
    configuration,
    async registrationOptions({ accountId, username, credentials }) {
      return generateRegistrationOptions({
        rpName: configuration.rpName,
        rpID: configuration.rpId,
        userID: new TextEncoder().encode(accountId),
        userName: username,
        userDisplayName: username,
        attestationType: "none",
        timeout: 5 * 60_000,
        excludeCredentials: credentials.map((credential) => ({
          id: credential.id,
          transports: credential.transports,
        })),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
        },
      });
    },
    async verifyRegistration({ response, challengeHash }) {
      try {
        const result = await verifyRegistrationResponse({
          response: response as RegistrationResponseJSON,
          expectedChallenge: async (challenge) => await sha256Hex(challenge) === challengeHash,
          expectedOrigin: configuration.origin,
          expectedRPID: configuration.rpId,
          requireUserVerification: true,
        });
        if (!result.verified || !result.registrationInfo) return { verified: false };
        const info = result.registrationInfo;
        return {
          verified: true,
          credential: {
            id: info.credential.id,
            publicKey: info.credential.publicKey,
            counter: info.credential.counter,
            transports: info.credential.transports,
            deviceType: info.credentialDeviceType,
            backedUp: info.credentialBackedUp,
          },
        };
      } catch {
        return { verified: false };
      }
    },
    async authenticationOptions({ credentials }) {
      return generateAuthenticationOptions({
        rpID: configuration.rpId,
        timeout: 5 * 60_000,
        userVerification: "required",
        allowCredentials: credentials.map((credential) => ({
          id: credential.id,
          transports: credential.transports,
        })),
      });
    },
    async verifyAuthentication({ response, challengeHash, credential }) {
      try {
        const result = await verifyAuthenticationResponse({
          response: response as AuthenticationResponseJSON,
          expectedChallenge: async (challenge) => await sha256Hex(challenge) === challengeHash,
          expectedOrigin: configuration.origin,
          expectedRPID: configuration.rpId,
          requireUserVerification: true,
          credential,
        });
        return {
          verified: result.verified,
          newCounter: result.verified ? result.authenticationInfo.newCounter : undefined,
        };
      } catch {
        return { verified: false };
      }
    },
  };
}
