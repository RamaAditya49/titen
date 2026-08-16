import { assertTrustCeiling, type Principal } from "./auth";
import { first, type Db, type Stmt } from "./db";
import { notFound, validationError } from "./errors";
import { eventStatement } from "./events";
import { newId, sha256Hex } from "./ids";
import { canonicalJson, commitIdempotent, idempotencyKey } from "./idempotency";
import { isRedactedObservation } from "./observations";
import { historyStatement, outboxStatement, purgedEvidenceGuardStatement } from "./writes";
export { purgedEvidenceGuardStatement } from "./writes";
import { requireProject } from "./projects";
import {
  authorizeRecordWorkspace,
  authorizeRecordTarget,
  recordAccessParams,
  recordAccessSql,
} from "./authorization";
import type { RequestContext, Result } from "./http";
import {
  CLAIM_KINDS,
  CLAIM_RELATIONS,
  LIMITS,
  RECALLED_SOURCE_TYPE,
  TRUST_LEVELS,
  TRUST_RANK,
  VISIBILITIES,
  assertTimestampOrder,
  isRecord,
  optionalEnum,
  optionalString,
  optionalTimestamp,
  requireEnum,
  requireObject,
  requireString,
  type Trust,
  type Visibility,
} from "./validate";

export const ENDPOINT = "POST /v1/consolidations";

const VISIBILITY_RANK: Record<Visibility, number> = { private: 0, team: 1, organization: 2 };

interface SourceInput {
  observationId: string;
  relation: (typeof CLAIM_RELATIONS)[number];
  field: string;
}

interface SourceRow {
  id: string;
  subject_id: string;
  project_id: string | null;
  workspace_id: string | null;
  trust: Trust;
  visibility: Visibility;
  actor_id: string;
  content: string;
  content_hash: string;
  source_type: string;
}

interface ClaimReplayRow {
  id: string;
  kind: string;
  confidence: number;
  trust: Trust;
  visibility: Visibility;
  status: string;
  valid_from: string;
  valid_to: string | null;
}

function parseSources(value: unknown, path: string): SourceInput[] {
  if (value === undefined) throw validationError(`Field "${path}" is required.`);
  if (!Array.isArray(value) || value.length === 0)
    throw validationError(`Field "${path}" must be a non-empty array.`);
  if (value.length > LIMITS.sourcesPerClaim)
    throw validationError(`Field "${path}" may not exceed ${LIMITS.sourcesPerClaim} items.`);
  return value.map((entry, index) => {
    const sourcePath = `${path}[${index}]`;
    if (!isRecord(entry)) throw validationError(`Field "${sourcePath}" must be an object.`);
    return {
      observationId: requireString(entry, "observation_id", LIMITS.identifier, `${sourcePath}.observation_id`),
      relation: requireEnum(entry, "relation", CLAIM_RELATIONS, `${sourcePath}.relation`),
      field: `${sourcePath}.observation_id`,
    };
  });
}

/**
 * Loads every referenced observation inside the authenticated organization.
 * A record outside that scope, or a private record belonging to someone else,
 * is indistinguishable from a record that does not exist.
 */
async function loadSources(
  db: Db,
  principal: Principal,
  sources: SourceInput[],
): Promise<Map<string, SourceRow>> {
  const ids = [...new Set(sources.map((source) => source.observationId))];
  const rows = await db.all<SourceRow>(
    `SELECT o.id, o.subject_id, o.project_id, o.workspace_id, o.trust, o.visibility, o.actor_id,
            o.content, o.content_hash, o.source_type
       FROM observations o
      WHERE o.org_id = ? AND o.id IN (${ids.map(() => "?").join(", ")})
        AND ${recordAccessSql("o")}`,
    [principal.orgId, ...ids, ...recordAccessParams(principal)],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const source of sources)
    if (!byId.has(source.observationId)
      || isRedactedObservation(byId.get(source.observationId)!.content, byId.get(source.observationId)!.content_hash))
      throw notFound({ field: source.field });
  return byId;
}

