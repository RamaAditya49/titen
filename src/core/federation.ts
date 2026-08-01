import { first, type Stmt } from "./db";
import { auditStatement } from "./audit";
import { assertTrustCeiling, requireScope } from "./auth";
import { recordAccessParams, recordAccessSql } from "./authorization";
import { notFound, validationError, conflict, forbidden, unavailable } from "./errors";
import { eventAccessParams, eventAccessSql, resolveEventCursor } from "./events";
import { newId, sha256Hex } from "./ids";
import { normalizeProjectReference } from "./projects";
import { historyStatement, outboxStatement } from "./writes";
import { signPayload } from "./webhooks";
import { MAX_BODY_BYTES, type RequestContext, type Result } from "./http";
import { requireOrgRole } from "./governance";
import {
  CLAIM_KINDS,
  CLAIM_RELATIONS,
  LIMITS,
  OBSERVATION_KINDS,
  TRUST_LEVELS,
  VISIBILITIES,
  assertTimestampOrder,
  optionalBoolean,
  optionalString,
  optionalTimestamp,
  requireEnum,
  requireObject,
  requireString,
  type Trust,
} from "./validate";

const DIRECTIONS = ["push", "pull", "bidirectional"] as const;
const TRUST_FILTERS = ["unverified", "asserted", "verified", "policy_approved"] as const;
const RESOURCE_TYPES = ["observation", "claim", "event"] as const;
const CLAIM_STATUSES = ["active", "disputed"] as const;
const FEDERATED_MEMORY_VERSION = 1;

// --- Peers ---

