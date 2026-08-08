import { assertTrustCeiling, hasScope, requestedScopes, requireScope, SCOPES } from "./auth";
import { auditStatement } from "./audit";
import { authorizeRecordWorkspace, recordAccessParams, recordAccessSql } from "./authorization";
import { purgedEvidenceGuardStatement } from "./claims";
import { MAX_BOUND_PARAMS, chunk, type Param, type Stmt } from "./db";
import { conflict, unresolvedReference, validationError } from "./errors";
import { eventStatement } from "./events";
import {
  derivationClaimKey,
  derivationOverflowClaimKey,
  supportedObservationTemporalBounds,
} from "./enrichment";
import { sha256Hex } from "./ids";
import { MAX_BODY_BYTES, type RequestContext, type Result } from "./http";
import { isRedactedObservation, outboxStatement, redactedObservationContent } from "./observations";
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

export const EXPORT_FORMAT_VERSION = 4;
export const EXPORT_TYPES = ["keys", "workspaces", "memberships", "projects", "observations", "claims"] as const;
export const EXPORT_DEPENDENCY_ORDER = [...EXPORT_TYPES];
export const EXPORT_DEPENDENCIES: Record<(typeof EXPORT_TYPES)[number], string[]> = {
  keys: [],
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
type ExportLine = { cursor: string; line: string; component: string };
type ExportScan = { pageFull: boolean; lastCursor?: string };

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
  if (type === "keys") {
    requireScope(principal, "keys:manage");
    if (!wholeDeployment)
      throw validationError('Credential export requires query "all=true".');
  }
  const after = ctx.url.searchParams.get("after") ?? "";
  const limit = Number(ctx.url.searchParams.get("limit") ?? "500");
  if (!Number.isInteger(limit) || limit < 1 || limit > EXPORT_MAX_LIMIT)
    throw validationError(`Query "limit" must be an integer between 1 and ${EXPORT_MAX_LIMIT}.`);

  let rows: Record<string, unknown>[];
  let scan: ExportScan | undefined;
  if (type === "keys") {
    rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT id, principal_id, principal_kind, key_hash, label, scopes, max_trust,
              created_at, not_before, expires_at, last_used_at, revoked_at
         FROM api_keys
        WHERE org_id = ? AND id > ? ORDER BY id LIMIT ?`,
      [principal.orgId, after, limit],
    );
  } else if (type === "workspaces") {
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
    const claimCursor = after;
    const eligibleAccess = wholeDeployment
      ? "1 = 1"
      : `${recordAccessSql("c")} AND NOT EXISTS (
          SELECT 1 FROM claim_sources export_source
          JOIN observations source_observation
            ON source_observation.id = export_source.observation_id
           AND source_observation.org_id = c.org_id
         WHERE export_source.claim_id = c.id
           AND NOT ${recordAccessSql("o").replaceAll("o.", "source_observation.")}
        )`;
    if (claimCursor) {
      const available = await ctx.app.db.all<{ id: string }>(
        `SELECT c.id FROM claims c
          WHERE c.org_id = ? AND c.id = ? AND ${eligibleAccess} LIMIT 1`,
        wholeDeployment
          ? [principal.orgId, claimCursor]
          : [
              principal.orgId,
              claimCursor,
              ...recordAccessParams(principal.principalId),
              ...recordAccessParams(principal.principalId),
            ],
      );
      if (!available.length)
        throw validationError("Claim export cursor is unavailable.");
    }
    rows = await ctx.app.db.all<Record<string, unknown>>(
      `WITH RECURSIVE
       eligible_claims AS (
         SELECT c.* FROM claims c WHERE c.org_id = ? AND ${eligibleAccess}
       ),
       link_endpoints AS (
         SELECT link.job_id, link.source_claim_id AS claim_id FROM claim_links link
         JOIN enrichment_jobs job ON job.id = link.job_id
          WHERE job.org_id = ?
         UNION
         SELECT link.job_id, link.target_claim_id AS claim_id FROM claim_links link
         JOIN enrichment_jobs job ON job.id = link.job_id
          WHERE job.org_id = ?
       ),
       link_owners AS (
         SELECT endpoint.job_id, MAX(endpoint.claim_id) AS owner_id
           FROM link_endpoints endpoint
           JOIN enrichment_commits commit_row ON commit_row.job_id = endpoint.job_id
          WHERE commit_row.result_kind = 'link'
          GROUP BY endpoint.job_id
       ),
       dependency_edges(node_id, dependency_id) AS (
         SELECT dependent.id, replacement.id
           FROM eligible_claims dependent
           JOIN eligible_claims replacement ON replacement.id = dependent.superseded_by
         UNION
         SELECT result_claim.id, premise.id
           FROM enrichment_jobs job
           JOIN enrichment_commits commit_row ON commit_row.job_id = job.id
            AND commit_row.result_kind = 'add'
           JOIN json_each(job.result_ids) result
           JOIN eligible_claims result_claim ON result_claim.id = result.value
           JOIN json_each(job.input_ids) input
           JOIN eligible_claims premise ON premise.id = json_extract(input.value, '$.id')
          WHERE job.org_id = ? AND job.lane = 'reflection'
         UNION
         SELECT owner.owner_id, premise.id
           FROM link_owners owner
           JOIN enrichment_jobs job ON job.id = owner.job_id
           JOIN eligible_claims owner_claim ON owner_claim.id = owner.owner_id
           JOIN json_each(job.input_ids) input
           JOIN eligible_claims premise ON premise.id = json_extract(input.value, '$.id')
          WHERE premise.id != owner.owner_id
         UNION
         SELECT owner.owner_id, endpoint_claim.id
           FROM link_owners owner
           JOIN eligible_claims owner_claim ON owner_claim.id = owner.owner_id
           JOIN link_endpoints endpoint ON endpoint.job_id = owner.job_id
           JOIN eligible_claims endpoint_claim ON endpoint_claim.id = endpoint.claim_id
          WHERE endpoint_claim.id != owner.owner_id
       ),
       reachable(node_id, dependency_id) AS (
         SELECT node_id, dependency_id FROM dependency_edges
         UNION
         SELECT reachable.node_id, edge.dependency_id
           FROM reachable
           JOIN dependency_edges edge ON edge.node_id = reachable.dependency_id
       ),
       mutual(node_id, member_id) AS (
         SELECT id, id FROM eligible_claims
         UNION
         SELECT forward.node_id, forward.dependency_id
           FROM reachable forward
           JOIN reachable reverse
             ON reverse.node_id = forward.dependency_id
            AND reverse.dependency_id = forward.node_id
       ),
       components AS (
         SELECT node_id, MIN(member_id) AS component_id,
                COUNT(*) AS component_size, MAX(member_id) AS component_last
           FROM mutual GROUP BY node_id
       ),
       dependency_ranks AS (
         SELECT node_id, COUNT(*) AS dependency_rank
           FROM reachable GROUP BY node_id
       ),
       ordered_claims AS (
         SELECT eligible.id,
                COALESCE(rank.dependency_rank, 0) AS dependency_rank,
                component.component_id, component.component_size,
                component.component_last
           FROM eligible_claims eligible
           JOIN components component ON component.node_id = eligible.id
           LEFT JOIN dependency_ranks rank ON rank.node_id = eligible.id
       ),
       cursor_order AS (
         SELECT dependency_rank, component_id, id FROM ordered_claims WHERE id = ?
       )
       SELECT c.id, c.subject_id, c.project_id, c.workspace_id, c.observer_id, c.actor_id,
              c.kind, c.statement, c.confidence, c.trust, c.visibility, c.status, c.version,
              c.valid_from, c.valid_to, c.created_at, c.superseded_by,
              c.enrichment_job_id, c.enrichment_key, c.enrichment_key_archived,
              (SELECT COUNT(*) FROM claim_sources source_count
                WHERE source_count.claim_id = c.id) AS source_count,
              ordered.dependency_rank AS portability_rank,
              ordered.component_id AS portability_component,
              ordered.component_size AS portability_component_size,
              CASE WHEN c.superseded_by IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM eligible_claims replacement
                 WHERE replacement.id = c.superseded_by
              ) THEN 1 ELSE 0 END AS portability_missing_supersession
         FROM ordered_claims ordered
         JOIN eligible_claims c ON c.id = ordered.id
        WHERE ? = '' OR (EXISTS (SELECT 1 FROM cursor_order) AND (
          ordered.dependency_rank > (SELECT dependency_rank FROM cursor_order)
          OR (
            ordered.dependency_rank = (SELECT dependency_rank FROM cursor_order)
            AND ordered.component_id > (SELECT component_id FROM cursor_order)
          )
          OR (
            ordered.dependency_rank = (SELECT dependency_rank FROM cursor_order)
            AND ordered.component_id = (SELECT component_id FROM cursor_order)
            AND ordered.id > (SELECT id FROM cursor_order)
          )
        ))
        ORDER BY ordered.dependency_rank, ordered.component_id, ordered.id LIMIT ?`,
      wholeDeployment
        ? [principal.orgId, principal.orgId, principal.orgId, principal.orgId, claimCursor, claimCursor, limit]
        : [
            principal.orgId,
            ...recordAccessParams(principal.principalId),
            ...recordAccessParams(principal.principalId),
            principal.orgId,
            principal.orgId,
            principal.orgId,
            claimCursor,
            claimCursor,
            limit,
      ],
    );
    if (rows.some((row) => Number(row.portability_missing_supersession) === 1))
      throw validationError("Claim export has incomplete authorized supersession.");
    const splitComponent = rows.findIndex((row, index) => {
      if (index > 0 && row.portability_component === rows[index - 1]!.portability_component)
        return false;
      return index + Number(row.portability_component_size) > rows.length;
    });
    if (splitComponent === 0) {
      const required = Number(rows[0]!.portability_component_size);
      if (required > EXPORT_MAX_LIMIT)
        throw validationError(
          `Claim dependency component exceeds the maximum logical export limit of ${EXPORT_MAX_LIMIT}.`,
        );
      throw validationError(`Claim dependency component requires limit at least ${required}.`);
    }
    if (splitComponent > 0) rows = rows.slice(0, splitComponent);
    scan = {
      pageFull: splitComponent > 0 || rows.length === limit,
      lastCursor: rows.length ? String(rows.at(-1)!.id) : undefined,
    };
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
    if (rows.some((row) =>
      (grouped.get(String(row.id)) ?? []).length !== Number(row.source_count)))
      throw validationError("Claim export has incomplete authorized evidence.");
    rows = rows
      .map((row) => ({
        ...row,
        __cursor: String(row.id),
        sources: grouped.get(String(row.id)) ?? [],
      }));
    const expectedGenerated = new Set(rows
      .filter((row) => typeof row.enrichment_job_id === "string")
      .map((row) => String(row.id)));
    const expectedComponents = new Map<string, number>();
    for (const row of rows) if (Number(row.portability_component_size) > 1)
      expectedComponents.set(
        String(row.portability_component),
        Number(row.portability_component_size),
      );
    rows = await attachEnrichmentBundles(ctx, rows, wholeDeployment);
    const attachedIds = new Set(rows.map((row) => String(row.id)));
    if ([...expectedGenerated].some((id) => !attachedIds.has(id)))
      throw validationError("Generated claim has incomplete authorized provenance.");
    for (const [component, expected] of expectedComponents) if (
      rows.filter((row) => row.portability_component === component).length !== expected
    ) throw validationError("Claim dependency component has incomplete portable provenance.");
  }

  return exportPage(ctx, type as ExportType, rows, limit, wholeDeployment, scan);
}

interface ExportEnrichmentJob extends Record<string, unknown> {
  id: string;
  input_ids: string;
  result_ids: string;
}

async function exportableEnrichmentJobIds(
  ctx: RequestContext,
  ids: string[],
  wholeDeployment: boolean,
): Promise<Set<string>> {
  const result = new Set<string>();
  const inputObservationAccess = wholeDeployment
    ? "1 = 1"
    : recordAccessSql("o").replaceAll("o.", "input_observation.");
  const inputClaimAccess = wholeDeployment
    ? "1 = 1"
    : recordAccessSql("c").replaceAll("c.", "input_claim.");
  const sourceAccess = wholeDeployment
    ? "1 = 1"
    : recordAccessSql("c").replaceAll("c.", "link_source.");
  const targetAccess = wholeDeployment
    ? "1 = 1"
    : recordAccessSql("c").replaceAll("c.", "link_target.");
  for (const group of chunk(ids, MAX_BOUND_PARAMS - 9)) {
    if (!group.length) continue;
    const rows = await ctx.app.db.all<{ id: string }>(
      `SELECT j.id FROM enrichment_jobs j
        WHERE j.org_id = ? AND j.id IN (${group.map(() => "?").join(", ")})
          AND (
            (j.lane = 'derivation' AND EXISTS (
              SELECT 1 FROM observations input_observation
               WHERE input_observation.id = json_extract(j.input_ids, '$[0].id')
                 AND input_observation.org_id = j.org_id
                 AND input_observation.content_hash = json_extract(j.input_ids, '$[0].content_hash')
                 AND ${inputObservationAccess}
            ))
            OR
            (j.lane = 'reflection' AND NOT EXISTS (
              SELECT 1 FROM json_each(j.input_ids) input
              LEFT JOIN claims input_claim
                ON input_claim.id = json_extract(input.value, '$.id')
               AND input_claim.org_id = j.org_id
              WHERE input_claim.id IS NULL
                 OR NOT ${inputClaimAccess}
                 OR (
                   input_claim.version != json_extract(input.value, '$.version')
                   AND NOT (
                     input_claim.version > json_extract(input.value, '$.version')
                     AND input_claim.status NOT IN ('active', 'disputed')
                     AND EXISTS (
                       SELECT 1 FROM enrichment_commits historical_commit
                        WHERE historical_commit.job_id = j.id
                          AND (
                            historical_commit.result_kind = 'link'
                            OR (
                              historical_commit.result_kind = 'add'
                              AND EXISTS (
                                SELECT 1 FROM json_each(j.result_ids) historical_result
                                JOIN claims generated
                                  ON generated.id = historical_result.value
                                 AND generated.org_id = j.org_id
                               WHERE generated.status NOT IN ('active', 'disputed')
                              )
                            )
                          )
                     )
                   )
                 )
            ))
          )
          AND NOT EXISTS (
            SELECT 1 FROM claim_links link
            LEFT JOIN claims link_source
              ON link_source.id = link.source_claim_id AND link_source.org_id = link.org_id
            LEFT JOIN claims link_target
              ON link_target.id = link.target_claim_id AND link_target.org_id = link.org_id
             WHERE link.job_id = j.id AND link.org_id = j.org_id
               AND (
                 link_source.id IS NULL OR link_target.id IS NULL
                 OR NOT ${sourceAccess} OR NOT ${targetAccess}
               )
          )`,
      [
        ctx.principal!.orgId,
        ...group,
        ...(wholeDeployment ? [] : recordAccessParams(ctx.principal!.principalId)),
        ...(wholeDeployment ? [] : recordAccessParams(ctx.principal!.principalId)),
        ...(wholeDeployment ? [] : recordAccessParams(ctx.principal!.principalId)),
        ...(wholeDeployment ? [] : recordAccessParams(ctx.principal!.principalId)),
      ],
    );
    for (const row of rows) result.add(row.id);
  }
  return result;
}

async function attachEnrichmentBundles(
  ctx: RequestContext,
  claimRows: Record<string, unknown>[],
  wholeDeployment: boolean,
): Promise<Record<string, unknown>[]> {
  const claimIds = claimRows.map((row) => String(row.id));
  const primaryIds = claimRows.map((row) => row.enrichment_job_id)
    .filter((id): id is string => typeof id === "string");
  const jobs = new Map<string, ExportEnrichmentJob>();
  for (const group of chunk(primaryIds, MAX_BOUND_PARAMS - 1)) {
    if (!group.length) continue;
    for (const row of await ctx.app.db.all<ExportEnrichmentJob>(
      `SELECT id, lane, derivation_key, input_ids, input_hash, subject_id,
              project_id, workspace_id, actor_id, model_id, model_fingerprint,
              prompt_fingerprint, schema_fingerprint, policy_fingerprint,
              state, attempts, max_attempts, next_attempt_at, error_class,
              output_hash, result_ids, created_at, updated_at
         FROM enrichment_jobs
        WHERE org_id = ? AND state = 'done'
          AND id IN (${group.map(() => "?").join(", ")})`,
      [ctx.principal!.orgId, ...group],
    )) jobs.set(row.id, row);
  }
  for (const group of chunk(claimIds, Math.floor((MAX_BOUND_PARAMS - 1) / 3))) {
    if (!group.length) continue;
    for (const row of await ctx.app.db.all<ExportEnrichmentJob>(
      `SELECT DISTINCT j.id, j.lane, j.derivation_key, j.input_ids, j.input_hash,
              j.subject_id, j.project_id, j.workspace_id, j.actor_id, j.model_id,
              j.model_fingerprint, j.prompt_fingerprint, j.schema_fingerprint,
              j.policy_fingerprint, j.state, j.attempts, j.max_attempts,
              j.next_attempt_at, j.error_class, j.output_hash, j.result_ids,
              j.created_at, j.updated_at
         FROM enrichment_jobs j JOIN enrichment_commits ec ON ec.job_id = j.id
        WHERE j.org_id = ? AND j.state = 'done'
          AND (
            (ec.result_kind = 'reuse' AND EXISTS (
              SELECT 1 FROM json_each(j.result_ids) result
               WHERE result.value IN (${group.map(() => "?").join(", ")})
            ))
            OR
            (ec.result_kind = 'link' AND EXISTS (
              SELECT 1 FROM claim_links link WHERE link.job_id = j.id
                AND (link.source_claim_id IN (${group.map(() => "?").join(", ")})
                  OR link.target_claim_id IN (${group.map(() => "?").join(", ")}))
            ))
          )`,
      [ctx.principal!.orgId, ...group, ...group, ...group],
    )) jobs.set(row.id, row);
  }
  const allowed = await exportableEnrichmentJobIds(ctx, [...jobs.keys()], wholeDeployment);
  for (const group of chunk([...allowed], MAX_BOUND_PARAMS - 1)) {
    if (!group.length) continue;
    const nested = await ctx.app.db.all<{ id: string }>(
      `SELECT DISTINCT job.id FROM enrichment_jobs job
        JOIN json_each(job.input_ids) input
        JOIN claims premise
          ON premise.id = json_extract(input.value, '$.id')
         AND premise.org_id = job.org_id
        JOIN enrichment_jobs source_job
          ON source_job.id = premise.enrichment_job_id
         AND source_job.org_id = job.org_id
       WHERE job.org_id = ? AND job.lane = 'reflection'
         AND source_job.lane = 'reflection'
         AND job.id IN (${group.map(() => "?").join(", ")}) LIMIT 1`,
      [ctx.principal!.orgId, ...group],
    );
    if (nested.length)
      throw validationError("Claim export has invalid enrichment provenance.");
  }
  for (const id of [...jobs.keys()]) if (!allowed.has(id)) jobs.delete(id);

  const commits = new Map<string, Record<string, unknown>>();
  const links = new Map<string, Record<string, unknown>[]>();
  for (const group of chunk([...jobs.keys()], MAX_BOUND_PARAMS)) {
    if (!group.length) continue;
    for (const row of await ctx.app.db.all<Record<string, unknown>>(
      `SELECT job_id, lease_token, result_kind, committed_at
         FROM enrichment_commits WHERE job_id IN (${group.map(() => "?").join(", ")})
        ORDER BY job_id`,
      group,
    )) commits.set(String(row.job_id), row);
    for (const row of await ctx.app.db.all<Record<string, unknown>>(
      `SELECT id, source_claim_id, target_claim_id, relation, job_id, created_at
         FROM claim_links WHERE job_id IN (${group.map(() => "?").join(", ")})
        ORDER BY job_id, id`,
      group,
    )) {
      const list = links.get(String(row.job_id)) ?? [];
      list.push(row);
      links.set(String(row.job_id), list);
    }
  }
  const bundle = (job: ExportEnrichmentJob) => ({
    job: {
      ...job,
      input_ids: JSON.parse(job.input_ids),
      result_ids: JSON.parse(job.result_ids),
    },
    commit: commits.get(job.id),
    links: links.get(job.id) ?? [],
  });
  try {
    for (const job of jobs.values()) {
      const portable = bundle(job);
      const prepared = await prepareEnrichmentBundle(
        {
          row: {},
          formatVersion: EXPORT_FORMAT_VERSION,
          sourceOrgId: ctx.principal!.orgId,
        },
        portable,
        new Map(),
        new Set(),
        String(job.actor_id),
      );
      const primary = claimRows.filter((claim) => claim.enrichment_job_id === job.id);
      if (prepared.commit.result_kind === "add" && (
        primary.length !== 1 || prepared.result_ids[0] !== primary[0]!.id
      )) throw new Error("invalid primary result");
      if (prepared.commit.result_kind !== "add" && primary.length)
        throw new Error("non-add job cannot own a claim");
    }
  } catch {
    throw validationError("Claim export has invalid enrichment provenance.");
  }
  return claimRows.flatMap((claim) => {
    const primaryId = claim.enrichment_job_id;
    if (typeof primaryId === "string" && (!jobs.has(primaryId) || !commits.has(primaryId))) return [];
    const attached = [...jobs.values()].filter((job) => {
      const commit = commits.get(job.id);
      if (!commit) return false;
      if (job.id === primaryId) return true;
      const resultIds = JSON.parse(job.result_ids) as string[];
      if (commit.result_kind === "reuse") return resultIds[0] === claim.id;
      if (commit.result_kind !== "link") return false;
      const endpoints = (links.get(job.id) ?? []).flatMap((link) => [
        String(link.source_claim_id),
        String(link.target_claim_id),
      ]);
      return endpoints.length > 0 && [...endpoints].sort().at(-1) === claim.id;
    }).sort((left, right) => left.id.localeCompare(right.id));
    return [{ ...claim, enrichments: attached.map(bundle) }];
  });
}

async function exportPage(
  ctx: RequestContext,
  type: ExportType,
  rows: Record<string, unknown>[],
  limit: number,
  wholeDeployment: boolean,
  scan?: ExportScan,
): Promise<Result> {
  const lineType: Record<ExportType, string> = {
    keys: "api_key",
    workspaces: "workspace",
    memberships: "membership",
    projects: "project",
    observations: "observation",
    claims: "claim",
  };
  // The importer rejects these at assertWorkspaceReferences (below). Refuse to
  // write a backup artifact that cannot be restored.
  const unbindable = rows.find((row) => row.visibility === "team" && row.workspace_id == null);
  if (unbindable)
    throw validationError(
      `Record ${String(unbindable.id)} predates workspace scoping; "workspace_id" is required for team visibility.`,
    );
  const candidates: ExportLine[] = rows.map((row) => {
    const {
      __cursor,
      portability_rank: _portabilityRank,
      portability_component: portabilityComponent,
      portability_component_size: _portabilityComponentSize,
      portability_missing_supersession: _portabilityMissingSupersession,
      source_count: _sourceCount,
      ...record
    } = row;
    return {
      cursor: String(__cursor ?? row.id),
      line: JSON.stringify({ type: lineType[type], ...record }),
      component: String(portabilityComponent ?? __cursor ?? row.id),
    };
  });
  const selected: ExportLine[] = [];
  let recordBytes = 0;
  for (let index = 0; index < candidates.length;) {
    const component = candidates[index]!.component;
    const end = candidates.findIndex((candidate, candidateIndex) =>
      candidateIndex > index && candidate.component !== component);
    const componentRows = candidates.slice(index, end < 0 ? candidates.length : end);
    const bytes = componentRows.reduce(
      (total, candidate) => total + encoder.encode(`${candidate.line}\n`).byteLength,
      0,
    );
    if (recordBytes + bytes > MAX_BODY_BYTES - HEADER_RESERVE_BYTES) {
      if (selected.length === 0 && componentRows.length > 1)
        throw validationError(
          `Claim dependency component exceeds the ${MAX_BODY_BYTES}-byte logical export boundary.`,
        );
      break;
    }
    selected.push(...componentRows);
    recordBytes += bytes;
    index += componentRows.length;
  }
  if (candidates.length > 0 && selected.length === 0)
    throw new Error("One export record exceeds the import request limit.");

  const exportedAt = ctx.app.now().toISOString();
  const truncated = selected.length < candidates.length;
  const hasMore = truncated || (scan?.pageFull ?? candidates.length === limit);
  const nextCursor = truncated
    ? selected.at(-1)!.cursor
    : scan?.pageFull
      ? scan.lastCursor ?? null
      : hasMore
        ? selected.at(-1)?.cursor ?? null
        : null;
  const header = {
    type: "titen.export.header",
    format_version: EXPORT_FORMAT_VERSION,
    record_type: type,
    dependency_order: EXPORT_DEPENDENCY_ORDER,
    depends_on: EXPORT_DEPENDENCIES[type as (typeof EXPORT_TYPES)[number]],
    org_id: ctx.principal!.orgId,
    scope: wholeDeployment ? "deployment" : "principal",
    exported_at: exportedAt,
    count: selected.length,
    next_cursor: hasMore ? nextCursor : null,
    complete: !hasMore,
  };
  const body = `${[JSON.stringify(header), ...selected.map(({ line }) => line)].join("\n")}\n`;
  if (encoder.encode(body).byteLength > MAX_BODY_BYTES)
    throw new Error("Export page exceeded the import request limit.");
  const audits = [auditStatement(
    ctx.principal!.orgId,
    ctx.principal!.principalId,
    "records.export",
    "export",
    exportedAt,
    type,
  )];
  if (wholeDeployment) audits.push(auditStatement(
      ctx.principal!.orgId,
      ctx.principal!.principalId,
      "portability.export_all",
      "export",
      exportedAt,
      null,
      JSON.stringify({ record_type: type, count: selected.length, complete: !hasMore }),
  ));
  await ctx.app.db.batch(audits);
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
/**
 * A prepared row is columns only, and every value in it has already been through
 * validation, so `Param` is the honest type: `Record<string, unknown>` erased
 * that at the most hostile input boundary in the repo and made 63 assignments
 * to SQL parameters unprovable.
 */
type Prepared = Record<string, Param>;
type EnrichmentLink = {
  id: string;
  source_claim_id: string;
  target_claim_id: string;
  relation: string;
  job_id: string;
  created_at: string;
};
type EnrichmentCommit = {
  job_id: string;
  lease_token: string;
  result_kind: "add" | "link" | "reuse";
  committed_at: string;
};
type PreparedEnrichment = Prepared & {
  input_ids: Array<{ id: string; content_hash?: string; version?: number }>;
  result_ids: string[];
  commit: EnrichmentCommit;
  links: EnrichmentLink[];
};
type PreparedClaim = Prepared & { sources: Source[]; enrichments: PreparedEnrichment[] };
type VersionedRow = { row: Record<string, unknown>; formatVersion: 1 | 2 | 3 | 4; sourceOrgId: string };

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
const fingerprint = (row: Record<string, unknown>, field: string): string => {
  const value = requireString(row, field, 64, `import.${field}`);
  if (!/^[a-f0-9]{64}$/u.test(value))
    throw validationError(`Imported field "${field}" must be a lowercase SHA-256 fingerprint.`);
  return value;
};
const exactFields = (row: Record<string, unknown>, fields: string[], label: string): void => {
  const actual = Object.keys(row).sort();
  const expected = [...fields].sort();
  if (canonical(actual) !== canonical(expected))
    throw validationError(`Imported ${label} fields do not match format version 3.`);
};

async function prepareEnrichmentBundle(
  entry: VersionedRow,
  value: unknown,
  mappings: Map<string, string>,
  usedMappings: Set<string>,
  importer: string,
): Promise<PreparedEnrichment> {
  if (!isRecord(value)) throw validationError("Each enrichment bundle must be an object.");
  exactFields(value, ["job", "commit", "links"], "enrichment bundle");
  if (!isRecord(value.job) || !isRecord(value.commit) || !Array.isArray(value.links))
    throw validationError("An enrichment bundle requires job, commit, and links.");
  const job = value.job;
  const commitRow = value.commit;
  exactFields(job, [
    "id", "lane", "derivation_key", "input_ids", "input_hash", "subject_id",
    "project_id", "workspace_id", "actor_id", "model_id", "model_fingerprint",
    "prompt_fingerprint", "schema_fingerprint", "policy_fingerprint", "state",
    "attempts", "max_attempts", "next_attempt_at", "error_class", "output_hash",
    "result_ids", "created_at", "updated_at",
  ], "enrichment job");
  exactFields(commitRow, ["job_id", "lease_token", "result_kind", "committed_at"], "enrichment commit");
  const id = requireString(job, "id", LIMITS.identifier);
  const lane = requireEnum(job, "lane", ["derivation", "reflection"] as const);
  if (job.state !== "done" || job.error_class !== null)
    throw validationError("Only successfully committed enrichment provenance is portable.");
  if (!Number.isInteger(job.attempts) || Number(job.attempts) < 1 || Number(job.attempts) > 4)
    throw validationError("Imported enrichment attempts must be an integer from 1 to 4.");
  if (!Number.isInteger(job.max_attempts) || Number(job.max_attempts) < 1 || Number(job.max_attempts) > 4
    || Number(job.attempts) > Number(job.max_attempts))
    throw validationError("Imported enrichment max_attempts is invalid.");
  if (!Array.isArray(job.input_ids) || job.input_ids.length < 1 || job.input_ids.length > 8)
    throw validationError("Imported enrichment input_ids must contain 1 to 8 entries.");
  const inputIds = job.input_ids.map((input): PreparedEnrichment["input_ids"][number] => {
    if (!isRecord(input)) throw validationError("Each enrichment input must be an object.");
    const inputId = requireString(input, "id", LIMITS.identifier);
    if (lane === "derivation") {
      exactFields(input, ["id", "content_hash"], "derivation input");
      return { id: inputId, content_hash: fingerprint(input, "content_hash") };
    }
    exactFields(input, ["id", "version"], "reflection input");
    if (!Number.isInteger(input.version) || Number(input.version) < 1)
      throw validationError("A reflection input version must be a positive integer.");
    return { id: inputId, version: Number(input.version) };
  });
  if (new Set(inputIds.map(({ id: inputId }) => inputId)).size !== inputIds.length)
    throw validationError("Imported enrichment input_ids must be unique.");
  if (lane === "derivation" && inputIds.length !== 1)
    throw validationError("A derivation job requires exactly one input.");
  if (!Array.isArray(job.result_ids) || job.result_ids.length < 1 || job.result_ids.length > 8)
    throw validationError("Portable enrichment result_ids must contain 1 to 8 entries.");
  const resultIds = job.result_ids.map((resultId) => {
    if (typeof resultId !== "string" || !resultId || resultId.length > LIMITS.identifier)
      throw validationError("Each enrichment result id must be a bounded string.");
    return resultId;
  });
  if (new Set(resultIds).size !== resultIds.length)
    throw validationError("Imported enrichment result_ids must be unique.");
  const commit: EnrichmentCommit = {
    job_id: requireString(commitRow, "job_id", LIMITS.identifier),
    lease_token: requireString(commitRow, "lease_token", LIMITS.identifier),
    result_kind: requireEnum(commitRow, "result_kind", ["add", "link", "reuse"] as const),
    committed_at: timestamp(commitRow, "committed_at")!,
  };
  if (commit.job_id !== id)
    throw validationError("Imported enrichment commit does not match its job.");
  if (
    (lane === "derivation" && !["add", "reuse"].includes(commit.result_kind))
    || (lane === "reflection" && !["add", "link"].includes(commit.result_kind))
  ) throw validationError("Imported enrichment lane and result kind are inconsistent.");
  if (commit.result_kind !== "link" && resultIds.length !== 1)
    throw validationError("An ADD or REUSE enrichment must name exactly one claim.");
  const outputHash = job.output_hash === null
    ? (commit.result_kind === "reuse" ? null : (() => {
        throw validationError("A model-backed enrichment result requires an output hash.");
      })())
    : fingerprint(job, "output_hash");
  const derivationKey = job.derivation_key === null ? null : fingerprint(job, "derivation_key");
  if ((lane === "derivation") !== (derivationKey !== null))
    throw validationError("Imported derivation_key does not match its lane.");
  const links: EnrichmentLink[] = value.links.map((link) => {
    if (!isRecord(link)) throw validationError("Each enrichment link must be an object.");
    exactFields(link, [
      "id", "source_claim_id", "target_claim_id", "relation", "job_id", "created_at",
    ], "enrichment link");
    const prepared = {
      id: requireString(link, "id", LIMITS.identifier),
      source_claim_id: requireString(link, "source_claim_id", LIMITS.identifier),
      target_claim_id: requireString(link, "target_claim_id", LIMITS.identifier),
      relation: requireEnum(link, "relation", [
        "derived_from",
        "related_to",
        "duplicate_candidate",
        "conflict_candidate",
        "supersession_candidate",
      ] as const),
      job_id: requireString(link, "job_id", LIMITS.identifier),
      created_at: timestamp(link, "created_at")!,
    };
    if (prepared.job_id !== id || prepared.source_claim_id === prepared.target_claim_id)
      throw validationError("Imported enrichment link does not match its job or has a self edge.");
    return prepared;
  });
  if (links.length > 8 || new Set(links.map(({ id: linkId }) => linkId)).size !== links.length)
    throw validationError("Imported enrichment links exceed bounds or repeat an id.");
  if (commit.result_kind === "link") {
    if (!links.length || links.some(({ relation }) => relation === "derived_from")
      || canonical([...resultIds].sort()) !== canonical(links.map(({ id: linkId }) => linkId).sort()))
      throw validationError("A LINK result must exactly name its non-derived links.");
  } else if (lane === "derivation" && links.length) {
    throw validationError("A derivation result cannot carry claim links.");
  } else if (lane === "reflection" && links.some(({ relation }) => relation !== "derived_from")) {
    throw validationError("A reflection ADD may carry only derived_from links.");
  }
  const createdAt = timestamp(job, "created_at")!;
  const nextAttemptAt = timestamp(job, "next_attempt_at")!;
  const updatedAt = timestamp(job, "updated_at")!;
  if (createdAt > nextAttemptAt || nextAttemptAt > commit.committed_at || commit.committed_at !== updatedAt
    || links.some(({ created_at }) => created_at !== commit.committed_at))
    throw validationError("Imported enrichment timestamps are inconsistent.");
  const inputHash = fingerprint(job, "input_hash");
  if (inputHash !== await sha256Hex(JSON.stringify({ lane, ids: inputIds })))
    throw validationError("Imported enrichment input_hash does not match input_ids.");
  return {
    id,
    lane,
    derivation_key: derivationKey,
    input_ids: inputIds,
    input_hash: inputHash,
    subject_id: requireString(job, "subject_id", LIMITS.identifier),
    project_id: optionalText(job, "project_id", LIMITS.identifier),
    workspace_id: optionalText(job, "workspace_id", LIMITS.identifier),
    actor_id: importedActor(entry, mappings, usedMappings, importer, "enrichment", "actor_id", job),
    model_id: requireString(job, "model_id", LIMITS.identifier),
    model_fingerprint: fingerprint(job, "model_fingerprint"),
    prompt_fingerprint: fingerprint(job, "prompt_fingerprint"),
    schema_fingerprint: fingerprint(job, "schema_fingerprint"),
    policy_fingerprint: fingerprint(job, "policy_fingerprint"),
    state: "done",
    attempts: Number(job.attempts),
    max_attempts: Number(job.max_attempts),
    next_attempt_at: nextAttemptAt,
    error_class: null,
    output_hash: outputHash,
    result_ids: resultIds,
    created_at: createdAt,
    updated_at: updatedAt,
    commit,
    links,
  };
}

/** Validate the complete graph before committing it in one atomic batch. */
export async function importRecords(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const lines = (await ctx.rawBody()).split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw validationError("Import body must contain at least one record.");
  const rawByType: Record<"api_key" | "workspace" | "membership" | "project" | "observation" | "claim", VersionedRow[]> = {
    api_key: [], workspace: [], membership: [], project: [], observation: [], claim: [],
  };
  const actorMappings = new Map<string, string>();
  const usedActorMappings = new Set<string>();
  let formatVersion: 1 | 2 | 3 | 4 = 1;
  let sourceOrgId = principal.orgId;
  let recordCount = 0;
  for (const line of lines) {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { throw validationError("Every import line must be valid JSON."); }
    assertJsonDepth(parsed);
    if (!isRecord(parsed)) throw validationError("Every import line must be a JSON object.");
    if (parsed.type === "titen.export.header") {
      if (parsed.format_version !== 1 && parsed.format_version !== 2
        && parsed.format_version !== 3 && parsed.format_version !== EXPORT_FORMAT_VERSION)
        throw validationError(`Unsupported export format version "${String(parsed.format_version)}".`);
      formatVersion = parsed.format_version;
      sourceOrgId = formatVersion >= 2
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
    if (!["api_key", "workspace", "membership", "project", "observation", "claim"].includes(String(parsed.type)))
      throw validationError(`Unknown record type "${String(parsed.type ?? "")}".`);
    recordCount += 1;
    if (recordCount > IMPORT_MAX_LINES)
      throw validationError(`Import accepts at most ${IMPORT_MAX_LINES} records per request.`);
    rawByType[parsed.type as keyof typeof rawByType].push({ row: parsed, formatVersion, sourceOrgId });
  }

  if (rawByType.api_key.length) requireScope(principal, "keys:manage");
  if (rawByType.workspace.length) requireScope(principal, "workspaces:write");
  if (rawByType.membership.length) requireScope(principal, "memberships:write");
  const at = ctx.app.now().toISOString();
  const workspaces = new Map<string, Prepared>();
  const keys = new Map<string, Prepared>();
  const memberships = new Map<string, Prepared>();
  const projects = new Map<string, Prepared>();
  const observations = new Map<string, Prepared>();
  const redactedObservations = new Set<string>();
  const claims = new Map<string, PreparedClaim>();
  const legacyClaims = new Set<string>();

  for (const { row, formatVersion: rowVersion } of rawByType.api_key) {
    if (rowVersion < 4)
      throw validationError("Credential records require export format version 4.");
    exactFields(row, [
      "type", "id", "principal_id", "principal_kind", "key_hash", "label", "scopes",
      "max_trust", "created_at", "not_before", "expires_at", "last_used_at", "revoked_at",
    ], "credential");
    const scopes = requestedScopes(
      requireString(row, "scopes", SCOPES.join(" ").length + 1_000, "import.scopes")
        .split(" ").filter(Boolean),
      principal,
    );
    const maxTrust = requireEnum(row, "max_trust", TRUST_LEVELS);
    assertTrustCeiling(principal, maxTrust);
    const notBefore = timestamp(row, "not_before")!;
    const expiresAt = timestamp(row, "expires_at", false);
    const lastUsedAt = timestamp(row, "last_used_at", false);
    if (expiresAt !== null && notBefore >= expiresAt)
      throw validationError("Imported credential not_before must precede expires_at.");
    if (lastUsedAt !== null && (lastUsedAt < notBefore || (expiresAt !== null && lastUsedAt >= expiresAt)))
      throw validationError("Imported credential last_used_at is outside its validity window.");
    const prepared: Prepared = {
      id: requireString(row, "id", LIMITS.identifier),
      principal_id: requireString(row, "principal_id", LIMITS.identifier),
      principal_kind: requireEnum(row, "principal_kind", ["human", "agent", "service"] as const),
      key_hash: fingerprint(row, "key_hash"),
      label: requireString(row, "label", LIMITS.label),
      scopes: scopes.join(" "),
      max_trust: maxTrust,
      created_at: timestamp(row, "created_at"),
      not_before: notBefore,
      expires_at: expiresAt,
      last_used_at: lastUsedAt,
      revoked_at: timestamp(row, "revoked_at", false),
    };
    addUnique(keys, prepared.id as string, prepared);
  }

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
      workspace_id: optionalText(row, "workspace_id", LIMITS.identifier),
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
    const enrichmentJobId = entry.formatVersion >= 3
      ? optionalText(row, "enrichment_job_id", LIMITS.identifier)
      : null;
    if (entry.formatVersion >= 3 && !("enrichment_key" in row))
      throw validationError("A version 3 claim requires enrichment_key.");
    if (entry.formatVersion >= 3 && !("enrichment_key_archived" in row))
      throw validationError("A version 3 claim requires enrichment_key_archived.");
    const enrichmentKey = entry.formatVersion >= 3 && row.enrichment_key !== null
      ? fingerprint(row, "enrichment_key")
      : null;
    const enrichmentKeyArchived = entry.formatVersion >= 3
      ? row.enrichment_key_archived
      : 0;
    if (typeof enrichmentKeyArchived !== "number" || !Number.isInteger(enrichmentKeyArchived)
      || (enrichmentKeyArchived !== 0 && enrichmentKeyArchived !== 1))
      throw validationError("Imported enrichment_key_archived must be 0 or 1.");
    if (!enrichmentJobId && (enrichmentKey || enrichmentKeyArchived))
      throw validationError("A direct claim cannot carry enrichment key state.");
    if (entry.formatVersion >= 3 && !Array.isArray(row.enrichments))
      throw validationError("A version 3 claim requires an enrichments array.");
    const enrichments: PreparedEnrichment[] = [];
    if (entry.formatVersion >= 3) for (const bundle of row.enrichments as unknown[])
      enrichments.push(await prepareEnrichmentBundle(
        entry,
        bundle,
        actorMappings,
        usedActorMappings,
        principal.principalId,
      ));
    if (new Set(enrichments.map(({ id }) => id)).size !== enrichments.length)
      throw validationError("A claim cannot repeat an enrichment job bundle.");
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
      enrichment_job_id: enrichmentJobId,
      enrichment_key: enrichmentKey,
      enrichment_key_archived: enrichmentKeyArchived,
      sources,
      enrichments,
    };
    addUnique(claims, prepared.id as string, prepared);
    if (entry.formatVersion === 1) legacyClaims.add(prepared.id as string);
  }
  if ([...actorMappings.keys()].some((key) => !usedActorMappings.has(key)))
    throw validationError("Import contains an actor mapping that no record uses.");

  const enrichments = new Map<string, PreparedEnrichment>();
  for (const claim of claims.values()) for (const enrichment of claim.enrichments) {
    if (enrichments.has(enrichment.id as string))
      throw validationError("Each enrichment job bundle must have one deterministic owner claim.");
    enrichments.set(enrichment.id as string, enrichment);
  }

  const byType = {
    workspace: [...workspaces.values()], membership: [...memberships.values()], project: [...projects.values()],
    observation: [...observations.values()], claim: [...claims.values()],
    enrichment: [...enrichments.values()],
  };
  await assertNoForeignIds(ctx, principal.orgId, byType);
  await assertWorkspaceReferences(ctx, workspaces, memberships, observations, claims);
  await assertProjectReferences(ctx, principal.orgId, projects, observations, claims);
  await assertSupersessionReferences(ctx, claims);
  const evidence = await loadEvidence(ctx, observations, claims, hasScope(principal, "keys:manage"));
  validateEvidenceDomains(claims, evidence);
  await assertEnrichmentGraph(ctx, observations, claims, memberships, enrichments);

  const existingWorkspaces = await loadExisting(ctx, "workspaces", [...workspaces.keys()]);
  const existingKeys = await loadExisting(ctx, "api_keys", [...keys.keys()]);
  const existingMemberships = await loadExisting(ctx, "memberships", [...memberships.keys()]);
  const existingProjects = await loadExisting(ctx, "projects", [...projects.keys()]);
  const existingObservations = await loadExisting(ctx, "observations", [...observations.keys()]);
  const existingClaims = await loadExisting(ctx, "claims", [...claims.keys()]);
  const existingEnrichments = await loadExisting(ctx, "enrichment_jobs", [...enrichments.keys()]);
  const existingSources = await loadExistingSources(ctx, [...existingClaims.keys()]);
  const existingEnrichmentCommits = await loadExistingEnrichmentCommits(ctx, [...enrichments.keys()]);
  const existingEnrichmentLinks = await loadExistingEnrichmentLinks(ctx, [...enrichments.keys()]);
  const statements: Stmt[] = [];
  const inserted = {
    api_key: 0,
    workspace: 0,
    membership: 0,
    project: 0,
    observation: 0,
    enrichment: 0,
    enrichment_commit: 0,
    enrichment_link: 0,
    claim: 0,
    claim_source: 0,
  };

  for (const row of keys.values()) {
    const existing = existingKeys.get(row.id as string);
    const shape = (value: Record<string, unknown>): Prepared => ({
      id: value.id,
      principal_id: value.principal_id,
      principal_kind: value.principal_kind,
      key_hash: value.key_hash,
      label: value.label,
      scopes: value.scopes,
      max_trust: value.max_trust,
      created_at: value.created_at,
      not_before: value.not_before,
      expires_at: value.expires_at,
    });
    if (existing) {
      const immutable = { ...row };
      delete immutable.last_used_at;
      delete immutable.revoked_at;
      assertSame("credential", shape(existing), immutable);
      statements.push({
        sql: `UPDATE api_keys
                 SET last_used_at = CASE
                       WHEN ? IS NOT NULL AND (last_used_at IS NULL OR last_used_at < ?) THEN ?
                       ELSE last_used_at
                     END,
                     revoked_at = COALESCE(revoked_at, ?)
               WHERE id = ? AND org_id = ?`,
        params: [
          row.last_used_at, row.last_used_at, row.last_used_at,
          row.revoked_at, row.id, principal.orgId,
        ],
      });
      continue;
    }
    inserted.api_key += 1;
    statements.push({
      sql: `INSERT INTO api_keys
              (id, org_id, principal_id, principal_kind, key_hash, label, scopes, max_trust,
               created_at, not_before, expires_at, last_used_at, revoked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.id, principal.orgId, row.principal_id, row.principal_kind, row.key_hash,
        row.label, row.scopes, row.max_trust, row.created_at, row.not_before,
        row.expires_at, row.last_used_at, row.revoked_at,
      ],
    });
  }

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
    statements.push(await importHistory(
      principal.orgId, "observation", row.id as string, principal.principalId, at,
    ));
    if (ctx.app.vectors)
      statements.push(outboxStatement(
        principal.orgId, "observation", row.id as string, redacted ? "delete" : "upsert", at,
      ));
    statements.push(eventStatement(
      principal.orgId, "observation.imported", principal.principalId, "observation", row.id as string, {}, at,
    ));
  }
  for (const row of enrichments.values()) {
    const existing = existingEnrichments.get(row.id as string);
    if (existing) {
      assertSame("enrichment", enrichmentShape(existing), withoutEnrichmentGraph(row));
      assertSame("enrichment commit", existingEnrichmentCommits.get(row.id as string), row.commit);
      assertSame("enrichment links", existingEnrichmentLinks.get(row.id as string) ?? [], row.links);
      continue;
    }
    inserted.enrichment += 1;
    inserted.enrichment_commit += 1;
    inserted.enrichment_link += row.links.length;
    statements.push({
      sql: `INSERT INTO enrichment_jobs
              (id, org_id, lane, derivation_key, input_ids, input_hash,
               subject_id, project_id, workspace_id, actor_id, model_id,
               model_fingerprint, prompt_fingerprint, schema_fingerprint,
               policy_fingerprint, state, attempts, max_attempts,
               next_attempt_at, lease_token, lease_expires_at, error_class,
               output_hash, result_ids, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'leased', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      params: [
        row.id,
        principal.orgId,
        row.lane,
        row.derivation_key,
        JSON.stringify(row.input_ids),
        row.input_hash,
        row.subject_id,
        row.project_id,
        row.workspace_id,
        row.actor_id,
        row.model_id,
        row.model_fingerprint,
        row.prompt_fingerprint,
        row.schema_fingerprint,
        row.policy_fingerprint,
        row.attempts,
        row.max_attempts,
        row.next_attempt_at,
        row.commit.lease_token,
        "9999-12-31T23:59:59.999Z",
        row.output_hash,
        JSON.stringify(row.result_ids),
        row.created_at,
        row.updated_at,
      ],
    });
    statements.push({
      sql: `INSERT INTO enrichment_commits
              (job_id, lease_token, result_kind, committed_at)
            VALUES (?, ?, ?, ?)`,
      params: [row.id, row.commit.lease_token, row.commit.result_kind, row.commit.committed_at],
    });
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
    if (indexable) statements.push(purgedEvidenceGuardStatement(
      principal.orgId,
      row.id as string,
      row.sources.map((source) => source.observation_id),
      at,
    ));
    statements.push({
      sql: `INSERT INTO claims
              (id, org_id, subject_id, project_id, workspace_id, observer_id, actor_id, kind, statement,
               confidence, trust, visibility, status, version, valid_from, valid_to, created_at,
               enrichment_job_id, enrichment_key, enrichment_key_archived)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: claimValues(principal.orgId, row),
    });
    if (indexable) statements.push({
      sql: `INSERT INTO claims_fts
              (statement, claim_id, org_scope, subject_scope)
            VALUES (?, ?, lower(hex(?)) || '0', lower(hex(?)) || '0')`,
      params: [row.statement, row.id, principal.orgId, row.subject_id],
    });
    statements.push(await importHistory(
      principal.orgId, "claim", row.id as string, principal.principalId, at,
    ));
    if (ctx.app.vectors)
      statements.push(outboxStatement(
        principal.orgId, "claim", row.id as string, indexable ? "upsert" : "delete", at,
      ));
    statements.push(eventStatement(
      principal.orgId, "claim.imported", principal.principalId, "claim", row.id as string, {}, at,
    ));
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
  for (const row of enrichments.values()) {
    if (existingEnrichments.has(row.id as string)) continue;
    for (const link of row.links) statements.push({
      sql: `INSERT INTO claim_links
              (id, org_id, source_claim_id, target_claim_id, relation, job_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        link.id,
        principal.orgId,
        link.source_claim_id,
        link.target_claim_id,
        link.relation,
        row.id,
        link.created_at,
      ],
    });
    statements.push({
      sql: `UPDATE enrichment_jobs
               SET state = 'done', lease_token = NULL, lease_expires_at = NULL,
                   error_class = NULL, updated_at = ?
             WHERE id = ? AND org_id = ? AND state = 'leased' AND lease_token = ?`,
      params: [row.updated_at, row.id, principal.orgId, row.commit.lease_token],
    });
  }
  if (keys.size || actorMappings.size || workspaces.size || memberships.size) statements.push(auditStatement(
    principal.orgId,
    principal.principalId,
    "portability.import",
    "import",
    at,
    null,
    JSON.stringify({
      workspaces: workspaces.size,
      keys: keys.size,
      memberships: memberships.size,
      projects: projects.size,
      observations: observations.size,
      enrichments: enrichments.size,
      claims: claims.size,
    }),
  ));
  statements.push(auditStatement(
    principal.orgId, principal.principalId, "records.import", "import", at,
  ));
  try {
    await ctx.app.db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw conflict("Import collided with a concurrent write; retry after exporting current state.");
    throw error;
  }
  const received = {
    api_key: keys.size,
    workspace: workspaces.size,
    membership: memberships.size,
    project: projects.size,
    observation: observations.size,
    enrichment: enrichments.size,
    enrichment_commit: enrichments.size,
    enrichment_link: [...enrichments.values()].reduce((sum, row) => sum + row.links.length, 0),
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
  sourceRow: Record<string, unknown> = entry.row,
): string {
  if (entry.formatVersion === 1) return importer;
  const sourceActor = requireString(sourceRow, field, LIMITS.identifier);
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

async function loadExistingEnrichmentCommits(
  ctx: RequestContext,
  ids: string[],
): Promise<Map<string, EnrichmentCommit>> {
  const result = new Map<string, EnrichmentCommit>();
  for (const group of chunk(ids, MAX_BOUND_PARAMS - 1)) {
    if (!group.length) continue;
    const rows = await ctx.app.db.all<EnrichmentCommit>(
      `SELECT c.job_id, c.lease_token, c.result_kind, c.committed_at
         FROM enrichment_commits c JOIN enrichment_jobs j ON j.id = c.job_id
        WHERE j.org_id = ? AND c.job_id IN (${group.map(() => "?").join(", ")})
        ORDER BY c.job_id`,
      [ctx.principal!.orgId, ...group],
    );
    for (const row of rows) result.set(row.job_id, row);
  }
  return result;
}

async function loadExistingEnrichmentLinks(
  ctx: RequestContext,
  ids: string[],
): Promise<Map<string, EnrichmentLink[]>> {
  const result = new Map<string, EnrichmentLink[]>();
  for (const group of chunk(ids, MAX_BOUND_PARAMS - 1)) {
    if (!group.length) continue;
    const rows = await ctx.app.db.all<EnrichmentLink>(
      `SELECT l.id, l.source_claim_id, l.target_claim_id, l.relation, l.job_id, l.created_at
         FROM claim_links l JOIN enrichment_jobs j ON j.id = l.job_id
        WHERE j.org_id = ? AND l.job_id IN (${group.map(() => "?").join(", ")})
        ORDER BY l.job_id, l.id`,
      [ctx.principal!.orgId, ...group],
    );
    for (const row of rows) {
      const list = result.get(row.job_id) ?? [];
      list.push(row);
      result.set(row.job_id, list);
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
  const membershipRefs = [...memberships.values()].map((row) => row.workspace_id)
    .filter((id): id is string => typeof id === "string");
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
  const stored = await loadAuthorizedPortableRecords(ctx, "claims", [...new Set(refs)]);
  if (refs.some((id) => !stored.has(id)))
    throw unresolvedReference({ record_type: "claim", field: "superseded_by", dependency_type: "claim" });

  for (const claim of claims.values()) {
    const replacementId = claim.superseded_by as string | null;
    if ((claim.status === "superseded") !== Boolean(replacementId))
      throw validationError("A superseded claim must name exactly one replacement.");
    if (!replacementId) continue;
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
      `SELECT o.id, o.subject_id, o.project_id, o.workspace_id, o.content, o.content_hash, o.trust, o.visibility
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
    if ((claim.status === "active" || claim.status === "disputed") && sources.some(({ row }) =>
      typeof row.content === "string" && typeof row.content_hash === "string"
      && isRedactedObservation(row.content, row.content_hash)))
      throw validationError("A current claim cannot use redacted evidence.");
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

async function loadAuthorizedPortableRecords(
  ctx: RequestContext,
  table: "observations" | "claims",
  ids: string[],
): Promise<Map<string, Prepared>> {
  const result = new Map<string, Prepared>();
  const administrative = hasScope(ctx.principal!, "keys:manage");
  const alias = table === "observations" ? "o" : "c";
  for (const group of chunk([...new Set(ids)], MAX_BOUND_PARAMS - 3)) {
    if (!group.length) continue;
    const rows = await ctx.app.db.all<Record<string, unknown>>(
      `SELECT ${alias}.* FROM ${table} ${alias}
        WHERE ${alias}.org_id = ? AND ${alias}.id IN (${group.map(() => "?").join(", ")})
          AND ${administrative ? "1 = 1" : recordAccessSql(alias)}`,
      administrative
        ? [ctx.principal!.orgId, ...group]
        : [ctx.principal!.orgId, ...group, ...recordAccessParams(ctx.principal!.principalId)],
    );
    for (const row of rows) result.set(String(row.id), row);
  }
  return result;
}

async function assertEnrichmentGraph(
  ctx: RequestContext,
  observations: Map<string, Prepared>,
  claims: Map<string, PreparedClaim>,
  memberships: Map<string, Prepared>,
  enrichments: Map<string, PreparedEnrichment>,
): Promise<void> {
  const observationRefs = [...enrichments.values()]
    .filter((job) => job.lane === "derivation")
    .map((job) => job.input_ids[0]!.id);
  const claimRefs = [...enrichments.values()].flatMap((job) => [
    ...(job.lane === "reflection" ? job.input_ids.map(({ id }) => id) : []),
    ...(job.commit.result_kind === "link" ? [] : job.result_ids),
    ...job.links.flatMap((link) => [link.source_claim_id, link.target_claim_id]),
  ]);
  const storedObservations = await loadAuthorizedPortableRecords(
    ctx,
    "observations",
    observationRefs.filter((id) => !observations.has(id)),
  );
  const storedClaims = await loadAuthorizedPortableRecords(
    ctx,
    "claims",
    claimRefs.filter((id) => !claims.has(id)),
  );
  const observation = (id: string) => observations.get(id) ?? storedObservations.get(id);
  const claim = (id: string) => claims.get(id) ?? storedClaims.get(id);
  if (observationRefs.some((id) => !observation(id)))
    throw unresolvedReference({ record_type: "enrichment", field: "input_ids", dependency_type: "observation" });
  if (claimRefs.some((id) => !claim(id)))
    throw unresolvedReference({ record_type: "enrichment", field: "claim_reference", dependency_type: "claim" });

  const premiseJobIds = [...new Set([...enrichments.values()]
    .filter((job) => job.lane === "reflection")
    .flatMap((job) => job.input_ids)
    .map(({ id }) => claim(id)?.enrichment_job_id)
    .filter((id): id is string => typeof id === "string"))];
  if (premiseJobIds.some((id) => enrichments.get(id)?.lane === "reflection"))
    throw validationError("Reflection provenance cannot use a reflection-generated premise.");
  const storedPremiseJobs = premiseJobIds.filter((id) => !enrichments.has(id));
  for (const group of chunk(storedPremiseJobs, MAX_BOUND_PARAMS - 1)) {
    if (!group.length) continue;
    const nested = await ctx.app.db.all<{ id: string }>(
      `SELECT id FROM enrichment_jobs
        WHERE org_id = ? AND lane = 'reflection'
          AND id IN (${group.map(() => "?").join(", ")}) LIMIT 1`,
      [ctx.principal!.orgId, ...group],
    );
    if (nested.length)
      throw validationError("Reflection provenance cannot use a reflection-generated premise.");
  }

  const linkIds = new Set<string>();
  for (const job of enrichments.values()) for (const link of job.links) {
    if (linkIds.has(link.id)) throw conflict("Import contains a duplicate enrichment link id.");
    linkIds.add(link.id);
  }
  for (const group of chunk([...linkIds], MAX_BOUND_PARAMS - 1)) {
    if (!group.length) continue;
    const foreign = await ctx.app.db.all<{ id: string }>(
      `SELECT link.id FROM claim_links link
        JOIN enrichment_jobs job ON job.id = link.job_id
       WHERE job.org_id <> ? AND link.id IN (${group.map(() => "?").join(", ")})`,
      [ctx.principal!.orgId, ...group],
    );
    if (foreign.length) throw conflict("An imported record id already exists outside this organization.");
  }

  const importedWriter = (workspaceId: string, actorId: string) => [...memberships.values()].some(
    (membership) => membership.workspace_id === workspaceId
      && membership.principal_id === actorId
      && membership.role !== "reader",
  );
  const premiseSources = new Map<string, string[]>();
  const reflectionPremiseIds = [...new Set([...enrichments.values()]
    .filter((job) => job.lane === "reflection")
    .flatMap((job) => job.input_ids.map(({ id }) => id)))];
  for (const id of reflectionPremiseIds) {
    const imported = claims.get(id);
    if (imported) premiseSources.set(id, imported.sources
      .filter(({ relation }) => relation === "supports")
      .map(({ observation_id }) => observation_id));
  }
  for (const group of chunk(
    reflectionPremiseIds.filter((id) => !premiseSources.has(id)),
    MAX_BOUND_PARAMS - 1,
  )) {
    if (!group.length) continue;
    const rows = await ctx.app.db.all<{ claim_id: string; observation_id: string }>(
      `SELECT source.claim_id, source.observation_id FROM claim_sources source
        JOIN claims premise ON premise.id = source.claim_id
       WHERE premise.org_id = ? AND source.relation = 'supports'
         AND source.claim_id IN (${group.map(() => "?").join(", ")})
       ORDER BY source.claim_id, source.observation_id`,
      [ctx.principal!.orgId, ...group],
    );
    for (const row of rows) {
      const ids = premiseSources.get(row.claim_id) ?? [];
      ids.push(row.observation_id);
      premiseSources.set(row.claim_id, ids);
    }
    for (const id of group) if (!premiseSources.has(id)) premiseSources.set(id, []);
  }
  for (const job of enrichments.values()) {
    if (job.workspace_id && !importedWriter(job.workspace_id as string, job.actor_id as string)) {
      const writer = await ctx.app.db.all<{ id: string }>(
        `SELECT id FROM memberships
          WHERE org_id = ? AND workspace_id = ? AND principal_id = ?
            AND removed_at IS NULL AND role != 'reader' LIMIT 1`,
        [ctx.principal!.orgId, job.workspace_id, job.actor_id],
      );
      if (!writer.length)
        throw unresolvedReference({ record_type: "enrichment", field: "actor_id", dependency_type: "writer_membership" });
    }
    const inputs = job.lane === "derivation"
      ? [observation(job.input_ids[0]!.id)!]
      : job.input_ids.map(({ id }) => claim(id)!);
    const result = job.commit.result_kind === "link"
      ? undefined
      : claim(job.result_ids[0]!)!;
    const historicalReflectionAdd = job.lane === "reflection"
      && job.commit.result_kind === "add"
      && result !== undefined
      && !["active", "disputed"].includes(String(result.status));
    let historicalReflectionSnapshot = false;
    for (const input of inputs) if (
      input.subject_id !== job.subject_id
      || input.project_id !== job.project_id
      || input.workspace_id !== job.workspace_id
    ) throw validationError("Imported enrichment inputs must match the job domain.");
    if (job.lane === "derivation") {
      if (
        inputs[0]!.content_hash !== job.input_ids[0]!.content_hash
        || inputs[0]!.actor_id !== job.actor_id
      ) throw validationError("Imported derivation input does not match its immutable snapshot.");
    } else {
      for (let index = 0; index < inputs.length; index += 1) {
        const currentVersion = Number(inputs[index]!.version);
        const committedVersion = Number(job.input_ids[index]!.version);
        if (currentVersion === committedVersion) continue;
        const historicalInput = !["active", "disputed"].includes(String(inputs[index]!.status));
        if (
          currentVersion < committedVersion
          || !historicalInput
          || (job.commit.result_kind !== "link" && !historicalReflectionAdd)
        )
          throw validationError("Imported reflection input must match its current exact version.");
        historicalReflectionSnapshot = true;
      }
    }
    if (job.commit.result_kind === "link") {
      const inputIds = new Set(job.input_ids.map(({ id }) => id));
      if (job.links.some((link) =>
        !inputIds.has(link.source_claim_id) || !inputIds.has(link.target_claim_id)))
        throw validationError("Imported LINK endpoints must be exact reflection premises.");
      continue;
    }
    // A revoked/expired/superseded reflection result may retain an older exact
    // premise snapshot after lifecycle propagation increments those premises.
    // It stays non-current and is never rebuilt into FTS/vector projections.
    const semanticResult = result!;
    if (
      semanticResult.subject_id !== job.subject_id
      || semanticResult.project_id !== job.project_id
      || semanticResult.workspace_id !== job.workspace_id
    ) throw validationError("Imported enrichment result must match the job domain.");
    if (job.commit.result_kind === "add") {
      const expectedVisibility = job.lane === "derivation"
        ? inputs[0]!.visibility
        : inputs.reduce<Visibility>((narrowest, input) =>
            ({ private: 0, team: 1, organization: 2 }[input.visibility as Visibility]
              < { private: 0, team: 1, organization: 2 }[narrowest]
              ? input.visibility as Visibility
              : narrowest), "organization");
      if (
        semanticResult.enrichment_job_id !== job.id
        || semanticResult.actor_id !== job.actor_id
        || semanticResult.trust !== "unverified"
        || semanticResult.visibility !== expectedVisibility
        || Number(semanticResult.confidence) !== 0.5
        || semanticResult.observer_id !== null
      ) throw validationError("Imported ADD result does not match its immutable job policy.");
      const portableResult = claims.get(String(semanticResult.id));
      if (!portableResult || portableResult.created_at !== job.commit.committed_at)
        throw validationError("Imported ADD result must be created by its commit.");
      const currentResult = semanticResult.status === "active" || semanticResult.status === "disputed";
      const expectedEnrichmentKey = job.lane === "derivation" && currentResult
        ? await derivationClaimKey({
            subjectId: String(job.subject_id),
            projectId: job.project_id as string | null,
            workspaceId: job.workspace_id as string | null,
            visibility: semanticResult.visibility as Visibility,
            kind: String(semanticResult.kind),
            statement: String(semanticResult.statement),
            validFrom: String(semanticResult.valid_from),
            validTo: semanticResult.valid_to as string | null,
          })
        : null;
      const keyArchived = Number(semanticResult.enrichment_key_archived);
      const expectedCurrentKey = expectedEnrichmentKey && keyArchived === 1
        ? await derivationOverflowClaimKey(expectedEnrichmentKey, String(semanticResult.id))
        : expectedEnrichmentKey;
      const keyValid = job.lane === "reflection"
        ? semanticResult.enrichment_key === null && keyArchived === 0
        : currentResult
          ? semanticResult.enrichment_key === expectedCurrentKey
            && keyArchived === (portableResult.sources.length >= LIMITS.sourcesPerClaim ? 1 : 0)
          : typeof semanticResult.enrichment_key === "string"
            && (keyArchived === 0
              || (keyArchived === 1
                && portableResult.sources.length >= LIMITS.sourcesPerClaim));
      if (!keyValid)
        throw validationError("Imported ADD result enrichment_key is invalid.");
      if (job.lane === "reflection") {
        const premiseIds = new Set(job.input_ids.map(({ id }) => id));
        const targets = job.links.map(({ target_claim_id }) => target_claim_id);
        if (
          !targets.length
          || new Set(targets).size !== targets.length
          || job.links.some((link) =>
            link.source_claim_id !== semanticResult.id || !premiseIds.has(link.target_claim_id))
        ) throw validationError("Imported derived_from links must cite exact reflection premises.");
      }
      const expectedSources = new Map<string, string>();
      if (job.lane === "derivation") {
        expectedSources.set(job.input_ids[0]!.id, job.commit.committed_at);
      } else {
        for (const premiseId of job.links.map(({ target_claim_id }) => target_claim_id))
          for (const observationId of premiseSources.get(premiseId) ?? [])
            expectedSources.set(observationId, job.commit.committed_at);
      }
      for (const reuse of enrichments.values()) if (
        reuse.commit.result_kind === "reuse" && reuse.result_ids[0] === semanticResult.id
      ) {
        const observationId = reuse.input_ids[0]!.id;
        if (expectedSources.has(observationId))
          throw validationError("Imported enrichment provenance repeats supporting evidence.");
        expectedSources.set(observationId, reuse.commit.committed_at);
      }
      if (portableResult.sources.length !== expectedSources.size
        || portableResult.sources.some((source) => source.relation !== "supports"
          || expectedSources.get(source.observation_id) !== source.created_at))
        throw validationError("Imported ADD sources do not match cited enrichment evidence.");
      const supportedBounds = job.lane === "derivation"
        ? supportedObservationTemporalBounds(
            String(inputs[0]!.content),
            inputs[0]!.occurred_at as string | null,
            String(inputs[0]!.ingested_at),
          )
        : new Set(job.links.flatMap(({ target_claim_id }) => {
            const premise = claim(target_claim_id)!;
            return [String(premise.valid_from), premise.valid_to as string | null]
              .filter((value): value is string => typeof value === "string");
          }));
      const purgedDerivationInput = job.lane === "derivation"
        && typeof inputs[0]!.content === "string"
        && typeof inputs[0]!.content_hash === "string"
        && isRedactedObservation(String(inputs[0]!.content), String(inputs[0]!.content_hash));
      if (!purgedDerivationInput && !historicalReflectionSnapshot && (
        !supportedBounds.has(String(semanticResult.valid_from))
        || (semanticResult.status !== "expired" && semanticResult.valid_to !== null
          && !supportedBounds.has(String(semanticResult.valid_to)))
      ))
        throw validationError("Imported ADD temporal bounds are not supported by cited evidence.");
    } else {
      const sources = (semanticResult.sources as Source[] | undefined) ?? [];
      if (
        semanticResult.enrichment_job_id === job.id
        || !sources.some((source) =>
          source.observation_id === job.input_ids[0]!.id && source.relation === "supports")
      ) throw validationError("Imported REUSE provenance does not match the appended source.");
    }
    if ((semanticResult.status === "active" || semanticResult.status === "disputed") && inputs.some((input) =>
      job.lane === "reflection"
        ? !["active", "disputed"].includes(String(input.status))
        : typeof input.content === "string" && typeof input.content_hash === "string"
          && isRedactedObservation(input.content, input.content_hash)))
      throw validationError("A current generated claim cannot depend on non-current evidence.");
  }

  for (const row of claims.values()) {
    const primaryId = row.enrichment_job_id as string | null;
    const primary = primaryId ? enrichments.get(primaryId) : undefined;
    if (primaryId && (
      !primary
      || primary.commit.result_kind !== "add"
      || primary.result_ids[0] !== row.id
    )) throw validationError("Imported generated claim provenance is incomplete.");
    for (const job of row.enrichments) {
      if (job.commit.result_kind === "add" && job.id !== primaryId)
        throw validationError("An ADD bundle must be owned by its generated claim.");
      if (job.commit.result_kind === "reuse" && job.result_ids[0] !== row.id)
        throw validationError("A REUSE bundle must be owned by its reused claim.");
      if (job.commit.result_kind === "link") {
        const owner = job.links.flatMap((link) => [link.source_claim_id, link.target_claim_id]).sort().at(-1);
        if (owner !== row.id)
          throw validationError("A LINK bundle must be attached to its deterministic owner claim.");
      }
    }
  }
}

function assertSame(label: string, existing: unknown, incoming: unknown): void {
  if (canonical(existing) !== canonical(incoming)) throw conflict(`Imported ${label} id already exists with different content.`);
}

const workspaceShape = (row: Record<string, unknown>): Prepared => ({
  id: String(row.id), name: String(row.name), created_at: String(row.created_at),
});
const membershipShape = (row: Record<string, unknown>): Prepared => ({
  id: String(row.id), workspace_id: row.workspace_id as string | null, principal_id: String(row.principal_id),
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
  enrichment_job_id: row.enrichment_job_id as string | null,
  enrichment_key: row.enrichment_key as string | null,
  enrichment_key_archived: Number(row.enrichment_key_archived),
});
const withoutSources = (row: PreparedClaim): Prepared => Object.fromEntries(
  Object.entries(row).filter(([key]) => key !== "sources" && key !== "enrichments"),
);
const withoutEnrichmentGraph = (row: PreparedEnrichment): Prepared => Object.fromEntries(
  Object.entries(row).filter(([key]) => key !== "commit" && key !== "links"),
);
const enrichmentShape = (row: Record<string, unknown>): Prepared => ({
  id: String(row.id),
  lane: String(row.lane),
  derivation_key: row.derivation_key as string | null,
  input_ids: JSON.parse(String(row.input_ids)),
  input_hash: String(row.input_hash),
  subject_id: String(row.subject_id),
  project_id: row.project_id as string | null,
  workspace_id: row.workspace_id as string | null,
  actor_id: String(row.actor_id),
  model_id: String(row.model_id),
  model_fingerprint: String(row.model_fingerprint),
  prompt_fingerprint: String(row.prompt_fingerprint),
  schema_fingerprint: String(row.schema_fingerprint),
  policy_fingerprint: String(row.policy_fingerprint),
  state: String(row.state),
  attempts: Number(row.attempts),
  max_attempts: Number(row.max_attempts),
  next_attempt_at: String(row.next_attempt_at),
  error_class: row.error_class as string | null,
  output_hash: row.output_hash as string | null,
  result_ids: JSON.parse(String(row.result_ids)),
  created_at: String(row.created_at),
  updated_at: String(row.updated_at),
});
const observationValues = (orgId: string, row: Prepared) => [row.id, orgId, row.subject_id, row.project_id, row.workspace_id, row.agent_id, row.run_id, row.actor_id, row.kind, row.content, row.content_hash, row.source_type, row.source_ref, row.trust, row.visibility, row.occurred_at, row.ingested_at] as (string | number | null)[];
const claimValues = (orgId: string, row: PreparedClaim) => [row.id, orgId, row.subject_id, row.project_id, row.workspace_id, row.observer_id, row.actor_id, row.kind, row.statement, row.confidence, row.trust, row.visibility, row.status, row.version, row.valid_from, row.valid_to, row.created_at, row.enrichment_job_id, row.enrichment_key, row.enrichment_key_archived] as (string | number | null)[];

async function assertNoForeignIds(
  ctx: RequestContext,
  orgId: string,
  byType: Record<string, Prepared[]>,
): Promise<void> {
  const tables: [string, string][] = [
    ["workspace", "workspaces"], ["membership", "memberships"], ["project", "projects"],
    ["observation", "observations"], ["claim", "claims"], ["enrichment", "enrichment_jobs"],
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

// --- @modelcontextprotocol/server-memory store ---

/**
 * The reference MCP memory server keeps its whole state in one file of
 * newline-delimited JSON, one `{"type":"entity"|"relation", ...}` object per
 * line. It is named `memory.jsonl` today and was named `memory.json` before
 * 0.6.3, which renames the old file in place; both carry this same format.
 *
 * Parsing is here rather than in a runtime adapter because it is pure string
 * work with no filesystem, and because `titen audit` reads the same files.
 */
export interface ReferenceEntity { name: string; entityType: string; observations: string[] }
export interface ReferenceRelation { from: string; to: string; relationType: string }
export interface ReferenceGraph { entities: ReferenceEntity[]; relations: ReferenceRelation[] }

function referenceText(row: Record<string, unknown>, field: string, line: number): string {
  const value = row[field];
  if (typeof value !== "string" || value === "")
    throw validationError(`Line ${line} of the memory store needs a non-empty "${field}".`);
  return value;
}

/**
 * Mirrors that server's own loader: lines it does not recognize are not part of
 * the graph. A line it *would* have accepted but that is malformed throws
 * instead of being dropped, because an import that silently loses records is
 * worse than one that refuses.
 */
export function parseReferenceGraph(text: string): ReferenceGraph {
  const graph: ReferenceGraph = { entities: [], relations: [] };
  for (const [index, raw] of text.split("\n").entries()) {
    const line = index + 1;
    if (!raw.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw validationError(`Line ${line} of the memory store is not valid JSON.`);
    }
    if (!isRecord(parsed)) continue;
    if (parsed.type === "entity") {
      const observations = parsed.observations ?? [];
      if (!Array.isArray(observations))
        throw validationError(`Line ${line} of the memory store has non-array "observations".`);
      graph.entities.push({
        name: referenceText(parsed, "name", line),
        entityType: referenceText(parsed, "entityType", line),
        observations: observations.map((observation, position) => {
          if (typeof observation !== "string" || observation === "")
            throw validationError(`Line ${line} observation ${position + 1} is not a non-empty string.`);
          return observation;
        }),
      });
    } else if (parsed.type === "relation") {
      graph.relations.push({
        from: referenceText(parsed, "from", line),
        to: referenceText(parsed, "to", line),
        relationType: referenceText(parsed, "relationType", line),
      });
    }
  }
  return graph;
}
