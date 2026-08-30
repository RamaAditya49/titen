import { newOperatorAccount } from "../../src/core/accounts";
import { createApp } from "../../src/core/app";
import { organizationStatement } from "../../src/core/auth";
import { migrate } from "../../src/core/migrations";
import { createWebAuthnRuntime, parseWebAuthnConfig } from "../../src/core/webauthn";
import { createSqliteDb, openDatabase } from "../../src/runtime/bun/sqlite";

const handle = openDatabase(":memory:");
const db = createSqliteDb(handle);
await migrate(db);
const account = await newOperatorAccount({
  orgId: "org_real_webauthn",
  createdBy: "owner_real_webauthn",
  username: "real-passkey",
  role: "owner",
  scopes: ["views:compile"],
  maxTrust: "verified",
});
await db.batch([
  organizationStatement("org_real_webauthn", "Real WebAuthn Test"),
  ...account.statements,
]);

let app: ReturnType<typeof createApp> | undefined;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => app?.(request) ?? new Response("starting", { status: 503 }),
});
const origin = `http://localhost:${server.port}`;
app = createApp({
  db,
  runtime: "webauthn-browser-test",
  webauthn: createWebAuthnRuntime(parseWebAuthnConfig({
    rpId: "localhost",
    origin,
    rpName: "Titen browser test",
  })),
});

process.stdout.write(`${JSON.stringify({
  origin,
  username: account.username,
  temporaryPassword: account.temporaryPassword,
})}\n`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await server.stop(true);
    handle.close();
    process.exit(0);
  });
}
