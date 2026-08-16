import { chunk, first, MAX_BOUND_PARAMS } from "./db";
import { hasScope, type Principal } from "./auth";
import {
  contradictedSql,
  organizationRecordAccessSql,
  recordAccessParams,
  recordAccessSql,
} from "./authorization";
import { auditStatement } from "./audit";
import { loadAuthorizedEvidenceIds } from "./evidence";
import { notFound, validationError } from "./errors";
import type { RequestContext, Result } from "./http";
import { requireObject, optionalString, requireEnum } from "./validate";
import { requireOrgRole } from "./governance";

const LENSES = ["evidence_trace", "neighborhood", "conflict_freshness", "review_queue", "scope_preview", "workspace_graph", "knowledge_release"] as const;
type Lens = (typeof LENSES)[number];
const REVIEW_REASONS = ["all", "disputed", "contradiction", "low_confidence", "negative_feedback"] as const;
const ACCESS_MODES = ["principal", "organization_admin"] as const;
const ADMINISTRATOR_REASONS = ["incident_response", "recovery", "deletion_verification", "export_verification"] as const;
type AccessMode = (typeof ACCESS_MODES)[number];

function accessSql(alias: "c" | "o", mode: AccessMode): string {
  return mode === "organization_admin"
    ? organizationRecordAccessSql(alias)
    : recordAccessSql(alias);
}

function accessParams(principal: Principal, mode: AccessMode) {
  return mode === "organization_admin" ? [] : recordAccessParams(principal);
}

function claimAccessSql(alias: "hc" | "rc", mode: AccessMode): string {
  const sql = mode === "organization_admin"
    ? organizationRecordAccessSql("c")
    : recordAccessSql("c");
  return sql.replaceAll("c.", `${alias}.`);
}

interface Node {
  id: string;
  type: "claim" | "observation" | "context" | "principal" | "release" | "subject";
  label: string;
  trust: string;
  status: string;
  created_at: string;
  freshness?: number;
  kind?: string;
  subject_id?: string;
  project_ref?: string | null;
  degree?: number;
}

interface ReviewNode extends Node {
  confidence: number;
  priority: number;
  reasons: string[];
  owner_id: string;
  next_action: string;
  deadline: string | null;
  terminal_state: string | null;
  evidence_refs: string[];
  audit_refs: string[];
}

interface ReviewCursor {
  priority: number;
  confidence: number;
  createdAt: string;
  id: string;
}

interface Edge {
  from: string;
  to: string;
  relation: string;
}

interface ViewResult {
  lens: Lens;
  focus_id: string | null;
  nodes: Node[];
  edges: Edge[];
  metadata: Record<string, unknown>;
  truncated?: boolean;
  withheld_edges?: number;
}

function daysSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
}

function clampLimit(body: Record<string, unknown>): number {
  const raw = body.limit;
  if (raw === undefined || raw === null) return 50;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 200)
    throw validationError('Field "limit" must be an integer between 1 and 200.');
  return raw;
}

function encodeCursor(cursor: ReviewCursor): string {
  return btoa(JSON.stringify([cursor.priority, cursor.confidence, cursor.createdAt, cursor.id]))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeCursor(value: string | null): ReviewCursor | null {
  if (!value) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(atob(padded));
    if (!Array.isArray(parsed) || parsed.length !== 4) throw new Error();
    const [priority, confidence, createdAt, id] = parsed;
    if (
      typeof priority !== "number" || !Number.isInteger(priority) || priority < 1 || priority > 4
      || typeof confidence !== "number" || confidence <= 0 || confidence > 1
      || typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))
      || typeof id !== "string" || id === "" || id.length > 200
    ) throw new Error();
    return { priority, confidence, createdAt, id };
  } catch {
    throw validationError('Field "cursor" is invalid.');
  }
}

// --- Lens handlers ---

