#!/usr/bin/env bun
import { createApiKey, organizationStatement, SCOPES } from "../../core/auth";
import { MIGRATIONS, migrate } from "../../core/migrations";
import { newId } from "../../core/ids";
import { TRUST_LEVELS, type Trust } from "../../core/validate";
import { createSqliteDb, openDatabase } from "./sqlite";
import { serve } from "./server";

const USAGE = `titen — self-hosted memory service

Usage:
  titen serve      [--db titen.db] [--port 8787] [--host 127.0.0.1] [--revision dev]
  titen migrate    [--db titen.db]
  titen bootstrap  [--db titen.db] [--org "My Org"] [--label owner] [--print-sql]
  titen key create [--db titen.db] --org-id <id> [--principal <id>] [--kind agent]
                   [--scopes "a,b"] [--trust asserted] [--label name] [--print-sql]
  titen key list   [--db titen.db]
  titen key revoke [--db titen.db] --id <key id>
  titen schema     print every migration statement (for "wrangler d1 execute --file")

Notes:
  --print-sql emits SQL for a remote database (Cloudflare D1) instead of writing
  locally. A raw key is printed once and is never recoverable afterwards.
  Scopes: ${SCOPES.join(", ")} (or * for all).
`;

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return { flags, positional };
}

const text = (value: string | boolean | undefined, fallback: string) =>
  typeof value === "string" ? value : fallback;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
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

async function withDb<T>(path: string, run: (db: ReturnType<typeof createSqliteDb>) => Promise<T>) {
  const database = openDatabase(path);
  try {
    return await run(createSqliteDb(database));
  } finally {
    database.close();
  }
}

const { flags, positional } = parseArgs(process.argv.slice(2));
const command = positional[0];
const dbPath = text(flags.db, "titen.db");

switch (command) {
  case "serve": {
    const started = await serve({
      dbPath,
      port: Number(text(flags.port, "8787")),
      hostname: text(flags.host, "127.0.0.1"),
      revision: text(flags.revision, "dev"),
    });
    console.log(`titen listening on ${started.url} (database ${dbPath})`);
    break;
  }

  case "migrate": {
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
    const action = positional[1];
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
      `INSERT INTO titen_migrations (version, applied_at) VALUES (${
        MIGRATIONS[MIGRATIONS.length - 1]!.version
      }, '${new Date().toISOString()}');`,
    );
    break;
  }

  default:
    console.log(USAGE);
    if (command) process.exit(1);
}
