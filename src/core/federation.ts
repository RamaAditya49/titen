import { first } from "./db";
import type { Db } from "./db";
import { notFound, validationError, conflict, forbidden } from "./errors";
import { newId, sha256Hex } from "./ids";
import type { RequestContext, Result } from "./http";
import { LIMITS, requireObject, requireString, optionalString, requireEnum } from "./validate";

const DIRECTIONS = ["push", "pull", "bidirectional"] as const;
const TRUST_FILTERS = ["unverified", "asserted", "verified", "policy_approved"] as const;
const RESOURCE_TYPES = ["observation", "claim", "event"] as const;

// --- Peers ---

/** POST /v1/federation/peers */
export async function registerPeer(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const name = requireString(body, "name", LIMITS.label);
  const endpoint = requireString(body, "endpoint", 2000);
  const sharedSecret = requireString(body, "shared_secret", 512);
  const direction = requireEnum(body, "direction", DIRECTIONS);

  const id = newId("fpeer");
  const now = ctx.app.now().toISOString();
  const hash = await sha256Hex(sharedSecret);

  await ctx.app.db.batch([
    {
      sql: `INSERT INTO federation_peers (id, org_id, name, endpoint, shared_secret_hash, direction, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      params: [id, principal.orgId, name, endpoint, hash, direction, now],
    },
  ]);

  return { status: 201, data: { peer_id: id, name, endpoint, direction, status: "active", created_at: now } };
}

/** GET /v1/federation/peers */
export async function listPeers(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const rows = await ctx.app.db.all<{
    id: string;
    name: string;
    endpoint: string;
    direction: string;
    status: string;
    last_cursor: string | null;
    last_sync_at: string | null;
    created_at: string;
  }>(
    `SELECT id, name, endpoint, direction, status, last_cursor, last_sync_at, created_at
       FROM federation_peers WHERE org_id = ? ORDER BY created_at DESC`,
    [principal.orgId],
  );
  return { data: { peers: rows.map((r) => ({ peer_id: r.id, ...r, id: undefined })) } };
}

/** POST /v1/federation/peers/:id/suspend */
export async function suspendPeer(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const peerId = ctx.params.id!;

  const peer = await first<{ id: string; status: string }>(
    ctx.app.db,
    `SELECT id, status FROM federation_peers WHERE id = ? AND org_id = ?`,
    [peerId, principal.orgId],
  );
  if (!peer) throw notFound();
  if (peer.status === "revoked") throw forbidden("Cannot suspend a revoked peer.");

  await ctx.app.db.batch([
    {
      sql: `UPDATE federation_peers SET status = 'suspended' WHERE id = ?`,
      params: [peerId],
    },
  ]);

  return { data: { id: peerId, status: "suspended" } };
}

// --- Filters ---

/** POST /v1/federation/peers/:id/filters */
export async function addFilter(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const peerId = ctx.params.id!;

  const peer = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM federation_peers WHERE id = ? AND org_id = ?`,
    [peerId, principal.orgId],
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
  const principal = ctx.principal!;
  const peerId = ctx.params.id!;

  const peer = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM federation_peers WHERE id = ? AND org_id = ?`,
    [peerId, principal.orgId],
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

/** POST /v1/federation/pull — pull local events matching peer filters from cursor. */
export async function pullEvents(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const peerId = requireString(body, "peer_id", LIMITS.identifier);

  const peer = await first<{ id: string; direction: string; status: string; last_cursor: string | null }>(
    ctx.app.db,
    `SELECT id, direction, status, last_cursor FROM federation_peers WHERE id = ? AND org_id = ?`,
    [peerId, principal.orgId],
  );
  if (!peer) throw notFound();
  if (peer.status !== "active") throw forbidden("Peer is not active.");
  if (peer.direction === "push") throw forbidden("Peer is configured for push only.");

  const filters = await ctx.app.db.all<FilterRow>(
    `SELECT resource_type, include_kinds, exclude_subjects, min_trust FROM federation_filters WHERE peer_id = ?`,
    [peerId],
  );

  // Fetch events after cursor
  const conditions: string[] = ["org_id = ?"];
  const params: (string | number)[] = [principal.orgId];

  if (peer.last_cursor) {
    const cursor = await first<{ created_at: string; id: string }>(
      ctx.app.db,
      `SELECT created_at, id FROM events WHERE id = ? AND org_id = ?`,
      [peer.last_cursor, principal.orgId],
    );
    if (cursor) {
      conditions.push("(created_at > ? OR (created_at = ? AND id > ?))");
      params.push(cursor.created_at, cursor.created_at, cursor.id);
    }
  }

  params.push(200);
  const rows = await ctx.app.db.all<{
    id: string;
    kind: string;
    actor_id: string;
    resource_type: string;
    resource_id: string;
    payload: string;
    created_at: string;
  }>(
    `SELECT id, kind, actor_id, resource_type, resource_id, payload, created_at
       FROM events WHERE ${conditions.join(" AND ")}
       ORDER BY created_at ASC, id ASC LIMIT ?`,
    params,
  );

  const events = rows
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      actor_id: r.actor_id,
      resource_type: r.resource_type,
      resource_id: r.resource_id,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
      created_at: r.created_at,
    }))
    .filter((e) => passesFilter(e, filters));

  // Update cursor to last event from the full batch (not filtered) so we don't re-scan
  const lastRow = rows[rows.length - 1];
  if (lastRow) {
    const now = ctx.app.now().toISOString();
    await ctx.app.db.batch([
      {
        sql: `UPDATE federation_peers SET last_cursor = ?, last_sync_at = ? WHERE id = ?`,
        params: [lastRow.id, now, peerId],
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

  return { data: { events, cursor: lastRow?.id ?? peer.last_cursor } };
}

/** POST /v1/federation/push — receive events from a remote peer. */
export async function pushEvents(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const peerId = requireString(body, "peer_id", LIMITS.identifier);

  const peer = await first<{ id: string; direction: string; status: string }>(
    ctx.app.db,
    `SELECT id, direction, status FROM federation_peers WHERE id = ? AND org_id = ?`,
    [peerId, principal.orgId],
  );
  if (!peer) throw notFound();
  if (peer.status !== "active") throw forbidden("Peer is not active.");
  if (peer.direction === "pull") throw forbidden("Peer is configured for pull only.");

  const filters = await ctx.app.db.all<FilterRow>(
    `SELECT resource_type, include_kinds, exclude_subjects, min_trust FROM federation_filters WHERE peer_id = ?`,
    [peerId],
  );

  const rawEvents = body.events;
  if (!Array.isArray(rawEvents)) throw validationError('Field "events" must be an array.');

  const now = ctx.app.now().toISOString();
  const results: { id: string; status: string; detail?: string }[] = [];
  const stmts: { sql: string; params: (string | number | null)[] }[] = [];

  for (const raw of rawEvents) {
    if (typeof raw !== "object" || raw === null || !("id" in raw)) {
      results.push({ id: "unknown", status: "rejected", detail: "Invalid event shape" });
      continue;
    }
    const evt = raw as Record<string, unknown>;
    const evtId = typeof evt.id === "string" ? evt.id : "unknown";
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

    // Check for conflict (already exists)
    const existing = await first<{ id: string }>(
      ctx.app.db,
      `SELECT id FROM events WHERE id = ? AND org_id = ?`,
      [evtId, principal.orgId],
    );

    if (existing) {
      results.push({ id: evtId, status: "conflict", detail: "Event already exists" });
      stmts.push({
        sql: `INSERT INTO federation_log (id, peer_id, direction, resource_type, resource_id, status, detail, created_at) VALUES (?, ?, 'received', ?, ?, 'conflict', ?, ?)`,
        params: [newId("flog"), peerId, resourceType, evtId, "Event already exists", now],
      });
      continue;
    }

    // Insert event
    const actorId = typeof evt.actor_id === "string" ? evt.actor_id : principal.principalId;
    stmts.push({
      sql: `INSERT INTO events (id, org_id, kind, actor_id, resource_type, resource_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [evtId, principal.orgId, kind, actorId, resourceType, resourceId, JSON.stringify(payload), now],
    });
    stmts.push({
      sql: `INSERT INTO federation_log (id, peer_id, direction, resource_type, resource_id, status, created_at) VALUES (?, ?, 'received', ?, ?, 'success', ?)`,
      params: [newId("flog"), peerId, resourceType, evtId, now],
    });
    results.push({ id: evtId, status: "success" });
  }

  if (stmts.length > 0) await ctx.app.db.batch(stmts);

  return { data: { results } };
}

// --- Log ---

/** GET /v1/federation/log */
export async function federationLog(ctx: RequestContext): Promise<Result> {
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

  // Verify peer belongs to org
  const peer = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM federation_peers WHERE id = ? AND org_id = ?`,
    [peerId, principal.orgId],
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