async function evidenceTrace(ctx: RequestContext, focusId: string, orgId: string, principal: Principal, mode: AccessMode, limit: number): Promise<ViewResult> {
  const claim = await first<{ id: string; statement: string; trust: string; status: string; visibility: string; actor_id: string; created_at: string }>(
    ctx.app.db,
    `SELECT c.id, c.statement, c.trust, c.status, c.visibility, c.actor_id, c.created_at
       FROM claims c
      WHERE c.id = ? AND c.org_id = ? AND ${accessSql("c", mode)}`,
    [focusId, orgId, ...accessParams(principal, mode)],
  );
  if (!claim) throw notFound();

  const sources = await ctx.app.db.all<{ relation: string; obs_id: string; kind: string; content: string; trust: string; visibility: string; actor_id: string; ingested_at: string }>(
    `SELECT s.relation, o.id AS obs_id, o.kind, o.content, o.trust, o.visibility, o.actor_id, o.ingested_at
       FROM claim_sources s
       JOIN observations o ON o.id = s.observation_id
      WHERE s.claim_id = ? AND o.org_id = ? AND ${accessSql("o", mode)}
      ORDER BY o.ingested_at, o.id
      LIMIT ?`,
    [focusId, orgId, ...accessParams(principal, mode), Math.max(0, limit - 1)],
  );

  const nodes: Node[] = [
    { id: claim.id, type: "claim", label: claim.statement, trust: claim.trust, status: claim.status, created_at: claim.created_at },
  ];
  const edges: Edge[] = [];

  for (const s of sources) {
    nodes.push({ id: s.obs_id, type: "observation", label: s.content.slice(0, 120), trust: s.trust, status: s.kind, created_at: s.ingested_at });
    edges.push({ from: s.obs_id, to: claim.id, relation: s.relation });
  }

  // A context is a readable projection only when the caller can read the
  // complete pack. Returning a partial context would disclose its hidden shape.
  const contexts = await ctx.app.db.all<{
    id: string; created_at: string; degraded: string;
  }>(
    `SELECT DISTINCT r.id, r.created_at, r.degraded
       FROM context_run_items i
       JOIN context_runs r ON r.id = i.context_id AND r.org_id = ?
      WHERE i.claim_id = ?
        AND (r.actor_id = ? OR EXISTS (
          SELECT 1 FROM handoffs h
           WHERE h.org_id = r.org_id AND h.context_id = r.id
             AND h.to_principal = ? AND h.status IN ('pending', 'accepted')
        ))
        AND NOT EXISTS (
          SELECT 1
            FROM context_run_items hidden
            LEFT JOIN claims hc ON hc.id = hidden.claim_id AND hc.org_id = r.org_id
           WHERE hidden.context_id = r.id
             AND (hc.id IS NULL OR NOT (${claimAccessSql("hc", mode)}))
        )
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ?`,
    [orgId, focusId, principal.principalId, principal.principalId, ...accessParams(principal, mode), Math.min(20, Math.max(0, limit - nodes.length))],
  );
  for (const context of contexts) {
    nodes.push({
      id: context.id,
      type: "context",
      label: context.id,
      trust: context.degraded === "none" ? "compiled" : "degraded",
      status: "active",
      created_at: context.created_at,
    });
    edges.push({ from: claim.id, to: context.id, relation: "selected-in" });
  }

  const now = ctx.app.now().toISOString();
  const releases = await ctx.app.db.all<{
    id: string; label: string; audience: string; lifecycle_status: string;
    created_at: string; activated_at: string | null;
  }>(
    `SELECT r.id, ch.label, r.audience, r.lifecycle_status, r.created_at, r.activated_at
       FROM channel_releases r
       JOIN channels ch ON ch.id = r.channel_id AND ch.org_id = r.org_id
       JOIN claims rc ON rc.id = r.claim_id AND rc.org_id = r.org_id
      WHERE r.org_id = ? AND r.claim_id = ?
        AND r.lifecycle_status = 'active' AND ch.status = 'active'
        AND rc.status = 'active' AND rc.version = r.claim_version
        AND (r.valid_from IS NULL OR r.valid_from <= ?)
        AND (r.valid_to IS NULL OR r.valid_to > ?)
        AND ${claimAccessSql("rc", mode)}
      ORDER BY COALESCE(r.activated_at, r.created_at) DESC, r.id DESC
      LIMIT ?`,
    [orgId, focusId, now, now, ...accessParams(principal, mode), Math.min(20, Math.max(0, limit - nodes.length))],
  );
  for (const release of releases) {
    nodes.push({
      id: release.id,
      type: "release",
      label: `${release.label} · ${release.audience}`,
      trust: "reviewed_snapshot",
      status: release.lifecycle_status,
      created_at: release.activated_at ?? release.created_at,
    });
    edges.push({ from: claim.id, to: release.id, relation: "released-as" });
  }

  return {
    lens: "evidence_trace",
    focus_id: focusId,
    nodes,
    edges,
    metadata: {
      observation_count: sources.length,
      context_count: contexts.length,
      release_count: releases.length,
    },
  };
}

