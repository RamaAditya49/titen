import { assertTrustCeiling, hasScope, requireScope } from "./auth";
import { auditStatement } from "./audit";
import { authorizeRecordWorkspace, recordAccessParams, recordAccessSql } from "./authorization";
import { MAX_BOUND_PARAMS, chunk, type Stmt } from "./db";
import { conflict, unresolvedReference, validationError } from "./errors";
import { eventStatement } from "./events";
import { sha256Hex } from "./ids";
import { MAX_BODY_BYTES, type RequestContext, type Result } from "./http";
import { outboxStatement, redactedObservationContent } from "./observations";
import {
  CLAIM_KINDS,
  CLAIM_RELATIONS,
  LIMITS,
  OBSERVATION_KINDS,
  TRUST_LEVELS,
  TRUST_RANK,
  VISIBILITIES,
  assertJsonDepth,
  assertTimestampOrder,
  isRecord,
  optionalString,
  optionalTimestamp,
  requireEnum,
  requireString,
  type Trust,
  type Visibility,
} from "./validate";

export const EXPORT_FORMAT_VERSION = 2;
export const EXPORT_TYPES = ["workspaces", "memberships", "projects", "observations", "claims"] as const;
export const EXPORT_DEPENDENCY_ORDER = [...EXPORT_TYPES];
export const EXPORT_DEPENDENCIES: Record<(typeof EXPORT_TYPES)[number], string[]> = {
  workspaces: [],
  memberships: ["workspaces"],
  projects: [],
  observations: ["workspaces", "memberships", "projects"],
  claims: ["workspaces", "memberships", "projects", "observations"],
};
export const EXPORT_MAX_LIMIT = 2000;
export const IMPORT_MAX_LINES = 2000;
const HEADER_RESERVE_BYTES = 4096;
const encoder = new TextEncoder();

type ExportType = (typeof EXPORT_TYPES)[number];
type ExportLine = { cursor: string; line: string };

