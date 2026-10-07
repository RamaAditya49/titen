#!/bin/sh
":" //; command -v bun >/dev/null 2>&1 || { echo "titen: error: bun was not found on PATH." >&2; echo "titen: the titen CLI runs on Bun 1.2 or newer. Install it from https://bun.sh, then run titen again." >&2; exit 1; }; exec bun "$0" "$@"
// Do not "simplify" the two lines above back to `#!/usr/bin/env bun`. npm and
// pnpm link this file into `node_modules/.bin`, so the kernel reads the shebang
// before any Titen code exists, and a Bun-less machine got env(1)'s own exit-127
// message naming neither Titen nor Bun. Line 2 is a string expression plus a
// comment to TypeScript and the whole check to `sh`, which never reaches line 3
// because it has already exec'd Bun or exited. One entry, one guard.
import { createApiKey, keyLifecycleStatus, SCOPES } from "../../core/auth";
import { auditStatement } from "../../core/audit";
import type { Stmt } from "../../core/db";
import {
  fenceAuditDetail,
  fenceStatements,
  fencesAreRestricted,
  fencesFromRows,
  parseFenceCsv,
  type FenceRow,
  type KeyFences,
} from "../../core/key-fences";
import { MIGRATIONS, SCHEMA_VERSION, migrate, pendingMigrations, schemaState } from "../../core/migrations";
import {
  ackEnrichmentJobs,
  listEnrichmentJobs,
  parseJobStatus,
  purgeEnrichmentJobs,
  retryEnrichmentJobs,
} from "../../core/jobs";
import { reassignPrivatePrincipal } from "../../core/principals";
import { newId } from "../../core/ids";
import { TRUST_LEVELS, VISIBILITIES, type Trust, type Visibility } from "../../core/validate";
import { normalizeProjectReference } from "../../core/projects";
import { createSqliteDb, openDatabase } from "./sqlite";
import { listHostAccounts, recoverHostAccount } from "./accounts";
import { serve } from "./server";
import { configureHttpExtraction } from "../../core/extraction";
import { parseSecretCipher } from "../../core/secrets";
import { TITEN_VERSION } from "../../core/version";
import { createBunWebhookSecurity } from "./webhooks";
import { fetchStableRelease, stableVersionStatus } from "./release";
import { localStorePath, provisionOwner, runMcpStdio } from "./mcp-stdio";
import { auditStore, renderReport } from "./audit";
import {
  SOURCE_IMPORT_PROFILE_IDS,
  applySourceImport,
  prepareSourceImport,
} from "./source-import";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const USAGE = `titen — self-hosted memory service

Usage:
  titen --version
  titen version    [--check]
  titen mcp        serve MCP over stdio: the local store when no environment is
                   set, otherwise a bridge to inherited TITEN_MCP_URL/TITEN_API_KEY
  titen serve      [--db <path>] [--port 8787] [--host 127.0.0.1] [--revision dev] [--quiet]
  titen dashboard  [--port 4322]  serve the packaged live operator dashboard
  titen migrate    [--db <path>] [--dry-run]
  titen bootstrap  [--db <path>] [--org "My Org"] [--username owner] [--label owner] [--print-sql]
  titen key create [--db <path>] --org-id <id> [--principal <id>] [--kind agent]
                   [--scopes "a,b"] [--trust asserted] [--label name]
                   [--not-before <UTC timestamp>] [--expires-at <UTC timestamp>] [--print-sql]
                   [--subjects <pattern,...>] [--projects <id,...>]
                   [--write-subjects <pattern,...>] [--write-projects <id,...>]
                   [--read-subjects <pattern,...>] [--read-projects <id,...>]
  titen key list   [--db <path>]
  titen key revoke [--db <path>] --id <key id>
  titen principal reassign [--db <path>] --org-id <id> --from <principal> --to <principal> [--dry-run]
  titen jobs list|retry|ack|purge [--db <path>] [--status terminal_error] [--org-id <id>] [--id <job id>]
  titen project create [--db <path>] --org-id <id> --reference <owner/repo>
                   [--default-visibility private|team|organization]
  titen project update [--db <path>] --org-id <id> --default-visibility <value>
                   (--id <project id> | --reference <owner/repo>)
  titen account list [--db <path>]
  titen account unlock [--db <path>] --username <name>
  titen account reset-password [--db <path>] --username <name>
  titen backup     [--db <path>] --out <file>   verified online copy
  titen schema     print every migration statement (for "wrangler d1 execute --file")
  titen audit      <path> [--json]   offline write-hygiene report for a Titen
                   store, a @modelcontextprotocol/server-memory memory.json(l),
                   or a Mem0 export
  titen import-source <path> --from <profile> --subject <id>
                   [--project <reference>] [--workspace-id <id>]
                   [--visibility private|team|organization]
                   [--trust unverified|asserted] [--db <path>] [--apply]

Notes:
  With neither TITEN_MCP_URL nor TITEN_API_KEY set, "titen mcp" serves
  ${localStorePath()} in process, creating it with one organization,
  workspace, project, and owner on first run.
  "audit" opens its path read-only and makes no network call of any kind. It
  prints a report; sharing it is the reader's decision.
  "import-source" previews locally unless --apply is present. Apply uses either
  an explicit --db plus TITEN_API_KEY, or TITEN_URL plus TITEN_API_KEY.
  Source profiles: ${SOURCE_IMPORT_PROFILE_IDS.join(", ")}.
  Bun service commands default to ${join(homedir(), ".titen", "service.db")}.
  "serve" never creates a missing database; run "titen bootstrap" first.
  "dashboard" serves the dashboard bundled with this npm release. Set
  TITEN_DASHBOARD_LIVE=true and the documented adapter variables for live data.
  --print-sql emits SQL for a remote database (Cloudflare D1) instead of writing
  locally. A raw key and temporary dashboard password are printed once and are
  never recoverable afterwards.
  --subjects and --projects are write fences. --write-subjects and
  --write-projects are the same fences. Subject patterns are exact or a single
  trailing *. Project values are project ids. Omit a list to leave that
  dimension unrestricted. A key with no fences behaves as before. Existing
  keys stay unrestricted; revoke one and create a replacement to add a fence.
  JSONL export does not carry key fences or raw keys. A SQLite backup does.
  Changing a key's principal does not move private records. Use
  "titen principal reassign" so the new principal can read them.
  "jobs ack" keeps a failed enrichment job but stops it from marking readiness
  terminal_error. "jobs purge" deletes an uncited failed job. "jobs retry"
  queues it again. Public /readyz does not list job ids; "jobs list" does.
  Scopes: ${SCOPES.join(", ")} (or * for all).
`;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const COMMAND_FLAGS: Record<
  string,
  { values: string[]; booleans?: string[]; positional?: string }
