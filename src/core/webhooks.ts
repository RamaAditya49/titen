import { first } from "./db";
import { auditStatement } from "./audit";
import type { Db, Stmt } from "./db";
import { notFound, validationError, forbidden, unavailable } from "./errors";
import { newId, sha256Hex } from "./ids";
import { canPrincipalReadEvent, eventAccessSql } from "./events";
import type { RequestContext, Result } from "./http";
import { LIMITS, requireObject, requireString } from "./validate";
import { dispatchWebhook, validateWebhookDestination } from "./webhook-security";

const encoder = new TextEncoder();

/** Backoff schedule in milliseconds: 1min, 5min, 30min, 2hr, 12hr. */
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
const MAX_ATTEMPTS = 5;
const MAX_CONSECUTIVE_FAILURES = 10;
export const WEBHOOK_TIMEOUT_MS = 10_000;
const WEBHOOK_LEASE_MARGIN_MS = 5_000;

/** HMAC-SHA256 signature over a payload string using the Web Crypto API. */
export async function signPayload(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Route handlers ---

/** POST /v1/webhooks */
export async function registerWebhook(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const body = requireObject(await ctx.json());
  const url = requireString(body, "url", 2000);
  const secret = requireString(body, "secret", 512);
  if (secret.length < 16)
    throw validationError('Field "secret" must be at least 16 characters.');

  const rawEvents = body.events;
  if (!Array.isArray(rawEvents) || rawEvents.length === 0)
    throw validationError('Field "events" must be a non-empty array of event kinds.');
  for (const e of rawEvents) {
    if (typeof e !== "string" || e.trim() === "")
      throw validationError('Each entry in "events" must be a non-empty string.');
  }
  if (rawEvents.length > 50)
    throw validationError('Field "events" may contain at most 50 entries.');

  const id = newId("whk");
  if (!ctx.app.secretCipher) throw unavailable("Signing-secret encryption is not configured.");
  const destination = await validateWebhookDestination(url, ctx.app.webhookSecurity);
  const now = ctx.app.now().toISOString();
  const secretHash = await sha256Hex(secret);
  const encrypted = await ctx.app.secretCipher.encrypt(secret, `webhook:${id}`);
  const eventsStr = (rawEvents as string[]).join(",");

  await ctx.app.db.batch([
    {
      sql: `INSERT INTO webhooks
              (id, org_id, principal_id, url, secret_hash, secret, events, status, failure_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, ?)`,
      params: [
        id,
        principal.orgId,
        principal.principalId,
        destination.url,
        secretHash,
        encrypted,
        eventsStr,
        now,
      ],
    },
    auditStatement(
      principal.orgId, principal.principalId, "webhook.register", "webhook", now, id,
    ),
  ]);

  return {
    status: 201,
    data: {
      webhook_id: id,
      url: destination.url,
      events: rawEvents,
      status: "active",
      created_at: now,
      signing: {
        header: "X-Titen-Signature",
        algorithm: "HMAC-SHA256",
        format: "sha256=<hex>",
        note: "Compute HMAC-SHA256 of the raw JSON body using your secret to verify deliveries.",
      },
    },
  };
}

/** GET /v1/webhooks */
export async function listWebhooks(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const rows = await ctx.app.db.all<{
    id: string;
    url: string;
    events: string;
    status: string;
    failure_count: number;
    last_delivery_at: string | null;
    created_at: string;
  }>(
    `SELECT id, url, events, status, failure_count, last_delivery_at, created_at
       FROM webhooks WHERE org_id = ? AND principal_id = ? ORDER BY created_at DESC`,
    [principal.orgId, principal.principalId],
  );

  return {
    data: {
      webhooks: rows.map((r) => ({
        webhook_id: r.id,
        ...r,
        id: undefined,
        events: r.events.split(","),
      })),
    },
  };
}

/** DELETE /v1/webhooks/:id */
export async function deleteWebhook(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const webhookId = ctx.params.id!;

  const hook = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM webhooks WHERE id = ? AND org_id = ? AND principal_id = ?`,
    [webhookId, principal.orgId, principal.principalId],
  );
  if (!hook) throw notFound();

  await ctx.app.db.batch([
    { sql: `DELETE FROM webhook_deliveries WHERE webhook_id = ?`, params: [webhookId] },
    { sql: `DELETE FROM webhooks WHERE id = ?`, params: [webhookId] },
    auditStatement(
      principal.orgId, principal.principalId, "webhook.delete", "webhook",
      ctx.app.now().toISOString(), webhookId,
    ),
  ]);

  return { data: { id: webhookId, deleted: true } };
}

/** POST /v1/webhooks/:id/pause */
export async function pauseWebhook(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const webhookId = ctx.params.id!;

  const hook = await first<{ id: string; status: string }>(
    ctx.app.db,
    `SELECT id, status FROM webhooks WHERE id = ? AND org_id = ? AND principal_id = ?`,
    [webhookId, principal.orgId, principal.principalId],
  );
  if (!hook) throw notFound();
  if (hook.status === "disabled") throw forbidden("Cannot pause a disabled webhook.");

  await ctx.app.db.batch([
    { sql: `UPDATE webhooks SET status = 'paused' WHERE id = ?`, params: [webhookId] },
  ]);

  return { data: { id: webhookId, status: "paused" } };
}

/** POST /v1/webhooks/:id/resume */
export async function resumeWebhook(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const webhookId = ctx.params.id!;

  const hook = await first<{ id: string; status: string }>(
    ctx.app.db,
    `SELECT id, status FROM webhooks WHERE id = ? AND org_id = ? AND principal_id = ?`,
    [webhookId, principal.orgId, principal.principalId],
  );
  if (!hook) throw notFound();
  if (hook.status === "disabled") throw forbidden("Cannot resume a disabled webhook. Re-register it.");

  await ctx.app.db.batch([
    {
      sql: `UPDATE webhooks SET status = 'active', failure_count = 0 WHERE id = ?`,
      params: [webhookId],
    },
  ]);

  return { data: { id: webhookId, status: "active" } };
}

/** GET /v1/webhooks/:id/deliveries */
export async function listDeliveries(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const webhookId = ctx.params.id!;

  const hook = await first<{ id: string }>(
    ctx.app.db,
    `SELECT id FROM webhooks WHERE id = ? AND org_id = ? AND principal_id = ?`,
    [webhookId, principal.orgId, principal.principalId],
  );
  if (!hook) throw notFound();

  const limitParam = ctx.url.searchParams.get("limit");
  let limit = 50;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1)
      throw validationError('Query "limit" must be a positive integer.');
    limit = Math.min(parsed, 200);
  }

  const rows = await ctx.app.db.all<{
    id: string;
    event_id: string;
    status: string;
    attempts: number;
    last_attempt_at: string | null;
    next_retry_at: string | null;
    lease_expires_at: string | null;
    attempt_id: string | null;
    response_status: number | null;
    created_at: string;
  }>(
    `SELECT id, event_id, status, attempts, last_attempt_at, next_retry_at,
            lease_expires_at, attempt_id, response_status, created_at
       FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?`,
    [webhookId, limit],
  );

  return { data: { deliveries: rows } };
}

// --- Internal delivery ---

/** Insert stable delivery rows before any outbound request. */
async function queueEvent(
  db: Db,
  orgId: string,
  event: { id: string; kind: string; created_at: string },
  now: Date = new Date(),
  principalId?: string,
): Promise<void> {
  const hooks = await db.all<{ id: string; events: string; principal_id: string }>(
    `SELECT id, events, principal_id FROM webhooks
       WHERE org_id = ? AND status = 'active' AND principal_id IS NOT NULL
         AND created_at <= ? AND (? IS NULL OR principal_id = ?)`,
    [orgId, event.created_at, principalId ?? null, principalId ?? null],
  );
  const statements: Stmt[] = [];
  for (const hook of hooks) {
    const kinds = hook.events.split(",");
    if (
      (!kinds.includes("*") && !kinds.includes(event.kind))
      || !await canPrincipalReadEvent(db, orgId, hook.principal_id, event.id)
    ) continue;
    statements.push({
      sql: `INSERT OR IGNORE INTO webhook_deliveries
              (id, webhook_id, event_id, status, attempts, next_retry_at, created_at)
            VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
      params: [newId("dlv"), hook.id, event.id, now.toISOString(), now.toISOString()],
    });
  }
  if (statements.length) await db.batch(statements);
}

