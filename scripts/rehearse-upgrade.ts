#!/usr/bin/env bun
/**
 * Operational lifecycle rehearsal.
 *
 * Seeds a store on a published `titen-memory` release through the real HTTP
 * API, then exercises the three lifecycle paths that every previous Titen
 * measurement skipped because it always used a freshly bootstrapped database:
 *
 *   1. upgrade  — migrate that NON-EMPTY file with the working tree and prove
 *                 every canonical row keeps its identity;
 *   2. backup   — run `deploy/backup.sh` for real, destroy the original, restore
 *                 from the backup, and compare the same compile query;
 *   3. portable — export NDJSON, import into a fresh store, and diff the two
 *                 exports record for record.
 *
 *   bun scripts/rehearse-upgrade.ts [--from 0.4.1] [--work DIR] [--port 8901]
 *                                   [--report FILE] [--keep]
 *
 * `--from` accepts any published version; when it is too old to migrate the
 * script reports the failing migration rather than hiding it, which is how the
 * real supported floor gets measured. The report contains ids, counts and
 * hashes only. The bootstrap API key stays in memory and is never printed,
 * written, or passed on a command line.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKING_TREE_CLI = join(REPO_ROOT, "src/runtime/bun/cli.ts");
const BACKUP_SCRIPT = join(REPO_ROOT, "deploy/backup.sh");

type Flags = Record<string, string | true>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[name] = true;
    else { flags[name] = next; i += 1; }
  }
  return flags;
}

const flags = parseFlags(process.argv.slice(2));
const FROM_VERSION = typeof flags.from === "string" ? flags.from : "0.4.1";
const BASE_PORT = Number(typeof flags.port === "string" ? flags.port : "8901");
const KEEP = flags.keep === true;
const WORK = typeof flags.work === "string"
  ? resolve(flags.work)
  : mkdtempSync(join(tmpdir(), "titen-rehearsal-"));

mkdirSync(WORK, { recursive: true });

// ---------------------------------------------------------------- process ---

async function run(cmd: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd ?? WORK,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

async function mustRun(cmd: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  const result = await run(cmd, options);
  if (result.code !== 0)
    throw new Error(`command failed (${result.code}): ${cmd[0]} ${cmd[1] ?? ""}\n${result.stderr.slice(0, 2000)}`);
  return result;
}

type Server = { port: number; stop: () => Promise<void> };

async function serve(cli: string, dbPath: string, port: number, quietFlag: string[] = ["--quiet"]): Promise<Server> {
  // A stale listener from an earlier aborted run answers /healthz from the wrong
  // database, and the rehearsal then reports a 401 instead of a busy port.
  try {
    await fetch(`http://127.0.0.1:${port}/healthz`);
    throw new Error(`port ${port} already has a listener; stop it before rehearsing`);
  } catch (error) {
    if (String(error).includes("already has a listener")) throw error;
  }
  const proc = Bun.spawn(["bun", cli, "serve", "--db", dbPath, "--port", String(port), ...quietFlag], {
    cwd: WORK,
    // Vector retrieval stays out of the rehearsal: the sidecar index is
    // rebuildable and is not what an upgrade or a restore has to preserve.
    env: { ...process.env, TITEN_EMBED_BASE_URL: "", TITEN_EMBED_MODEL: "", TITEN_EMBED_DIMS: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (proc.exitCode !== null) {
      const stderr = await new Response(proc.stderr).text();
      // Releases before 0.3.0 have no --quiet; retry once rather than call the
      // whole rehearsal a migration failure.
      if (quietFlag.length && /unknown flag "--quiet"/.test(stderr)) return serve(cli, dbPath, port, []);
      throw new Error(`server exited before becoming healthy: ${stderr.slice(0, 2000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) break;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error(`server on port ${port} never became healthy`);
    await Bun.sleep(150);
  }
  return {
    port,
    stop: async () => {
      proc.kill();
      await proc.exited;
      // Bun keeps the WAL beside the database; give the kernel a beat to flush
      // the final checkpoint before anything reads the file directly.
      await Bun.sleep(200);
    },
  };
}

// -------------------------------------------------------------------- api ---

function client(port: number, key: string) {
  return async function api(method: string, path: string, body?: unknown, raw?: string) {
    const headers: Record<string, string> = { authorization: `Bearer ${key}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (raw !== undefined) headers["content-type"] = "application/x-ndjson";
    if (method !== "GET") headers["idempotency-key"] = crypto.randomUUID();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 600)}`);
    if (response.headers.get("content-type")?.includes("ndjson")) return text;
    if (!text) return null;
    const parsed = JSON.parse(text);
    // Every JSON route answers in the { data, meta } envelope.
    return parsed && typeof parsed === "object" && "data" in parsed && "meta" in parsed
      ? parsed.data
      : parsed;
  };
}

// -------------------------------------------------------------- inventory ---

type Inventory = {
  schema_version: number;
  applied_migrations: number[];
  tables: Record<string, number>;
  ids: Record<string, string[]>;
  claims: Record<string, string>;
  observations: Record<string, string>;
};

function inventory(dbPath: string): Inventory {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all()
      .map((row) => row.name);
    const counts: Record<string, number> = {};
    const ids: Record<string, string[]> = {};
    for (const table of tables) {
      counts[table] = Number(
        (db.query(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n,
      );
      const columns = db.query<{ name: string }, []>(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
      if (columns.includes("id"))
        ids[table] = db
          .query<{ id: string }, []>(`SELECT id FROM "${table}" ORDER BY id`)
          .all()
          .map((row) => String(row.id));
    }
    // Canonical identity, not just presence: a migration that rewrote a
    // statement, a status, or an evidence hash would keep the row count and
    // still have lost the record.
    const claims: Record<string, string> = {};
    for (const row of db
      .query<Record<string, unknown>, []>(
        `SELECT id, kind, statement, status, version, confidence, trust, visibility,
                valid_from, valid_to, superseded_by FROM claims ORDER BY id`,
      )
      .all())
      claims[String(row.id)] = JSON.stringify(row);
    const observations: Record<string, string> = {};
    for (const row of db
      .query<Record<string, unknown>, []>(
        `SELECT id, subject_id, kind, content_hash, source_type, trust, visibility, ingested_at
           FROM observations ORDER BY id`,
      )
      .all())
      observations[String(row.id)] = JSON.stringify(row);
    const applied = db
      .query<{ version: number }, []>(`SELECT version FROM titen_migrations ORDER BY version`)
      .all()
      .map((row) => Number(row.version));
    return {
      schema_version: applied.at(-1) ?? 0,
      applied_migrations: applied,
      tables: counts,
      ids,
      claims,
      observations,
    };
  } finally {
    db.close();
  }
}

function diffInventory(before: Inventory, after: Inventory) {
  const lostTables = Object.keys(before.tables).filter((t) => !(t in after.tables));
  const shrunk = Object.keys(before.tables)
    .filter((t) => t in after.tables && after.tables[t]! < before.tables[t]!)
    .map((t) => ({ table: t, before: before.tables[t]!, after: after.tables[t]! }));
  const lostIds: { table: string; missing: string[] }[] = [];
  for (const [table, ids] of Object.entries(before.ids)) {
    const present = new Set(after.ids[table] ?? []);
    const missing = ids.filter((id) => !present.has(id));
    if (missing.length) lostIds.push({ table, missing });
  }
  const mutated = (kind: "claims" | "observations") =>
    Object.entries(before[kind])
      .filter(([id, row]) => after[kind][id] !== row)
      .map(([id]) => id);
  return {
    lost_tables: lostTables,
    shrunk_tables: shrunk,
    lost_ids: lostIds,
    mutated_claims: mutated("claims"),
    mutated_observations: mutated("observations"),
    new_tables: Object.keys(after.tables).filter((t) => !(t in before.tables)),
  };
}

// ------------------------------------------------------------------- seed ---

const SUBJECTS = ["user_alpha", "user_beta", "team_gamma"] as const;

async function seedCorpus(api: ReturnType<typeof client>) {
  // Resolution alone never creates scope; creating a project is a capability.
  const project = await api("POST", "/v1/projects/resolve", {
    reference: "rehearsal/lifecycle",
    create: true,
  });
  // Team visibility is refused without a workspace, so the workspace and the
  // membership are part of the corpus rather than an optional extra.
  const workspace = await api("POST", "/v1/workspaces", { name: "Rehearsal Workspace" });
  await api("POST", "/v1/memberships", {
    workspace_id: workspace.workspace_id,
    principal_id: "owner",
    principal_kind: "human",
    role: "owner",
  });
  const observations: string[] = [];
  const kinds = ["user_statement", "tool_result", "imported_source", "decision", "system_event"] as const;
  for (let i = 0; i < 15; i += 1) {
    const subject = SUBJECTS[i % SUBJECTS.length]!;
    const record = await api("POST", "/v1/observations", {
      subject_id: subject,
      project_id: project.project_id,
      kind: kinds[i % kinds.length],
      content: `rehearsal observation ${i} for ${subject}: deployment window is Tuesday 02:00 UTC, owner is ops-${i % 4}`,
      source: { type: "rehearsal", ref: `seed-${i}` },
      trust: i % 3 === 0 ? "verified" : "asserted",
      visibility: "team",
      workspace_id: workspace.workspace_id,
      agent_id: `agent_${i % 2}`,
      run_id: `run_${i % 3}`,
    });
    observations.push(record.observation_id);
  }

  // Multi-source claims, so evidence links are more than a 1:1 shadow of the
  // observation table and an upgrade has an actual join to preserve.
  const first = await api("POST", "/v1/consolidations", {
    subject_id: SUBJECTS[0],
    project_id: project.project_id,
    workspace_id: workspace.workspace_id,
    claims: [
      {
        kind: "semantic_fact",
        statement: "The deployment window is Tuesday at 02:00 UTC.",
        confidence: 0.9,
        sources: [
          { observation_id: observations[0], relation: "supports" },
          { observation_id: observations[3], relation: "supports" },
        ],
        trust: "verified",
      },
      {
        kind: "preference",
        statement: "Alpha prefers a summary before the full evidence trace.",
        confidence: 0.7,
        sources: [{ observation_id: observations[6], relation: "supports" }],
      },
      {
        kind: "procedural",
        statement: "Rollback requires an owner acknowledgement inside ten minutes.",
        confidence: 0.8,
        sources: [
          { observation_id: observations[9], relation: "supports" },
          { observation_id: observations[12], relation: "qualifies" },
        ],
      },
    ],
  });

  const second = await api("POST", "/v1/consolidations", {
    subject_id: SUBJECTS[1],
    project_id: project.project_id,
    workspace_id: workspace.workspace_id,
    claims: [
      {
        kind: "episodic_event",
        statement: "Beta escalated the ingest backlog on the second Tuesday.",
        confidence: 0.75,
        sources: [{ observation_id: observations[1], relation: "supports" }],
      },
      {
        kind: "decision",
        statement: "Beta chose the lexical-only operating point for the batch lane.",
        confidence: 0.85,
        sources: [{ observation_id: observations[4], relation: "supports" }],
      },
    ],
  });

  // A disputed pair: one claim carries a contradicting source, which is the
  // only way conflict reaches the claim status without a resolution step.
  const disputed = await api("POST", "/v1/consolidations", {
    subject_id: SUBJECTS[2],
    project_id: project.project_id,
    workspace_id: workspace.workspace_id,
    claims: [
      {
        kind: "semantic_fact",
        statement: "Gamma owns the ingest lane.",
        confidence: 0.6,
        sources: [
          { observation_id: observations[2], relation: "supports" },
          { observation_id: observations[5], relation: "contradicts" },
        ],
      },
      {
        kind: "semantic_fact",
        statement: "Gamma does not own the ingest lane.",
        confidence: 0.55,
        sources: [{ observation_id: observations[8], relation: "supports" }],
      },
    ],
  });

  // A superseded claim: the replacement is authored first, then the original is
  // fenced by its expected version.
  const replacement = await api("POST", "/v1/consolidations", {
    subject_id: SUBJECTS[0],
    project_id: project.project_id,
    workspace_id: workspace.workspace_id,
    claims: [
      {
        kind: "semantic_fact",
        statement: "The deployment window moved to Thursday at 03:00 UTC.",
        confidence: 0.95,
        sources: [{ observation_id: observations[12], relation: "supports" }],
        trust: "verified",
      },
    ],
  });
  const supersededId = first.claims[0].claim_id;
  await api("POST", `/v1/claims/${supersededId}/supersede`, {
    superseded_by: replacement.claims[0].claim_id,
    expected_version: 1,
    reason: "schedule change rehearsed",
  });

  const checkpoint = await api("POST", "/v1/checkpoints", {
    subject_id: SUBJECTS[0],
    kind: "task_state",
    state: { step: "rehearsal", cursor: 42, pending: ["verify", "publish"] },
    ttl_seconds: 86_400,
    // agent_id defaults to the calling principal and may not name another.
    run_id: "run_0",
  });

  const lease = await api("POST", "/v1/leases", {
    resource_type: "rehearsal_resource",
    resource_id: "ingest-lane",
    purpose: "upgrade rehearsal",
    ttl_seconds: 86_400,
  });

  return {
    project_id: project.project_id as string,
    workspace_id: workspace.workspace_id as string,
    observation_ids: observations,
    claim_ids: [...first.claims, ...second.claims, ...disputed.claims, ...replacement.claims]
      .map((c: { claim_id: string }) => c.claim_id),
    superseded_claim_id: supersededId as string,
    superseding_claim_id: replacement.claims[0].claim_id as string,
    disputed_claim_id: disputed.claims[0].claim_id as string,
    checkpoint_id: checkpoint.checkpoint_id as string,
    lease_id: lease.lease_id as string,
  };
}

/** The read side every phase re-runs: identity, evidence, and a compile. */
async function readBack(api: ReturnType<typeof client>, seed: Awaited<ReturnType<typeof seedCorpus>>) {
  const evidence: Record<string, number> = {};
  const statuses: Record<string, string> = {};
  for (const claimId of seed.claim_ids) {
    // A claim that survives migration but is no longer authorized to read is a
    // measurable upgrade outcome, not a reason to abandon the rehearsal.
    const result = await tolerate(() => api("GET", `/v1/claims/${claimId}/evidence`));
    evidence[claimId] = result ? result.evidence.length : -1;
    statuses[claimId] = result ? (result.claim?.status ?? result.status ?? "unknown") : "unreadable";
  }
  const compiles: Record<string, string[]> = {};
  for (const subject of SUBJECTS) {
    const pack = await api("POST", "/v1/context/compile", {
      subject_id: subject,
      task: "What is the deployment window and who owns the ingest lane?",
      max_tokens: 1200,
      project_id: seed.project_id,
    });
    compiles[subject] = pack.items.map((item: { claim_id: string }) => item.claim_id).sort();
  }
  // Coordination reads are tolerant: releases before 0.2.0 answer only DELETE on
  // /v1/checkpoints/:id, and a missing route there is not a lost record.
  const checkpoint = await tolerate(() => api("GET", `/v1/checkpoints/${seed.checkpoint_id}`));
  const leases = await tolerate(() => api("GET", "/v1/leases"));
  return {
    evidence_counts: evidence,
    claim_statuses: statuses,
    compiles,
    checkpoint_state_hash: checkpoint
      ? Bun.SHA256.hash(JSON.stringify(checkpoint.state ?? checkpoint), "hex")
      : null,
    lease_ids: leases
      ? (leases.leases ?? leases.items ?? []).map((l: { lease_id?: string; id?: string }) => l.lease_id ?? l.id).sort()
      : null,
  };
}