async function neighborhood(ctx: RequestContext, subjectId: string, orgId: string, principal: Principal, limit: number, mode: AccessMode): Promise<ViewResult> {
  const claims = await ctx.app.db.all<{ id: string; statement: string; trust: string; status: string; visibility: string; actor_id: string; created_at: string }>(
    `SELECT id, statement, trust, status, visibility, actor_id, created_at
       FROM claims c WHERE c.subject_id = ? AND c.org_id = ? AND c.status != 'revoked'
        AND ${accessSql("c", mode)}
      ORDER BY created_at DESC LIMIT ?`,
    [subjectId, orgId, ...accessParams(principal, mode), limit],
  );

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const seenObs = new Set<string>();

  for (const c of claims) {
    nodes.push({ id: c.id, type: "claim", label: c.statement, trust: c.trust, status: c.status, created_at: c.created_at });

    const sources = await ctx.app.db.all<{ obs_id: string; content: string; trust: string; visibility: string; actor_id: string; ingested_at: string; relation: string }>(
      `SELECT o.id AS obs_id, o.content, o.trust, o.visibility, o.actor_id, o.ingested_at, s.relation
         FROM claim_sources s
         JOIN observations o ON o.id = s.observation_id
        WHERE s.claim_id = ? AND o.org_id = ? AND ${accessSql("o", mode)}`,
      [c.id, orgId, ...accessParams(principal, mode)],
    );

    for (const s of sources) {
      if (!seenObs.has(s.obs_id)) {
        seenObs.add(s.obs_id);
        nodes.push({ id: s.obs_id, type: "observation", label: s.content.slice(0, 120), trust: s.trust, status: "active", created_at: s.ingested_at });
      }
      edges.push({ from: c.id, to: s.obs_id, relation: s.relation });
    }
  }

  return { lens: "neighborhood", focus_id: null, nodes, edges, metadata: { subject_id: subjectId, claim_count: claims.length } };
}

