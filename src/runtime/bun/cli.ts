#!/usr/bin/env bun
import { createApiKey, organizationStatement, SCOPES } from "../../core/auth";
import { MIGRATIONS, migrate, pendingMigrations, schemaState } from "../../core/migrations";
import { newId } from "../../core/ids";
import { TRUST_LEVELS, type Trust } from "../../core/validate";
import { createSqliteDb, openDatabase } from "./sqlite";
import { serve } from "./server";
import { parseSecretCipher } from "../../core/secrets";
import { createBunWebhookSecurity } from "./webhooks";
import { chmodSync, existsSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const USAGE = `titen — self-hosted memory service

Usage:
  titen serve      [--db titen.db] [--port 8787] [--host 127.0.0.1] [--revision dev] [--quiet]
  titen migrate    [--db titen.db] [--dry-run]
  titen bootstrap  [--db titen.db] [--org "My Org"] [--label owner] [--print-sql]
  titen key create [--db titen.db] --org-id <id> [--principal <id>] [--kind agent]
                   [--scopes "a,b"] [--trust asserted] [--label name] [--print-sql]
  titen key list   [--db titen.db]
  titen key revoke [--db titen.db] --id <key id>
  titen backup     [--db titen.db] --out <file>   verified online copy
  titen schema     print every migration statement (for "wrangler d1 execute --file")

Notes:
  --print-sql emits SQL for a remote database (Cloudflare D1) instead of writing
  locally. A raw key is printed once and is never recoverable afterwards.
  Scopes: ${SCOPES.join(", ")} (or * for all).
`;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const COMMAND_FLAGS: Record<string, { values: string[]; booleans?: string[] }> = {
  serve: { values: ["db", "port", "host", "revision"], booleans: ["quiet"] },
  migrate: { values: ["db"], booleans: ["dry-run"] },
  bootstrap: { values: ["db", "org", "label"], booleans: ["print-sql"] },
  "key create": {
    values: ["db", "org-id", "principal", "kind", "scopes", "trust", "label"],
    booleans: ["print-sql"],
  },
  "key list": { values: ["db"] },
  "key revoke": { values: ["db", "id"] },
  backup: { values: ["db", "out"] },
  schema: { values: [] },
};

function parseArgs(argv: string[]) {
  // Help is conventionally read-only. Handle it before command validation so
  // no malformed companion flag can open a database or create a credential.
  if (argv.includes("--help")) {
    console.log(USAGE);
    process.exit(0);
  }
  if (argv.length === 0) return { command: undefined, action: undefined, flags: {} };

  const command = argv[0]!;
  const action = command === "key" ? argv[1] : undefined;
  const name = action ? `${command} ${action}` : command;
  const schema = COMMAND_FLAGS[name];
  if (!schema) fail(command === "key" ? "key needs create, list, or revoke" : `unknown command "${command}"`);

  const flags: Record<string, string | boolean> = {};
  const values = new Set(schema.values);
  const booleans = new Set(schema.booleans ?? []);
  for (let index = action ? 2 : 1; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--") || token === "--") fail(`unexpected argument "${token}"`);
    const key = token.slice(2);
    if (booleans.has(key)) {
      flags[key] = true;
      continue;
    }
    if (!values.has(key)) fail(`unknown flag "--${key}" for ${name}`);
    const value = argv[index + 1];
    if (value === undefined || value === "" || value.startsWith("--"))
      fail(`--${key} requires a value`);
    flags[key] = value;
    index += 1;
  }
  return { command, action, flags };
}

const text = (value: string | boolean | undefined, fallback: string) =>
  typeof value === "string" ? value : fallback;

function port(value: string | boolean | undefined): number {
  const raw = text(value, "8787");
  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535)
    fail("--port must be an integer between 1 and 65535");
  return parsed;
}