> = {
  version: { values: [], booleans: ["check"] },
  audit: { values: [], booleans: ["json"], positional: "path" },
  "import-source": {
    values: ["from", "subject", "project", "workspace-id", "visibility", "trust", "db"],
    booleans: ["apply"],
    positional: "path",
  },
  mcp: { values: [] },
  dashboard: { values: ["port"] },
  serve: { values: ["db", "port", "host", "revision"], booleans: ["quiet"] },
  migrate: { values: ["db"], booleans: ["dry-run"] },
  bootstrap: { values: ["db", "org", "username", "label"], booleans: ["print-sql"] },
  "key create": {
    values: [
      "db", "org-id", "principal", "kind", "scopes", "trust", "label",
      "not-before", "expires-at",
      "subjects", "projects", "write-subjects", "write-projects",
      "read-subjects", "read-projects",
    ],
    booleans: ["print-sql"],
  },
  "account list": { values: ["db"] },
  "account unlock": { values: ["db", "username"] },
  "account reset-password": { values: ["db", "username"] },
  "key list": { values: ["db"] },
  "key revoke": { values: ["db", "id"] },
  "principal reassign": {
    values: ["db", "org-id", "from", "to"],
    booleans: ["dry-run"],
  },
  "jobs list": { values: ["db", "status", "org-id", "id"] },
  "jobs retry": { values: ["db", "status", "org-id", "id"] },
  "jobs ack": { values: ["db", "status", "org-id", "id"] },
  "jobs purge": { values: ["db", "status", "org-id", "id"] },
  "project create": {
    values: ["db", "org-id", "reference", "default-visibility"],
  },
  "project update": {
    values: ["db", "org-id", "id", "reference", "default-visibility"],
  },
  backup: { values: ["db", "out"] },
  schema: { values: [] },
};