export async function exportRecords(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const type = ctx.url.searchParams.get("type") ?? "observations";
  if (!EXPORT_TYPES.includes(type as never))
    throw validationError(`Query "type" must be one of: ${EXPORT_TYPES.join(", ")}.`);
  const all = ctx.url.searchParams.get("all");
  if (all !== null && all !== "true" && all !== "false")
    throw validationError('Query "all" must be "true" or "false".');
  const wholeDeployment = all === "true";
  if (wholeDeployment) requireScope(principal, "export:all");
  const after = ctx.url.searchParams.get("after") ?? "";
  const limit = Number(ctx.url.searchParams.get("limit") ?? "500");
  if (!Number.isInteger(limit) || limit < 1 || limit > EXPORT_MAX_LIMIT)
    throw validationError(`Query "limit" must be an integer between 1 and ${EXPORT_MAX_LIMIT}.`);

  let rows: Record<string, unknown>[];
  if (type === "workspaces") {
    rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT w.id, w.name, w.created_at FROM workspaces w
        WHERE w.org_id = ? AND w.id > ?
          ${wholeDeployment ? "" : `AND EXISTS (
            SELECT 1 FROM memberships m
             WHERE m.org_id = w.org_id AND m.workspace_id = w.id
               AND m.principal_id = ? AND m.removed_at IS NULL
          )`}
        ORDER BY w.id LIMIT ?`,
      wholeDeployment
        ? [principal.orgId, after, limit]
        : [principal.orgId, after, principal.principalId, limit],
    );
  } else if (type === "memberships") {
    rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT m.id, m.workspace_id, m.principal_id, m.principal_kind, m.role, m.created_at
         FROM memberships m
        WHERE m.org_id = ? AND m.id > ? AND m.removed_at IS NULL
          ${wholeDeployment ? "" : "AND m.principal_id = ?"}
        ORDER BY m.id LIMIT ?`,
      wholeDeployment
        ? [principal.orgId, after, limit]
        : [principal.orgId, after, principal.principalId, limit],
    );
  } else if (type === "projects") {
    const rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT id, reference, created_at FROM projects
        WHERE org_id = ? AND id > ? ORDER BY id LIMIT ?`,
      [principal.orgId, after, limit],
    );
    return exportPage(ctx, type, rows, limit, wholeDeployment);
  } else if (type === "observations") {
    rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT o.id, o.subject_id, o.project_id, o.workspace_id, o.agent_id, o.run_id, o.actor_id,
              o.kind, o.content, o.content_hash, o.source_type, o.source_ref, o.trust,
              o.visibility, o.occurred_at, o.ingested_at
         FROM observations o
        WHERE o.org_id = ? AND o.id > ? AND ${wholeDeployment ? "1 = 1" : recordAccessSql("o")}
        ORDER BY o.id LIMIT ?`,
      wholeDeployment
        ? [principal.orgId, after, limit]
        : [principal.orgId, after, ...recordAccessParams(principal.principalId), limit],
    );
  } else {
    rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT c.id, c.subject_id, c.project_id, c.workspace_id, c.observer_id, c.actor_id,
              c.kind, c.statement, c.confidence, c.trust, c.visibility, c.status, c.version,
              c.valid_from, c.valid_to, c.created_at, c.superseded_by
         FROM claims c
        WHERE c.org_id = ? AND c.id > ? AND ${wholeDeployment ? "1 = 1" : recordAccessSql("c")}
        ORDER BY c.id LIMIT ?`,
      wholeDeployment
        ? [principal.orgId, after, limit]
        : [principal.orgId, after, ...recordAccessParams(principal.principalId), limit],
    );
    const ids = rows.map((row) => String(row.id));
    const sources: Record<string, unknown>[] = [];
    for (const group of chunk(ids, MAX_BOUND_PARAMS - 2)) {
      if (!group.length) continue;
      sources.push(...await ctx.app.db.all<Record<string, unknown>>(
        `SELECT s.claim_id, s.observation_id, s.relation, s.created_at
          FROM claim_sources s JOIN observations o ON o.id = s.observation_id
          WHERE s.claim_id IN (${group.map(() => "?").join(", ")})
            AND o.org_id = ? AND ${wholeDeployment ? "1 = 1" : recordAccessSql("o")}
          ORDER BY s.claim_id, s.observation_id, s.relation`,
        wholeDeployment
          ? [...group, principal.orgId]
          : [...group, principal.orgId, ...recordAccessParams(principal.principalId)],
      ));
    }
    const grouped = new Map<string, unknown[]>();
    for (const source of sources) {
      const id = String(source.claim_id);
      const list = grouped.get(id) ?? [];
      list.push({ observation_id: source.observation_id, relation: source.relation, created_at: source.created_at });
      grouped.set(id, list);
    }
    rows = rows.map((row) => ({ ...row, sources: grouped.get(String(row.id)) ?? [] }));
  }

  return exportPage(ctx, type as ExportType, rows, limit, wholeDeployment);
}

async function exportPage(
  ctx: RequestContext,
  type: ExportType,
  rows: Record<string, unknown>[],
  limit: number,
  wholeDeployment: boolean,
): Promise<Result> {
  const lineType: Record<ExportType, string> = {
    workspaces: "workspace",
    memberships: "membership",
    projects: "project",
    observations: "observation",
    claims: "claim",
  };
  const candidates: ExportLine[] = rows.map((row) => ({
    cursor: String(row.id),
    line: JSON.stringify({ type: lineType[type], ...row }),
  }));
  const selected: ExportLine[] = [];
  let recordBytes = 0;
  for (const candidate of candidates) {
    const bytes = encoder.encode(`${candidate.line}\n`).byteLength;
    if (recordBytes + bytes > MAX_BODY_BYTES - HEADER_RESERVE_BYTES) break;
    selected.push(candidate);
    recordBytes += bytes;
  }
  if (candidates.length > 0 && selected.length === 0)
    throw new Error("One export record exceeds the import request limit.");

  const hasMore = selected.length < candidates.length || candidates.length === limit;
  const header = {
    type: "titen.export.header",
    format_version: EXPORT_FORMAT_VERSION,
    record_type: type,
    dependency_order: EXPORT_DEPENDENCY_ORDER,
    depends_on: EXPORT_DEPENDENCIES[type as (typeof EXPORT_TYPES)[number]],
    org_id: ctx.principal!.orgId,
    scope: wholeDeployment ? "deployment" : "principal",
    exported_at: ctx.app.now().toISOString(),
    count: selected.length,
    next_cursor: hasMore ? selected.at(-1)?.cursor ?? null : null,
    complete: !hasMore,
  };
  const body = `${[JSON.stringify(header), ...selected.map(({ line }) => line)].join("\n")}\n`;
  if (encoder.encode(body).byteLength > MAX_BODY_BYTES)
    throw new Error("Export page exceeded the import request limit.");
  if (wholeDeployment) {
    await ctx.app.db.batch([auditStatement(
      ctx.principal!.orgId,
      ctx.principal!.principalId,
      "portability.export_all",
      "export",
      ctx.app.now().toISOString(),
      null,
      JSON.stringify({ record_type: type, count: selected.length, complete: !hasMore }),
    )]);
  }
  return {
    raw: new Response(body, {
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
type VersionedRow = { row: Record<string, unknown>; formatVersion: 1 | 2; sourceOrgId: string };

const optionalText = (row: Record<string, unknown>, field: string, max: number): string | null => {
  return optionalString(row, field, max, `import.${field}`);
};
const timestamp = (row: Record<string, unknown>, field: string, required = true): string | null => {
  const value = row[field];
  if ((value === undefined || value === null) && !required) return null;
  if (typeof value !== "string" || !/^\d{4}-/.test(value))
    throw validationError(`Imported field "${field}" must be an ISO-8601 timestamp.`);
  const canonical = optionalTimestamp(row, field, `import.${field}`);
  if (canonical === null)
    throw validationError(`Imported field "${field}" must be an ISO-8601 timestamp.`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(canonical))
    throw validationError(`Imported field "${field}" must use a four-digit year.`);
  return canonical;
};
const canonical = (value: unknown): string => JSON.stringify(value);

/** Validate the complete graph before committing it in one atomic batch. */
export async function importRecords(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const lines = (await ctx.rawBody()).split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw validationError("Import body must contain at least one record.");
  const rawByType: Record<"workspace" | "membership" | "project" | "observation" | "claim", VersionedRow[]> = {
    workspace: [], membership: [], project: [], observation: [], claim: [],
  };
  const actorMappings = new Map<string, string>();
  const usedActorMappings = new Set<string>();
  let formatVersion: 1 | 2 = 1;
  let sourceOrgId = principal.orgId;
  let recordCount = 0;
  for (const line of lines) {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { throw validationError("Every import line must be valid JSON."); }
    assertJsonDepth(parsed);
    if (!isRecord(parsed)) throw validationError("Every import line must be a JSON object.");
    if (parsed.type === "titen.export.header") {
      if (parsed.format_version !== 1 && parsed.format_version !== EXPORT_FORMAT_VERSION)
        throw validationError(`Unsupported export format version "${String(parsed.format_version)}".`);
      formatVersion = parsed.format_version;
      sourceOrgId = formatVersion === 2
        ? requireString(parsed, "org_id", LIMITS.identifier)
        : optionalText(parsed, "org_id", LIMITS.identifier) ?? principal.orgId;
      continue;
    }
    if (parsed.type === "titen.import.actor_map") {
      const sourceOrg = requireString(parsed, "source_org_id", LIMITS.identifier);
      const sourceActor = requireString(parsed, "source_actor_id", LIMITS.identifier);
      const destinationActor = requireString(parsed, "destination_actor_id", LIMITS.identifier);
      if (destinationActor !== principal.principalId && !hasScope(principal, "keys:manage"))
        requireScope(principal, "keys:manage");
      const key = actorKey(sourceOrg, sourceActor);
      const previous = actorMappings.get(key);
      if (previous && previous !== destinationActor)
        throw conflict("Import contains conflicting actor mappings.");
      actorMappings.set(key, destinationActor);
      if (actorMappings.size > IMPORT_MAX_LINES)
        throw validationError(`Import accepts at most ${IMPORT_MAX_LINES} actor mappings per request.`);
      continue;
    }
    if (!["workspace", "membership", "project", "observation", "claim"].includes(String(parsed.type)))
      throw validationError(`Unknown record type "${String(parsed.type ?? "")}".`);
    recordCount += 1;
    if (recordCount > IMPORT_MAX_LINES)
      throw validationError(`Import accepts at most ${IMPORT_MAX_LINES} records per request.`);
    rawByType[parsed.type as keyof typeof rawByType].push({ row: parsed, formatVersion, sourceOrgId });
  }

  if (rawByType.workspace.length) requireScope(principal, "workspaces:write");
  if (rawByType.membership.length) requireScope(principal, "memberships:write");
  const at = ctx.app.now().toISOString();
  const workspaces = new Map<string, Prepared>();
  const memberships = new Map<string, Prepared>();
  const projects = new Map<string, Prepared>();
  const observations = new Map<string, Prepared>();
  const redactedObservations = new Set<string>();
  const claims = new Map<string, PreparedClaim>();
  const legacyClaims = new Set<string>();

  for (const { row } of rawByType.workspace) {
    const prepared: Prepared = {
      id: requireString(row, "id", LIMITS.identifier),
      name: requireString(row, "name", LIMITS.label),
      created_at: timestamp(row, "created_at"),
    };
    addUnique(workspaces, prepared.id as string, prepared);
  }
  for (const entry of rawByType.membership) {
    const { row } = entry;
    const prepared: Prepared = {
      id: requireString(row, "id", LIMITS.identifier),
      workspace_id: requireString(row, "workspace_id", LIMITS.identifier),
      principal_id: importedActor(entry, actorMappings, usedActorMappings, principal.principalId, "membership", "principal_id"),
      principal_kind: requireEnum(row, "principal_kind", ["human", "agent", "service"] as const),
      role: requireEnum(row, "role", ["owner", "admin", "member", "reader"] as const),
      created_at: timestamp(row, "created_at"),
    };
    addUnique(memberships, prepared.id as string, prepared);
  }
  for (const { row } of rawByType.project) {
    const prepared: Prepared = {
      id: requireString(row, "id", LIMITS.identifier),
      reference: requireString(row, "reference", LIMITS.identifier),
      created_at: timestamp(row, "created_at"),
    };
    addUnique(projects, prepared.id as string, prepared);
  }
  for (const entry of rawByType.observation) {
    const { row } = entry;
    const trust = requireEnum(row, "trust", TRUST_LEVELS);
    const visibility = requireEnum(row, "visibility", VISIBILITIES);
    assertTrustCeiling(principal, trust);
    const content = requireString(row, "content", LIMITS.content);
    const suppliedHash = row.content_hash;
    const redacted = typeof suppliedHash === "string"
      && /^[0-9a-f]{64}$/.test(suppliedHash)
      && content === redactedObservationContent(suppliedHash);
    const hash = redacted ? suppliedHash : await sha256Hex(content);
    if (!redacted && suppliedHash !== undefined && suppliedHash !== hash)
      throw validationError("Imported observation content_hash does not match content.");
    const prepared: Prepared = {
      id: requireString(row, "id", LIMITS.identifier),
      subject_id: requireString(row, "subject_id", LIMITS.identifier),
      project_id: optionalText(row, "project_id", LIMITS.identifier),
      workspace_id: optionalText(row, "workspace_id", LIMITS.identifier),
      agent_id: optionalText(row, "agent_id", LIMITS.identifier),
      run_id: optionalText(row, "run_id", LIMITS.identifier),
      actor_id: importedActor(entry, actorMappings, usedActorMappings, principal.principalId, "observation", "actor_id"),
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
    addUnique(observations, prepared.id as string, prepared);
    if (redacted) redactedObservations.add(prepared.id as string);
  }
  for (const entry of rawByType.claim) {
    const { row } = entry;
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
    const validFrom = timestamp(row, "valid_from")!;
    const validTo = timestamp(row, "valid_to", false);
    assertTimestampOrder(validFrom, validTo, "valid_from", "valid_to");
    const prepared: PreparedClaim = {
      id: requireString(row, "id", LIMITS.identifier),
      subject_id: requireString(row, "subject_id", LIMITS.identifier),
      project_id: optionalText(row, "project_id", LIMITS.identifier),
      workspace_id: optionalText(row, "workspace_id", LIMITS.identifier),
      observer_id: optionalText(row, "observer_id", LIMITS.identifier),
      actor_id: importedActor(entry, actorMappings, usedActorMappings, principal.principalId, "claim", "actor_id"),
      kind: requireEnum(row, "kind", CLAIM_KINDS),
      statement: requireString(row, "statement", LIMITS.statement),
      confidence,
      trust,
      visibility,
      status,
      version: Number(row.version),
      valid_from: validFrom,
      valid_to: validTo,
      created_at: timestamp(row, "created_at"),
      superseded_by: optionalText(row, "superseded_by", LIMITS.identifier),
      sources,
    };
    addUnique(claims, prepared.id as string, prepared);
    if (entry.formatVersion === 1) legacyClaims.add(prepared.id as string);
  }
  if ([...actorMappings.keys()].some((key) => !usedActorMappings.has(key)))
    throw validationError("Import contains an actor mapping that no record uses.");

  const byType = {
    workspace: [...workspaces.values()], membership: [...memberships.values()], project: [...projects.values()],
    observation: [...observations.values()], claim: [...claims.values()],
  };
  await assertNoForeignIds(ctx, principal.orgId, byType);
  await assertWorkspaceReferences(ctx, workspaces, memberships, observations, claims);
  await assertProjectReferences(ctx, principal.orgId, projects, observations, claims);
  await assertSupersessionReferences(ctx, claims);
  const evidence = await loadEvidence(ctx, observations, claims, hasScope(principal, "keys:manage"));
  validateEvidenceDomains(claims, evidence);

  const existingWorkspaces = await loadExisting(ctx, "workspaces", [...workspaces.keys()]);
  const existingMemberships = await loadExisting(ctx, "memberships", [...memberships.keys()]);
  const existingProjects = await loadExisting(ctx, "projects", [...projects.keys()]);
  const existingObservations = await loadExisting(ctx, "observations", [...observations.keys()]);
  const existingClaims = await loadExisting(ctx, "claims", [...claims.keys()]);
  const existingSources = await loadExistingSources(ctx, [...existingClaims.keys()]);
  const statements: Stmt[] = [];
  const inserted = { workspace: 0, membership: 0, project: 0, observation: 0, claim: 0, claim_source: 0 };

  for (const row of workspaces.values()) {
    const existing = existingWorkspaces.get(row.id as string);
    if (existing) { assertSame("workspace", workspaceShape(existing), row); continue; }
    inserted.workspace += 1;
    statements.push({
      sql: `INSERT INTO workspaces (id, org_id, name, created_at) VALUES (?, ?, ?, ?)`,
      params: [row.id, principal.orgId, row.name, row.created_at],
    });
  }
  for (const row of memberships.values()) {
    const existing = existingMemberships.get(row.id as string);
    if (existing) { assertSame("membership", membershipShape(existing), row); continue; }
    inserted.membership += 1;
    statements.push({
      sql: `INSERT INTO memberships
              (id, org_id, workspace_id, principal_id, principal_kind, role, created_at, removed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      params: [row.id, principal.orgId, row.workspace_id, row.principal_id, row.principal_kind, row.role, row.created_at],
    });
  }
  for (const row of projects.values()) {
    const existing = existingProjects.get(row.id as string);
    if (existing) { assertSame("project", projectShape(existing), row); continue; }
    inserted.project += 1;
    statements.push({ sql: `INSERT INTO projects (id, org_id, reference, created_at) VALUES (?, ?, ?, ?)`, params: [row.id, principal.orgId, row.reference, row.created_at] });
  }
  for (const row of observations.values()) {
    const existing = existingObservations.get(row.id as string);
    if (existing) { assertSame("observation", observationShape(existing), row); continue; }
    const redacted = redactedObservations.has(row.id as string);
    inserted.observation += 1;
    statements.push({
      sql: `INSERT INTO observations
              (id, org_id, subject_id, project_id, workspace_id, agent_id, run_id, actor_id, kind, content,
               content_hash, source_type, source_ref, trust, visibility, occurred_at, ingested_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: observationValues(principal.orgId, row),
    });
    if (!redacted) statements.push({
      sql: `INSERT INTO observations_fts
              (content, observation_id, org_scope, subject_scope)
            VALUES (?, ?, lower(hex(?)) || '0', lower(hex(?)) || '0')`,
      params: [row.content, row.id, principal.orgId, row.subject_id],
    });
    statements.push(
      await importHistory(principal.orgId, "observation", row.id as string, principal.principalId, at),
      outboxStatement(principal.orgId, "observation", row.id as string, redacted ? "delete" : "upsert", at),
      eventStatement(principal.orgId, "observation.imported", principal.principalId, "observation", row.id as string, {}, at),
    );
  }
  for (const row of claims.values()) {
    const existing = existingClaims.get(row.id as string);
    if (existing) {
      const incoming = withoutSources(row);
      const stored = claimShape(existing);
      if (legacyClaims.has(row.id as string) && incoming.superseded_by === null) {
        delete incoming.superseded_by;
        delete stored.superseded_by;
      }
      assertSame("claim", stored, incoming);
      assertSame("claim sources", existingSources.get(row.id as string) ?? [], row.sources);
      continue;
    }
    const indexable = row.status === "active" || row.status === "disputed";
    inserted.claim += 1;
    inserted.claim_source += row.sources.length;
    statements.push({
      sql: `INSERT INTO claims
              (id, org_id, subject_id, project_id, workspace_id, observer_id, actor_id, kind, statement,
               confidence, trust, visibility, status, version, valid_from, valid_to, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: claimValues(principal.orgId, row),
    });
    if (indexable) statements.push({
      sql: `INSERT INTO claims_fts
              (statement, claim_id, org_scope, subject_scope)
            VALUES (?, ?, lower(hex(?)) || '0', lower(hex(?)) || '0')`,
      params: [row.statement, row.id, principal.orgId, row.subject_id],
    });
    statements.push(
      await importHistory(principal.orgId, "claim", row.id as string, principal.principalId, at),
      outboxStatement(principal.orgId, "claim", row.id as string, indexable ? "upsert" : "delete", at),
      eventStatement(principal.orgId, "claim.imported", principal.principalId, "claim", row.id as string, {}, at),
    );
    for (const source of row.sources) statements.push({
      sql: `INSERT INTO claim_sources (claim_id, observation_id, relation, created_at) VALUES (?, ?, ?, ?)`,
      params: [row.id, source.observation_id, source.relation, source.created_at],
    });
  }
  for (const row of claims.values()) {
    if (!row.superseded_by || existingClaims.has(row.id as string)) continue;
    statements.push({
      sql: `UPDATE claims SET superseded_by = ? WHERE id = ? AND org_id = ?`,
      params: [row.superseded_by, row.id, principal.orgId],
    });
  }
  if (actorMappings.size || workspaces.size || memberships.size) statements.push(auditStatement(
    principal.orgId,
    principal.principalId,
    "portability.import",
    "import",
    at,
    null,
    JSON.stringify({
      workspaces: workspaces.size,
      memberships: memberships.size,
      projects: projects.size,
      observations: observations.size,
      claims: claims.size,
    }),
  ));

  try {
    if (statements.length) await ctx.app.db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw conflict("Import collided with a concurrent write; retry after exporting current state.");
    throw error;
  }
  const received = {
    workspace: workspaces.size,
    membership: memberships.size,
    project: projects.size,
    observation: observations.size,
    claim: claims.size,
    claim_source: [...claims.values()].reduce((sum, claim) => sum + claim.sources.length, 0),
  };
  return { status: 200, data: { format_version: EXPORT_FORMAT_VERSION, received, inserted }, meta: { atomic: true } };
}

