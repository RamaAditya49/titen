import { createApp } from "../../core/app";
import { authenticate, createApiKey, organizationStatement } from "../../core/auth";
import { newOperatorAccount } from "../../core/accounts";
import { auditStatement } from "../../core/audit";
import { first, type Db, type Stmt } from "../../core/db";
import { newId } from "../../core/ids";
import { migrate } from "../../core/migrations";
import { parseReferenceGraph } from "../../core/portability";
import { prepareSigningSecrets } from "../../core/secrets";
import { TITEN_VERSION } from "../../core/version";
import { createSqliteDb, openDatabase } from "./sqlite";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

type JsonRpcId = string | number | null;

type StdioOptions = {
  endpoint?: string;
  apiKey?: string;
  input?: AsyncIterable<Uint8Array>;
  fetcher?: typeof fetch;
  write?: (line: string) => void;
};

function requestId(message: unknown): JsonRpcId | undefined {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  if (!Object.hasOwn(message, "id")) return undefined;
  const id = (message as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function failure(id: JsonRpcId, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

function endpointFrom(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("TITEN_MCP_URL must be a valid HTTP /mcp endpoint");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith("/mcp")
  ) throw new Error("TITEN_MCP_URL must be a credential-free HTTP /mcp endpoint");
  return url;
}

// --- Zero-config local store ---

/**
 * One provisioning routine, used by `titen bootstrap` and by the local store
 * below. Returns statements only: the caller decides whether they are written,
 * printed as SQL for a remote database, or rolled back.
 */
export async function provisionOwner(input: {
  orgName: string;
  username: string;
  label: string;
  orgId?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const orgId = input.orgId ?? newId("org");
  const key = await createApiKey({
    orgId,
    principalId: "owner",
    principalKind: "human",
    label: input.label,
    scopes: ["*"],
    maxTrust: "policy_approved",
  }, now);
  const owner = await newOperatorAccount({
    orgId,
    createdBy: "owner",
    username: input.username,
    role: "owner",
    scopes: ["*"],
    maxTrust: "policy_approved",
    now,
    principalId: "owner",
  });
  const statements: Stmt[] = [
    organizationStatement(orgId, input.orgName, now),
    key.statement,
    ...owner.statements,
    auditStatement(
      orgId, "owner", "operator_account.create", "operator_account",
      now.toISOString(), owner.accountId,
    ),
  ];
  return { orgId, key, owner, statements };
}

/**
 * Ids of the organization, workspace and project a new local store provisions.
 * They are fixed rather than random so that two `titen mcp` processes racing on
 * a brand new file cannot both win: the loser's organization INSERT violates the
 * primary key, its whole batch rolls back, and it adopts what the winner wrote
 * instead of silently splitting one machine's memory across two organizations.
 */
const LOCAL_ORG_ID = "org_local";
const LOCAL_WORKSPACE_ID = "ws_local";
const LOCAL_PROJECT_ID = "project_local";
const LOCAL_KEY_LABEL = "local";

export function localStorePath(): string {
  return join(homedir(), ".titen", "memory.db");
}

const firstOrganization = (db: Db) =>
  first<{ id: string }>(db, `SELECT id FROM organizations ORDER BY created_at, id LIMIT 1`);

async function authenticates(db: Db, rawKey: string): Promise<boolean> {
  try {
    await authenticate(
      db,
      new Request("http://127.0.0.1/v1/principal", {
        headers: { authorization: `Bearer ${rawKey}` },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Real records, not a special case: the key this returns is checked by exactly
 * the same core predicates a served deployment uses.
 */
async function localOwnerKey(db: Db, keyPath: string): Promise<string> {
  const stored = existsSync(keyPath) ? readFileSync(keyPath, "utf8").trim() : "";
  if (stored && await authenticates(db, stored)) return stored;

  const now = new Date();
  const raw = await provisionLocalOwner(db, now);
  // Only a key's hash is stored, so a raw key cannot be recovered from the
  // database. Keeping it beside the store means a restart reuses one owner
  // instead of accumulating a credential row per process; the store it opens is
  // a plaintext SQLite file in the same directory, so this widens no access.
  writeFileSync(keyPath, `${raw}\n`, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  return raw;
}

async function provisionLocalOwner(db: Db, now: Date): Promise<string> {
  const at = now.toISOString();
  if (!(await firstOrganization(db))) {
    const provisioned = await provisionOwner({
      orgId: LOCAL_ORG_ID,
      orgName: "Local",
      username: "owner",
      label: LOCAL_KEY_LABEL,
      now,
    });
    try {
      await db.batch([
        ...provisioned.statements,
        {
          sql: `INSERT INTO workspaces (id, org_id, name, created_at) VALUES (?, ?, 'Local', ?)`,
          params: [LOCAL_WORKSPACE_ID, LOCAL_ORG_ID, at],
        },
        {
          sql: `INSERT INTO memberships
                  (id, org_id, workspace_id, principal_id, principal_kind, role, created_at)
                VALUES (?, ?, ?, 'owner', 'human', 'owner', ?)`,
          params: [newId("mbr"), LOCAL_ORG_ID, LOCAL_WORKSPACE_ID, at],
        },
        {
          sql: `INSERT INTO projects (id, org_id, reference, created_at) VALUES (?, ?, 'local', ?)`,
          params: [LOCAL_PROJECT_ID, LOCAL_ORG_ID, at],
        },
      ]);
      return provisioned.key.key;
    } catch (error) {
      // A lost race leaves a complete store written by the winner. Anything else
      // (a full disk, a corrupt file) must not be reported as one.
      if (!(await firstOrganization(db))) throw error;
    }
  }
  // An existing store keeps its own organization, whether the winner of a race
  // wrote it or an operator ran `titen bootstrap` against this path.
  const key = await createApiKey({
    orgId: (await firstOrganization(db))!.id,
    principalId: "owner",
    principalKind: "human",
    label: LOCAL_KEY_LABEL,
    scopes: ["*"],
    maxTrust: "policy_approved",
  }, now);
  await db.batch([key.statement]);
  return key.key;
}

/**
 * Opens the zero-config local store, creating `~/.titen/memory.db` with a real
 * organization, workspace, project and owner principal when it is new.
 *
 * Returns the same request handler `serve` binds to a socket, without binding
 * one: no listener for a local firewall to prompt about, no HTTP hop, and no
 * vector capability, so retrieval is FTS-only and nothing reaches the network.
 */
export async function openLocalStore(dbPath = localStorePath()): Promise<{
  app: (request: Request) => Promise<Response>;
  apiKey: string;
  close: () => void;
}> {
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const database = openDatabase(dbPath);
  try {
    const db = createSqliteDb(database);
    await migrate(db);
    const apiKey = await localOwnerKey(db, `${dbPath}.key`);
    return {
      app: createApp({
        db,
        revision: TITEN_VERSION,
        runtime: "bun-sqlite",
        secretStorageReady: await prepareSigningSecrets(db, undefined),
      }),
      apiKey,
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

/**
 * Address of the in-process local store. Nothing ever connects to it: the shim
 * below answers every request without a socket. It exists because the request
 * pipeline needs a URL, and it satisfies the same endpoint rules as a remote one.
 */
const LOCAL_ENDPOINT = "http://127.0.0.1/mcp";

// --- Adopting an existing @modelcontextprotocol/server-memory store ---

/** Where the reference server's package lives once installed, relative to a root. */
const REFERENCE_PACKAGE = join("node_modules", "@modelcontextprotocol", "server-memory", "dist");

/**
 * Every place a `@modelcontextprotocol/server-memory` graph can be, most
 * explicit first.
 *
 * `MEMORY_FILE_PATH` wins outright when it is set, because the user has said
 * where the file is. With it unset the reference server writes **beside its own
 * module**, not in the directory you launched it from — so the store of anyone
 * who ran it the documented way is inside its install, and for the documented
 * `npx -y @modelcontextprotocol/server-memory` that install is a hashed
 * directory under npm's `_npx` cache. Searching only the cwd found neither, and
 * an MCP server launched by a desktop client inherits the client's working
 * directory anyway, so the cwd guess was weakest exactly where it was relied
 * on. Both names are tried: `memory.jsonl` since 2025.11.25, `memory.json`
 * before it.
 */
export function referenceMemoryCandidates(cwd = process.cwd()): string[] {
  const configured = process.env.MEMORY_FILE_PATH;
  if (configured) return [isAbsolute(configured) ? configured : join(cwd, configured)];
  const roots = [cwd, join(cwd, REFERENCE_PACKAGE), ...npxCachedReferenceDirs()];
  return roots.flatMap((root) => [join(root, "memory.jsonl"), join(root, "memory.json")]);
}

/**
 * Reference-server installs that `npx` has left in npm's cache. Each run gets
 * its own hashed directory, so there can be several and the newest is not
 * knowable from the name; every one is offered as a candidate and the first
 * that exists wins.
 */
function npxCachedReferenceDirs(): string[] {
  const cache = join(homedir(), ".npm", "_npx");
  if (!existsSync(cache)) return [];
  try {
    return readdirSync(cache)
      .map((entry) => join(cache, entry, REFERENCE_PACKAGE))
      .filter((dir) => existsSync(dir));
  } catch {
    return []; // an unreadable cache is not a reason to fail the server
  }
}

export function referenceMemoryPath(cwd = process.cwd()): string | undefined {
  return referenceMemoryCandidates(cwd).find((path) => existsSync(path));
}

/** Splits a list so no single MCP request approaches the 1 MiB body limit. */
function batched<Item>(items: Item[], limit = 200_000): Item[][] {
  const groups: Item[][] = [];
  let current: Item[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = JSON.stringify(item).length;
    if (current.length && bytes + size > limit) {
      groups.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length) groups.push(current);
  return groups;
}

/**
 * Imports a reference-server store through the same MCP tools a client calls,
 * so the import path and the live path cannot drift apart.
 *
 * Entities are created before their observations are added rather than in one
 * call, because both steps are idempotent that way: an import interrupted
 * halfway resumes on the next start instead of leaving an entity whose
 * remaining observations can never arrive. The marker file records which
 * sources have been read — re-importing would resurrect entities the user
 * deleted after switching.
 */
export async function importReferenceMemory(
  local: { app: (request: Request) => Promise<Response>; apiKey: string },
  source: string,
  markerPath: string,
): Promise<{ entities: number; relations: number } | undefined> {
  const done = existsSync(markerPath)
    ? readFileSync(markerPath, "utf8").split("\n").filter(Boolean)
    : [];
  if (done.includes(source)) return undefined;
  const graph = parseReferenceGraph(readFileSync(source, "utf8"));

  let messageId = 0;
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await local.app(new Request(LOCAL_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${local.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (messageId += 1),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }));
    const body = await response.json() as {
      result?: { isError?: boolean; content?: { text?: string }[] };
      error?: { message?: string };
    };
    const failure = body.error?.message
      ?? (body.result?.isError ? body.result.content?.[0]?.text : undefined);
    if (failure) throw new Error(`${name}: ${failure}`);
  };

  for (const group of batched(graph.entities))
    await call("create_entities", {
      entities: group.map(({ name, entityType }) => ({ name, entityType, observations: [] })),
    });
  for (const group of batched(graph.entities.filter((entity) => entity.observations.length)))
    await call("add_observations", {
      observations: group.map(({ name, observations }) => ({
        entityName: name,
        contents: observations,
      })),
    });
  for (const group of batched(graph.relations))
    await call("create_relations", { relations: group });

  appendFileSync(markerPath, `${source}\n`, { mode: 0o600 });
  return { entities: graph.entities.length, relations: graph.relations.length };
}

/**
 * Zero-config local mode. With neither variable set there is nothing to bridge
 * to, so `titen mcp` opens `~/.titen/memory.db` instead and serves the same MCP
 * surface against it in process: no HTTP hop, no key to paste, no network.
 *
 * Local mode adds an entry point; it relaxes nothing. Every request below is
 * authenticated and authorized by the same core predicates a served deployment
 * uses, against a credential row that really exists.
 */
async function runLocalMcpStdio(options: StdioOptions): Promise<void> {
  const dbPath = localStorePath();
  const local = await openLocalStore(dbPath);
  try {
    const source = referenceMemoryPath();
    // stdout is the MCP transport, so every word about the import goes to
    // stderr. A failure leaves the marker unwritten and the next start retries;
    // it must not take the memory server down with it.
    if (source) try {
      const imported = await importReferenceMemory(local, source, `${dbPath}.imported`);
      if (imported) console.error(
        `titen: imported ${imported.entities} entities and ${imported.relations} relations from ${source}`,
      );
    } catch (error) {
      console.error(
        `titen: could not import ${source}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } else if (process.env.MEMORY_FILE_PATH) {
      // The user said where their graph is and it is not there. Silence here
      // reads as "Titen lost my memories", so name the path actually tried.
      //
      // Only this case warns. A first run that simply finds no graph says
      // nothing: most first runs are not migrations, some clients surface
      // stderr as an error, and `local-mode.test.ts` holds the stdio entry
      // point to a clean stderr on a normal start. Finding the graph is what
      // fixes the silent-empty-store failure — see referenceMemoryCandidates.
      console.error(
        `titen: MEMORY_FILE_PATH is set to ${referenceMemoryCandidates()[0]} but no file is there; starting empty.`,
      );
    }
    await runMcpStdio({
      ...options,
      endpoint: LOCAL_ENDPOINT,
      apiKey: local.apiKey,
      fetcher: (input, init) => local.app(new Request(input as string | URL, init)),
    });
  } finally {
    local.close();
  }
}

/** Adapts MCP's newline-delimited stdio transport to Titen's existing HTTP endpoint. */
export async function runMcpStdio(options: StdioOptions = {}): Promise<void> {
  const rawEndpoint = options.endpoint ?? process.env.TITEN_MCP_URL;
  const apiKey = options.apiKey ?? process.env.TITEN_API_KEY;
  if (!rawEndpoint && !apiKey) return runLocalMcpStdio(options);
  if (!rawEndpoint || !apiKey)
    throw new Error(
      "set both TITEN_MCP_URL and TITEN_API_KEY to bridge to a served instance, or neither to use the local store",
    );
  if (apiKey !== apiKey.trim() || /[\r\n]/u.test(apiKey))
    throw new Error("TITEN_API_KEY is invalid");

  const endpoint = endpointFrom(rawEndpoint);
  const fetcher = options.fetcher ?? fetch;
  const write = options.write ?? ((line: string) => console.log(line));
  const input = options.input ?? (Bun.stdin.stream() as AsyncIterable<Uint8Array>);
  const decoder = new TextDecoder();
  let pending = "";
  let protocolVersion: string | undefined;

  const forward = async (line: string) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      write(failure(null, -32700, "Parse error."));
      return;
    }
    const id = requestId(message);
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          ...(protocolVersion ? { "mcp-protocol-version": protocolVersion } : {}),
        },
        body: line,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await response.text()).replaceAll(apiKey, "[redacted]");
      if (id === undefined || body === "") return;
      const parsed = JSON.parse(body) as {
        jsonrpc?: unknown;
        result?: { protocolVersion?: unknown };
      };
      if (parsed.jsonrpc !== "2.0") throw new Error("invalid upstream response");
      if (
        (message as { method?: unknown }).method === "initialize" &&
        typeof parsed.result?.protocolVersion === "string"
      ) protocolVersion = parsed.result.protocolVersion;
      write(body);
    } catch {
      if (id !== undefined) write(failure(id, -32000, "Titen MCP request failed."));
    }
  };

  for await (const chunk of input) {
    pending += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/u, "");
      pending = pending.slice(newline + 1);
      if (line.trim()) await forward(line);
    }
  }
  pending += decoder.decode();
  if (pending.trim()) await forward(pending.replace(/\r$/u, ""));
}
