import { assertTrustCeiling } from "./auth";
import { authorizeRecordWorkspace, recordAccessParams, recordAccessSql } from "./authorization";
import { MAX_BOUND_PARAMS, chunk, type Stmt } from "./db";
import { conflict, unresolvedReference, validationError } from "./errors";
import { eventStatement } from "./events";
import { sha256Hex } from "./ids";
import type { RequestContext, Result } from "./http";
import { outboxStatement } from "./observations";
import {
  CLAIM_KINDS,
  CLAIM_RELATIONS,
  LIMITS,
  OBSERVATION_KINDS,
  TRUST_LEVELS,
  TRUST_RANK,
  VISIBILITIES,
  isRecord,
  requireEnum,
  requireString,
  type Trust,
  type Visibility,
} from "./validate";

export const EXPORT_FORMAT_VERSION = 1;
/**
 * ponytail: the portable format covers the memory surface only, not the whole
 * deployment. The ceiling is that workspaces, memberships, checkpoints,
 * feedback and version history do not survive an export/import roundtrip, so
 * JSONL is an interchange format and `titen backup` is the durability
 * boundary. Upgrade path: extend these types in dependency order, starting
 * with workspaces and memberships, which team-scoped records already require
 * on import (#111).
 */
export const EXPORT_TYPES = ["projects", "observations", "claims"] as const;
export const EXPORT_DEPENDENCY_ORDER = [...EXPORT_TYPES];
export const EXPORT_DEPENDENCIES: Record<(typeof EXPORT_TYPES)[number], string[]> = {
  projects: [],
  observations: ["projects"],
  claims: ["projects", "observations"],
};
// ponytail: both caps count rows, while the transport cap counts bytes. The
// ceiling is that the two are not reconciled, so a page this endpoint is
// willing to emit can exceed what the import endpoint will accept. Upgrade
// path: cut export pages on accumulated byte length as well as row count and
// set `next_cursor` accordingly, so any page is importable by construction
// (#112).
export const EXPORT_MAX_LIMIT = 2000;
export const IMPORT_MAX_LINES = 2000;