export async function consolidate(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const raw = await ctx.rawBody();
  const body = requireObject(await ctx.json());
  const subjectId = requireString(body, "subject_id", LIMITS.identifier);
  const projectId = await requireProject(
    ctx.app.db,
    principal.orgId,
    optionalString(body, "project_id", LIMITS.identifier),
  );
  const workspaceId = optionalString(body, "workspace_id", LIMITS.identifier);
  await authorizeRecordTarget(ctx.app.db, principal, subjectId, projectId);
  const claims = body.claims;
  if (claims === undefined) throw validationError('Field "claims" is required.');
  if (!Array.isArray(claims) || claims.length === 0)
    throw validationError('Field "claims" must be a non-empty array.');
  if (claims.length > LIMITS.claimsPerConsolidation)
    throw validationError(`At most ${LIMITS.claimsPerConsolidation} claims per request.`);

  const prepared: {
    id: string;
    kind: string;
    statement: string;
    confidence: number;
    trust: Trust;
    visibility: Visibility;
    status: string;
    observerId: string | null;
    validFrom: string;
    validTo: string | null;
    sources: SourceInput[];
    canonicalHash: string;
    existing: boolean;
  }[] = [];

  for (const [index, entry] of claims.entries()) {
    const path = `claims[${index}]`;
    const claim = requireObject(entry, path);
    const kind = requireEnum(claim, "kind", CLAIM_KINDS, `${path}.kind`);
    const statement = requireString(claim, "statement", LIMITS.statement, `${path}.statement`);
    const confidenceValue = claim.confidence ?? 0.8;
    if (typeof confidenceValue !== "number" || !(confidenceValue > 0) || confidenceValue > 1)
      throw validationError(`Field "${path}.confidence" must be greater than 0 and at most 1.`);
    const sources = parseSources(claim.sources, `${path}.sources`);
    const rows = await loadSources(ctx.app.db, principal, sources);
    for (const source of sources) {
      const row = rows.get(source.observationId)!;
      // Closes the loop instead of labelling it: evidence Titen itself handed
      // back through a context pack may never be promoted into a new claim,
      // which is how one preference gets stored two hundred times (#280).
      if (row.source_type === RECALLED_SOURCE_TYPE)
        throw validationError(
          "Claim evidence may not be a recalled observation: consolidating context Titen issued would re-materialize its own output.",
        );
      if (
        row.subject_id !== subjectId
        || row.project_id !== projectId
        || row.workspace_id !== workspaceId
      ) throw validationError("Claim evidence must match the claim workspace, subject, and project.");
    }

    const supporting = sources.filter((source) => source.relation === "supports");
    if (supporting.length === 0)
      throw validationError("A claim needs at least one supporting source.");

    // A claim can never be more trusted than the evidence under it.
    const evidenceTrust = supporting.reduce<Trust>((highest, source) => {
      const candidate = rows.get(source.observationId)!.trust;
      return TRUST_RANK[candidate] > TRUST_RANK[highest] ? candidate : highest;
    }, "unverified");
    const trust = optionalEnum(claim, "trust", TRUST_LEVELS, evidenceTrust, `${path}.trust`);
    if (TRUST_RANK[trust] > TRUST_RANK[evidenceTrust])
      throw validationError("Claim trust may not exceed the trust of its supporting evidence.");
    assertTrustCeiling(principal, trust);
    if (trust === "policy_approved")
      throw validationError('Trust "policy_approved" is assigned only by the claim approval workflow.');

    // Visibility never widens beyond the narrowest source it was derived from.
    const narrowest = sources.reduce<Visibility>((narrow, source) => {
      const candidate = rows.get(source.observationId)!.visibility;
      return VISIBILITY_RANK[candidate] < VISIBILITY_RANK[narrow] ? candidate : narrow;
    }, "organization");
    const visibility = optionalEnum(claim, "visibility", VISIBILITIES, narrowest, `${path}.visibility`);
    if (VISIBILITY_RANK[visibility] > VISIBILITY_RANK[narrowest])
      throw validationError("Claim visibility may not exceed the visibility of its evidence.");
    await authorizeRecordWorkspace(ctx.app.db, principal, workspaceId, visibility);

    const seen = new Set<string>();
    for (const source of sources) {
      const key = `${source.observationId}:${source.relation}`;
      if (seen.has(key)) throw validationError("Duplicate claim source relation in one claim.");
      seen.add(key);
    }

    const requestedValidFrom = optionalTimestamp(claim, "valid_from", `${path}.valid_from`);
    const validFrom = requestedValidFrom ?? ctx.app.now().toISOString();
    const validTo = optionalTimestamp(claim, "valid_to", `${path}.valid_to`);
    assertTimestampOrder(validFrom, validTo, `${path}.valid_from`, `${path}.valid_to`);

    const observerId = optionalString(claim, "observer_id", LIMITS.identifier, `${path}.observer_id`);
    const canonicalHash = await sha256Hex(canonicalJson({
      actor_id: principal.principalId,
      subject_id: subjectId,
      project_id: projectId,
      workspace_id: workspaceId,
      kind,
      statement,
      confidence: confidenceValue,
      trust,
      visibility,
      observer_id: observerId,
      valid_from: requestedValidFrom,
      valid_to: validTo,
      position: index,
      sources: [...sources]
        .sort((left, right) => left.observationId.localeCompare(right.observationId)
          || left.relation.localeCompare(right.relation))
        .map(({ observationId, relation }) => ({ observation_id: observationId, relation })),
    }));
    const existing = await first<ClaimReplayRow>(ctx.app.db,
      `SELECT id, kind, confidence, trust, visibility, status, valid_from, valid_to FROM claims
        WHERE org_id = ? AND actor_id = ? AND canonical_hash = ? LIMIT 1`,
      [principal.orgId, principal.principalId, canonicalHash]);
    prepared.push({
      id: existing?.id ?? newId("claim"),
      kind: existing?.kind ?? kind,
      statement,
      confidence: existing?.confidence ?? confidenceValue,
      trust: existing?.trust ?? trust,
      visibility: existing?.visibility ?? visibility,
      // Contradicting evidence is preserved as a dispute, never resolved here.
      status: existing?.status
        ?? (sources.some((source) => source.relation === "contradicts") ? "disputed" : "active"),
      observerId,
      validFrom: existing?.valid_from ?? validFrom,
      validTo: existing?.valid_to ?? validTo,
      sources,
      canonicalHash,
      existing: Boolean(existing),
    });
  }

  const responseData = () => ({
    subject_id: subjectId,
    project_id: projectId,
    workspace_id: workspaceId,
    model_used: false,
    claims: prepared.map((claim) => ({
      claim_id: claim.id,
      kind: claim.kind,
      status: claim.status,
      trust: claim.trust,
      visibility: claim.visibility,
      confidence: claim.confidence,
      valid_from: claim.validFrom,
      valid_to: claim.validTo,
      evidence_ids: claim.sources.map((source) => source.observationId),
    })),
  });

  try {
    const result = await commitIdempotent(
      ctx.app.db,
      principal,
      ctx.request,
      idempotencyKey(ctx.request),
      raw,
      ctx.app.now(),
      async () => {
      const at = ctx.app.now().toISOString();
      const statements: Stmt[] = [];
      for (const claim of prepared) {
        if (claim.existing) continue;
        statements.push(purgedEvidenceGuardStatement(
          principal.orgId,
          claim.id,
          claim.sources.map((source) => source.observationId),
          at,
        ));
        statements.push({
          sql: `INSERT INTO claims
                  (id, org_id, subject_id, project_id, workspace_id, observer_id, actor_id, kind, statement,
                   confidence, trust, visibility, status, version, valid_from, valid_to,
                   canonical_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          params: [
            claim.id,
            principal.orgId,
            subjectId,
            projectId,
            workspaceId,
            claim.observerId,
            principal.principalId,
            claim.kind,
            claim.statement,
            claim.confidence,
            claim.trust,
            claim.visibility,
            claim.status,
            claim.validFrom,
            claim.validTo,
            claim.canonicalHash,
            at,
          ],
        });
        statements.push({
          sql: `INSERT INTO claims_fts
                  (statement, claim_id, org_scope, subject_scope)
                VALUES (?, ?, lower(hex(?)) || '0', lower(hex(?)) || '0')`,
          params: [claim.statement, claim.id, principal.orgId, subjectId],
        });
        for (const source of claim.sources)
          statements.push({
            sql: `INSERT INTO claim_sources (claim_id, observation_id, relation, created_at)
                  VALUES (?, ?, ?, ?)`,
            params: [claim.id, source.observationId, source.relation, at],
          });
        statements.push(
          historyStatement(
            principal.orgId,
            "claim",
            claim.id,
            1,
            "materialize",
            principal.principalId,
            await sha256Hex(`${claim.statement}|${claim.status}|${claim.trust}`),
            at,
          ),
        );
        if (ctx.app.vectors)
          statements.push(outboxStatement(principal.orgId, "claim", claim.id, "upsert", at));
        statements.push(
          eventStatement(
            principal.orgId,
            "claim.materialized",
            principal.principalId,
            "claim",
            claim.id,
            {
              subject_id: subjectId,
              workspace_id: workspaceId,
              kind: claim.kind,
              status: claim.status,
              trust: claim.trust,
              visibility: claim.visibility,
            },
            at,
          ),
        );
      }
      return {
        status: 201,
        data: responseData(),
        statements,
      };
      },
    );

    const canonicalReplay = prepared.every((claim) => claim.existing);
    return {
      status: result.replayed || canonicalReplay ? 200 : result.status,
      data: result.data,
      meta: {
        replayed: result.replayed || canonicalReplay,
        canonical_replays: prepared.filter((claim) => claim.existing).length,
        model: "disabled",
      },
    };
  } catch (error) {
    if (error instanceof Error && /UNIQUE.*canonical_hash/i.test(error.message)) {
      for (const claim of prepared) {
        const raced = await first<ClaimReplayRow>(ctx.app.db,
          `SELECT id, kind, confidence, trust, visibility, status, valid_from, valid_to FROM claims
            WHERE org_id = ? AND actor_id = ? AND canonical_hash = ? LIMIT 1`,
          [principal.orgId, principal.principalId, claim.canonicalHash]);
        if (!raced) throw error;
        claim.id = raced.id;
        claim.kind = raced.kind;
        claim.confidence = raced.confidence;
        claim.trust = raced.trust;
        claim.visibility = raced.visibility;
        claim.status = raced.status;
        claim.validFrom = raced.valid_from;
        claim.validTo = raced.valid_to;
        claim.existing = true;
      }
      return {
        status: 200,
        data: responseData(),
        meta: { replayed: true, canonical_replays: prepared.length, model: "disabled" },
      };
    }
    if (error instanceof Error && /FOREIGN KEY/i.test(error.message)) {
      for (const claim of prepared) {
        for (const source of claim.sources) {
          const purged = await first<{ found: number }>(
            ctx.app.db,
            `SELECT 1 AS found FROM record_history
              WHERE org_id = ? AND record_type = 'observation'
                AND record_id = ? AND change_kind = 'purge' LIMIT 1`,
            [principal.orgId, source.observationId],
          );
          if (purged) throw notFound({ field: source.field });
        }
      }
    }
    throw error;
  }
}
