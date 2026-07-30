import { assertTrustCeiling, type Principal } from "./auth";
import type { Db, Stmt } from "./db";
import { notFound, validationError } from "./errors";
import { eventStatement } from "./events";
import { newId, sha256Hex } from "./ids";
import { commitIdempotent, idempotencyKey } from "./idempotency";
import { historyStatement, outboxStatement } from "./observations";
import { requireProject } from "./projects";
import {
  authorizeRecordWorkspace,
  recordAccessParams,
  recordAccessSql,
} from "./authorization";
import type { RequestContext, Result } from "./http";
import {
  CLAIM_KINDS,
  CLAIM_RELATIONS,
  LIMITS,
  TRUST_LEVELS,
  TRUST_RANK,
  VISIBILITIES,
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
}

interface SourceRow {
  id: string;
  subject_id: string;
  project_id: string | null;
  workspace_id: string | null;
  trust: Trust;
  visibility: Visibility;
  actor_id: string;
}

function parseSources(value: unknown): SourceInput[] {
  if (!Array.isArray(value) || value.length === 0)
    throw validationError('Each claim needs a non-empty "sources" array.');
  if (value.length > LIMITS.sourcesPerClaim)
    throw validationError(`A claim may not exceed ${LIMITS.sourcesPerClaim} sources.`);
  return value.map((entry) => {
    if (!isRecord(entry)) throw validationError("Each claim source must be an object.");
    return {
      observationId: requireString(entry, "observation_id", LIMITS.identifier),
      relation: requireEnum(entry, "relation", CLAIM_RELATIONS),
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
    `SELECT o.id, o.subject_id, o.project_id, o.workspace_id, o.trust, o.visibility, o.actor_id
       FROM observations o
      WHERE o.org_id = ? AND o.id IN (${ids.map(() => "?").join(", ")})
        AND ${recordAccessSql("o")}`,
    [principal.orgId, ...ids, ...recordAccessParams(principal.principalId)],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw notFound();
  }
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
  const claims = body.claims;
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
  }[] = [];

  for (const entry of claims) {
    const claim = requireObject(entry);
    const kind = requireEnum(claim, "kind", CLAIM_KINDS);
    const statement = requireString(claim, "statement", LIMITS.statement);
    const confidenceValue = claim.confidence ?? 0.8;
    if (typeof confidenceValue !== "number" || !(confidenceValue > 0) || confidenceValue > 1)
      throw validationError('Field "confidence" must be greater than 0 and at most 1.');
    const sources = parseSources(claim.sources);
    const rows = await loadSources(ctx.app.db, principal, sources);
    for (const source of sources) {
      const row = rows.get(source.observationId)!;
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
    const trust = optionalEnum(claim, "trust", TRUST_LEVELS, evidenceTrust);
    if (TRUST_RANK[trust] > TRUST_RANK[evidenceTrust])
      throw validationError("Claim trust may not exceed the trust of its supporting evidence.");
    assertTrustCeiling(principal, trust);

    // Visibility never widens beyond the narrowest source it was derived from.
    const narrowest = sources.reduce<Visibility>((narrow, source) => {
      const candidate = rows.get(source.observationId)!.visibility;
      return VISIBILITY_RANK[candidate] < VISIBILITY_RANK[narrow] ? candidate : narrow;
    }, "organization");
    const visibility = optionalEnum(claim, "visibility", VISIBILITIES, narrowest);
    if (VISIBILITY_RANK[visibility] > VISIBILITY_RANK[narrowest])
      throw validationError("Claim visibility may not exceed the visibility of its evidence.");
    await authorizeRecordWorkspace(ctx.app.db, principal, workspaceId, visibility);

    const seen = new Set<string>();
    for (const source of sources) {
      const key = `${source.observationId}:${source.relation}`;
      if (seen.has(key)) throw validationError("Duplicate claim source relation in one claim.");
      seen.add(key);
    }

    prepared.push({
      id: newId("claim"),
      kind,
      statement,
      confidence: confidenceValue,
      trust,
      visibility,
      // Contradicting evidence is preserved as a dispute, never resolved here.
      status: sources.some((source) => source.relation === "contradicts") ? "disputed" : "active",
      observerId: optionalString(claim, "observer_id", LIMITS.identifier),
      validFrom: optionalTimestamp(claim, "valid_from") ?? ctx.app.now().toISOString(),
      validTo: optionalTimestamp(claim, "valid_to"),
      sources,
    });
  }

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
        statements.push({
          sql: `INSERT INTO claims
                  (id, org_id, subject_id, project_id, workspace_id, observer_id, actor_id, kind, statement,
                   confidence, trust, visibility, status, version, valid_from, valid_to, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
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
            at,
          ],
        });
        statements.push({
          sql: `INSERT INTO claims_fts (statement, claim_id) VALUES (?, ?)`,
          params: [claim.statement, claim.id],
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
        data: {
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
        },
        statements,
      };
    },
  );

  return {
    status: result.replayed ? 200 : result.status,
    data: result.data,
    meta: { replayed: result.replayed, model: "disabled" },
  };
}