async function conflictFreshness(ctx: RequestContext, subjectId: string, orgId: string, principal: Principal, limit: number, mode: AccessMode): Promise<ViewResult> {
  const now = ctx.app.now();

  // Claims that have at least one contradicting source
  const disputed = await ctx.app.db.all<{ id: string; statement: string; trust: string; status: string; visibility: string; actor_id: string; created_at: string }>(
    `SELECT c.id, c.statement, c.trust, c.status, c.visibility, c.actor_id, c.created_at
       FROM claims c
      WHERE c.org_id = ? AND c.subject_id = ? AND c.status != 'revoked'
        AND ${accessSql("c", mode)}
        AND ${contradictedSql("c", mode === "organization_admin")}
      ORDER BY c.created_at DESC LIMIT ?`,
    [
      orgId,
      subjectId,
      ...accessParams(principal, mode),
      ...accessParams(principal, mode),
      limit,
    ],
  );

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const seenObs = new Set<string>();

  for (const c of disputed) {
    nodes.push({ id: c.id, type: "claim", label: c.statement, trust: c.trust, status: c.status, created_at: c.created_at, freshness: daysSince(c.created_at, now) });

    const contradictions = await ctx.app.db.all<{ obs_id: string; content: string; trust: string; visibility: string; actor_id: string; ingested_at: string }>(
      `SELECT o.id AS obs_id, o.content, o.trust, o.visibility, o.actor_id, o.ingested_at
         FROM claim_sources s
         JOIN observations o ON o.id = s.observation_id
        WHERE s.claim_id = ? AND s.relation = 'contradicts' AND o.org_id = ?
          AND ${accessSql("o", mode)}`,
      [c.id, orgId, ...accessParams(principal, mode)],
    );

    for (const o of contradictions) {
      if (!seenObs.has(o.obs_id)) {
        seenObs.add(o.obs_id);
        nodes.push({ id: o.obs_id, type: "observation", label: o.content.slice(0, 120), trust: o.trust, status: "contradiction", created_at: o.ingested_at, freshness: daysSince(o.ingested_at, now) });
      }
      edges.push({ from: o.obs_id, to: c.id, relation: "contradicts" });
    }
  }

  return { lens: "conflict_freshness", focus_id: null, nodes, edges, metadata: { subject_id: subjectId, disputed_count: disputed.length } };
}