/** POST /v1/federation/peers */
export async function registerPeer(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "federation.peer.register");
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const name = requireString(body, "name", LIMITS.label);
  const endpoint = requireString(body, "endpoint", 2000);
  const sharedSecret = requireString(body, "shared_secret", 512);
  if (sharedSecret.length < 16)
    throw validationError('Field "shared_secret" must be at least 16 characters.');
  const direction = requireEnum(body, "direction", DIRECTIONS);

  const id = newId("fpeer");
  if (!ctx.app.secretCipher) throw unavailable("Signing-secret encryption is not configured.");
  const now = ctx.app.now().toISOString();
  const hash = await sha256Hex(sharedSecret);
  const encrypted = await ctx.app.secretCipher.encrypt(sharedSecret, `federation:${id}`);

  await ctx.app.db.batch([
    {
      sql: `INSERT INTO federation_peers (id, org_id, principal_id, name, endpoint, shared_secret_hash, shared_secret, direction, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      params: [id, principal.orgId, principal.principalId, name, endpoint, hash, encrypted, direction, now],
    },
    auditStatement(
      principal.orgId, principal.principalId, "federation.peer.register", "federation_peer", now, id,
    ),
  ]);

  return { status: 201, data: { peer_id: id, name, endpoint, direction, status: "active", created_at: now } };
}

/** GET /v1/federation/peers */
export async function listPeers(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin", "reader"], "federation.peer.list");
  const principal = ctx.principal!;
  const rows = await ctx.app.db.all<{
    id: string;
    name: string;
    endpoint: string;
    direction: string;
    status: string;
    last_cursor: string | null;
    last_sync_at: string | null;
    source_org_id: string | null;
    created_at: string;
  }>(
    `SELECT id, name, endpoint, direction, status, last_cursor, last_sync_at, source_org_id, created_at
       FROM federation_peers WHERE org_id = ? AND principal_id = ? ORDER BY created_at DESC, id DESC LIMIT 500`,
    [principal.orgId, principal.principalId],
  );
  return { data: { peers: rows.map((r) => ({ peer_id: r.id, ...r, id: undefined })) } };
}

/** POST /v1/federation/peers/:id/suspend */
export async function suspendPeer(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "federation.peer.suspend");
  const principal = ctx.principal!;
  const peerId = ctx.params.id!;

  const peer = await first<{ id: string; status: string }>(
    ctx.app.db,
    `SELECT id, status FROM federation_peers WHERE id = ? AND org_id = ? AND principal_id = ?`,
    [peerId, principal.orgId, principal.principalId],
  );
  if (!peer) throw notFound();
  if (peer.status === "revoked") throw forbidden("Cannot suspend a revoked peer.");

  await ctx.app.db.batch([
    {
      sql: `UPDATE federation_peers SET status = 'suspended' WHERE id = ? AND org_id = ? AND principal_id = ?`,
      params: [peerId, principal.orgId, principal.principalId],
    },
    auditStatement(
      principal.orgId, principal.principalId, "federation.peer.suspend", "federation_peer",
      ctx.app.now().toISOString(), peerId,
    ),
  ]);

  return { data: { id: peerId, status: "suspended" } };
}

// --- Filters ---

/** POST /v1/federation/peers/:id/filters */
export async function addFilter(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "federation.filter.add");
  const principal = ctx.principal!;
  const peerId = ctx.params.id!;

  const peer = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM federation_peers WHERE id = ? AND org_id = ? AND principal_id = ?`,
    [peerId, principal.orgId, principal.principalId],
  );
  if (!peer) throw notFound();

  const body = requireObject(await ctx.json());
  const resourceType = requireEnum(body, "resource_type", RESOURCE_TYPES);
  const includeKinds = optionalString(body, "include_kinds", 1000);
  const excludeSubjects = optionalString(body, "exclude_subjects", 1000);
  const minTrust = body.min_trust != null ? requireEnum(body, "min_trust", TRUST_FILTERS) : null;

  const id = newId("ffilt");
  const now = ctx.app.now().toISOString();

  await ctx.app.db.batch([
    {
      sql: `INSERT INTO federation_filters (id, peer_id, resource_type, include_kinds, exclude_subjects, min_trust, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [id, peerId, resourceType, includeKinds, excludeSubjects, minTrust, now],
    },
  ]);

  return { status: 201, data: { filter_id: id, peer_id: peerId, resource_type: resourceType, include_kinds: includeKinds, exclude_subjects: excludeSubjects, min_trust: minTrust, created_at: now } };
}

/** GET /v1/federation/peers/:id/filters */
export async function listFilters(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin", "reader"], "federation.filter.list");
  const principal = ctx.principal!;
  const peerId = ctx.params.id!;

  const peer = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM federation_peers WHERE id = ? AND org_id = ? AND principal_id = ?`,
    [peerId, principal.orgId, principal.principalId],
  );
  if (!peer) throw notFound();

  const rows = await ctx.app.db.all<{
    id: string;
    resource_type: string;
    include_kinds: string | null;
    exclude_subjects: string | null;
    min_trust: string | null;
    created_at: string;
  }>(
    `SELECT id, resource_type, include_kinds, exclude_subjects, min_trust, created_at
       FROM federation_filters WHERE peer_id = ? ORDER BY created_at ASC`,
    [peerId],
  );

  return { data: { filters: rows.map((r) => ({ filter_id: r.id, ...r, id: undefined })) } };
}

// --- Pull / Push ---

interface FilterRow {
  resource_type: string;
  include_kinds: string | null;
  exclude_subjects: string | null;
  min_trust: string | null;
}

const TRUST_RANK: Record<string, number> = { unverified: 0, asserted: 1, verified: 2, policy_approved: 3 };

function passesFilter(event: { kind: string; resource_type: string; payload: Record<string, unknown> }, filters: FilterRow[]): boolean {
  // If no filters match resource_type, reject
  const applicable = filters.filter((f) => f.resource_type === event.resource_type);
  if (applicable.length === 0 && filters.length > 0) return false;
  if (applicable.length === 0) return true; // no filters = allow all

  return applicable.some((f) => {
    if (f.include_kinds) {
      const kinds = f.include_kinds.split(",").map((k) => k.trim());
      if (!kinds.includes(event.kind)) return false;
    }
    if (f.exclude_subjects) {
      const excluded = f.exclude_subjects.split(",").map((s) => s.trim());
      const subjectId = (event.payload as Record<string, unknown>).subject_id;
      if (typeof subjectId === "string" && excluded.includes(subjectId)) return false;
    }
    if (f.min_trust) {
      const trust = (event.payload as Record<string, unknown>).trust;
      if (typeof trust === "string" && (TRUST_RANK[trust] ?? 0) < (TRUST_RANK[f.min_trust] ?? 0)) return false;
    }
    return true;
  });
}

function requiredTimestamp(body: Record<string, unknown>, field: string, path: string): string {
  const value = optionalTimestamp(body, field, path);
  if (!value) throw validationError(`Field "${path}" is required.`);
  return value;
}

async function federationLocalId(
  peerId: string,
  sourceOrgId: string,
  resourceType: "observation" | "claim",
  remoteId: string,
): Promise<string> {
  const digest = await sha256Hex(`${peerId}\0${sourceOrgId}\0${resourceType}\0${remoteId}`);
  return `${resourceType === "claim" ? "claim" : "obs"}_fed_${digest.slice(0, 32)}`;
}

interface CanonicalClaimRow {
  id: string;
  subject_id: string;
  project_id: string | null;
  project_reference: string | null;
  project_created_at: string | null;
  observer_id: string | null;
  actor_id: string;
  kind: string;
  statement: string;
  confidence: number;
  trust: string;
  visibility: string;
  status: string;
  version: number;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
}

interface CanonicalSourceRow {
  id: string;
  subject_id: string;
  project_id: string | null;
  actor_id: string;
  kind: string;
  content: string;
  content_hash: string;
  source_type: string;
  source_ref: string | null;
  trust: string;
  visibility: string;
  occurred_at: string | null;
  ingested_at: string;
  relation: string;
  linked_at: string;
}

/** Hydrate only a complete, directly materialized, organization-visible graph. */
async function memoryBundleForClaim(
  ctx: RequestContext,
  claimId: string,
): Promise<Record<string, unknown> | undefined> {
  const principal = ctx.principal!;
  const claim = await first<CanonicalClaimRow>(
    ctx.app.db,
    `SELECT c.id, c.subject_id, c.project_id, p.reference AS project_reference,
            p.created_at AS project_created_at, c.observer_id, c.actor_id, c.kind,
            c.statement, c.confidence, c.trust, c.visibility, c.status, c.version,
            c.valid_from, c.valid_to, c.created_at
       FROM claims c LEFT JOIN projects p ON p.id = c.project_id AND p.org_id = c.org_id
      WHERE c.id = ? AND c.org_id = ? AND c.workspace_id IS NULL
        AND c.visibility = 'organization' AND c.status IN ('active', 'disputed')
        AND c.enrichment_job_id IS NULL AND ${recordAccessSql("c")}`,
    [claimId, principal.orgId, ...recordAccessParams(principal.principalId)],
  );
  if (!claim || (claim.project_id && !claim.project_reference)) return undefined;

  const expected = await first<{ count: number }>(
    ctx.app.db,
    `SELECT COUNT(*) AS count FROM claim_sources WHERE claim_id = ?`,
    [claim.id],
  );
  const sources = await ctx.app.db.all<CanonicalSourceRow>(
    `SELECT o.id, o.subject_id, o.project_id, o.actor_id, o.kind, o.content,
            o.content_hash, o.source_type, o.source_ref, o.trust, o.visibility,
            o.occurred_at, o.ingested_at, s.relation, s.created_at AS linked_at
       FROM claim_sources s JOIN observations o ON o.id = s.observation_id
      WHERE s.claim_id = ? AND o.org_id = ? AND o.workspace_id IS NULL
        AND o.visibility = 'organization' AND ${recordAccessSql("o")}
      ORDER BY o.id, s.relation`,
    [claim.id, principal.orgId, ...recordAccessParams(principal.principalId)],
  );
  if (
    sources.length === 0
    || sources.length !== Number(expected?.count ?? 0)
    || !sources.some(({ relation }) => relation === "supports")
    || sources.some((source) =>
      source.subject_id !== claim.subject_id || source.project_id !== claim.project_id)
  ) return undefined;

  const observations = [...new Map(sources.map((source) => [source.id, {
    id: source.id,
    subject_id: source.subject_id,
    project_id: source.project_id,
    actor_id: source.actor_id,
    kind: source.kind,
    content: source.content,
    content_hash: source.content_hash,
    source_type: source.source_type,
    source_ref: source.source_ref,
    trust: source.trust,
    visibility: source.visibility,
    occurred_at: source.occurred_at,
    ingested_at: source.ingested_at,
  }])).values()];

  return {
    format_version: FEDERATED_MEMORY_VERSION,
    source_org_id: principal.orgId,
    project: claim.project_id ? {
      id: claim.project_id,
      reference: claim.project_reference,
      created_at: claim.project_created_at,
    } : null,
    observations,
    claim: {
      id: claim.id,
      subject_id: claim.subject_id,
      project_id: claim.project_id,
      observer_id: claim.observer_id,
      actor_id: claim.actor_id,
      kind: claim.kind,
      statement: claim.statement,
      confidence: claim.confidence,
      trust: claim.trust,
      visibility: claim.visibility,
      status: claim.status,
      version: claim.version,
      valid_from: claim.valid_from,
      valid_to: claim.valid_to,
      created_at: claim.created_at,
      sources: sources.map((source) => ({
        observation_id: source.id,
        relation: source.relation,
        created_at: source.linked_at,
      })),
    },
  };
}

interface PendingFederatedRecord {
  localId: string;
  payloadHash: string;
}

interface MemoryImport {
  statements: Stmt[];
  claimId: string;
  sourceOrgId: string;
  sourceClaimId: string;
  sourceActorId: string;
  subjectId: string;
  claimKind: string;
  trust: Trust;
  status: string;
  payloadHash: string;
}

async function existingFederatedRecord(
  ctx: RequestContext,
  peerId: string,
  resourceType: "observation" | "claim",
  remoteId: string,
): Promise<{ local_id: string; payload_hash: string } | undefined> {
  return first(
    ctx.app.db,
    `SELECT local_id, payload_hash FROM federated_records
      WHERE peer_id = ? AND resource_type = ? AND remote_id = ?`,
    [peerId, resourceType, remoteId],
  );
}

async function prepareMemoryImport(
  ctx: RequestContext,
  peerId: string,
  rawMemory: unknown,
  pending: Map<string, PendingFederatedRecord>,
  pendingProjects: Map<string, string>,
  at: string,
): Promise<MemoryImport> {
  const principal = ctx.principal!;
  requireScope(principal, "import:write");
  const memory = requireObject(rawMemory, "events[].memory");
  if (memory.format_version !== FEDERATED_MEMORY_VERSION)
    throw validationError(`Federated memory format_version must be ${FEDERATED_MEMORY_VERSION}.`);
  const sourceOrgId = requireString(memory, "source_org_id", LIMITS.identifier, "events[].memory.source_org_id");
  const claim = requireObject(memory.claim, "events[].memory.claim");
  const sourceClaimId = requireString(claim, "id", LIMITS.identifier, "events[].memory.claim.id");
  const subjectId = requireString(claim, "subject_id", LIMITS.identifier, "events[].memory.claim.subject_id");
  const remoteProjectId = optionalString(claim, "project_id", LIMITS.identifier, "events[].memory.claim.project_id");
  const remoteActorId = requireString(claim, "actor_id", LIMITS.identifier, "events[].memory.claim.actor_id");
  const observerId = optionalString(claim, "observer_id", LIMITS.identifier, "events[].memory.claim.observer_id");
  const kind = requireEnum(claim, "kind", CLAIM_KINDS, "events[].memory.claim.kind");
  const statement = requireString(claim, "statement", LIMITS.statement, "events[].memory.claim.statement");
  const confidence = claim.confidence;
  if (typeof confidence !== "number" || confidence <= 0 || confidence > 1)
    throw validationError("Federated claim confidence must be greater than 0 and at most 1.");
  const trust = requireEnum(claim, "trust", TRUST_LEVELS, "events[].memory.claim.trust");
  if (trust === "policy_approved")
    throw validationError("Federated claims require local approval before policy_approved trust.");
  assertTrustCeiling(principal, trust);
  if (requireEnum(claim, "visibility", VISIBILITIES, "events[].memory.claim.visibility") !== "organization")
    throw forbidden("Federated canonical memory must be organization-visible.");
  const status = requireEnum(claim, "status", CLAIM_STATUSES, "events[].memory.claim.status");
  if (!Number.isInteger(claim.version) || Number(claim.version) < 1)
    throw validationError("Federated claim version must be a positive integer.");
  const validFrom = requiredTimestamp(claim, "valid_from", "events[].memory.claim.valid_from");
  const validTo = optionalTimestamp(claim, "valid_to", "events[].memory.claim.valid_to");
  assertTimestampOrder(validFrom, validTo);
  const claimCreatedAt = requiredTimestamp(claim, "created_at", "events[].memory.claim.created_at");
  const statements: Stmt[] = [];

  let projectId: string | null = null;
  const projectRaw = memory.project;
  if (remoteProjectId) {
    const project = requireObject(projectRaw, "events[].memory.project");
    if (requireString(project, "id", LIMITS.identifier, "events[].memory.project.id") !== remoteProjectId)
      throw validationError("Federated project id does not match the claim project_id.");
    const reference = normalizeProjectReference(
      requireString(project, "reference", LIMITS.identifier, "events[].memory.project.reference"),
    );
    const projectCreatedAt = requiredTimestamp(project, "created_at", "events[].memory.project.created_at");
    projectId = pendingProjects.get(reference) ?? null;
    if (!projectId) {
      const existing = await first<{ id: string }>(
        ctx.app.db,
        `SELECT id FROM projects WHERE org_id = ? AND reference = ?`,
        [principal.orgId, reference],
      );
      if (existing) projectId = existing.id;
      else {
        requireScope(principal, "projects:create");
        projectId = `proj_fed_${(await sha256Hex(`${principal.orgId}\0${reference}`)).slice(0, 32)}`;
        statements.push({
          sql: `INSERT INTO projects (id, org_id, reference, created_at) VALUES (?, ?, ?, ?)`,
          params: [projectId, principal.orgId, reference, projectCreatedAt],
        });
      }
      pendingProjects.set(reference, projectId);
    }
  } else if (projectRaw !== null && projectRaw !== undefined) {
    throw validationError("Federated unscoped memory must not include a project.");
  }

  const rawObservations = memory.observations;
  if (!Array.isArray(rawObservations) || rawObservations.length < 1 || rawObservations.length > LIMITS.sourcesPerClaim)
    throw validationError(`Federated memory observations must contain 1 to ${LIMITS.sourcesPerClaim} entries.`);
  const observations = new Map<string, {
    remoteId: string; localId: string; actorId: string; kind: string; content: string;
    contentHash: string; sourceType: string; sourceRef: string | null; trust: Trust;
    occurredAt: string | null; ingestedAt: string; payloadHash: string; isNew: boolean;
  }>();

  for (const [index, raw] of rawObservations.entries()) {
    const observation = requireObject(raw, `events[].memory.observations[${index}]`);
    const path = `events[].memory.observations[${index}]`;
    const remoteId = requireString(observation, "id", LIMITS.identifier, `${path}.id`);
    if (observations.has(remoteId)) throw validationError("Federated memory contains a duplicate observation id.");
    if (requireString(observation, "subject_id", LIMITS.identifier, `${path}.subject_id`) !== subjectId)
      throw validationError("Federated evidence subject must match the claim.");
    if (optionalString(observation, "project_id", LIMITS.identifier, `${path}.project_id`) !== remoteProjectId)
      throw validationError("Federated evidence project must match the claim.");
    if (requireEnum(observation, "visibility", VISIBILITIES, `${path}.visibility`) !== "organization")
      throw forbidden("Federated canonical evidence must be organization-visible.");
    const observationTrust = requireEnum(observation, "trust", TRUST_LEVELS, `${path}.trust`);
    if (observationTrust === "policy_approved")
      throw validationError("Federated observations must not use policy_approved trust.");
    assertTrustCeiling(principal, observationTrust);
    const content = requireString(observation, "content", LIMITS.content, `${path}.content`);
    const contentHash = requireString(observation, "content_hash", 64, `${path}.content_hash`);
    if (!/^[0-9a-f]{64}$/u.test(contentHash) || await sha256Hex(content) !== contentHash)
      throw validationError("Federated observation content_hash does not match content.");
    const actorId = requireString(observation, "actor_id", LIMITS.identifier, `${path}.actor_id`);
    const observationKind = requireEnum(observation, "kind", OBSERVATION_KINDS, `${path}.kind`);
    const sourceType = requireString(observation, "source_type", LIMITS.label, `${path}.source_type`);
    const sourceRef = optionalString(observation, "source_ref", LIMITS.identifier, `${path}.source_ref`);
    const occurredAt = optionalTimestamp(observation, "occurred_at", `${path}.occurred_at`);
    const ingestedAt = requiredTimestamp(observation, "ingested_at", `${path}.ingested_at`);
    const canonicalPayload = {
      source_org_id: sourceOrgId, id: remoteId, subject_id: subjectId,
      project_id: remoteProjectId, actor_id: actorId, kind: observationKind,
      content, content_hash: contentHash, source_type: sourceType, source_ref: sourceRef,
      trust: observationTrust, visibility: "organization", occurred_at: occurredAt,
      ingested_at: ingestedAt,
    };
    const payloadHash = await sha256Hex(JSON.stringify(canonicalPayload));
    const key = `observation:${remoteId}`;
    const existing = pending.get(key) ?? await existingFederatedRecord(ctx, peerId, "observation", remoteId);
    const existingHash = existing
      ? ("payloadHash" in existing ? existing.payloadHash : existing.payload_hash)
      : undefined;
    if (existingHash !== undefined && existingHash !== payloadHash)
      throw conflict("Federated observation identity was reused with different content.");
    const localId = existing
      ? ("localId" in existing ? existing.localId : existing.local_id)
      : await federationLocalId(peerId, sourceOrgId, "observation", remoteId);
    const isNew = !existing;
    if (isNew) pending.set(key, { localId, payloadHash });
    observations.set(remoteId, {
      remoteId, localId, actorId, kind: observationKind, content, contentHash,
      sourceType, sourceRef, trust: observationTrust, occurredAt, ingestedAt,
      payloadHash, isNew,
    });
  }

  const rawSources = claim.sources;
  if (!Array.isArray(rawSources) || rawSources.length < 1 || rawSources.length > LIMITS.sourcesPerClaim)
    throw validationError(`Federated claim sources must contain 1 to ${LIMITS.sourcesPerClaim} entries.`);
  const sources = rawSources.map((raw, index) => {
    const source = requireObject(raw, `events[].memory.claim.sources[${index}]`);
    const observationId = requireString(source, "observation_id", LIMITS.identifier, `events[].memory.claim.sources[${index}].observation_id`);
    if (!observations.has(observationId))
      throw validationError("Federated claim source is missing from the evidence bundle.");
    return {
      observationId,
      relation: requireEnum(source, "relation", CLAIM_RELATIONS, `events[].memory.claim.sources[${index}].relation`),
      createdAt: requiredTimestamp(source, "created_at", `events[].memory.claim.sources[${index}].created_at`),
    };
  });
  if (!sources.some(({ relation }) => relation === "supports"))
    throw validationError("Federated claim needs at least one supporting source.");
  if (new Set(sources.map(({ observationId, relation }) => `${observationId}:${relation}`)).size !== sources.length)
    throw validationError("Federated claim contains a duplicate source relation.");
  const referencedObservationIds = new Set(sources.map(({ observationId }) => observationId));
  if (
    referencedObservationIds.size !== observations.size
    || [...observations.keys()].some((id) => !referencedObservationIds.has(id))
  ) throw validationError("Every federated observation must be referenced by the claim.");
  const evidenceTrust = sources.filter(({ relation }) => relation === "supports")
    .reduce<Trust>((highest, source) => {
      const candidate = observations.get(source.observationId)!.trust;
      return TRUST_RANK[candidate] > TRUST_RANK[highest] ? candidate : highest;
    }, "unverified");
  if (TRUST_RANK[trust] > TRUST_RANK[evidenceTrust])
    throw validationError("Federated claim trust may not exceed supporting evidence.");

  const claimPayload = {
    source_org_id: sourceOrgId, id: sourceClaimId, subject_id: subjectId,
    project_id: remoteProjectId, observer_id: observerId, actor_id: remoteActorId,
    kind, statement, confidence, trust, visibility: "organization", status,
    version: Number(claim.version), valid_from: validFrom, valid_to: validTo,
    created_at: claimCreatedAt,
    sources: sources.map(({ observationId, relation, createdAt }) => ({
      observation_id: observationId, relation, created_at: createdAt,
    })),
  };
  const claimPayloadHash = await sha256Hex(JSON.stringify(claimPayload));
  const claimKey = `claim:${sourceClaimId}`;
  const existingClaim = pending.get(claimKey) ?? await existingFederatedRecord(ctx, peerId, "claim", sourceClaimId);
  const existingClaimHash = existingClaim
    ? ("payloadHash" in existingClaim ? existingClaim.payloadHash : existingClaim.payload_hash)
    : undefined;
  if (existingClaimHash !== undefined && existingClaimHash !== claimPayloadHash)
    throw conflict("Federated claim identity was reused with different content.");
  const claimId = existingClaim
    ? ("localId" in existingClaim ? existingClaim.localId : existingClaim.local_id)
    : await federationLocalId(peerId, sourceOrgId, "claim", sourceClaimId);
  const claimIsNew = !existingClaim;
  if (claimIsNew) pending.set(claimKey, { localId: claimId, payloadHash: claimPayloadHash });

  for (const observation of observations.values()) if (observation.isNew) {
    statements.push({
      sql: `INSERT INTO observations
              (id, org_id, subject_id, project_id, workspace_id, agent_id, run_id, actor_id,
               kind, content, content_hash, source_type, source_ref, trust, visibility,
               occurred_at, ingested_at)
            VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'organization', ?, ?)`,
      params: [
        observation.localId, principal.orgId, subjectId, projectId, principal.principalId,
        observation.kind, observation.content, observation.contentHash, observation.sourceType,
        observation.sourceRef, observation.trust, observation.occurredAt, observation.ingestedAt,
      ],
    }, {
      sql: `INSERT INTO observations_fts
              (content, observation_id, org_scope, subject_scope)
            VALUES (?, ?, lower(hex(?)) || '0', lower(hex(?)) || '0')`,
      params: [observation.content, observation.localId, principal.orgId, subjectId],
    }, historyStatement(
      principal.orgId, "observation", observation.localId, 1, "federation_import",
      principal.principalId, observation.contentHash, at,
    ), {
      sql: `INSERT INTO federated_records
              (peer_id, source_org_id, resource_type, remote_id, local_id, payload_hash,
               remote_actor_id, remote_created_at, received_at)
            VALUES (?, ?, 'observation', ?, ?, ?, ?, ?, ?)`,
      params: [
        peerId, sourceOrgId, observation.remoteId, observation.localId,
        observation.payloadHash, observation.actorId, observation.ingestedAt, at,
      ],
    });
    if (ctx.app.vectors)
      statements.push(outboxStatement(principal.orgId, "observation", observation.localId, "upsert", at));
  }

  if (claimIsNew) {
    statements.push({
      sql: `INSERT INTO claims
              (id, org_id, subject_id, project_id, workspace_id, observer_id, actor_id, kind,
               statement, confidence, trust, visibility, status, version, valid_from, valid_to,
               created_at)
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'organization', ?, ?, ?, ?, ?)`,
      params: [
        claimId, principal.orgId, subjectId, projectId, observerId, principal.principalId,
        kind, statement, confidence, trust, status, Number(claim.version), validFrom, validTo,
        claimCreatedAt,
      ],
    }, {
      sql: `INSERT INTO claims_fts
              (statement, claim_id, org_scope, subject_scope)
            VALUES (?, ?, lower(hex(?)) || '0', lower(hex(?)) || '0')`,
      params: [statement, claimId, principal.orgId, subjectId],
    });
    for (const source of sources) statements.push({
      sql: `INSERT INTO claim_sources (claim_id, observation_id, relation, created_at)
            VALUES (?, ?, ?, ?)`,
      params: [claimId, observations.get(source.observationId)!.localId, source.relation, source.createdAt],
    });
    statements.push(historyStatement(
      principal.orgId, "claim", claimId, Number(claim.version), "federation_import",
      principal.principalId, await sha256Hex(`${statement}|${status}|${trust}`), at,
    ), {
      sql: `INSERT INTO federated_records
              (peer_id, source_org_id, resource_type, remote_id, local_id, payload_hash,
               remote_actor_id, remote_created_at, received_at)
            VALUES (?, ?, 'claim', ?, ?, ?, ?, ?, ?)`,
      params: [peerId, sourceOrgId, sourceClaimId, claimId, claimPayloadHash, remoteActorId, claimCreatedAt, at],
    });
    if (ctx.app.vectors)
      statements.push(outboxStatement(principal.orgId, "claim", claimId, "upsert", at));
  }

  return {
    statements,
    claimId,
    sourceOrgId,
    sourceClaimId,
    sourceActorId: remoteActorId,
    subjectId,
    claimKind: kind,
    trust,
    status,
    payloadHash: claimPayloadHash,
  };
}

/** POST /v1/federation/pull — pull local events matching peer filters from cursor. */
export async function pullEvents(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "federation.export");
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const peerId = requireString(body, "peer_id", LIMITS.identifier);
  const includeMemory = optionalBoolean(body, "include_memory");

  const peer = await first<{ id: string; direction: string; status: string; last_cursor: string | null }>(
    ctx.app.db,
    `SELECT id, direction, status, last_cursor FROM federation_peers WHERE id = ? AND org_id = ? AND principal_id = ?`,
    [peerId, principal.orgId, principal.principalId],
  );
  if (!peer) throw notFound();
  if (peer.status !== "active") throw forbidden("Peer is not active.");
  if (peer.direction === "push") throw forbidden("Peer is configured for push only.");

  const filters = await ctx.app.db.all<FilterRow>(
    `SELECT resource_type, include_kinds, exclude_subjects, min_trust FROM federation_filters WHERE peer_id = ?`,
    [peerId],
  );
  if (includeMemory) {
    requireScope(principal, "export:read");
    if (!filters.some(({ resource_type }) => resource_type === "claim"))
      throw forbidden("Canonical memory pull requires an explicit claim filter.");
  }

  // Fetch events after cursor
  const conditions: string[] = ["e.org_id = ?", eventAccessSql("e")];
  const params: (string | number)[] = [
    principal.orgId,
    ...eventAccessParams(principal.principalId),
  ];
  if (includeMemory) conditions.push("e.resource_type = 'claim'", "e.kind = 'claim.materialized'");

  if (peer.last_cursor) {
    const sequence = await resolveEventCursor(ctx.app.db, principal.orgId, peer.last_cursor);
    if (sequence === undefined)
      throw conflict("Federation cursor references an unknown event.");
    conditions.push("eo.seq > ?");
    params.push(sequence);
  }

  // Canonical bundles can approach the request ceiling by themselves. One
  // claim per opt-in pull guarantees the returned event can be pushed without
  // inventing a second pagination or chunk-assembly protocol.
  params.push(includeMemory ? 1 : 200);
  const rows = await ctx.app.db.all<{
    id: string;
    kind: string;
    actor_id: string;
    resource_type: string;
    resource_id: string;
    payload: string;
    created_at: string;
  }>(
    `SELECT e.id, e.kind, e.actor_id, e.resource_type, e.resource_id, e.payload,
            e.created_at
       FROM event_order eo JOIN events e ON e.id = eo.event_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY eo.seq LIMIT ?`,
    params,
  );

  const candidates = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      actor_id: r.actor_id,
      resource_type: r.resource_type,
      resource_id: r.resource_id,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
      created_at: r.created_at,
    }));
  const events: Record<string, unknown>[] = [];
  for (const event of candidates) {
    if (!passesFilter(event, filters)) continue;
    if (!includeMemory) {
      events.push(event);
      continue;
    }
    if (event.resource_type !== "claim") continue;
    const memory = await memoryBundleForClaim(ctx, event.resource_id);
    if (memory) {
      const offered = { ...event, memory };
      if (new TextEncoder().encode(JSON.stringify(offered)).byteLength > MAX_BODY_BYTES - 4_096)
        throw validationError("Federated memory bundle exceeds the signed push body limit.");
      events.push(offered);
    }
  }

  // Update cursor to last event from the full batch (not filtered) so we don't re-scan
  const lastRow = rows[rows.length - 1];
  if (lastRow) {
    const now = ctx.app.now().toISOString();
    await ctx.app.db.batch([
      {
        sql: `UPDATE federation_peers SET last_cursor = ?, last_sync_at = ?
              WHERE id = ? AND org_id = ? AND principal_id = ?`,
        params: [lastRow.id, now, peerId, principal.orgId, principal.principalId],
      },
    ]);

    // Log sent events
    if (events.length > 0) {
      const logStmts = events.map((e) => ({
        sql: `INSERT INTO federation_log (id, peer_id, direction, resource_type, resource_id, status, created_at) VALUES (?, ?, 'sent', ?, ?, 'success', ?)`,
        params: [newId("flog"), peerId, e.resource_type, e.id, now] as (string | number | null)[],
      }));
      await ctx.app.db.batch(logStmts);
    }
  }

  return {
    data: {
      events,
      cursor: lastRow?.id ?? peer.last_cursor,
    },
  };
}