interface DueDelivery {
  id: string;
  webhook_id: string;
  event_id: string;
  attempts: number;
  url: string;
  secret: string | null;
  kind: string;
  payload: string;
}

export async function drainWebhookQueue(options: {
  db: Db;
  orgId: string;
  now: Date;
  limit: number;
  security: RequestContext["app"]["webhookSecurity"];
  cipher: RequestContext["app"]["secretCipher"];
  principalId?: string;
}): Promise<{ attempted: number; delivered: number }> {
  if (!options.security) throw unavailable("Webhook delivery security is not configured.");
  if (!options.cipher) throw unavailable("Signing-secret encryption is not configured.");
  const nowString = options.now.toISOString();
  await options.db.batch([{
    sql: `UPDATE webhook_deliveries
             SET status = 'expired', next_retry_at = NULL,
                 lease_token = NULL, lease_expires_at = NULL
           WHERE id IN (
             SELECT d.id FROM webhook_deliveries d
             JOIN webhooks w ON w.id = d.webhook_id
             JOIN events e ON e.id = d.event_id AND e.org_id = w.org_id
              WHERE w.org_id = ? AND d.status = 'pending'
                AND (? IS NULL OR w.principal_id = ?)
                AND (w.principal_id IS NULL OR NOT ${eventAccessSql("e", "w.principal_id")})
              ORDER BY COALESCE(d.next_retry_at, d.created_at), d.id LIMIT ?
           )`,
    params: [options.orgId, options.principalId ?? null, options.principalId ?? null, options.limit],
  }]);
  const due = await options.db.all<DueDelivery>(
    `SELECT d.id, d.webhook_id, d.event_id, d.attempts,
            w.url, w.secret, e.kind, e.payload
       FROM webhook_deliveries d
       JOIN webhooks w ON w.id = d.webhook_id
       JOIN events e ON e.id = d.event_id AND e.org_id = w.org_id
      WHERE w.org_id = ? AND w.status = 'active' AND w.principal_id IS NOT NULL
        AND (? IS NULL OR w.principal_id = ?) AND d.status = 'pending'
        AND ${eventAccessSql("e", "w.principal_id")}
        AND (d.next_retry_at IS NULL OR d.next_retry_at <= ?)
        AND (d.lease_expires_at IS NULL OR d.lease_expires_at <= ?)
      ORDER BY COALESCE(d.next_retry_at, d.created_at), d.id LIMIT ?`,
    [options.orgId, options.principalId ?? null, options.principalId ?? null,
      nowString, nowString, options.limit],
  );
  let attempted = 0;
  let delivered = 0;
  for (const row of due) {
    if (!row.secret) throw unavailable("Webhook signing secret is unavailable.");
    let secret: string;
    try {
      secret = await options.cipher.decrypt(row.secret, `webhook:${row.webhook_id}`);
    } catch {
      throw unavailable("Webhook signing key is unavailable.");
    }
    const timeoutMs = Math.max(1, Math.min(options.security.timeoutMs ?? WEBHOOK_TIMEOUT_MS, WEBHOOK_TIMEOUT_MS));
    const lease = newId("wlease");
    const attemptId = newId("wattempt");
    const leaseExpires = new Date(options.now.getTime() + timeoutMs + WEBHOOK_LEASE_MARGIN_MS).toISOString();
    await options.db.batch([
      {
        sql: `UPDATE webhook_deliveries
                 SET lease_token = ?, lease_expires_at = ?, attempt_id = ?, last_attempt_at = ?
               WHERE id = ? AND status = 'pending'
                 AND (next_retry_at IS NULL OR next_retry_at <= ?)
                 AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
                 AND EXISTS (SELECT 1 FROM webhooks WHERE id = ? AND status = 'active')
                 AND NOT EXISTS (
                   SELECT 1 FROM webhook_deliveries sibling
                    WHERE sibling.webhook_id = ? AND sibling.id <> ?
                      AND sibling.status = 'pending' AND sibling.lease_expires_at > ?
                 )`,
        params: [lease, leaseExpires, attemptId, nowString, row.id, nowString, nowString,
          row.webhook_id, row.webhook_id, row.id, nowString],
      },
    ]);
    const claimed = await first<{ lease_token: string | null }>(
      options.db,
      `SELECT lease_token FROM webhook_deliveries WHERE id = ?`,
      [row.id],
    );
    if (claimed?.lease_token !== lease) continue;
    attempted += 1;
    const payload = row.payload;
    const signature = await signPayload(secret, payload);
    let responseStatus: number | null = null;
    let success = false;
    try {
      const response = await dispatchWebhook(row.url, options.security, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Titen-Signature": `sha256=${signature}`,
          "X-Titen-Event": row.kind,
          "X-Titen-Delivery": row.id,
          "X-Titen-Attempt": attemptId,
        },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
      responseStatus = response.status;
      success = response.ok;
    } catch {
      success = false;
    }
    const attempts = row.attempts + 1;
    const status = success ? "success" : attempts >= MAX_ATTEMPTS ? "failed" : "pending";
    const nextRetry =
      !success && attempts < MAX_ATTEMPTS
        ? new Date(options.now.getTime() + RETRY_DELAYS_MS[attempts - 1]!).toISOString()
        : null;
    const hook: Stmt = success
      ? {
          sql: `UPDATE webhooks SET failure_count = 0, last_delivery_at = ?
                 WHERE id = ? AND EXISTS (
                   SELECT 1 FROM webhook_deliveries WHERE id = ? AND lease_token = ?
                 )`,
          params: [nowString, row.webhook_id, row.id, lease],
        }
      : {
          sql: `UPDATE webhooks
                   SET failure_count = failure_count + 1,
                       last_delivery_at = ?,
                       status = CASE WHEN failure_count + 1 >= ? THEN 'disabled' ELSE status END
                 WHERE id = ? AND EXISTS (
                   SELECT 1 FROM webhook_deliveries WHERE id = ? AND lease_token = ?
                 )`,
          params: [nowString, MAX_CONSECUTIVE_FAILURES, row.webhook_id, row.id, lease],
        };
    await options.db.batch([
      hook,
      {
        sql: `UPDATE webhook_deliveries
                 SET status = ?, attempts = ?, next_retry_at = ?, response_status = ?,
                     lease_token = NULL, lease_expires_at = NULL
               WHERE id = ? AND lease_token = ?`,
        params: [status, attempts, nextRetry, responseStatus, row.id, lease],
      },
      {
        sql: `UPDATE webhook_deliveries
                 SET status = 'failed', next_retry_at = NULL,
                     lease_token = NULL, lease_expires_at = NULL
               WHERE webhook_id = ? AND status = 'pending'
                 AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
                 AND EXISTS (SELECT 1 FROM webhooks WHERE id = ? AND status = 'disabled')`,
        params: [row.webhook_id, nowString, row.webhook_id],
      },
    ]);
    if (success) delivered += 1;
  }
  return { attempted, delivered };
}