const actorKey = (orgId: string, actorId: string) => `${orgId}\u0000${actorId}`;

function importedActor(
  entry: VersionedRow,
  mappings: Map<string, string>,
  usedMappings: Set<string>,
  importer: string,
  recordType: string,
  field: string,
): string {
  if (entry.formatVersion === 1) return importer;
  const sourceActor = requireString(entry.row, field, LIMITS.identifier);
  if (sourceActor === importer) return importer;
  const mapped = mappings.get(actorKey(entry.sourceOrgId, sourceActor));
  if (!mapped)
    throw unresolvedReference({ record_type: recordType, field, dependency_type: "actor_mapping" });
  usedMappings.add(actorKey(entry.sourceOrgId, sourceActor));
  return mapped;
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

async function assertWorkspaceReferences(
  ctx: RequestContext,
  workspaces: Map<string, Prepared>,
  memberships: Map<string, Prepared>,
  observations: Map<string, Prepared>,
  claims: Map<string, PreparedClaim>,
): Promise<void> {
  const membershipRefs = [...memberships.values()].map((row) => row.workspace_id as string);
  const observationRefs = [...observations.values()].map((row) => row.workspace_id)
    .filter((id): id is string => typeof id === "string");
  const claimRefs = [...claims.values()].map((row) => row.workspace_id)
    .filter((id): id is string => typeof id === "string");
  const missing = [...new Set([...membershipRefs, ...observationRefs, ...claimRefs])]
    .filter((id) => !workspaces.has(id));
  const stored = await loadExisting(ctx, "workspaces", missing);
  const absent = (ids: string[]) => ids.some((id) => !workspaces.has(id) && !stored.has(id));
  if (absent(membershipRefs))
    throw unresolvedReference({ record_type: "membership", field: "workspace_id", dependency_type: "workspace" });
  if (absent(observationRefs))
    throw unresolvedReference({ record_type: "observation", field: "workspace_id", dependency_type: "workspace" });
  if (absent(claimRefs))
    throw unresolvedReference({ record_type: "claim", field: "workspace_id", dependency_type: "workspace" });

  const importedWritable = new Set(
    [...memberships.values()]
      .filter((row) => row.principal_id === ctx.principal!.principalId && row.role !== "reader")
      .map((row) => row.workspace_id as string),
  );
  const administrative = hasScope(ctx.principal!, "keys:manage");
  for (const row of [...observations.values(), ...claims.values()]) {
    const workspaceId = row.workspace_id as string | null;
    const visibility = row.visibility as Visibility;
    if (visibility === "team" && !workspaceId)
      throw validationError('Field "workspace_id" is required for team visibility.');
    if (!workspaceId || administrative || importedWritable.has(workspaceId)) continue;
    await authorizeRecordWorkspace(ctx.app.db, ctx.principal!, workspaceId, visibility);
  }
}

async function assertSupersessionReferences(
  ctx: RequestContext,
  claims: Map<string, PreparedClaim>,
): Promise<void> {
  const refs = [...claims.values()].map((row) => row.superseded_by)
    .filter((id): id is string => typeof id === "string" && !claims.has(id));
  const stored = await loadExisting(ctx, "claims", [...new Set(refs)]);
  if (refs.some((id) => !stored.has(id)))
    throw unresolvedReference({ record_type: "claim", field: "superseded_by", dependency_type: "claim" });

  for (const claim of claims.values()) {
    const replacementId = claim.superseded_by as string | null;
    if (!replacementId) continue;
    if (claim.status !== "superseded")
      throw validationError("Only a superseded claim may name a replacement.");
    if (replacementId === claim.id)
      throw validationError("A claim cannot supersede itself.");
    const replacement = claims.get(replacementId) ?? claimShape(stored.get(replacementId)!);
    for (const field of ["subject_id", "project_id", "workspace_id", "kind", "visibility"])
      if (replacement[field] !== claim[field])
        throw validationError("A replacement claim must match the original claim domain and visibility.");
  }

  for (const id of claims.keys()) {
    const seen = new Set<string>();
    let cursor: string | null = id;
    while (cursor && claims.has(cursor)) {
      if (seen.has(cursor)) throw validationError("Imported supersession graph contains a cycle.");
      seen.add(cursor);
      cursor = claims.get(cursor)!.superseded_by as string | null;
    }
  }
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
  administrative: boolean,
): Promise<Map<string, Prepared>> {
  const result = new Map(observations);
  const refs = [...claims.values()].flatMap((claim) => claim.sources.map((source) => source.observation_id)).filter((id) => !result.has(id));
  for (const group of chunk([...new Set(refs)], MAX_BOUND_PARAMS - 2)) {
    if (!group.length) continue;
    const rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT o.id, o.subject_id, o.project_id, o.workspace_id, o.trust, o.visibility
         FROM observations o WHERE o.org_id = ? AND o.id IN (${group.map(() => "?").join(", ")})
          AND ${administrative ? "1 = 1" : recordAccessSql("o")}`,
      administrative
        ? [ctx.principal!.orgId, ...group]
        : [ctx.principal!.orgId, ...group, ...recordAccessParams(ctx.principal!.principalId)],
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

const workspaceShape = (row: Record<string, unknown>): Prepared => ({
  id: String(row.id), name: String(row.name), created_at: String(row.created_at),
});
const membershipShape = (row: Record<string, unknown>): Prepared => ({
  id: String(row.id), workspace_id: String(row.workspace_id), principal_id: String(row.principal_id),
  principal_kind: String(row.principal_kind), role: String(row.role), created_at: String(row.created_at),
});
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
  valid_to: row.valid_to as string | null, created_at: String(row.created_at), superseded_by: row.superseded_by as string | null,
});
const withoutSources = (row: PreparedClaim): Prepared => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "sources"));
const observationValues = (orgId: string, row: Prepared) => [row.id, orgId, row.subject_id, row.project_id, row.workspace_id, row.agent_id, row.run_id, row.actor_id, row.kind, row.content, row.content_hash, row.source_type, row.source_ref, row.trust, row.visibility, row.occurred_at, row.ingested_at] as (string | number | null)[];
const claimValues = (orgId: string, row: PreparedClaim) => [row.id, orgId, row.subject_id, row.project_id, row.workspace_id, row.observer_id, row.actor_id, row.kind, row.statement, row.confidence, row.trust, row.visibility, row.status, row.version, row.valid_from, row.valid_to, row.created_at] as (string | number | null)[];

async function assertNoForeignIds(
  ctx: RequestContext,
  orgId: string,
  byType: Record<string, Prepared[]>,
): Promise<void> {
  const tables: [string, string][] = [
    ["workspace", "workspaces"], ["membership", "memberships"], ["project", "projects"],
    ["observation", "observations"], ["claim", "claims"],
  ];
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