export async function exportRecords(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const type = ctx.url.searchParams.get("type") ?? "observations";
  if (!EXPORT_TYPES.includes(type as never))
    throw validationError(`Query "type" must be one of: ${EXPORT_TYPES.join(", ")}.`);
  const after = ctx.url.searchParams.get("after") ?? "";
  const limit = Number(ctx.url.searchParams.get("limit") ?? "500");
  if (!Number.isInteger(limit) || limit < 1 || limit > EXPORT_MAX_LIMIT)
    throw validationError(`Query "limit" must be an integer between 1 and ${EXPORT_MAX_LIMIT}.`);

  const lines: string[] = [];
  let cursor = "";
  if (type === "projects") {
    const rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT id, reference, created_at FROM projects
        WHERE org_id = ? AND id > ? ORDER BY id LIMIT ?`,
      [principal.orgId, after, limit],
    );
    for (const row of rows) {
      cursor = String(row.id);
      lines.push(JSON.stringify({ type: "project", ...row }));
    }
  } else if (type === "observations") {
    const rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT o.id, o.subject_id, o.project_id, o.workspace_id, o.agent_id, o.run_id, o.actor_id,
              o.kind, o.content, o.content_hash, o.source_type, o.source_ref, o.trust,
              o.visibility, o.occurred_at, o.ingested_at
         FROM observations o
        WHERE o.org_id = ? AND o.id > ? AND ${recordAccessSql("o")}
        ORDER BY o.id LIMIT ?`,
      [principal.orgId, after, ...recordAccessParams(principal.principalId), limit],
    );
    for (const row of rows) {
      cursor = String(row.id);
      lines.push(JSON.stringify({ type: "observation", ...row }));
    }
  } else {
    const rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT c.id, c.subject_id, c.project_id, c.workspace_id, c.observer_id, c.actor_id,
              c.kind, c.statement, c.confidence, c.trust, c.visibility, c.status, c.version,
              c.valid_from, c.valid_to, c.created_at
         FROM claims c
        WHERE c.org_id = ? AND c.id > ? AND ${recordAccessSql("c")}
        ORDER BY c.id LIMIT ?`,
      [principal.orgId, after, ...recordAccessParams(principal.principalId), limit],
    );
    const ids = rows.map((row) => String(row.id));
    const sources: Record<string, unknown>[] = [];
    for (const group of chunk(ids, MAX_BOUND_PARAMS - 2)) {
      if (!group.length) continue;
      sources.push(...await ctx.app.db.all<Record<string, unknown>>(
        `SELECT s.claim_id, s.observation_id, s.relation, s.created_at
           FROM claim_sources s JOIN observations o ON o.id = s.observation_id
          WHERE s.claim_id IN (${group.map(() => "?").join(", ")})
            AND o.org_id = ? AND ${recordAccessSql("o")}
          ORDER BY s.claim_id, s.observation_id, s.relation`,
        [...group, principal.orgId, ...recordAccessParams(principal.principalId)],
      ));
    }
    const grouped = new Map<string, unknown[]>();
    for (const source of sources) {
      const id = String(source.claim_id);
      const list = grouped.get(id) ?? [];
      list.push({ observation_id: source.observation_id, relation: source.relation, created_at: source.created_at });
      grouped.set(id, list);
    }
    for (const row of rows) {
      cursor = String(row.id);
      lines.push(JSON.stringify({ type: "claim", ...row, sources: grouped.get(String(row.id)) ?? [] }));
    }
  }

  const header = {
    type: "titen.export.header",
    format_version: EXPORT_FORMAT_VERSION,
    record_type: type,
    dependency_order: EXPORT_DEPENDENCY_ORDER,
    depends_on: EXPORT_DEPENDENCIES[type as (typeof EXPORT_TYPES)[number]],
    org_id: principal.orgId,
    exported_at: ctx.app.now().toISOString(),
    count: lines.length,
    next_cursor: lines.length === limit ? cursor : null,
    complete: lines.length < limit,
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

type Source = { observation_id: string; relation: string; created_at: string };
type Prepared = Record<string, unknown>;
type PreparedClaim = Prepared & { sources: Source[] };

const optionalText = (row: Record<string, unknown>, field: string, max: number): string | null => {
  const value = row[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > max || value.trim() === "")
    throw validationError(`Imported field "${field}" is invalid.`);
  return value;
};
const timestamp = (row: Record<string, unknown>, field: string, required = true): string | null => {
  const value = row[field];
  if ((value === undefined || value === null) && !required) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    throw validationError(`Imported field "${field}" must be an ISO-8601 timestamp.`);
  return new Date(value).toISOString();
};
const canonical = (value: unknown): string => JSON.stringify(value);

/** Validate the complete graph before committing it in one atomic batch. */
export async function importRecords(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const lines = (await ctx.rawBody()).split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw validationError("Import body must contain at least one record.");
  if (lines.length > IMPORT_MAX_LINES)
    throw validationError(`Import accepts at most ${IMPORT_MAX_LINES} lines per request.`);

  const rawByType: Record<"project" | "observation" | "claim", Record<string, unknown>[]> = {
    project: [], observation: [], claim: [],
  };
  for (const line of lines) {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { throw validationError("Every import line must be valid JSON."); }
    if (!isRecord(parsed)) throw validationError("Every import line must be a JSON object.");
    if (parsed.type === "titen.export.header") {
      if (parsed.format_version !== EXPORT_FORMAT_VERSION)
        throw validationError(`Unsupported export format version "${String(parsed.format_version)}".`);
      continue;
    }
    if (parsed.type !== "project" && parsed.type !== "observation" && parsed.type !== "claim")
      throw validationError(`Unknown record type "${String(parsed.type ?? "")}".`);
    rawByType[parsed.type].push(parsed);
  }

  const at = ctx.app.now().toISOString();
  const projects = new Map<string, Prepared>();
  const observations = new Map<string, Prepared>();
  const claims = new Map<string, PreparedClaim>();

  for (const row of rawByType.project) {
    const prepared: Prepared = {
      id: requireString(row, "id", LIMITS.identifier),
      reference: requireString(row, "reference", LIMITS.identifier),
      created_at: timestamp(row, "created_at"),
    };
    addUnique(projects, prepared.id as string, prepared);
  }
  for (const row of rawByType.observation) {
    const trust = requireEnum(row, "trust", TRUST_LEVELS);
    const visibility = requireEnum(row, "visibility", VISIBILITIES);
    assertTrustCeiling(principal, trust);
    const content = requireString(row, "content", LIMITS.content);
    const hash = await sha256Hex(content);
    if (row.content_hash !== undefined && row.content_hash !== hash)
      throw validationError("Imported observation content_hash does not match content.");
    const prepared: Prepared = {
      id: requireString(row, "id", LIMITS.identifier),
      subject_id: requireString(row, "subject_id", LIMITS.identifier),
      project_id: optionalText(row, "project_id", LIMITS.identifier),
      workspace_id: optionalText(row, "workspace_id", LIMITS.identifier),
      agent_id: optionalText(row, "agent_id", LIMITS.identifier),
      run_id: optionalText(row, "run_id", LIMITS.identifier),
      actor_id: principal.principalId,
      kind: requireEnum(row, "kind", OBSERVATION_KINDS),
      content,
      content_hash: hash,
      source_type: requireString(row, "source_type", LIMITS.label),
      source_ref: optionalText(row, "source_ref", LIMITS.identifier),
      trust,
      visibility,
      occurred_at: timestamp(row, "occurred_at", false),
      ingested_at: timestamp(row, "ingested_at"),
    };
    await authorizeRecordWorkspace(ctx.app.db, principal, prepared.workspace_id as string | null, visibility);
    addUnique(observations, prepared.id as string, prepared);
  }
  for (const row of rawByType.claim) {
    const trust = requireEnum(row, "trust", TRUST_LEVELS);
    const visibility = requireEnum(row, "visibility", VISIBILITIES);
    assertTrustCeiling(principal, trust);
    const confidence = row.confidence;
    if (typeof confidence !== "number" || confidence <= 0 || confidence > 1)
      throw validationError("Imported claim confidence must be greater than 0 and at most 1.");
    if (!Number.isInteger(row.version) || Number(row.version) < 1)
      throw validationError("Imported claim version must be a positive integer.");
    const sourceRows = row.sources;
    if (!Array.isArray(sourceRows) || !sourceRows.length || sourceRows.length > LIMITS.sourcesPerClaim)
      throw validationError(`Imported claim sources must contain 1 to ${LIMITS.sourcesPerClaim} entries.`);
    const sources: Source[] = sourceRows.map((source) => {
      if (!isRecord(source)) throw validationError("Each claim source must be an object.");
      return {
        observation_id: requireString(source, "observation_id", LIMITS.identifier),
        relation: requireEnum(source, "relation", CLAIM_RELATIONS),
        created_at: timestamp(source, "created_at")!,
      };
    });
    if (!sources.some((source) => source.relation === "supports"))
      throw validationError("An imported claim needs at least one supporting source.");
    if (new Set(sources.map((source) => `${source.observation_id}:${source.relation}`)).size !== sources.length)
      throw validationError("Imported claim contains a duplicate source relation.");
    const status = requireString(row, "status", LIMITS.label);
    if (!["active", "disputed", "superseded", "expired", "revoked"].includes(status))
      throw validationError("Imported claim status is invalid.");
    const prepared: PreparedClaim = {
      id: requireString(row, "id", LIMITS.identifier),
      subject_id: requireString(row, "subject_id", LIMITS.identifier),
      project_id: optionalText(row, "project_id", LIMITS.identifier),
      workspace_id: optionalText(row, "workspace_id", LIMITS.identifier),
      observer_id: optionalText(row, "observer_id", LIMITS.identifier),
      actor_id: principal.principalId,
      kind: requireEnum(row, "kind", CLAIM_KINDS),
      statement: requireString(row, "statement", LIMITS.statement),
      confidence,
      trust,
      visibility,
      status,
      version: Number(row.version),
      valid_from: timestamp(row, "valid_from"),
      valid_to: timestamp(row, "valid_to", false),
      created_at: timestamp(row, "created_at"),
      sources,
    };
    await authorizeRecordWorkspace(ctx.app.db, principal, prepared.workspace_id as string | null, visibility);
    addUnique(claims, prepared.id as string, prepared);
  }

  const byType = { project: [...projects.values()], observation: [...observations.values()], claim: [...claims.values()] };
  await assertNoForeignIds(ctx, principal.orgId, byType);
  await assertProjectReferences(ctx, principal.orgId, projects, observations, claims);
  const evidence = await loadEvidence(ctx, observations, claims);
  validateEvidenceDomains(claims, evidence);

  const existingProjects = await loadExisting(ctx, "projects", [...projects.keys()]);
  const existingObservations = await loadExisting(ctx, "observations", [...observations.keys()]);
  const existingClaims = await loadExisting(ctx, "claims", [...claims.keys()]);
  const existingSources = await loadExistingSources(ctx, [...existingClaims.keys()]);
  const statements: Stmt[] = [];
  const inserted = { project: 0, observation: 0, claim: 0, claim_source: 0 };

  for (const row of projects.values()) {
    const existing = existingProjects.get(row.id as string);
    if (existing) { assertSame("project", projectShape(existing), row); continue; }
    inserted.project += 1;
    statements.push({ sql: `INSERT INTO projects (id, org_id, reference, created_at) VALUES (?, ?, ?, ?)`, params: [row.id, principal.orgId, row.reference, row.created_at] });
  }
  for (const row of observations.values()) {
    const existing = existingObservations.get(row.id as string);
    if (existing) { assertSame("observation", observationShape(existing), row); continue; }
    inserted.observation += 1;
    statements.push({
      sql: `INSERT INTO observations
              (id, org_id, subject_id, project_id, workspace_id, agent_id, run_id, actor_id, kind, content,
               content_hash, source_type, source_ref, trust, visibility, occurred_at, ingested_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: observationValues(principal.orgId, row),
    }, {
      sql: `INSERT INTO observations_fts
              (content, observation_id, org_scope, subject_scope)
            VALUES (?, ?, lower(hex(?)) || '0', lower(hex(?)) || '0')`,
      params: [row.content, row.id, principal.orgId, row.subject_id],
    },
    await importHistory(principal.orgId, "observation", row.id as string, principal.principalId, at),
    outboxStatement(principal.orgId, "observation", row.id as string, "upsert", at),
    eventStatement(principal.orgId, "observation.imported", principal.principalId, "observation", row.id as string, {}, at));
  }
  for (const row of claims.values()) {
    const existing = existingClaims.get(row.id as string);
    if (existing) {
      assertSame("claim", claimShape(existing), withoutSources(row));
      assertSame("claim sources", existingSources.get(row.id as string) ?? [], row.sources);
      continue;
    }
    inserted.claim += 1;
    inserted.claim_source += row.sources.length;
    statements.push({
      sql: `INSERT INTO claims
              (id, org_id, subject_id, project_id, workspace_id, observer_id, actor_id, kind, statement,
               confidence, trust, visibility, status, version, valid_from, valid_to, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: claimValues(principal.orgId, row),
    }, {
      sql: `INSERT INTO claims_fts
              (statement, claim_id, org_scope, subject_scope)
            VALUES (?, ?, lower(hex(?)) || '0', lower(hex(?)) || '0')`,
      params: [row.statement, row.id, principal.orgId, row.subject_id],
    },
    await importHistory(principal.orgId, "claim", row.id as string, principal.principalId, at),
    outboxStatement(principal.orgId, "claim", row.id as string, "upsert", at),
    eventStatement(principal.orgId, "claim.imported", principal.principalId, "claim", row.id as string, {}, at));
    for (const source of row.sources) statements.push({
      sql: `INSERT INTO claim_sources (claim_id, observation_id, relation, created_at) VALUES (?, ?, ?, ?)`,
      params: [row.id, source.observation_id, source.relation, source.created_at],
    });
  }

  try {
    if (statements.length) await ctx.app.db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw conflict("Import collided with a concurrent write; retry after exporting current state.");
    throw error;
  }
  const received = {
    project: projects.size,
    observation: observations.size,
    claim: claims.size,
    claim_source: [...claims.values()].reduce((sum, claim) => sum + claim.sources.length, 0),
  };
  return { status: 200, data: { format_version: EXPORT_FORMAT_VERSION, received, inserted }, meta: { atomic: true } };
}

function addUnique<T>(map: Map<string, T>, id: string, row: T): void {
  const previous = map.get(id);
  if (previous && canonical(previous) !== canonical(row)) throw conflict("Import contains conflicting duplicate ids.");
  map.set(id, row);
}

async function loadExisting(ctx: RequestContext, table: string, ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const group of chunk(ids)) {
    if (!group.length) continue;
    const rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE org_id = ? AND id IN (${group.map(() => "?").join(", ")})`,
      [ctx.principal!.orgId, ...group],
    );
    for (const row of rows) result.set(String(row.id), row);
  }
  return result;
}