/** Queue missing event/hook pairs and then claim due work. */
export async function processWebhooks(options: {
  db: Db;
  orgId: string;
  now: Date;
  limit: number;
  security: RequestContext["app"]["webhookSecurity"];
  cipher: RequestContext["app"]["secretCipher"];
  principalId?: string;
}): Promise<{ events: number; attempted: number; delivered: number; cursor: string | null }> {
  const events = await options.db.all<{ id: string; kind: string; created_at: string }>(
    `SELECT e.id, e.kind, e.created_at FROM events e
      WHERE e.org_id = ? AND EXISTS (
        SELECT 1 FROM webhooks w
         WHERE w.org_id = e.org_id AND w.status = 'active'
           AND w.principal_id IS NOT NULL
           AND (? IS NULL OR w.principal_id = ?)
           AND ${eventAccessSql("e", "w.principal_id")}
           AND w.created_at <= e.created_at
           AND ((',' || w.events || ',') LIKE '%,*,%' OR (',' || w.events || ',') LIKE '%,' || e.kind || ',%')
           AND NOT EXISTS (
             SELECT 1 FROM webhook_deliveries d
              WHERE d.webhook_id = w.id AND d.event_id = e.id
           )
      ) ORDER BY e.created_at, e.id LIMIT ?`,
    [options.orgId, options.principalId ?? null, options.principalId ?? null, options.limit],
  );
  // The durable delivery uniqueness rule advances later pages across passes.
  for (const event of events)
    await queueEvent(options.db, options.orgId, event, options.now, options.principalId);
  const result = await drainWebhookQueue(options);
  return {
    events: events.length,
    attempted: result.attempted,
    delivered: result.delivered,
    cursor: events.at(-1)?.id ?? null,
  };
}