function parseArgs(argv: string[]) {
  if (argv.length === 1 && argv[0] === "--version") {
    console.log(TITEN_VERSION);
    process.exit(0);
  }
  // Help is conventionally read-only. Handle it before command validation so
  // no malformed companion flag can open a database or create a credential.
  if (argv.includes("--help")) {
    console.log(USAGE);
    process.exit(0);
  }
  const flags: Record<string, string | boolean> = {};
  if (argv.length === 0)
    return { command: undefined, action: undefined, flags, positional: undefined };

  const command = argv[0]!;
  const action = ["key", "account", "project", "principal", "jobs"].includes(command) ? argv[1] : undefined;
  const name = action ? `${command} ${action}` : command;
  const schema = COMMAND_FLAGS[name];
  if (!schema) {
    fail(command === "key"
      ? "key needs create, list, or revoke"
      : command === "project"
        ? "project needs create or update"
        : command === "principal"
          ? "principal needs reassign"
          : command === "jobs"
            ? "jobs needs list, retry, ack, or purge"
            : `unknown command "${command}"`);
  }

  const values = new Set(schema.values);
  const booleans = new Set(schema.booleans ?? []);
  let start = action ? 2 : 1;
  let positional: string | undefined;
  if (schema.positional) {
    const token = argv[start];
    if (token === undefined || token.startsWith("--"))
      fail(`${name} requires a ${schema.positional}`);
    positional = token;
    start += 1;
  }
  for (let index = start; index < argv.length; index += 1) {
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
  return { command, action, flags, positional };
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

function formatFence(patterns: string[] | null): string {
  return patterns && patterns.length ? patterns.join(",") : "-";
}

function optionalFence(
  flags: Record<string, string | boolean>,
  flag: string,
  alias: string | undefined,
  kind: "project" | "subject",
): string[] | null {
  const primary = flags[flag];
  const aliased = alias ? flags[alias] : undefined;
  if (typeof primary === "string" && typeof aliased === "string")
    fail(`pass only one of --${flag} and --${alias}`);
  const value = typeof primary === "string" ? primary : typeof aliased === "string" ? aliased : undefined;
  if (value === undefined) return null;
  try {
    return parseFenceCsv(value, flag, kind);
  } catch (error) {
    fail(error instanceof Error ? error.message : `invalid --${flag}`);
  }
}

function keyFencesFromFlags(flags: Record<string, string | boolean>): KeyFences {
  return {
    read_projects: optionalFence(flags, "read-projects", undefined, "project"),
    read_subjects: optionalFence(flags, "read-subjects", undefined, "subject"),
    write_projects: optionalFence(flags, "write-projects", "projects", "project"),
    write_subjects: optionalFence(flags, "write-subjects", "subjects", "subject"),
  };
}

function timestamp(value: string | boolean | undefined, flag: string): Date | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || !/^\d{4}-/u.test(parsed.toISOString()))
    fail(`--${flag} must be an ISO-8601 timestamp`);
  return parsed;
}

