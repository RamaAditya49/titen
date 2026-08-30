import { test } from "bun:test";
import assert from "node:assert/strict";
import { createApp } from "../../src/core/app";
import { migrate } from "../../src/core/migrations";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";
import { createWebAuthnRuntime, parseWebAuthnConfig } from "../../src/core/webauthn";

test("WebAuthn is disabled only when the complete tuple is absent", () => {
  assert.deepEqual(parseWebAuthnConfig({}), { state: "disabled" });
  assert.deepEqual(parseWebAuthnConfig({ rpId: "memory.example.com" }), {
    state: "configured_error",
    diagnostic: "webauthn_configuration_incomplete",
  });
});

test("WebAuthn accepts an HTTPS origin and bounded relying-party metadata", () => {
  assert.deepEqual(parseWebAuthnConfig({
    rpId: "memory.example.com",
    origin: "https://memory.example.com",
    rpName: "Titen",
  }), {
    state: "enabled",
    rpId: "memory.example.com",
    origin: "https://memory.example.com",
    rpName: "Titen",
  });
  assert.deepEqual(parseWebAuthnConfig({
    rpId: "localhost",
    origin: "http://localhost:8787",
    rpName: "Titen development",
  }), {
    state: "enabled",
    rpId: "localhost",
    origin: "http://localhost:8787",
    rpName: "Titen development",
  });
});

test("WebAuthn rejects unsafe or ambiguous origins", () => {
  for (const input of [
    { rpId: "memory.example.com", origin: "http://memory.example.com", rpName: "Titen" },
    { rpId: "memory.example.com", origin: "https://memory.example.com/path", rpName: "Titen" },
    { rpId: "example.com", origin: "https://unrelated.example.net", rpName: "Titen" },
    { rpId: "*.example.com", origin: "https://memory.example.com", rpName: "Titen" },
  ]) {
    assert.deepEqual(parseWebAuthnConfig(input), {
      state: "configured_error",
      diagnostic: "webauthn_configuration_invalid",
    });
  }
});

test("a partial WebAuthn tuple fails readiness without calling a remote service", async () => {
  const handle = openDatabase(":memory:");
  const db = createSqliteDb(handle);
  try {
    await migrate(db);
    const app = createApp({
      db,
      runtime: "test",
      webauthn: createWebAuthnRuntime(parseWebAuthnConfig({ rpId: "memory.example.com" })),
    });
    const response = await app(new Request("http://titen.test/readyz"));
    assert.equal(response.status, 503);
    const body = await response.json() as any;
    assert.equal(body.meta.checks.webauthn, "webauthn_configuration_incomplete");
    assert.equal(body.meta.capabilities.webauthn, "configured_error");
  } finally {
    handle.close();
  }
});

test("the real WebAuthn adapter emits relying-party-bound options", async () => {
  const runtime = createWebAuthnRuntime(parseWebAuthnConfig({
    rpId: "memory.example.com",
    origin: "https://memory.example.com",
    rpName: "Titen",
  }));
  assert.equal(runtime.configuration.state, "enabled");
  if (!("registrationOptions" in runtime)) throw new Error("expected enabled WebAuthn");
  const registration = await runtime.registrationOptions({
    accountId: "usr_fixture",
    username: "operator-fixture",
    credentials: [],
  });
  assert.match(registration.challenge, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual((registration as any).rp, { id: "memory.example.com", name: "Titen" });
  const authentication = await runtime.authenticationOptions({ credentials: [] });
  assert.match(authentication.challenge, /^[A-Za-z0-9_-]+$/);
  assert.equal((authentication as any).rpId, "memory.example.com");
  assert.equal((authentication as any).userVerification, "required");
});
