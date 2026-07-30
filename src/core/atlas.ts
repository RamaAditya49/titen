import { first } from "./db";
import { recordAccessParams, recordAccessSql } from "./authorization";
import { notFound, validationError } from "./errors";
import type { RequestContext, Result } from "./http";
import { requireObject, requireString, optionalString, requireEnum } from "./validate";

const LENSES = ["evidence_trace", "neighborhood", "conflict_freshness"] as const;
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
    `SELECT c.id, c.statement, c.trust, c.status, c.visibility, c.actor_id, c.created_at
       FROM claims c
      WHERE c.id = ? AND c.org_id = ? AND ${recordAccessSql("c")}`,
    [focusId, orgId, ...recordAccessParams(principalId)],
  );
  if (!claim) throw notFound();

  const sources = await ctx.app.db.all<{ relation: string; obs_id: string; kind: string; content: string; trust: string; visibility: string; actor_id: string; ingested_at: string }>(
    `SELECT s.relation, o.id AS obs_id, o.kind, o.content, o.trust, o.visibility, o.actor_id, o.ingested_at
       FROM claim_sources s
       JOIN observations o ON o.id = s.observation_id
      WHERE s.claim_id = ? AND o.org_id = ? AND ${recordAccessSql("o")}
      ORDER BY o.ingested_at`,
    [focusId, orgId, ...recordAccessParams(principalId)],
  );

  const nodes: Node[] = [
    { id: claim.id, type: "claim", label: claim.statement, trust: claim.trust, status: claim.status, created_at: claim.created_at },
  ];
  const edges: Edge[] = [];

  for (const s of sources) {
    nodes.push({ id: s.obs_id, type: "observation", label: s.content.slice(0, 120), trust: s.trust, status: s.kind, created_at: s.ingested_at });
    edges.push({ from: s.obs_id, to: claim.id, relation: s.relation });
  }

  return { lens: "evidence_trace", focus_id: focusId, nodes, edges, metadata: { observation_count: edges.length } };
}

async function neighborhood(ctx: RequestContext, subjectId: string, orgId: string, principalId: string, limit: number): Promise<ViewResult> {
  const claims = await ctx.app.db.all<{ id: string; statement: string; trust: string; status: string; visibility: string; actor_id: string; created_at: string }>(
    `SELECT id, statement, trust, status, visibility, actor_id, created_at
       FROM claims c WHERE c.subject_id = ? AND c.org_id = ? AND c.status != 'revoked'
        AND ${recordAccessSql("c")}
      ORDER BY created_at DESC LIMIT ?`,
    [subjectId, orgId, ...recordAccessParams(principalId), limit],
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
        WHERE s.claim_id = ? AND o.org_id = ? AND ${recordAccessSql("o")}`,
      [c.id, orgId, ...recordAccessParams(principalId)],
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

async function conflictFreshness(ctx: RequestContext, subjectId: string, orgId: string, principalId: string, limit: number): Promise<ViewResult> {
  const now = ctx.app.now();

  // Claims that have at least one contradicting source
  const disputed = await ctx.app.db.all<{ id: string; statement: string; trust: string; status: string; visibility: string; actor_id: string; created_at: string }>(
    `SELECT DISTINCT c.id, c.statement, c.trust, c.status, c.visibility, c.actor_id, c.created_at
       FROM claims c
       JOIN claim_sources s ON s.claim_id = c.id AND s.relation = 'contradicts'
      WHERE c.org_id = ? AND c.subject_id = ? AND c.status != 'revoked'
        AND ${recordAccessSql("c")}
      ORDER BY c.created_at DESC LIMIT ?`,
    [orgId, subjectId, ...recordAccessParams(principalId), limit],
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
          AND ${recordAccessSql("o")}`,
      [c.id, orgId, ...recordAccessParams(principalId)],
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
  }

  return { data: view };
}