async function loadExistingSources(ctx: RequestContext, ids: string[]): Promise<Map<string, Source[]>> {
  const result = new Map<string, Source[]>();
  for (const group of chunk(ids)) {
    if (!group.length) continue;
    const rows = await ctx.app.db.all<Source & { claim_id: string }>(
      `SELECT claim_id, observation_id, relation, created_at FROM claim_sources
        WHERE claim_id IN (${group.map(() => "?").join(", ")}) ORDER BY observation_id, relation`, group,
    );
    for (const row of rows) {
      const list = result.get(row.claim_id) ?? [];
      list.push({ observation_id: row.observation_id, relation: row.relation, created_at: row.created_at });
      result.set(row.claim_id, list);
    }
  }
  return result;
}

async function assertProjectReferences(
  ctx: RequestContext,
  orgId: string,
  projects: Map<string, Prepared>,
  observations: Map<string, Prepared>,
  claims: Map<string, PreparedClaim>,
): Promise<void> {
  const observationRefs = [...observations.values()].map((row) => row.project_id).filter((id): id is string => typeof id === "string" && !projects.has(id));
  const claimRefs = [...claims.values()].map((row) => row.project_id).filter((id): id is string => typeof id === "string" && !projects.has(id));
  const stored = await loadExisting(ctx, "projects", [...observationRefs, ...claimRefs]);
  if (observationRefs.some((id) => !stored.has(id)))
    throw unresolvedReference({ record_type: "observation", field: "project_id", dependency_type: "project" });
  if (claimRefs.some((id) => !stored.has(id)))
    throw unresolvedReference({ record_type: "claim", field: "project_id", dependency_type: "project" });
  void orgId;
}