async function workspaceGraph(
  ctx: RequestContext,
  workspaceId: string | null,
  maxNodes: number,
  mode: AccessMode,
): Promise<ViewResult> {
  const principal = ctx.principal!;
  const totals = await first<{
    claim_count: number; subject_count: number; link_count: number; supersede_count: number;
  }>(ctx.app.db,
    `WITH authorized AS (
       SELECT c.id, c.subject_id, c.superseded_by FROM claims c
        WHERE c.org_id = ? AND (c.workspace_id IS ? OR c.visibility = 'organization')
          AND ${accessSql("c", mode)}
     )
     SELECT COUNT(*) AS claim_count, COUNT(DISTINCT subject_id) AS subject_count,
       (SELECT COUNT(*) FROM claim_links l
         JOIN authorized source ON source.id = l.source_claim_id
         JOIN authorized target ON target.id = l.target_claim_id
        WHERE l.org_id = ?) AS link_count,
       COALESCE(SUM(CASE WHEN superseded_by IN (SELECT id FROM authorized) THEN 1 ELSE 0 END), 0)
         AS supersede_count
       FROM authorized`,
    [principal.orgId, workspaceId, ...accessParams(principal, mode), principal.orgId]);
  const claims = await ctx.app.db.all<{
    id: string; subject_id: string; statement: string; kind: string; status: string;
    trust: string; created_at: string; superseded_by: string | null; project_ref: string | null;
  }>(
    `SELECT c.id, c.subject_id, c.statement, c.kind, c.status, c.trust,
            c.created_at, c.superseded_by, p.reference AS project_ref
       FROM claims c LEFT JOIN projects p ON p.id = c.project_id AND p.org_id = c.org_id
      WHERE c.org_id = ? AND (c.workspace_id IS ? OR c.visibility = 'organization')
        AND ${accessSql("c", mode)}
      ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
    [principal.orgId, workspaceId, ...accessParams(principal, mode), maxNodes + 1],
  );
  const totalNodes = Number(totals?.claim_count ?? 0) + Number(totals?.subject_count ?? 0);
  const truncated = totalNodes > maxNodes;
  const selected = claims.slice(0, maxNodes);
  const claimIds = new Set(selected.map((claim) => claim.id));
  const subjectIds = [...new Set(selected.map((claim) => claim.subject_id))].sort();
  while (selected.length + subjectIds.length > maxNodes) {
    const removed = selected.pop();
    if (!removed) break;
    claimIds.delete(removed.id);
    if (!selected.some((claim) => claim.subject_id === removed.subject_id))
      subjectIds.splice(subjectIds.indexOf(removed.subject_id), 1);
  }
  const subjectRows = subjectIds.length ? await ctx.app.db.all<{ id: string; label: string; created_at: string }>(
    `SELECT id, label, created_at FROM subjects
      WHERE org_id = ? AND id IN (${subjectIds.map(() => "?").join(", ")})`,
    [principal.orgId, ...subjectIds],
  ) : [];
  const subjectById = new Map(subjectRows.map((subject) => [subject.id, subject]));
  const nodes: Node[] = subjectIds.map((id) => ({
    id: `subject:${id}`,
    type: "subject",
    label: subjectById.get(id)?.label ?? id,
    trust: "canonical",
    status: "active",
    created_at: subjectById.get(id)?.created_at ?? selected.find((claim) => claim.subject_id === id)!.created_at,
    degree: 0,
  }));
  nodes.push(...selected.map((claim) => ({
    id: claim.id,
    type: "claim" as const,
    label: claim.statement,
    kind: claim.kind,
    subject_id: claim.subject_id,
    trust: claim.trust,
    status: claim.status,
    created_at: claim.created_at,
    project_ref: claim.project_ref,
    degree: 0,
  })));
  const edges: Edge[] = selected.map((claim) => ({
    from: claim.id, to: `subject:${claim.subject_id}`, relation: "about",
  }));
  if (selected.length) {
    const ids = selected.map((claim) => claim.id);
    const links = await ctx.app.db.all<{ source_claim_id: string; target_claim_id: string; relation: string }>(
      `SELECT source_claim_id, target_claim_id, relation FROM claim_links
        WHERE org_id = ? AND source_claim_id IN (${ids.map(() => "?").join(", ")})
          AND target_claim_id IN (${ids.map(() => "?").join(", ")})
        ORDER BY created_at, id`,
      [principal.orgId, ...ids, ...ids],
    );
    for (const link of links) edges.push({
      from: link.source_claim_id,
      to: link.target_claim_id,
      relation: link.relation === "conflict_candidate" ? "contradicts" : "related",
    });
    for (const claim of selected)
      if (claim.superseded_by && claimIds.has(claim.superseded_by))
        edges.push({ from: claim.id, to: claim.superseded_by, relation: "supersedes" });
  }
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  for (const node of nodes) node.degree = degree.get(node.id) ?? 0;
  const totalEdges = Number(totals?.claim_count ?? 0) + Number(totals?.link_count ?? 0)
    + Number(totals?.supersede_count ?? 0);
  const withheldEdges = Math.max(0, totalEdges - edges.length);
  return { lens: "workspace_graph", focus_id: selected[0]?.id ?? null, nodes, edges,
    truncated, withheld_edges: withheldEdges,
    metadata: { workspace_id: workspaceId, truncated, withheld_edges: withheldEdges,
      node_count: nodes.length, edge_count: edges.length } };
}

async function loadAuditRefs(ctx: RequestContext, claimIds: string[]): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  if (!hasScope(ctx.principal!, "audit:read")) return grouped;
  for (const ids of chunk(claimIds, MAX_BOUND_PARAMS - 1)) {
    if (!ids.length) continue;
    const rows = await ctx.app.db.all<{ resource_id: string; id: string }>(
      `SELECT resource_id, id FROM audit_log
        WHERE org_id = ? AND resource_type = 'claim'
          AND resource_id IN (${ids.map(() => "?").join(", ")})
        ORDER BY created_at, id`,
      [ctx.principal!.orgId, ...ids],
    );
    for (const row of rows) {
      const refs = grouped.get(row.resource_id) ?? [];
      refs.push(row.id);
      grouped.set(row.resource_id, refs);
    }
  }
  return grouped;
}

async function reviewQueue(
  ctx: RequestContext,
  subjectId: string | null,
  ownerId: string | null,
  reason: (typeof REVIEW_REASONS)[number],
  cursor: ReviewCursor | null,
  limit: number,
  mode: AccessMode,
): Promise<ViewResult> {
  const principal = ctx.principal!;
  const scoredConditions = ["c.org_id = ?", "c.status IN ('active', 'disputed')", accessSql("c", mode)];
  const params: (string | number | null)[] = [
    ...accessParams(principal, mode),
    principal.orgId,
    ...accessParams(principal, mode),
  ];
  if (subjectId) { scoredConditions.push("c.subject_id = ?"); params.push(subjectId); }
  if (ownerId) { scoredConditions.push("c.actor_id = ?"); params.push(ownerId); }

  const reasonCondition = {
    all: "1 = 1",
    disputed: "status = 'disputed'",
    contradiction: "has_contradiction = 1",
    low_confidence: "confidence < 0.7",
    negative_feedback: "incorrect_count > 0 OR harmful_count > 0",
  }[reason];
  const cursorCondition = cursor
    ? `AND (
         priority < ?
         OR (priority = ? AND confidence > ?)
         OR (priority = ? AND confidence = ? AND created_at > ?)
         OR (priority = ? AND confidence = ? AND created_at = ? AND id > ?)
       )`
    : "";
  if (cursor) params.push(
    cursor.priority,
    cursor.priority, cursor.confidence,
    cursor.priority, cursor.confidence, cursor.createdAt,
    cursor.priority, cursor.confidence, cursor.createdAt, cursor.id,
  );
  params.push(limit + 1);

  const rows = await ctx.app.db.all<{
    id: string; statement: string; trust: string; status: string; actor_id: string;
    confidence: number; valid_to: string | null; created_at: string; has_contradiction: number;
    incorrect_count: number; harmful_count: number; priority: number; remaining_count: number;
  }>(
    `WITH scored AS (
       SELECT c.id, c.statement, c.trust, c.status, c.actor_id, c.confidence, c.valid_to, c.created_at,
              ${contradictedSql("c", mode === "organization_admin")} AS has_contradiction,
              (SELECT COUNT(*) FROM context_feedback f
                WHERE f.org_id = c.org_id AND f.claim_id = c.id AND f.outcome = 'incorrect') AS incorrect_count,
              (SELECT COUNT(*) FROM context_feedback f
                WHERE f.org_id = c.org_id AND f.claim_id = c.id AND f.outcome = 'harmful') AS harmful_count
         FROM claims c
        WHERE ${scoredConditions.join(" AND ")}
     ), eligible AS (
       SELECT *, CASE
         WHEN harmful_count > 0 THEN 4
         WHEN status = 'disputed' OR has_contradiction = 1 THEN 3
         WHEN incorrect_count > 0 THEN 2
         ELSE 1
       END AS priority
       FROM scored
       WHERE status = 'disputed' OR has_contradiction = 1 OR confidence < 0.7
          OR incorrect_count > 0 OR harmful_count > 0
     ), filtered AS (
       SELECT * FROM eligible WHERE ${reasonCondition}
     )
     SELECT *, COUNT(*) OVER() AS remaining_count FROM filtered
      WHERE 1 = 1 ${cursorCondition}
      ORDER BY priority DESC, confidence ASC, created_at ASC, id ASC
      LIMIT ?`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const claimIds = page.map((row) => row.id);
  const [evidence, audits] = await Promise.all([
    loadAuthorizedEvidenceIds(ctx.app.db, principal, claimIds, mode === "organization_admin"),
    loadAuditRefs(ctx, claimIds),
  ]);
  const nodes: ReviewNode[] = page.map((row) => {
    const reasons = [
      ...(row.status === "disputed" ? ["disputed"] : []),
      ...(row.has_contradiction ? ["contradiction"] : []),
      ...(row.confidence < 0.7 ? ["low_confidence"] : []),
      ...(row.incorrect_count ? ["incorrect_feedback"] : []),
      ...(row.harmful_count ? ["harmful_feedback"] : []),
    ];
    const nextAction = row.harmful_count
      ? "inspect_harmful_feedback"
      : row.status === "disputed" || row.has_contradiction
        ? "review_conflicting_evidence"
        : row.incorrect_count
          ? "validate_incorrect_feedback"
          : "collect_supporting_evidence";
    return {
      id: row.id,
      type: "claim",
      label: row.statement,
      trust: row.trust,
      status: row.status,
      created_at: row.created_at,
      confidence: row.confidence,
      priority: row.priority,
      reasons,
      owner_id: row.actor_id,
      next_action: nextAction,
      deadline: row.valid_to,
      terminal_state: null,
      evidence_refs: evidence.get(row.id) ?? [],
      audit_refs: audits.get(row.id) ?? [],
    };
  });
  const tail = page.at(-1);
  return {
    lens: "review_queue",
    focus_id: null,
    nodes,
    edges: [],
    metadata: {
      subject_id: subjectId,
      owner_id: ownerId,
      reason,
      page_count: nodes.length,
      remaining_count: rows[0]?.remaining_count ?? 0,
      next_cursor: hasMore && tail ? encodeCursor({ priority: tail.priority, confidence: tail.confidence, createdAt: tail.created_at, id: tail.id }) : null,
    },
  };
}

async function scopePreview(ctx: RequestContext, principalId: string): Promise<ViewResult> {
  if (!hasScope(ctx.principal!, "governance:read")) throw notFound();
  await requireOrgRole(ctx, ["owner", "admin", "reader"], "atlas.scope_preview");
  const target = await first<{ principal_id: string; principal_kind: string }>(
    ctx.app.db,
    `SELECT principal_id, principal_kind FROM api_keys
      WHERE org_id = ? AND principal_id = ? AND revoked_at IS NULL
     UNION
     SELECT principal_id, principal_kind FROM memberships
      WHERE org_id = ? AND principal_id = ? AND removed_at IS NULL
     LIMIT 1`,
    [ctx.principal!.orgId, principalId, ctx.principal!.orgId, principalId],
  );
  if (!target) throw notFound();
  const roles = await ctx.app.db.all<{ workspace_id: string | null; role: string }>(
    `SELECT workspace_id, role FROM memberships
      WHERE org_id = ? AND principal_id = ? AND removed_at IS NULL
      ORDER BY workspace_id, role`,
    [ctx.principal!.orgId, principalId],
  );
  return {
    lens: "scope_preview",
    focus_id: principalId,
    nodes: [{ id: principalId, type: "principal", label: target.principal_kind, trust: "n/a", status: "active", created_at: "" }],
    edges: [],
    metadata: {
      principal_id: principalId,
      principal_kind: target.principal_kind,
      organization_role: roles.find((role) => role.workspace_id === null)?.role ?? null,
      workspace_roles: roles.filter((role) => role.workspace_id !== null),
      preview_only: true,
      authority_granted: false,
    },
  };
}

async function knowledgeReleaseView(ctx: RequestContext, channelId: string | null, limit: number): Promise<ViewResult> {
  if (!hasScope(ctx.principal!, "releases:read")) throw notFound();
  await requireOrgRole(ctx, ["owner", "admin", "reader"], "atlas.knowledge_release");
  if (channelId) {
    const channel = await first<{ id: string }>(ctx.app.db,
      `SELECT id FROM channels WHERE id = ? AND org_id = ?`, [channelId, ctx.principal!.orgId]);
    if (!channel) throw notFound();
  }
  const rows = await ctx.app.db.all<{
    id: string; channel_id: string; claim_id: string; claim_version: number;
    audience: string; released_content: string; status: string; created_at: string;
  }>(
    `SELECT id, channel_id, claim_id, claim_version, audience, released_content,
            lifecycle_status AS status, created_at
       FROM channel_releases
      WHERE org_id = ? AND channel_id IS NOT NULL AND (? IS NULL OR channel_id = ?)
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    [ctx.principal!.orgId, channelId, channelId, limit],
  );
  return {
    lens: "knowledge_release",
    focus_id: channelId,
    nodes: rows.map((row) => ({
      id: row.id,
      type: "release" as const,
      label: row.released_content,
      trust: "reviewed_snapshot",
      status: row.status,
      created_at: row.created_at,
    })),
    edges: [],
    metadata: {
      channel_id: channelId,
      release_count: rows.length,
      audiences: [...new Set(rows.map((row) => row.audience))].sort(),
      source_refs: rows.map((row) => ({
        release_id: row.id,
        claim_id: row.claim_id,
        claim_version: row.claim_version,
      })),
      source_evidence_included: false,
    },
  };
}