/** POST /v1/federation/push — receive events from a remote peer. */
export async function pushEvents(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin"], "federation.import");
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const peerId = requireString(body, "peer_id", LIMITS.identifier);

  const peer = await first<{
    id: string;
    direction: string;
    status: string;
    shared_secret: string | null;
    source_org_id: string | null;
  }>(
    ctx.app.db,
    `SELECT id, direction, status, shared_secret, source_org_id FROM federation_peers WHERE id = ? AND org_id = ? AND principal_id = ?`,
    [peerId, principal.orgId, principal.principalId],
  );
  if (!peer) throw notFound();
  if (peer.status !== "active") throw forbidden("Peer is not active.");
  if (peer.direction === "pull") throw forbidden("Peer is configured for pull only.");

  // An API key proves the caller may use this endpoint; the peer signature
  // proves the batch came from the peer that was registered. Without it the
  // shared secret would be decorative and any authorized caller could inject
  // records attributed to a remote deployment.
  if (!peer.shared_secret || !ctx.app.secretCipher)
    throw unavailable("Federation signing key is unavailable.");
  let sharedSecret: string;
  try {
    sharedSecret = await ctx.app.secretCipher.decrypt(peer.shared_secret, `federation:${peer.id}`);
  } catch {
    throw unavailable("Federation signing key is unavailable.");
  }
  const offered = ctx.request.headers.get("x-titen-peer-signature");
  if (!offered) throw forbidden("Peer signature header is required.");
  const expected = `sha256=${await signPayload(sharedSecret, await ctx.rawBody())}`;
  if (offered.length !== expected.length) throw forbidden("Peer signature is invalid.");
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1)
    mismatch |= offered.charCodeAt(index) ^ expected.charCodeAt(index);
  if (mismatch !== 0) throw forbidden("Peer signature is invalid.");

  const filters = await ctx.app.db.all<FilterRow>(
    `SELECT resource_type, include_kinds, exclude_subjects, min_trust FROM federation_filters WHERE peer_id = ?`,
    [peerId],
  );

  const rawEvents = body.events;
  if (!Array.isArray(rawEvents)) throw validationError('Field "events" must be an array.');

  const now = ctx.app.now().toISOString();
  const results: { id: string; status: string; detail?: string; canonical_claim_id?: string }[] = [];
  const stmts: Stmt[] = [];
  const pending = new Map<string, PendingFederatedRecord>();
  const pendingProjects = new Map<string, string>();
  const pendingEventPayloads = new Map<string, string>();
  let sourceOrgId = peer.source_org_id;

  for (const raw of rawEvents) {
    if (typeof raw !== "object" || raw === null || !("id" in raw)) {
      results.push({ id: "unknown", status: "rejected", detail: "Invalid event shape" });
      continue;
    }
    const evt = raw as Record<string, unknown>;
    const evtId = typeof evt.id === "string" ? evt.id : "unknown";
    const storedEventId = evt.memory === undefined
      ? evtId
      : `evt_fed_${(await sha256Hex(`${peerId}\0${evtId}`)).slice(0, 32)}`;
    const kind = typeof evt.kind === "string" ? evt.kind : "";
    const resourceType = typeof evt.resource_type === "string" ? evt.resource_type : "";
    const resourceId = typeof evt.resource_id === "string" ? evt.resource_id : "";
    const payload = typeof evt.payload === "object" && evt.payload !== null ? evt.payload as Record<string, unknown> : {};

    // Check filters
    if (!passesFilter({ kind, resource_type: resourceType, payload }, filters)) {
      results.push({ id: evtId, status: "rejected", detail: "Filtered out by policy" });
      stmts.push({
        sql: `INSERT INTO federation_log (id, peer_id, direction, resource_type, resource_id, status, detail, created_at) VALUES (?, ?, 'received', ?, ?, 'rejected', ?, ?)`,
        params: [newId("flog"), peerId, resourceType, evtId, "Filtered out by policy", now],
      });
      continue;
    }

    // An existing wrapper is replayable only when its complete metadata and
    // canonical provenance resolve identically below.
    let existingPayload = pendingEventPayloads.get(storedEventId);
    if (existingPayload === undefined) existingPayload = (await first<{ payload: string }>(
      ctx.app.db,
      `SELECT payload FROM events WHERE id = ? AND org_id = ?`,
      [storedEventId, principal.orgId],
    ))?.payload;

    if (existingPayload !== undefined && evt.memory === undefined) {
      results.push({ id: evtId, status: "conflict", detail: "Event already exists" });
      stmts.push({
        sql: `INSERT INTO federation_log (id, peer_id, direction, resource_type, resource_id, status, detail, created_at) VALUES (?, ?, 'received', ?, ?, 'conflict', ?, ?)`,
        params: [newId("flog"), peerId, resourceType, evtId, "Event already exists", now],
      });
      continue;
    }

    let imported: MemoryImport | undefined;
    let bindSourceOrg = false;
    if (evt.memory !== undefined) {
      if (evtId === "unknown")
        throw validationError("Federated memory event id must be a string.");
      if (!filters.some(({ resource_type }) => resource_type === "claim"))
        throw forbidden("Canonical memory push requires an explicit claim filter.");
      if (kind !== "claim.materialized" || resourceType !== "claim")
        throw validationError("Federated memory must accompany a claim.materialized event.");
      imported = await prepareMemoryImport(ctx, peerId, evt.memory, pending, pendingProjects, now);
      if (sourceOrgId && sourceOrgId !== imported.sourceOrgId)
        throw conflict("Federation peer is bound to a different source organization.");
      if (!sourceOrgId) {
        sourceOrgId = imported.sourceOrgId;
        bindSourceOrg = true;
      }
      if (imported.sourceClaimId !== resourceId)
        throw validationError("Federated memory claim id must match event resource_id.");
      if (evt.actor_id !== imported.sourceActorId)
        throw validationError("Federated memory actor must match event actor_id.");
      if (
        payload.subject_id !== imported.subjectId
        || payload.kind !== imported.claimKind
        || payload.trust !== imported.trust
        || payload.status !== imported.status
        || payload.visibility !== "organization"
      ) throw validationError("Federated memory must match its event policy metadata.");
    }

    // A signature proves peer transport, while imported canonical rows remain
    // owned by the destination principal. Content lives in canonical SQL; the
    // event wrapper keeps only remote identity and a provenance hash.
    const wrappedPayload = imported ? {
      untrusted_remote_event: {
        id: evtId,
        kind,
        actor_id: typeof evt.actor_id === "string" ? evt.actor_id : null,
        resource_type: resourceType,
        resource_id: resourceId,
        payload,
        created_at: typeof evt.created_at === "string" ? evt.created_at : null,
      },
      canonical_import: {
        claim_id: imported.claimId,
        source_org_id: imported.sourceOrgId,
        source_claim_id: imported.sourceClaimId,
        payload_hash: imported.payloadHash,
      },
    } : {
      untrusted_remote_event: {
        id: evtId,
        kind,
        actor_id: typeof evt.actor_id === "string" ? evt.actor_id : null,
        resource_type: resourceType,
        resource_id: resourceId,
        payload,
        created_at: typeof evt.created_at === "string" ? evt.created_at : null,
      },
    };
    const serializedPayload = JSON.stringify(wrappedPayload);

    if (existingPayload !== undefined) {
      if (imported && (imported.statements.length > 0 || existingPayload !== serializedPayload))
        throw conflict("Federated event identity was reused with different canonical memory.");
      stmts.push({
        sql: `INSERT INTO federation_log (id, peer_id, direction, resource_type, resource_id, status, detail, created_at) VALUES (?, ?, 'received', ?, ?, 'success', 'Idempotent replay', ?)`,
        params: [newId("flog"), peerId, resourceType, evtId, now],
      });
      results.push({
        id: evtId,
        status: "replayed",
        detail: "Canonical memory already imported",
        canonical_claim_id: imported!.claimId,
      });
      continue;
    }
    if (bindSourceOrg) stmts.push({
      sql: `UPDATE federation_peers SET source_org_id = ?
             WHERE id = ? AND org_id = ? AND principal_id = ? AND source_org_id IS NULL`,
      params: [sourceOrgId!, peerId, principal.orgId, principal.principalId],
    });
    if (imported) stmts.push(...imported.statements);
    pendingEventPayloads.set(storedEventId, serializedPayload);
    stmts.push({
      sql: `INSERT INTO events (id, org_id, kind, actor_id, resource_type, resource_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        storedEventId,
        principal.orgId,
        "federation.received",
        principal.principalId,
        "federated_event",
        evtId,
        serializedPayload,
        now,
      ],
    });
    stmts.push({
      sql: `INSERT INTO federation_log (id, peer_id, direction, resource_type, resource_id, status, created_at) VALUES (?, ?, 'received', ?, ?, 'success', ?)`,
      params: [newId("flog"), peerId, resourceType, evtId, now],
    });
    if (imported && imported.statements.length > 0) stmts.push(auditStatement(
      principal.orgId,
      principal.principalId,
      "federation.memory.import",
      "claim",
      now,
      imported.claimId,
      `peer_id=${peerId};source_org_id=${imported.sourceOrgId};source_claim_id=${imported.sourceClaimId}`,
    ));
    results.push({
      id: evtId,
      status: imported && imported.statements.length === 0 ? "replayed" : "success",
      ...(imported ? { canonical_claim_id: imported.claimId } : {}),
    });
  }

  if (stmts.length > 0) {
    try {
      await ctx.app.db.batch(stmts);
    } catch (error) {
      if (error instanceof Error && error.message.includes("FEDERATION_SOURCE_ORG_MISMATCH"))
        throw conflict("Federation peer is bound to a different source organization.");
      throw error;
    }
  }

  return { data: { results } };
}

// --- Log ---

/** GET /v1/federation/log */
export async function federationLog(ctx: RequestContext): Promise<Result> {
  await requireOrgRole(ctx, ["owner", "admin", "reader"], "federation.log.list");
  const principal = ctx.principal!;
  const peerId = ctx.url.searchParams.get("peer_id");
  const limitParam = ctx.url.searchParams.get("limit");
  let limit = 50;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1) throw validationError('Query "limit" must be a positive integer.');
    limit = Math.min(parsed, 200);
  }

  if (!peerId) throw validationError('Query "peer_id" is required.');

  // Verify peer belongs to the caller without disclosing same-org peers.
  const peer = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM federation_peers WHERE id = ? AND org_id = ? AND principal_id = ?`,
    [peerId, principal.orgId, principal.principalId],
  );
  if (!peer) throw notFound();

  const rows = await ctx.app.db.all<{
    id: string;
    direction: string;
    resource_type: string;
    resource_id: string;
    status: string;
    detail: string | null;
    created_at: string;
  }>(
    `SELECT id, direction, resource_type, resource_id, status, detail, created_at
       FROM federation_log WHERE peer_id = ? ORDER BY created_at DESC LIMIT ?`,
    [peerId, limit],
  );

  return { data: { entries: rows } };
}