async function loadEvidence(
  ctx: RequestContext,
  observations: Map<string, Prepared>,
  claims: Map<string, PreparedClaim>,
): Promise<Map<string, Prepared>> {
  const result = new Map(observations);
  const refs = [...claims.values()].flatMap((claim) => claim.sources.map((source) => source.observation_id)).filter((id) => !result.has(id));
  for (const group of chunk([...new Set(refs)], MAX_BOUND_PARAMS - 2)) {
    if (!group.length) continue;
    const rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT o.id, o.subject_id, o.project_id, o.workspace_id, o.trust, o.visibility
         FROM observations o WHERE o.org_id = ? AND o.id IN (${group.map(() => "?").join(", ")})
          AND ${recordAccessSql("o")}`,
      [ctx.principal!.orgId, ...group, ...recordAccessParams(ctx.principal!.principalId)],
    );
    for (const row of rows) result.set(String(row.id), row as Prepared);
  }
  if (refs.some((id) => !result.has(id)))
    throw unresolvedReference({ record_type: "claim", field: "sources.observation_id", dependency_type: "observation" });
  return result;
}

function validateEvidenceDomains(claims: Map<string, PreparedClaim>, evidence: Map<string, Prepared>): void {
  const visibilityRank: Record<Visibility, number> = { private: 0, team: 1, organization: 2 };
  for (const claim of claims.values()) {
    const sources = claim.sources.map((source) => ({ ...source, row: evidence.get(source.observation_id)! }));
    for (const source of sources) {
      if (source.row.subject_id !== claim.subject_id || source.row.project_id !== claim.project_id || source.row.workspace_id !== claim.workspace_id)
        throw validationError("Imported claim evidence must match its workspace, subject, and project.");
      if (visibilityRank[claim.visibility as Visibility] > visibilityRank[source.row.visibility as Visibility])
        throw validationError("Imported claim visibility may not exceed its evidence visibility.");
    }
    const maxSupportTrust = sources.filter((source) => source.relation === "supports")
      .reduce((rank, source) => Math.max(rank, TRUST_RANK[source.row.trust as Trust]), 0);
    if (TRUST_RANK[claim.trust as Trust] > maxSupportTrust)
      throw validationError("Imported claim trust may not exceed its supporting evidence.");
  }
}

function assertSame(label: string, existing: unknown, incoming: unknown): void {
  if (canonical(existing) !== canonical(incoming)) throw conflict(`Imported ${label} id already exists with different content.`);
}

const projectShape = (row: Record<string, unknown>): Prepared => ({ id: String(row.id), reference: String(row.reference), created_at: String(row.created_at) });
const observationShape = (row: Record<string, unknown>): Prepared => ({
  id: String(row.id), subject_id: String(row.subject_id), project_id: row.project_id as string | null,
  workspace_id: row.workspace_id as string | null, agent_id: row.agent_id as string | null, run_id: row.run_id as string | null,
  actor_id: String(row.actor_id), kind: String(row.kind), content: String(row.content), content_hash: String(row.content_hash),
  source_type: String(row.source_type), source_ref: row.source_ref as string | null, trust: String(row.trust), visibility: String(row.visibility),
  occurred_at: row.occurred_at as string | null, ingested_at: String(row.ingested_at),
});
const claimShape = (row: Record<string, unknown>): Prepared => ({
  id: String(row.id), subject_id: String(row.subject_id), project_id: row.project_id as string | null,
  workspace_id: row.workspace_id as string | null, observer_id: row.observer_id as string | null, actor_id: String(row.actor_id),
  kind: String(row.kind), statement: String(row.statement), confidence: Number(row.confidence), trust: String(row.trust),
  visibility: String(row.visibility), status: String(row.status), version: Number(row.version), valid_from: String(row.valid_from),
  valid_to: row.valid_to as string | null, created_at: String(row.created_at),
});
const withoutSources = (row: PreparedClaim): Prepared => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "sources"));
const observationValues = (orgId: string, row: Prepared) => [row.id, orgId, row.subject_id, row.project_id, row.workspace_id, row.agent_id, row.run_id, row.actor_id, row.kind, row.content, row.content_hash, row.source_type, row.source_ref, row.trust, row.visibility, row.occurred_at, row.ingested_at] as (string | number | null)[];
const claimValues = (orgId: string, row: PreparedClaim) => [row.id, orgId, row.subject_id, row.project_id, row.workspace_id, row.observer_id, row.actor_id, row.kind, row.statement, row.confidence, row.trust, row.visibility, row.status, row.version, row.valid_from, row.valid_to, row.created_at] as (string | number | null)[];

async function assertNoForeignIds(
  ctx: RequestContext,
  orgId: string,
  byType: Record<string, Prepared[]>,
): Promise<void> {
  const tables: [string, string][] = [["project", "projects"], ["observation", "observations"], ["claim", "claims"]];
  for (const [recordType, table] of tables) for (const group of chunk(byType[recordType]!.map((row) => row.id as string), MAX_BOUND_PARAMS - 1)) {
    if (!group.length) continue;
    const rows = await ctx.app.db.all<{ id: string }>(
      `SELECT id FROM ${table} WHERE org_id <> ? AND id IN (${group.map(() => "?").join(", ")})`, [orgId, ...group],
    );
    if (rows.length) throw conflict("An imported record id already exists outside this organization.");
  }
}

async function importHistory(orgId: string, recordType: string, recordId: string, actorId: string, at: string): Promise<Stmt> {
  const id = `hist_${(await sha256Hex(`import:${recordType}:${recordId}`)).slice(0, 32)}`;
  return {
    sql: `INSERT INTO record_history
            (id, org_id, record_type, record_id, version, change_kind, actor_id, snapshot_hash, changed_at)
          VALUES (?, ?, ?, ?, 1, 'import', ?, ?, ?)`,
    params: [id, orgId, recordType, recordId, actorId, id, at],
  };
}
