import { first } from "./db";
import { notFound, validationError } from "./errors";
import type { RequestContext, Result } from "./http";
import { requireObject, requireString, optionalString, requireEnum } from "./validate";

const LENSES = ["evidence_trace", "neighborhood", "conflict_freshness", "scope_preview"] as const;
type Lens = (typeof LENSES)[number];

interface Node {
  id: string;
  type: "claim" | "observation";
  label: string;
  trust: string;
  status: string;
  created_at: string;
  freshness?: number;
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

// --- Lens handlers ---

async function evidenceTrace(ctx: RequestContext, focusId: string, orgId: string, principalId: string): Promise<ViewResult> {
  const claim = await first<{ id: string; statement: string; trust: string; status: string; visibility: string; actor_id: string; created_at: string }>(
    ctx.app.db,
    `SELECT id, statement, trust, status, visibility, actor_id, created_at FROM claims WHERE id = ? AND org_id = ?`,
    [focusId, orgId],
  );
  if (!claim) throw notFound();
  if (claim.visibility === "private" && claim.actor_id !== principalId) throw notFound();

  const sources = await ctx.app.db.all<{ relation: string; obs_id: string; kind: string; content: string; trust: string; visibility: string; actor_id: string; ingested_at: string }>(
    `SELECT s.relation, o.id AS obs_id, o.kind, o.content, o.trust, o.visibility, o.actor_id, o.ingested_at
       FROM claim_sources s
       JOIN observations o ON o.id = s.observation_id
      WHERE s.claim_id = ? AND o.org_id = ?
      ORDER BY o.ingested_at`,
    [focusId, orgId],
  );

  const nodes: Node[] = [
    { id: claim.id, type: "claim", label: claim.statement, trust: claim.trust, status: claim.status, created_at: claim.created_at },
  ];
  const edges: Edge[] = [];

  for (const s of sources) {
    if (s.visibility === "private" && s.actor_id !== principalId) continue;
    nodes.push({ id: s.obs_id, type: "observation", label: s.content.slice(0, 120), trust: s.trust, status: s.kind, created_at: s.ingested_at });
    edges.push({ from: s.obs_id, to: claim.id, relation: s.relation });
  }

  return { lens: "evidence_trace", focus_id: focusId, nodes, edges, metadata: { observation_count: edges.length } };
}

async function neighborhood(ctx: RequestContext, subjectId: string, orgId: string, principalId: string, limit: number): Promise<ViewResult> {
  const claims = await ctx.app.db.all<{ id: string; statement: string; trust: string; status: string; visibility: string; actor_id: string; created_at: string }>(
    `SELECT id, statement, trust, status, visibility, actor_id, created_at
       FROM claims WHERE subject_id = ? AND org_id = ? AND status != 'revoked'
      ORDER BY created_at DESC LIMIT ?`,
    [subjectId, orgId, limit],
  );

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const seenObs = new Set<string>();

  for (const c of claims) {
    if (c.visibility === "private" && c.actor_id !== principalId) continue;
    nodes.push({ id: c.id, type: "claim", label: c.statement, trust: c.trust, status: c.status, created_at: c.created_at });

    const sources = await ctx.app.db.all<{ obs_id: string; content: string; trust: string; visibility: string; actor_id: string; ingested_at: string; relation: string }>(
      `SELECT o.id AS obs_id, o.content, o.trust, o.visibility, o.actor_id, o.ingested_at, s.relation
         FROM claim_sources s
         JOIN observations o ON o.id = s.observation_id
        WHERE s.claim_id = ? AND o.org_id = ?`,
      [c.id, orgId],
    );

    for (const s of sources) {
      if (s.visibility === "private" && s.actor_id !== principalId) continue;
      if (!seenObs.has(s.obs_id)) {
        seenObs.add(s.obs_id);
        nodes.push({ id: s.obs_id, type: "observation", label: s.content.slice(0, 120), trust: s.trust, status: "active", created_at: s.ingested_at });
      }
      edges.push({ from: c.id, to: s.obs_id, relation: s.relation });
    }
  }

  return { lens: "neighborhood", focus_id: null, nodes, edges, metadata: { subject_id: subjectId, claim_count: claims.length } };
}

async function conflictFreshness(ctx: RequestContext, subjectId: string, orgId: string, principalId: string, limit: number): Promise<ViewResult> {
  const now = ctx.app.now();

  // Claims that have at least one contradicting source
  const disputed = await ctx.app.db.all<{ id: string; statement: string; trust: string; status: string; visibility: string; actor_id: string; created_at: string }>(
    `SELECT DISTINCT c.id, c.statement, c.trust, c.status, c.visibility, c.actor_id, c.created_at
       FROM claims c
       JOIN claim_sources s ON s.claim_id = c.id AND s.relation = 'contradicts'
      WHERE c.org_id = ? AND c.subject_id = ? AND c.status != 'revoked'
      ORDER BY c.created_at DESC LIMIT ?`,
    [orgId, subjectId, limit],
  );

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const seenObs = new Set<string>();

  for (const c of disputed) {
    if (c.visibility === "private" && c.actor_id !== principalId) continue;
    nodes.push({ id: c.id, type: "claim", label: c.statement, trust: c.trust, status: c.status, created_at: c.created_at, freshness: daysSince(c.created_at, now) });

    const contradictions = await ctx.app.db.all<{ obs_id: string; content: string; trust: string; visibility: string; actor_id: string; ingested_at: string }>(
      `SELECT o.id AS obs_id, o.content, o.trust, o.visibility, o.actor_id, o.ingested_at
         FROM claim_sources s
         JOIN observations o ON o.id = s.observation_id
        WHERE s.claim_id = ? AND s.relation = 'contradicts' AND o.org_id = ?`,
      [c.id, orgId],
    );

    for (const o of contradictions) {
      if (o.visibility === "private" && o.actor_id !== principalId) continue;
      if (!seenObs.has(o.obs_id)) {
        seenObs.add(o.obs_id);
        nodes.push({ id: o.obs_id, type: "observation", label: o.content.slice(0, 120), trust: o.trust, status: "contradiction", created_at: o.ingested_at, freshness: daysSince(o.ingested_at, now) });
      }
      edges.push({ from: o.obs_id, to: c.id, relation: "contradicts" });
    }
  }

  return { lens: "conflict_freshness", focus_id: null, nodes, edges, metadata: { subject_id: subjectId, disputed_count: disputed.length } };
}

async function scopePreview(ctx: RequestContext, orgId: string): Promise<ViewResult> {
  const now = ctx.app.now().toISOString();

  const [claimsByStatus, obsByKind, leaseCount, handoffCount] = await Promise.all([
    ctx.app.db.all<{ status: string; cnt: number }>(
      `SELECT status, COUNT(*) AS cnt FROM claims WHERE org_id = ? GROUP BY status`,
      [orgId],
    ),
    ctx.app.db.all<{ kind: string; cnt: number }>(
      `SELECT kind, COUNT(*) AS cnt FROM observations WHERE org_id = ? GROUP BY kind`,
      [orgId],
    ),
    first<{ cnt: number }>(
      ctx.app.db,
      `SELECT COUNT(*) AS cnt FROM leases WHERE org_id = ? AND released_at IS NULL AND expires_at > ?`,
      [orgId, now],
    ),
    first<{ cnt: number }>(
      ctx.app.db,
      `SELECT COUNT(*) AS cnt FROM handoffs WHERE org_id = ? AND status = 'pending'`,
      [orgId],
    ),
  ]);

  const claims: Record<string, number> = {};
  for (const r of claimsByStatus) claims[r.status] = r.cnt;

  const observations: Record<string, number> = {};
  for (const r of obsByKind) observations[r.kind] = r.cnt;

  return {
    lens: "scope_preview",
    focus_id: null,
    nodes: [],
    edges: [],
    metadata: {
      claims_by_status: claims,
      observations_by_kind: observations,
      active_leases: leaseCount?.cnt ?? 0,
      pending_handoffs: handoffCount?.cnt ?? 0,
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
  const limit = clampLimit(body);

  const orgId = principal.orgId;
  const principalId = principal.principalId;

  let view: ViewResult;

  switch (lens) {
    case "evidence_trace": {
      if (!focusId) throw validationError('Field "focus_id" is required for evidence_trace lens.');
      view = await evidenceTrace(ctx, focusId, orgId, principalId);
      break;
    }
    case "neighborhood": {
      if (!subjectId) throw validationError('Field "subject_id" is required for neighborhood lens.');
      view = await neighborhood(ctx, subjectId, orgId, principalId, limit);
      break;
    }
    case "conflict_freshness": {
      if (!subjectId) throw validationError('Field "subject_id" is required for conflict_freshness lens.');
      view = await conflictFreshness(ctx, subjectId, orgId, principalId, limit);
      break;
    }
    case "scope_preview": {
      view = await scopePreview(ctx, orgId);
      break;
    }
  }

  return { data: view };
}
