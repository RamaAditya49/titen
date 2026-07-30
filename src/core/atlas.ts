import { chunk, first, MAX_BOUND_PARAMS } from "./db";
import { hasScope } from "./auth";
import { recordAccessParams, recordAccessSql } from "./authorization";
import { loadAuthorizedEvidenceIds } from "./evidence";
import { notFound, validationError } from "./errors";
import type { RequestContext, Result } from "./http";
import { requireObject, optionalString, requireEnum } from "./validate";

const LENSES = ["evidence_trace", "neighborhood", "conflict_freshness", "review_queue"] as const;
type Lens = (typeof LENSES)[number];
const REVIEW_REASONS = ["all", "disputed", "contradiction", "low_confidence", "negative_feedback"] as const;

interface Node {
  id: string;
  type: "claim" | "observation";
  label: string;
  trust: string;
  status: string;
  created_at: string;
  freshness?: number;
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
): Promise<ViewResult> {
  const principal = ctx.principal!;
  const scoredConditions = ["c.org_id = ?", "c.status IN ('active', 'disputed')", recordAccessSql("c")];
  const params: (string | number | null)[] = [
    principal.principalId,
    principal.principalId,
    principal.orgId,
    ...recordAccessParams(principal.principalId),
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
              EXISTS (
                SELECT 1 FROM claim_sources s
                JOIN observations o ON o.id = s.observation_id
                WHERE s.claim_id = c.id AND s.relation = 'contradicts'
                  AND o.org_id = c.org_id AND ${recordAccessSql("o")}
              ) AS has_contradiction,
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
    loadAuthorizedEvidenceIds(ctx.app.db, principal, claimIds),
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

// --- Entry point ---

export async function compileView(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const lens = requireEnum(body, "lens", LENSES);
  const focusId = optionalString(body, "focus_id", 200);
  const subjectId = optionalString(body, "subject_id", 200);
  const ownerId = optionalString(body, "owner_id", 200);
  const cursor = decodeCursor(optionalString(body, "cursor", 1000));
  const reviewReason = requireEnum({ review_reason: body.review_reason ?? "all" }, "review_reason", REVIEW_REASONS);
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
    case "review_queue": {
      view = await reviewQueue(ctx, subjectId, ownerId, reviewReason, cursor, limit);
      break;
    }
  }

  return { data: view };
}