// --- Entry point ---

export async function compileView(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const lens = requireEnum(body, "lens", LENSES);
  const focusId = optionalString(body, "focus_id", 200);
  const subjectId = optionalString(body, "subject_id", 200);
  const ownerId = optionalString(body, "owner_id", 200);
  const workspaceId = optionalString(body, "workspace_id", 200);
  const cursor = decodeCursor(optionalString(body, "cursor", 1000));
  const reviewReason = requireEnum({ review_reason: body.review_reason ?? "all" }, "review_reason", REVIEW_REASONS);
  const accessMode = requireEnum({ access_mode: body.access_mode ?? "principal" }, "access_mode", ACCESS_MODES);
  const administratorReason = accessMode === "organization_admin"
    ? requireEnum(body, "administrator_reason", ADMINISTRATOR_REASONS)
    : null;
  const limit = clampLimit(body);
  const maxNodes = body.max_nodes === undefined ? 150 : body.max_nodes;
  if (!Number.isInteger(maxNodes) || Number(maxNodes) < 25 || Number(maxNodes) > 300)
    throw validationError('Field "max_nodes" must be an integer between 25 and 300.');

  if (accessMode === "organization_admin") {
    if (!hasScope(principal, "views:compile:all")) throw notFound();
    await requireOrgRole(ctx, ["owner"], "atlas.organization_admin");
  }

  const orgId = principal.orgId;
  const principalId = principal.principalId;

  let view: ViewResult;

  switch (lens) {
    case "evidence_trace": {
      if (!focusId) throw validationError('Field "focus_id" is required for evidence_trace lens.');
      view = await evidenceTrace(ctx, focusId, orgId, principal, accessMode, limit);
      break;
    }
    case "neighborhood": {
      if (!subjectId) throw validationError('Field "subject_id" is required for neighborhood lens.');
      view = await neighborhood(ctx, subjectId, orgId, principal, limit, accessMode);
      break;
    }
    case "conflict_freshness": {
      if (!subjectId) throw validationError('Field "subject_id" is required for conflict_freshness lens.');
      view = await conflictFreshness(ctx, subjectId, orgId, principal, limit, accessMode);
      break;
    }
    case "review_queue": {
      view = await reviewQueue(ctx, subjectId, ownerId, reviewReason, cursor, limit, accessMode);
      break;
    }
    case "scope_preview": {
      if (!focusId) throw validationError('Field "focus_id" is required for scope_preview lens.');
      view = await scopePreview(ctx, focusId);
      break;
    }
    case "workspace_graph": {
      view = await workspaceGraph(ctx, workspaceId, Number(maxNodes), accessMode);
      break;
    }
    case "knowledge_release": {
      view = await knowledgeReleaseView(ctx, focusId, limit);
      break;
    }
  }

  view.metadata.authorization = {
    principal_id: principalId,
    access_mode: accessMode,
  };
  if (accessMode === "organization_admin") {
    await ctx.app.db.batch([auditStatement(
      orgId,
      principalId,
      "memory_view.compile.admin",
      "memory_view",
      ctx.app.now().toISOString(),
      focusId ?? subjectId,
      JSON.stringify({
        lens,
        subject_id: subjectId,
        focus_id: focusId,
        access_mode: accessMode,
        reason: administratorReason,
      }),
    )]);
  }

  return { data: view };
}