async function tolerate<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch { return null; }
}

/** null on either side means the route was absent, not that a record was lost. */
function sameOrUnmeasured(before: unknown, after: unknown) {
  if (before === null || after === null) return "not measured";
  return JSON.stringify(before) === JSON.stringify(after);
}

async function exportAll(api: ReturnType<typeof client>) {
  const types = ["keys", "workspaces", "memberships", "projects", "observations", "claims"] as const;
  const pages: string[] = [];
  const counts: Record<string, number> = {};
  const unsupported: Record<string, string> = {};
  for (const type of types) {
    let after = "";
    let records = 0;
    try {
      for (;;) {
        const query = `type=${type}&all=true&limit=500${after ? `&after=${encodeURIComponent(after)}` : ""}`;
        const body = (await api("GET", `/v1/export?${query}`)) as string;
        const lines = body.split("\n").filter(Boolean);
        const header = JSON.parse(lines[0]!);
        pages.push(...lines);
        records += lines.length - 1;
        if (header.complete || !header.next_cursor) break;
        after = header.next_cursor;
      }
      counts[type] = records;
    } catch (error) {
      // A record type the seeding release cannot export is a version fact.
      counts[type] = -1;
      unsupported[type] = String(error).slice(0, 200);
    }
  }
  return { lines: pages, counts, unsupported };
}