/** POST /v1/webhooks/deliver — bounded at-least-once queue drain. */
export async function drainWebhooks(ctx: RequestContext): Promise<Result> {
  const { orgId, principalId } = ctx.principal!;
  const limit = Number(ctx.url.searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw validationError('Query "limit" must be an integer between 1 and 200.');
  const result = await processWebhooks({
    db: ctx.app.db,
    orgId,
    now: ctx.app.now(),
    limit,
    security: ctx.app.webhookSecurity,
    cipher: ctx.app.secretCipher,
    principalId,
  });
  const stats = await first<{
    pending: number;
    failed: number;
    oldest_retry: string | null;
    oldest_pending: string | null;
  }>(
    ctx.app.db,
    `SELECT
       SUM(CASE WHEN d.status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN d.status = 'failed' THEN 1 ELSE 0 END) AS failed,
       MIN(CASE WHEN d.status = 'pending' THEN d.next_retry_at END) AS oldest_retry,
       MIN(CASE WHEN d.status = 'pending' THEN d.created_at END) AS oldest_pending
       FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
      WHERE w.org_id = ? AND w.principal_id = ?`,
    [orgId, principalId],
  );
  return {
    data: {
      events_drained: result.events,
      delivery_attempts: result.attempted,
      delivered: result.delivered,
      cursor: result.cursor,
      pending_deliveries: Number(stats?.pending ?? 0),
      failed_deliveries: Number(stats?.failed ?? 0),
      oldest_retry_at: stats?.oldest_retry ?? null,
      oldest_pending_at: stats?.oldest_pending ?? null,
      semantics: "at_least_once",
    },
  };
}
