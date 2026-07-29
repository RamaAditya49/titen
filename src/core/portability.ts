import { MAX_BOUND_PARAMS, chunk } from "./db";
import type { Stmt } from "./db";
import { conflict, validationError } from "./errors";
import { sha256Hex } from "./ids";
import type { RequestContext, Result } from "./http";
import { isRecord } from "./validate";

export const EXPORT_FORMAT_VERSION = 1;
export const EXPORT_TYPES = ["projects", "observations", "claims"] as const;
export const EXPORT_MAX_LIMIT = 2000;
export const IMPORT_MAX_LINES = 2000;
/** Statements per atomic batch, kept well inside D1's per-batch limits. */
const IMPORT_BATCH = 50;

/**
 * Canonical records leave as versioned JSONL: one header line describing the
 * page, then one line per record. Credentials are never exported, and indexes
 * are rebuilt on import rather than copied.
 */
export async function exportRecords(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const type = ctx.url.searchParams.get("type") ?? "observations";
  if (!EXPORT_TYPES.includes(type as never))
    throw validationError(`Query "type" must be one of: ${EXPORT_TYPES.join(", ")}.`);
  const after = ctx.url.searchParams.get("after") ?? "";
  const limitParam = Number(ctx.url.searchParams.get("limit") ?? "500");
  if (!Number.isInteger(limitParam) || limitParam < 1 || limitParam > EXPORT_MAX_LIMIT)
    throw validationError(`Query "limit" must be an integer between 1 and ${EXPORT_MAX_LIMIT}.`);

  const lines: string[] = [];
  let cursor = "";

  if (type === "projects") {
    const rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT id, reference, created_at FROM projects
        WHERE org_id = ? AND id > ? ORDER BY id LIMIT ?`,
      [principal.orgId, after, limitParam],
    );
    for (const row of rows) {
      cursor = String(row.id);
      lines.push(JSON.stringify({ type: "project", ...row }));
    }
  } else if (type === "observations") {
    const rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT id, subject_id, project_id, agent_id, run_id, actor_id, kind, content, content_hash,
              source_type, source_ref, trust, visibility, occurred_at, ingested_at
         FROM observations WHERE org_id = ? AND id > ? ORDER BY id LIMIT ?`,
      [principal.orgId, after, limitParam],
    );
    for (const row of rows) {
      cursor = String(row.id);
      lines.push(JSON.stringify({ type: "observation", ...row }));
    }
  } else {
    const rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT id, subject_id, project_id, observer_id, actor_id, kind, statement, confidence,
              trust, visibility, status, version, valid_from, valid_to, created_at
         FROM claims WHERE org_id = ? AND id > ? ORDER BY id LIMIT ?`,
      [principal.orgId, after, limitParam],
    );
    const ids = rows.map((row) => String(row.id));
    const sources: { claim_id: string; observation_id: string; relation: string; created_at: string }[] = [];
    for (const group of chunk(ids))
      sources.push(
        ...(await ctx.app.db.all<{
          claim_id: string;
          observation_id: string;
          relation: string;
          created_at: string;
        }>(
          `SELECT claim_id, observation_id, relation, created_at FROM claim_sources
            WHERE claim_id IN (${group.map(() => "?").join(", ")})
            ORDER BY claim_id, observation_id, relation`,
          group,
        )),
      );
    const grouped = new Map<string, unknown[]>();
    for (const source of sources) {
      const list = grouped.get(source.claim_id) ?? [];
      list.push({
        observation_id: source.observation_id,
        relation: source.relation,
        created_at: source.created_at,
      });
      grouped.set(source.claim_id, list);
    }
    for (const row of rows) {
      cursor = String(row.id);
      lines.push(
        JSON.stringify({ type: "claim", ...row, sources: grouped.get(String(row.id)) ?? [] }),
      );
    }
  }

  const header = {
    type: "titen.export.header",
    format_version: EXPORT_FORMAT_VERSION,
    record_type: type,
    org_id: principal.orgId,
    exported_at: ctx.app.now().toISOString(),
    count: lines.length,
    next_cursor: lines.length === limitParam ? cursor : null,
    complete: lines.length < limitParam,
  };

  return {
    raw: new Response(`${[JSON.stringify(header), ...lines].join("\n")}\n`, {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        "x-request-id": ctx.requestId,
      },
    }),
    data: null,
  };
}

const text = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value === "")
    throw validationError(`Imported record is missing "${field}".`);
  return value;
};
const maybe = (value: unknown): string | null =>
  value === undefined || value === null ? null : String(value);

/**
 * Replays exported records into the authenticated organization. Original record
 * IDs are preserved so evidence links survive a move, and re-importing the same
 * file changes nothing.
 */
export async function importRecords(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const raw = await ctx.rawBody();
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) throw validationError("Import body must contain at least one record.");
  if (lines.length > IMPORT_MAX_LINES)
    throw validationError(`Import accepts at most ${IMPORT_MAX_LINES} lines per request.`);

  const received = { project: 0, observation: 0, claim: 0, claim_source: 0 };
  const byType: Record<string, Record<string, unknown>[]> = {
    project: [],
    observation: [],
    claim: [],
  };
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw validationError("Every import line must be valid JSON.");
    }
    if (!isRecord(parsed)) throw validationError("Every import line must be a JSON object.");
    if (parsed.type === "titen.export.header") {
      if (parsed.format_version !== EXPORT_FORMAT_VERSION)
        throw validationError(`Unsupported export format version "${String(parsed.format_version)}".`);
      continue;
    }
    const recordType = String(parsed.type ?? "");
    if (!(recordType in byType)) throw validationError(`Unknown record type "${recordType}".`);
    byType[recordType]!.push(parsed);
  }

  const at = ctx.app.now().toISOString();
  await assertNoForeignIds(ctx, principal.orgId, byType);
  const statements: Stmt[] = [];

  for (const row of byType.project!) {
    received.project += 1;
    statements.push({
      sql: `INSERT OR IGNORE INTO projects (id, org_id, reference, created_at) VALUES (?, ?, ?, ?)`,
      params: [text(row.id, "id"), principal.orgId, text(row.reference, "reference"), maybe(row.created_at) ?? at],
    });
  }

  for (const row of byType.observation!) {
    received.observation += 1;
    const id = text(row.id, "id");
    statements.push({
      sql: `INSERT OR IGNORE INTO observations
              (id, org_id, subject_id, project_id, agent_id, run_id, actor_id, kind, content,
               content_hash, source_type, source_ref, trust, visibility, occurred_at, ingested_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        principal.orgId,
        text(row.subject_id, "subject_id"),
        maybe(row.project_id),
        maybe(row.agent_id),
        maybe(row.run_id),
        maybe(row.actor_id) ?? principal.principalId,
        text(row.kind, "kind"),
        text(row.content, "content"),
        maybe(row.content_hash) ?? (await sha256Hex(String(row.content))),
        text(row.source_type, "source_type"),
        maybe(row.source_ref),
        text(row.trust, "trust"),
        text(row.visibility, "visibility"),
        maybe(row.occurred_at),
        maybe(row.ingested_at) ?? at,
      ],
    });
    // Rebuild the index entry rather than importing it, and stay idempotent.
    statements.push({
      sql: `DELETE FROM observations_fts WHERE observation_id = ?`,
      params: [id],
    });
    statements.push({
      sql: `INSERT INTO observations_fts (content, observation_id) VALUES (?, ?)`,
      params: [text(row.content, "content"), id],
    });
    statements.push(await importHistory(principal.orgId, "observation", id, at));
  }

  for (const row of byType.claim!) {
    received.claim += 1;
    const id = text(row.id, "id");
    statements.push({
      sql: `INSERT OR IGNORE INTO claims
              (id, org_id, subject_id, project_id, observer_id, actor_id, kind, statement,
               confidence, trust, visibility, status, version, valid_from, valid_to, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        principal.orgId,
        text(row.subject_id, "subject_id"),
        maybe(row.project_id),
        maybe(row.observer_id),
        maybe(row.actor_id) ?? principal.principalId,
        text(row.kind, "kind"),
        text(row.statement, "statement"),
        typeof row.confidence === "number" ? row.confidence : 0.8,
        text(row.trust, "trust"),
        text(row.visibility, "visibility"),
        text(row.status, "status"),
        typeof row.version === "number" ? row.version : 1,
        text(row.valid_from, "valid_from"),
        maybe(row.valid_to),
        maybe(row.created_at) ?? at,
      ],
    });
    statements.push({ sql: `DELETE FROM claims_fts WHERE claim_id = ?`, params: [id] });
    statements.push({
      sql: `INSERT INTO claims_fts (statement, claim_id) VALUES (?, ?)`,
      params: [text(row.statement, "statement"), id],
    });
    statements.push(await importHistory(principal.orgId, "claim", id, at));
    const sources = Array.isArray(row.sources) ? row.sources : [];
    for (const entry of sources) {
      if (!isRecord(entry)) throw validationError("Each claim source must be an object.");
      received.claim_source += 1;
      statements.push({
        sql: `INSERT OR IGNORE INTO claim_sources (claim_id, observation_id, relation, created_at)
              VALUES (?, ?, ?, ?)`,
        params: [
          id,
          text(entry.observation_id, "observation_id"),
          text(entry.relation, "relation"),
          maybe(entry.created_at) ?? at,
        ],
      });
    }
  }

  for (let index = 0; index < statements.length; index += IMPORT_BATCH)
    await ctx.app.db.batch(statements.slice(index, index + IMPORT_BATCH));

  return {
    status: 200,
    data: { format_version: EXPORT_FORMAT_VERSION, received },
    meta: { batches: Math.ceil(statements.length / IMPORT_BATCH) },
  };
}

/**
 * An id that already belongs to another organization must never be silently
 * skipped: that would look like a successful import of missing data.
 */
async function assertNoForeignIds(
  ctx: RequestContext,
  orgId: string,
  byType: Record<string, Record<string, unknown>[]>,
): Promise<void> {
  // Kept as one statement per table: folding them into a UNION would bind each
  // id three times, forcing chunks three times smaller for the same number of
  // round trips, and would risk D1's 100-parameter cap.
  const tables: [string, string][] = [
    ["project", "projects"],
    ["observation", "observations"],
    ["claim", "claims"],
  ];
  for (const [recordType, table] of tables) {
    const ids = byType[recordType]!.map((row) => text(row.id, "id"));
    for (const group of chunk(ids, MAX_BOUND_PARAMS - 1)) {
      const rows = await ctx.app.db.all<{ id: string }>(
        `SELECT id FROM ${table} WHERE org_id <> ? AND id IN (${group.map(() => "?").join(", ")})`,
        [orgId, ...group],
      );
      if (rows.length)
        throw conflict("An imported record id already exists outside this organization.");
    }
  }
}

async function importHistory(
  orgId: string,
  recordType: string,
  recordId: string,
  at: string,
): Promise<Stmt> {
  // Deterministic id keeps a repeated import from stacking history rows.
  const id = `hist_${(await sha256Hex(`import:${recordType}:${recordId}`)).slice(0, 32)}`;
  return {
    sql: `INSERT OR IGNORE INTO record_history
            (id, org_id, record_type, record_id, version, change_kind, actor_id, snapshot_hash, changed_at)
          VALUES (?, ?, ?, ?, 1, 'import', 'import', ?, ?)`,
    params: [id, orgId, recordType, recordId, id, at],
  };
}