/** Records only, header lines dropped: headers carry a timestamp and an org id. */
function recordLines(lines: string[]) {
  return lines
    .filter((line) => !line.includes('"titen.export.header"'))
    .map((line) => {
      const row = JSON.parse(line) as Record<string, unknown>;
      return JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));
    })
    .sort();
}

// ------------------------------------------------------------------- main ---

const report: Record<string, unknown> = {
  rehearsal: "operational-lifecycle",
  from_version: FROM_VERSION,
  working_tree_version: (await mustRun(["bun", WORKING_TREE_CLI, "version"])).stdout.trim(),
  started_at: new Date().toISOString(),
  host: process.env.HOSTNAME ?? "unknown",
  work_dir: WORK,
};

let server: Server | undefined;

try {
  // --- phase 1: seed on the published release ------------------------------
  const oldRoot = join(WORK, "old");
  mkdirSync(oldRoot, { recursive: true });
  await mustRun(["npm", "pack", `titen-memory@${FROM_VERSION}`, "--silent"], { cwd: oldRoot });
  await mustRun(["tar", "-xf", `titen-memory-${FROM_VERSION}.tgz`], { cwd: oldRoot });
  const oldCli = join(oldRoot, "package/src/runtime/bun/cli.ts");
  if (!existsSync(oldCli)) throw new Error(`published ${FROM_VERSION} has no ${oldCli}`);

  const dbPath = join(WORK, "store.db");
  const bootstrap = await mustRun(["bun", oldCli, "bootstrap", "--db", dbPath, "--org", "Rehearsal"]);
  const key = bootstrap.stdout.match(/^api_key:\s*(\S+)$/m)?.[1];
  if (!key) throw new Error("bootstrap did not print an api key");

  const seedInventory = inventory(dbPath);
  server = await serve(oldCli, dbPath, BASE_PORT);
  const oldApi = client(server.port, key);
  const seed = await seedCorpus(oldApi);
  const before = await readBack(oldApi, seed);
  const beforeExport = await exportAll(oldApi);
  await server.stop();
  server = undefined;

  const inventoryBefore = inventory(dbPath);
  report.phase_1_seed = {
    published_cli: `titen-memory@${FROM_VERSION}`,
    schema_version_after_bootstrap: seedInventory.schema_version,
    schema_version_after_seed: inventoryBefore.schema_version,
    observations: seed.observation_ids.length,
    claims: seed.claim_ids.length,
    row_counts: inventoryBefore.tables,
    claim_statuses: before.claim_statuses,
  };

  // --- phase 2: upgrade in place -------------------------------------------
  const dryRun = await mustRun(["bun", WORKING_TREE_CLI, "migrate", "--db", dbPath, "--dry-run"]);
  const pending = Number(dryRun.stdout.match(/-- (\d+) migration\(s\) pending/)?.[1] ?? "-1");
  const migrateResult = await run(["bun", WORKING_TREE_CLI, "migrate", "--db", dbPath]);
  report.phase_2_upgrade = {
    pending_before: pending,
    migrate_exit_code: migrateResult.code,
    migrate_stdout: migrateResult.stdout.trim(),
    migrate_stderr: migrateResult.stderr.trim().slice(0, 2000),
  };
  if (migrateResult.code !== 0) {
    (report.phase_2_upgrade as Record<string, unknown>).verdict =
      `FLOOR: ${FROM_VERSION} does not migrate forward with this working tree`;
    throw new Error(`migrate failed from ${FROM_VERSION}: ${migrateResult.stderr.slice(0, 1000)}`);
  }

  const inventoryAfter = inventory(dbPath);
  const drift = diffInventory(inventoryBefore, inventoryAfter);
  server = await serve(WORKING_TREE_CLI, dbPath, BASE_PORT + 1);
  const newApi = client(server.port, key);
  const after = await readBack(newApi, seed);
  const afterExport = await exportAll(newApi);
  await server.stop();
  server = undefined;

  (report.phase_2_upgrade as Record<string, unknown>).applied_migrations_before = inventoryBefore.applied_migrations;
  (report.phase_2_upgrade as Record<string, unknown>).applied_migrations_after = inventoryAfter.applied_migrations;
  (report.phase_2_upgrade as Record<string, unknown>).migrations_applied =
    inventoryAfter.applied_migrations.filter((v) => !inventoryBefore.applied_migrations.includes(v));
  (report.phase_2_upgrade as Record<string, unknown>).row_counts_before = inventoryBefore.tables;
  (report.phase_2_upgrade as Record<string, unknown>).row_counts_after = inventoryAfter.tables;
  (report.phase_2_upgrade as Record<string, unknown>).drift = drift;
  (report.phase_2_upgrade as Record<string, unknown>).credential_still_authenticates = true;
  (report.phase_2_upgrade as Record<string, unknown>).evidence_before = before.evidence_counts;
  (report.phase_2_upgrade as Record<string, unknown>).evidence_after = after.evidence_counts;
  (report.phase_2_upgrade as Record<string, unknown>).evidence_identical =
    JSON.stringify(before.evidence_counts) === JSON.stringify(after.evidence_counts);
  (report.phase_2_upgrade as Record<string, unknown>).statuses_identical =
    JSON.stringify(before.claim_statuses) === JSON.stringify(after.claim_statuses);
  (report.phase_2_upgrade as Record<string, unknown>).compiles_before = before.compiles;
  (report.phase_2_upgrade as Record<string, unknown>).compiles_after = after.compiles;
  (report.phase_2_upgrade as Record<string, unknown>).checkpoint_survived =
    sameOrUnmeasured(before.checkpoint_state_hash, after.checkpoint_state_hash);
  (report.phase_2_upgrade as Record<string, unknown>).lease_survived =
    sameOrUnmeasured(before.lease_ids, after.lease_ids);
  (report.phase_2_upgrade as Record<string, unknown>).export_record_counts_before = beforeExport.counts;
  (report.phase_2_upgrade as Record<string, unknown>).export_record_counts_after = afterExport.counts;
  (report.phase_2_upgrade as Record<string, unknown>).export_types_unsupported_by_source = beforeExport.unsupported;

  // --- phase 3: backup, destroy, restore -----------------------------------
  const backupDir = join(WORK, "backups");
  // The comparison baseline is the state at backup time, not the state before
  // the phase-2 read-back: compiles and exports append audit and context rows.
  const inventoryAtBackup = inventory(dbPath);
  const backupRun = await mustRun(["bash", BACKUP_SCRIPT, dbPath, backupDir], {
    env: { TITEN_ROOT: REPO_ROOT },
  });
  const backupFile = backupRun.stdout.match(/Backup complete: (\S+)/)?.[1];
  if (!backupFile) throw new Error(`backup.sh produced no path: ${backupRun.stdout}`);
  const checksum = await mustRun(["sha256sum", "--check", `${backupFile}.sha256`], { cwd: backupDir });

  // Destroy is a rename, not an unlink: the rehearsal proves restore works, it
  // does not need to prove the filesystem can delete a file.
  const destroyed = `${dbPath}.destroyed`;
  const sourceBytes = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
    .reduce((total, file) => total + (existsSync(file) ? Bun.file(file).size : 0), 0);
  renameSync(dbPath, destroyed);
  for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(sidecar)) rmSync(sidecar);
  const openedAfterDestroy = await run(["bun", WORKING_TREE_CLI, "migrate", "--db", dbPath, "--dry-run"]);

  await mustRun(["cp", backupFile, dbPath]);
  const restoredInventory = inventory(dbPath);
  server = await serve(WORKING_TREE_CLI, dbPath, BASE_PORT + 2);
  const restoredApi = client(server.port, key);
  const restored = await readBack(restoredApi, seed);
  await server.stop();
  server = undefined;
  rmSync(destroyed, { force: true });

  report.phase_3_backup_restore = {
    backup_script: BACKUP_SCRIPT,
    backup_bytes: Bun.file(backupFile).size,
    source_bytes_including_wal: sourceBytes,
    checksum_check: checksum.stdout.trim().replace(/^.*\//, ""),
    destroyed_store_reports_pending: Number(
      openedAfterDestroy.stdout.match(/-- (\d+) migration\(s\) pending/)?.[1] ?? "-1",
    ),
    restored_row_counts: restoredInventory.tables,
    row_counts_identical: JSON.stringify(inventoryAtBackup.tables) === JSON.stringify(restoredInventory.tables),
    row_count_drift: diffInventory(inventoryAtBackup, restoredInventory),
    compile_identical: JSON.stringify(after.compiles) === JSON.stringify(restored.compiles),
    compiles_restored: restored.compiles,
    evidence_identical: JSON.stringify(after.evidence_counts) === JSON.stringify(restored.evidence_counts),
    checkpoint_survived: sameOrUnmeasured(after.checkpoint_state_hash, restored.checkpoint_state_hash),
    lease_survived: sameOrUnmeasured(after.lease_ids, restored.lease_ids),
  };

  // --- phase 4: export / import round trip ---------------------------------
  const freshDb = join(WORK, "fresh.db");
  const freshBootstrap = await mustRun(["bun", WORKING_TREE_CLI, "bootstrap", "--db", freshDb, "--org", "Rehearsal Import"]);
  const freshKey = freshBootstrap.stdout.match(/^api_key:\s*(\S+)$/m)?.[1];
  if (!freshKey) throw new Error("fresh bootstrap did not print an api key");

  server = await serve(WORKING_TREE_CLI, dbPath, BASE_PORT + 3);
  const sourceApi = client(server.port, key);
  const sourceExport = await exportAll(sourceApi);
  await server.stop();
  server = undefined;
  const exportPath = join(WORK, "export.ndjson");
  writeFileSync(exportPath, `${sourceExport.lines.join("\n")}\n`, { mode: 0o600 });

  server = await serve(WORKING_TREE_CLI, freshDb, BASE_PORT + 4);
  const freshApi = client(server.port, freshKey);
  const importResults: Record<string, unknown> = {};
  // Import respects the declared dependency order; a single request per type
  // keeps the failure attributable to one record type.
  for (const type of ["keys", "workspaces", "memberships", "projects", "observations", "claims"]) {
    const lines = sourceExport.lines.filter((line) => {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (row.type === "titen.export.header") return row.record_type === type;
      return true;
    });
    const header = lines.find((line) => line.includes('"titen.export.header"'));
    const records = lines.filter(
      (line) => !line.includes('"titen.export.header"')
        && JSON.parse(line).type === ({
          keys: "api_key", workspaces: "workspace", memberships: "membership",
          projects: "project", observations: "observation", claims: "claim",
        } as Record<string, string>)[type],
    );
    if (!records.length) { importResults[type] = { records: 0, skipped: "nothing exported" }; continue; }
    const body = `${[header, ...records].filter(Boolean).join("\n")}\n`;
    try {
      const result = await freshApi("POST", "/v1/import", undefined, body);
      importResults[type] = { records: records.length, result };
    } catch (error) {
      importResults[type] = { records: records.length, error: String(error).slice(0, 600) };
    }
  }
  const roundTripExport = await exportAll(freshApi);
  await server.stop();
  server = undefined;

  const sourceRecords = recordLines(sourceExport.lines);
  const roundTripRecords = recordLines(roundTripExport.lines);
  const sourceSet = new Set(sourceRecords);
  const roundTripSet = new Set(roundTripRecords);
  report.phase_4_export_import = {
    export_bytes: Bun.file(exportPath).size,
    source_counts: sourceExport.counts,
    round_trip_counts: roundTripExport.counts,
    import_results: importResults,
    every_source_record_preserved: sourceRecords.every((line) => roundTripSet.has(line)),
    byte_identical: sourceRecords.length === roundTripRecords.length
      && sourceRecords.every((line, index) => line === roundTripRecords[index]),
    missing_after_round_trip: sourceRecords.filter((line) => !roundTripSet.has(line)).slice(0, 20),
    added_after_round_trip: roundTripRecords.filter((line) => !sourceSet.has(line)).slice(0, 20),
  };

  report.outcome = "completed";
} catch (error) {
  report.outcome = "failed";
  report.error = String(error).slice(0, 4000);
} finally {
  // A thrown phase must never leave a listener holding the rehearsal port.
  await server?.stop();
  report.finished_at = new Date().toISOString();
  const out = typeof flags.report === "string" ? resolve(flags.report) : join(WORK, "report.json");
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`report: ${out}`);
  console.log(`outcome: ${String(report.outcome)}`);
  if (!KEEP && typeof flags.work !== "string") rmSync(WORK, { recursive: true, force: true });
}

if (report.outcome !== "completed") process.exit(1);