function sqlLiteral(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function renderStatement(statement: { sql: string; params: (string | number | null)[] }): string {
  let index = 0;
  const inlined = statement.sql.replace(/\?/g, () => sqlLiteral(statement.params[index++] ?? null));
  return `${inlined.replace(/\s+/g, " ").trim()};`;
}

function printKey(raw: string, id: string) {
  console.log(`key_id: ${id}`);
  console.log(`api_key: ${raw}`);
  console.log("");
  console.log("Store this key now. Titen keeps only its hash and cannot show it again.");
}

async function withDb<T>(
  path: string,
  run: (db: ReturnType<typeof createSqliteDb>) => Promise<T>,
  options?: Parameters<typeof openDatabase>[1],
) {
  const database = openDatabase(path, options);
  try {
    return await run(createSqliteDb(database));
  } finally {
    database.close();
  }
}

const { flags, command, action } = parseArgs(process.argv.slice(2));
const dbPath = text(flags.db, "titen.db");

switch (command) {
  case "serve": {
    // Vector retrieval is configured by environment, not by flags: the values
    // are deployment facts (and one is a credential), so they belong in the unit
    // file or the container environment rather than a shell history. Absent any
    // of them the service serves lexical retrieval and says so in readiness.
    const embedDims = Number(process.env.TITEN_EMBED_DIMS ?? "0");
    const servePort = port(flags.port);
    const quiet = flags.quiet === true;
    let started: Awaited<ReturnType<typeof serve>>;
    try {
      started = await serve({
        dbPath,
        port: servePort,
        hostname: text(flags.host, "127.0.0.1"),
        revision: text(flags.revision, "dev"),
        quiet,
        vecDbPath: process.env.TITEN_VEC_DB_PATH ?? `${dbPath}.vec`,
        embedBaseUrl: process.env.TITEN_EMBED_BASE_URL,
        embedModel: process.env.TITEN_EMBED_MODEL,
        embedDims: Number.isInteger(embedDims) && embedDims > 0 ? embedDims : undefined,
        embedApiKey: process.env.TITEN_EMBED_API_KEY,
        maintenanceIntervalMs:
          process.env.TITEN_MAINTENANCE_INTERVAL_MS === undefined
            ? undefined
            : Number(process.env.TITEN_MAINTENANCE_INTERVAL_MS),
        secretCipher: parseSecretCipher(process.env.TITEN_SECRET_KEYS),
        webhookSecurity: createBunWebhookSecurity(process.env.TITEN_WEBHOOK_ALLOWED_HOSTNAMES),
        mcpOrigin: process.env.TITEN_MCP_ORIGIN,
      });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
      const detail = (error instanceof Error ? error.message : "unknown startup error")
        .replace(/\s+/g, " ")
        .slice(0, 300);
      if (code === "EADDRINUSE" || /EADDRINUSE|address already in use/i.test(detail))
        fail(`port ${servePort} is already in use`);
      fail(`could not start server: ${detail}`);
    }
    if (!quiet) console.log(`titen listening on ${started.url} (database ${dbPath})`);
    break;
  }

  case "migrate": {
    if (flags["dry-run"]) {
      const pending = existsSync(dbPath)
        ? await withDb(dbPath, (db) => pendingMigrations(db), { create: false, readonly: true })
        : MIGRATIONS;
      for (const migration of pending) {
        console.log(`-- migration ${migration.version}`);
        for (const statement of migration.statements)
          console.log(`${statement.replace(/\s+/g, " ").trim()};`);
      }
      console.log(`-- ${pending.length} migration(s) pending; database unchanged`);
      break;
    }
    const version = await withDb(dbPath, (db) => migrate(db));
    console.log(`schema version ${version} applied to ${dbPath}`);
    break;
  }

  case "bootstrap": {
    const orgName = text(flags.org, "Titen");
    const orgId = newId("org");
    const key = await createApiKey({
      orgId,
      principalId: "owner",
      principalKind: "human",
      label: text(flags.label, "owner"),
      scopes: ["*"],
      maxTrust: "policy_approved",
    });
    const org = organizationStatement(orgId, orgName);
    if (flags["print-sql"]) {
      console.error(`-- organization ${orgId} (${orgName})`);
      console.log(renderStatement(org));
      console.log(renderStatement(key.statement));
      console.error("");
      console.error(`key_id: ${key.id}`);
      console.error(`api_key: ${key.key}`);
      console.error("Store this key now. Only its hash appears in the SQL above.");
      break;
    }
    await withDb(dbPath, async (db) => {
      await migrate(db);
      await db.batch([org, key.statement]);
    });
    console.log(`organization: ${orgId} (${orgName})`);
    printKey(key.key, key.id);
    break;
  }

  case "key": {
    if (action === "create") {
      const orgId = text(flags["org-id"], "");
      if (!orgId) fail("--org-id is required");
      const trust = text(flags.trust, "asserted") as Trust;
      if (!TRUST_LEVELS.includes(trust)) fail(`--trust must be one of ${TRUST_LEVELS.join(", ")}`);
      const scopes = text(flags.scopes, "projects:resolve,observations:write,claims:write,context:compile,feedback:write,evidence:read")
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean);
      for (const scope of scopes)
        if (scope !== "*" && !SCOPES.includes(scope as never)) fail(`unknown scope "${scope}"`);
      const kind = text(flags.kind, "agent");
      if (!["human", "agent", "service"].includes(kind)) fail("--kind must be human, agent, or service");
      const key = await createApiKey({
        orgId,
        principalId: text(flags.principal, newId("agent")),
        principalKind: kind as "human" | "agent" | "service",
        label: text(flags.label, "agent key"),
        scopes,
        maxTrust: trust,
      });
      if (flags["print-sql"]) {
        console.log(renderStatement(key.statement));
        console.error(`key_id: ${key.id}`);
        console.error(`api_key: ${key.key}`);
        break;
      }
      await withDb(dbPath, (db) => db.batch([key.statement]));
      printKey(key.key, key.id);
      break;
    }
    if (action === "list") {
      const rows = await withDb(dbPath, (db) =>
        db.all<{
          id: string;
          org_id: string;
          label: string;
          principal_id: string;
          scopes: string;
          max_trust: string;
          revoked_at: string | null;
        }>(
          `SELECT id, org_id, label, principal_id, scopes, max_trust, revoked_at
             FROM api_keys ORDER BY created_at`,
        ),
      );
      for (const row of rows)
        console.log(
          `${row.id}  ${row.revoked_at ? "revoked" : "active "}  ${row.org_id}  ${row.principal_id}  ${row.max_trust}  ${row.label}  [${row.scopes}]`,
        );
      if (!rows.length) console.log("no keys");
      break;
    }
    if (action === "revoke") {
      const id = text(flags.id, "");
      if (!id) fail("--id is required");
      await withDb(dbPath, (db) =>
        db.batch([
          {
            sql: `UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
            params: [new Date().toISOString(), id],
          },
        ]),
      );
      console.log(`revoked ${id}`);
      break;
    }
    fail("key needs create, list, or revoke");
    break;
  }

  case "backup": {
    const out = text(flags.out, "");
    if (!out) fail("--out <file> is required");
    const sourcePath = resolve(dbPath);
    const outPath = resolve(out);
    if (sourcePath === outPath) fail("--out must differ from --db");
    if (!existsSync(sourcePath)) fail(`database does not exist: ${dbPath}`);
    const temporary = join(
      dirname(outPath),
      `.${basename(outPath)}.tmp-${process.pid}-${crypto.randomUUID()}`,
    );
    // VACUUM INTO writes a compacted, self-contained copy and is safe against a
    // live WAL database. Only a verified adjacent temp file replaces the target,
    // so a failed run cannot leave a stale or empty file looking successful.
    try {
      const database = openDatabase(sourcePath, { create: false });
      try {
        database.run(`VACUUM INTO ?`, temporary);
      } finally {
        database.close();
      }
      const copy = openDatabase(temporary, { create: false });
      try {
        const integrity = copy.query(`PRAGMA integrity_check`).all() as { integrity_check: string }[];
        if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok")
          throw new Error(`integrity check returned ${integrity[0]?.integrity_check ?? "no result"}`);
        const foreignKeys = copy.query(`PRAGMA foreign_key_check`).all();
        if (foreignKeys.length) throw new Error("foreign key check failed");
        const objects = copy.query(
          `SELECT COUNT(*) AS count FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'`,
        ).get() as { count: number };
        if (Number(objects.count) === 0) throw new Error("schema is empty");
        const schema = await schemaState(createSqliteDb(copy));
        if (!schema.verified || schema.applied !== schema.expected)
          throw new Error(`schema verification failed (${schema.applied}/${schema.expected})`);
      } finally {
        copy.close();
      }
      chmodSync(temporary, 0o600);
      renameSync(temporary, outPath);
    } catch (error) {
      rmSync(temporary, { force: true });
      fail(`backup failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    console.log(`backup verified: ${outPath}`);
    break;
  }

  case "schema": {
    console.log(
      "CREATE TABLE IF NOT EXISTS titen_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
    );
    for (const migration of MIGRATIONS) {
      console.log(`-- migration ${migration.version}`);
      for (const statement of migration.statements)
        console.log(`${statement.replace(/\s+/g, " ").trim()};`);
    }
    console.log(
      `INSERT OR IGNORE INTO titen_migrations (version, applied_at) VALUES (${
        MIGRATIONS[MIGRATIONS.length - 1]!.version
      }, '1970-01-01T00:00:00.000Z');`,
    );
    break;
  }

  default:
    console.log(USAGE);
    if (command) process.exit(1);
}