function sqlLiteral(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function renderStatement(statement: Stmt): string {
  let index = 0;
  const inlined = statement.sql.replace(/\?/g, () => sqlLiteral(statement.params?.[index++] ?? null));
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
  if (options?.create !== false && options?.readonly !== true && path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const sidecars = [`${path}-wal`, `${path}-shm`, `${path}-journal`];
  const snapshotDirectory = options?.readonly && !sidecars.some(existsSync)
    ? mkdtempSync(join(tmpdir(), "titen-readonly-"))
    : undefined;
  const databasePath = snapshotDirectory ? join(snapshotDirectory, basename(path)) : path;
  let database: ReturnType<typeof openDatabase> | undefined;
  try {
    if (snapshotDirectory) copyFileSync(path, databasePath);
    database = openDatabase(databasePath, options);
    return await run(createSqliteDb(database));
  } finally {
    database?.close();
    if (snapshotDirectory) rmSync(snapshotDirectory, { recursive: true, force: true });
  }
}

class CliFailure extends Error {}

async function withReadyDatabase<T>(
  path: string,
  run: (
    database: ReturnType<typeof openDatabase>,
    db: ReturnType<typeof createSqliteDb>,
  ) => Promise<T> | T,
  readonly = false,
): Promise<T> {
  if (!existsSync(path)) throw new CliFailure(`database does not exist: ${path}`);
  const database = openDatabase(path, { create: false, readonly });
  try {
    const db = createSqliteDb(database);
    const schema = await schemaState(db);
    if (!schema.verified || schema.applied !== schema.expected)
      throw new CliFailure(`database schema is not ready (${schema.applied}/${schema.expected})`);
    return await run(database, db);
  } finally {
    database.close();
  }
}

async function existingDatabase<T>(
  path: string,
  run: Parameters<typeof withReadyDatabase<T>>[1],
  readonly = false,
): Promise<T> {
  try {
    return await withReadyDatabase(path, run, readonly);
  } catch (error) {
    fail(error instanceof CliFailure ? error.message : "database operation failed");
  }
}

const { flags, command, action, positional } = parseArgs(process.argv.slice(2));
const explicitDb = typeof flags.db === "string";
const requestedDbPath = text(flags.db, join(homedir(), ".titen", "service.db"));
const dbPath = requestedDbPath === ":memory:" || requestedDbPath.startsWith("file::memory:")
  ? requestedDbPath
  : resolve(requestedDbPath);
const legacyDbPath = resolve("titen.db");
const localDatabaseCommand = ["serve", "migrate", "bootstrap", "key", "account", "backup"].includes(command ?? "")
  && !(flags["print-sql"] === true && (command === "bootstrap" || action === "create"));
if (
  !explicitDb
  && localDatabaseCommand
  && dbPath !== legacyDbPath
  && !existsSync(dbPath)
  && existsSync(legacyDbPath)
) {
  fail(
    `legacy database found at ${legacyDbPath}; rerun with --db ${legacyDbPath} to keep using it, or move it to ${dbPath}`,
  );
}

switch (command) {
  case "audit": {
    // Offline by construction: nothing below opens a socket, and the report is
    // written to this process's stdout only. See src/runtime/bun/audit.ts.
    let audit: Awaited<ReturnType<typeof auditStore>>;
    try {
      audit = await auditStore(positional!);
    } catch (error) {
      fail(error instanceof Error ? error.message : "audit failed");
    }
    console.log(flags.json ? JSON.stringify(audit, null, 2) : renderReport(audit));
    break;
  }

  case "import-source": {
    const profile = text(flags.from, "");
    if (!profile) fail("--from is required");
    const subject = text(flags.subject, "");
    if (!subject) fail("--subject is required");
    let prepared: Awaited<ReturnType<typeof prepareSourceImport>>;
    try {
      prepared = await prepareSourceImport({
        path: positional!,
        profile,
        subject,
        project: typeof flags.project === "string" ? flags.project : undefined,
        workspaceId: typeof flags["workspace-id"] === "string" ? flags["workspace-id"] : undefined,
        visibility: typeof flags.visibility === "string" ? flags.visibility : undefined,
        trust: typeof flags.trust === "string" ? flags.trust : undefined,
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "source preview failed");
    }
    if (flags.apply !== true) {
      console.log(JSON.stringify({ data: prepared.preview, meta: { applied: false } }, null, 2));
      break;
    }
    const apiKey = process.env.TITEN_API_KEY ?? "";
    const url = process.env.TITEN_URL;
    if (explicitDb && url) fail("--db and TITEN_URL are mutually exclusive");
    if (!explicitDb && !url) fail("--apply requires either --db <path> or TITEN_URL");
    let applied: Awaited<ReturnType<typeof applySourceImport>>;
    try {
      applied = await applySourceImport(prepared, {
        apiKey,
        ...(explicitDb ? { dbPath } : { url }),
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "source apply failed");
    }
    console.log(JSON.stringify({ data: { preview: prepared.preview, apply: applied }, meta: { applied: true } }, null, 2));
    break;
  }

  case "mcp": {
    try {
      await runMcpStdio();
    } catch (error) {
      fail(error instanceof Error ? error.message : "MCP bridge failed");
    }
    break;
  }

  case "dashboard": {
    if (flags.port !== undefined) process.env.TITEN_DASHBOARD_PORT = String(port(flags.port));
    await import("../../../scripts/dashboard-adapter.ts");
    break;
  }

  case "version": {
    if (!flags.check) {
      console.log(TITEN_VERSION);
      console.log(`schema_version ${SCHEMA_VERSION}`);
      break;
    }
    let release: Awaited<ReturnType<typeof fetchStableRelease>>;
    try {
      release = await fetchStableRelease();
    } catch (error) {
      fail(error instanceof Error ? error.message : "release check failed");
    }
    const status = stableVersionStatus(TITEN_VERSION, release.cliVersion);
    const labels = {
      current: "up to date",
      behind: "update available",
      ahead: "newer than stable",
      prerelease: "prerelease build",
    } as const;
    console.log(`CLI installed: ${TITEN_VERSION}`);
    console.log(`CLI stable:    ${release.cliVersion}`);
    console.log(`CLI status:    ${labels[status]}`);
    console.log(`Plugin stable: ${release.pluginVersion}`);
    console.log(`Release notes: https://titen.dev/releases/${release.cliVersion}`);
    console.log("Install/update: https://titen.dev/docs/install");
    break;
  }

  case "serve": {
    // Vector retrieval is configured by environment, not by flags: the values
    // are deployment facts (and one is a credential), so they belong in the unit
    // file or the container environment rather than a shell history. Absent any
    // of them the service serves lexical retrieval and says so in readiness.
    const servePort = port(flags.port);
    const quiet = flags.quiet === true;
    if (!existsSync(dbPath))
      fail(`database does not exist: ${dbPath}; run "titen bootstrap" first or pass --db <path>`);
    const extraction = configureHttpExtraction({
      baseUrl: process.env.TITEN_EXTRACT_BASE_URL,
      model: process.env.TITEN_EXTRACT_MODEL,
      modelFingerprint: process.env.TITEN_EXTRACT_MODEL_FINGERPRINT,
      apiKey: process.env.TITEN_EXTRACT_API_KEY,
      timeoutMs: process.env.TITEN_EXTRACT_TIMEOUT_MS === undefined
        ? undefined
        : Number(process.env.TITEN_EXTRACT_TIMEOUT_MS),
      responseMode: process.env.TITEN_EXTRACT_RESPONSE_MODE,
      gateUrl: process.env.TITEN_EXTRACT_GATE_URL,
      gateModel: process.env.TITEN_EXTRACT_GATE_MODEL,
      gateApiKey: process.env.TITEN_EXTRACT_GATE_API_KEY,
      gateAbstainBelow: process.env.TITEN_EXTRACT_GATE_ABSTAIN_BELOW === undefined
        ? undefined
        : Number(process.env.TITEN_EXTRACT_GATE_ABSTAIN_BELOW),
      gateTimeoutMs: process.env.TITEN_EXTRACT_GATE_TIMEOUT_MS === undefined
        ? undefined
        : Number(process.env.TITEN_EXTRACT_GATE_TIMEOUT_MS),
      gateLanes: process.env.TITEN_EXTRACT_GATE_LANES,
      gateLinkMinConfidence: process.env.TITEN_EXTRACT_GATE_LINK_MIN_CONFIDENCE === undefined
        ? undefined
        : Number(process.env.TITEN_EXTRACT_GATE_LINK_MIN_CONFIDENCE),
    });
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
        embedDims: process.env.TITEN_EMBED_DIMS,
        embedRevision: process.env.TITEN_EMBED_REVISION,
        embedProfile: process.env.TITEN_EMBED_PROFILE,
        embedMinCosine: process.env.TITEN_EMBED_MIN_COSINE,
        embedApiKey: process.env.TITEN_EMBED_API_KEY,
        extraction: extraction.capability,
        extractionState: extraction.state,
        extractionApiKeySet: Boolean(process.env.TITEN_EXTRACT_API_KEY),
        maintenanceIntervalMs:
          process.env.TITEN_MAINTENANCE_INTERVAL_MS === undefined
            ? undefined
            : Number(process.env.TITEN_MAINTENANCE_INTERVAL_MS),
        secretCipher: parseSecretCipher(process.env.TITEN_SECRET_KEYS),
        webhookSecurity: createBunWebhookSecurity(process.env.TITEN_WEBHOOK_ALLOWED_HOSTNAMES),
        mcpOrigin: process.env.TITEN_MCP_ORIGIN,
        webauthnRpId: process.env.TITEN_WEBAUTHN_RP_ID,
        webauthnOrigin: process.env.TITEN_WEBAUTHN_ORIGIN,
        webauthnRpName: process.env.TITEN_WEBAUTHN_RP_NAME,
        loginClientIpHeader: process.env.TITEN_LOGIN_CLIENT_IP_HEADER,
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
    const { orgId, key, owner, statements } = await provisionOwner({
      orgName,
      username: text(flags.username, "owner"),
      label: text(flags.label, "owner"),
    });
    if (flags["print-sql"]) {
      console.error(`-- organization ${orgId} (${orgName})`);
      for (const statement of statements) console.log(renderStatement(statement));
      console.error("");
      console.error(`key_id: ${key.id}`);
      console.error(`api_key: ${key.key}`);
      console.error(`dashboard_username: ${owner.username}`);
      console.error(`temporary_password: ${owner.temporaryPassword}`);
      console.error("Store these credentials now. Only their hashes appear in the SQL above.");
      console.error("Change the temporary password on first dashboard sign-in.");
      break;
    }
    await withDb(dbPath, async (db) => {
      await migrate(db);
      await db.batch(statements);
    });
    console.log(`database: ${dbPath}`);
    console.log(`organization: ${orgId} (${orgName})`);
    printKey(key.key, key.id);
    console.log(`dashboard_username: ${owner.username}`);
    console.log(`temporary_password: ${owner.temporaryPassword}`);
    console.log("Change the temporary password on first dashboard sign-in.");
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
      const issuedAt = new Date();
      const notBefore = timestamp(flags["not-before"], "not-before") ?? issuedAt;
      const expiresAt = timestamp(flags["expires-at"], "expires-at");
      if (expiresAt && notBefore.getTime() >= expiresAt.getTime())
        fail("--not-before must be earlier than --expires-at");
      const fences = keyFencesFromFlags(flags);
      const key = await createApiKey({
        orgId,
        principalId: text(flags.principal, newId("agent")),
        principalKind: kind as "human" | "agent" | "service",
        label: text(flags.label, "agent key"),
        scopes,
        maxTrust: trust,
        notBefore,
        ...(expiresAt ? { expiresAt } : {}),
      }, issuedAt);
      const fenceSql = fenceStatements(key.id, fences);
      const audit = fencesAreRestricted(fences)
        ? auditStatement(
          orgId,
          "cli",
          "key.create",
          "api_key",
          issuedAt.toISOString(),
          key.id,
          fenceAuditDetail({
            not_before: notBefore.toISOString(),
            expires_at: expiresAt ? expiresAt.toISOString() : null,
          }, fences),
        )
        : null;
      if (flags["print-sql"]) {
        console.log(renderStatement(key.statement));
        for (const statement of fenceSql) console.log(renderStatement(statement));
        if (audit) console.log(renderStatement(audit));
        console.error(`key_id: ${key.id}`);
        console.error(`api_key: ${key.key}`);
        break;
      }
      await existingDatabase(dbPath, (database) => {
        const organization = database.query("SELECT 1 FROM organizations WHERE id = ?").get(orgId);
        if (!organization) throw new CliFailure(`organization not found: ${orgId}`);
        database.transaction(() => {
          database.query(key.statement.sql).run(...key.statement.params);
          for (const statement of fenceSql)
            database.query(statement.sql).run(...(statement.params ?? []));
          if (audit) database.query(audit.sql).run(...(audit.params ?? []));
        })();
      });
      printKey(key.key, key.id);
      break;
    }
    if (action === "list") {
      const listedKeys = await existingDatabase(dbPath, (_database, db) =>
        Promise.all([
          db.all<{
            id: string;
            org_id: string;
            label: string;
            principal_id: string;
            scopes: string;
            max_trust: string;
            not_before: string;
            expires_at: string | null;
            last_used_at: string | null;
            revoked_at: string | null;
          }>(
            `SELECT id, org_id, label, principal_id, scopes, max_trust,
                    not_before, expires_at, last_used_at, revoked_at
               FROM api_keys ORDER BY created_at`,
          ),
          db.all<FenceRow & { key_id: string }>(
            `SELECT key_id, access, target_type, pattern FROM api_key_fences`,
          ),
        ]), true);
      const rows = listedKeys[0];
      const fenceRows = listedKeys[1];
      const fencesByKey = new Map<string, FenceRow[]>();
      for (const fence of fenceRows) {
        const group = fencesByKey.get(fence.key_id) ?? [];
        group.push(fence);
        fencesByKey.set(fence.key_id, group);
      }
      const at = new Date().toISOString();
      for (const row of rows) {
        const status = keyLifecycleStatus({
          notBefore: row.not_before,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
        }, at);
        const fences = fencesFromRows(fencesByKey.get(row.id) ?? []);
        console.log(
          `${row.id}  ${status.padEnd(7)}  ${row.org_id}  ${row.principal_id}  ${row.max_trust}  ${row.label}  [${row.scopes}]  not_before=${row.not_before}  expires_at=${row.expires_at ?? "never"}  last_used_at=${row.last_used_at ?? "never"}  read_projects=${formatFence(fences.read_projects)}  read_subjects=${formatFence(fences.read_subjects)}  write_projects=${formatFence(fences.write_projects)}  write_subjects=${formatFence(fences.write_subjects)}`,
        );
      }
      if (!rows.length) console.log("no keys");
      break;
    }
    if (action === "revoke") {
      const id = text(flags.id, "");
      if (!id) fail("--id is required");
      await existingDatabase(dbPath, (database) => {
        const result = database.query(
          `UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
        ).run(new Date().toISOString(), id);
        if (Number(result.changes) === 1) return;
        const key = database.query("SELECT revoked_at FROM api_keys WHERE id = ?").get(id) as
          | { revoked_at: string | null }
          | null;
        if (!key) throw new CliFailure(`key not found: ${id}`);
        throw new CliFailure(`key already revoked: ${id}`);
      });
      console.log(`revoked ${id}`);
      break;
    }
    fail("key needs create, list, or revoke");
    break;
  }

  case "project": {
    const orgId = text(flags["org-id"], "");
    if (!orgId) fail("--org-id is required");
    if (action === "update" && !flags["default-visibility"]) fail("--default-visibility is required");
    if (typeof flags["default-visibility"] === "string" && !VISIBILITIES.includes(flags["default-visibility"] as Visibility))
      fail(`--default-visibility must be one of ${VISIBILITIES.join(", ")}`);
    const defaultVisibility = typeof flags["default-visibility"] === "string"
      ? flags["default-visibility"] as Visibility
      : null;
    try {
      if (action === "create") {
        const reference = normalizeProjectReference(text(flags.reference, ""));
        const id = newId("project");
        const at = new Date().toISOString();
        await existingDatabase(dbPath, (database) => {
          const organization = database.query("SELECT 1 FROM organizations WHERE id = ?").get(orgId);
          if (!organization) throw new CliFailure(`organization not found: ${orgId}`);
          const taken = database.query("SELECT id FROM projects WHERE org_id = ? AND reference = ?").get(orgId, reference) as { id: string } | null;
          if (taken) throw new CliFailure(`project already exists: ${taken.id}`);
          database.query(
            `INSERT INTO projects (id, org_id, reference, created_at, default_visibility) VALUES (?, ?, ?, ?, ?)`,
          ).run(id, orgId, reference, at, defaultVisibility);
        });
        console.log(`project_id: ${id}`);
        console.log(`reference: ${reference}`);
        console.log(`default_visibility: ${defaultVisibility ?? "private"}`);
        break;
      }
      if (action === "update") {
        const projectId = text(flags.id, "");
        const referenceInput = text(flags.reference, "");
        if (!projectId && !referenceInput) fail("--id or --reference is required");
        if (projectId && referenceInput) fail("pass only one of --id or --reference");
        const reference = referenceInput ? normalizeProjectReference(referenceInput) : "";
        const updated = await existingDatabase(dbPath, (database) => {
          const row = (projectId
            ? database.query("SELECT id, reference FROM projects WHERE id = ? AND org_id = ?").get(projectId, orgId)
            : database.query("SELECT id, reference FROM projects WHERE org_id = ? AND reference = ?").get(orgId, reference)) as
            | { id: string; reference: string }
            | null;
          if (!row) throw new CliFailure("project not found");
          database.query(
            `UPDATE projects SET default_visibility = ? WHERE id = ? AND org_id = ?`,
          ).run(defaultVisibility, row.id, orgId);
          return row;
        });
        console.log(`project_id: ${updated.id}`);
        console.log(`reference: ${updated.reference}`);
        console.log(`default_visibility: ${defaultVisibility}`);
        break;
      }
      fail("project needs create or update");
    } catch (error) {
      fail(error instanceof Error ? error.message : "project command failed");
    }
    break;
  }

  case "account": {
    if (action === "list") {
      const accounts = await existingDatabase(dbPath, (_handle, db) => listHostAccounts(db), true);
      console.log(JSON.stringify({ accounts }, null, 2));
    } else {
      const username = text(flags.username, "");
      if (!username) fail("--username is required");
      const recovered = await existingDatabase(dbPath, (_handle, db) => recoverHostAccount(db, username, action === "reset-password"));
      console.log(`username: ${recovered.username}`);
      console.log("unlocked: true");
      if (recovered.temporaryPassword) {
        console.log(`temporary_password: ${recovered.temporaryPassword}`);
        console.log("password_change_required: true");
      }
    }
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
        database.run(`VACUUM INTO ?`, [temporary]);
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
      // Reassert after replacement because some container bind mounts recreate
      // the destination inode with the mount's default mode during rename.
      chmodSync(outPath, 0o600);
    } catch (error) {
      rmSync(temporary, { force: true });
      fail(`backup failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    console.log(`backup verified: ${outPath}`);
    break;
  }

  case "principal": {
    if (action !== "reassign") fail("principal needs reassign");
    const orgId = text(flags["org-id"], "");
    const from = text(flags.from, "");
    const to = text(flags.to, "");
    if (!orgId || !from || !to) fail("--org-id, --from, and --to are required");
    const dryRun = flags["dry-run"] === true;
    const result = await existingDatabase(dbPath, (database, db) =>
      reassignPrivatePrincipal(db, orgId, "cli", from, to, new Date().toISOString(), dryRun));
    console.log(JSON.stringify(result));
    break;
  }

  case "jobs": {
    if (!action || !["list", "retry", "ack", "purge"].includes(action))
      fail("jobs needs list, retry, ack, or purge");
    let status;
    try {
      status = parseJobStatus(text(flags.status, action === "list" ? "failed" : "terminal_error"));
    } catch (error) {
      fail(error instanceof Error ? error.message : "invalid status");
    }
    const orgId = text(flags["org-id"], "") || null;
    const id = text(flags.id, "") || null;
    const at = new Date().toISOString();
    const result = await existingDatabase(dbPath, async (database, db) => {
      if (action === "list") return { jobs: await listEnrichmentJobs(db, status, orgId) };
      if (action === "retry") return retryEnrichmentJobs(db, status, at, orgId, id);
      if (action === "ack") return ackEnrichmentJobs(db, status, at, orgId, id);
      return purgeEnrichmentJobs(db, status, orgId, id);
    });
    console.log(JSON.stringify(result));
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
