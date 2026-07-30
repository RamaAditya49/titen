import { first } from "./db";
import type { Db, Param } from "./db";
import { notFound, validationError, forbidden } from "./errors";
import { newId, sha256Hex } from "./ids";
import type { RequestContext, Result } from "./http";
import { LIMITS, requireObject, requireString } from "./validate";

const encoder = new TextEncoder();

/** Backoff schedule in milliseconds: 1min, 5min, 30min, 2hr, 12hr. */
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
const MAX_ATTEMPTS = 5;
const MAX_CONSECUTIVE_FAILURES = 10;

/** Allowed URL schemes: https required, except localhost for development. */
function validateWebhookUrl(url: string): void {
  if (
    !url.startsWith("https://") &&
    !url.startsWith("http://localhost") &&
    !url.startsWith("http://127.0.0.1")
  ) {
    throw validationError(
      'Field "url" must use https:// (or http://localhost / http://127.0.0.1 for development).',
    );
  }
  // Reject private/link-local ranges that could be used for SSRF
  const hostMatch = url.match(/^https?:\/\/([^/:]+)/);
  if (hostMatch) {
    const host = hostMatch[1]!;
    if (
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      throw validationError('Field "url" must not target private or link-local IP addresses.');
    }
  }
}

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

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

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

  validateWebhookUrl(url);

  const id = newId("whk");
  const now = ctx.app.now().toISOString();
  const secretHash = await sha256Hex(secret);
  const eventsStr = (rawEvents as string[]).join(",");

  await ctx.app.db.batch([
    {
      sql: `INSERT INTO webhooks (id, org_id, url, secret_hash, secret, events, status, failure_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?)`,
      params: [id, principal.orgId, url, secretHash, secret, eventsStr, now],
    },
  ]);

  return {
    status: 201,
    data: {
      webhook_id: id,
      url,
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
       FROM webhooks WHERE org_id = ? ORDER BY created_at DESC`,
    [principal.orgId],
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
    `SELECT id FROM webhooks WHERE id = ? AND org_id = ?`,
    [webhookId, principal.orgId],
  );
  if (!hook) throw notFound();

  await ctx.app.db.batch([
    { sql: `DELETE FROM webhook_deliveries WHERE webhook_id = ?`, params: [webhookId] },
    { sql: `DELETE FROM webhooks WHERE id = ?`, params: [webhookId] },
  ]);

  return { data: { id: webhookId, deleted: true } };
}

/** POST /v1/webhooks/:id/pause */
export async function pauseWebhook(ctx: RequestContext): Promise<Result> {
  const principal = ctx.principal!;
  const webhookId = ctx.params.id!;

  const hook = await first<{ id: string; status: string }>(
    ctx.app.db,
    `SELECT id, status FROM webhooks WHERE id = ? AND org_id = ?`,
    [webhookId, principal.orgId],
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
    `SELECT id, status FROM webhooks WHERE id = ? AND org_id = ?`,
    [webhookId, principal.orgId],
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
    `SELECT id FROM webhooks WHERE id = ? AND org_id = ?`,
    [webhookId, principal.orgId],
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
    response_status: number | null;
    created_at: string;
  }>(
    `SELECT id, event_id, status, attempts, last_attempt_at, next_retry_at, response_status, created_at
       FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?`,
    [webhookId, limit],
  );

  return { data: { deliveries: rows } };
}

// --- Internal delivery ---

/**
 * Deliver an event to all active webhooks in the org that subscribe to the event kind.
 *
 * The optional `fetcher` parameter enables testing without real HTTP. When absent,
 * deliveries are recorded as 'pending' for later retry by a background process.
 */
export async function deliverEvent(
  db: Db,
  orgId: string,
  eventKind: string,
  payload: object,
  now: Date = new Date(),
  fetcher?: Fetcher,
): Promise<void> {
  const hooks = await db.all<{
    id: string;
    url: string;
    secret: string | null;
    secret_hash: string;
    events: string;
    failure_count: number;
  }>(
    `SELECT id, url, secret, secret_hash, events, failure_count FROM webhooks
       WHERE org_id = ? AND status = 'active'`,
    [orgId],
  );

  const matching = hooks.filter((h) => {
    const subscribed = h.events.split(",");
    return subscribed.includes("*") || subscribed.includes(eventKind);
  });

  if (matching.length === 0) return;

  const payloadStr = JSON.stringify(payload);
  const nowStr = now.toISOString();

  for (const hook of matching) {
    const deliveryId = newId("dlv");
    const stmts: { sql: string; params: Param[] }[] = [
      {
        sql: `INSERT INTO webhook_deliveries (id, webhook_id, event_id, status, attempts, last_attempt_at, created_at)
              VALUES (?, ?, ?, 'pending', 0, NULL, ?)`,
        params: [deliveryId, hook.id, eventKind, nowStr],
      },
    ];

    if (fetcher) {
      // Attempt actual delivery
      // Signed with the shared secret so the receiver can verify without
      // holding anything Titen stores about it.
      const signature = await signPayload(hook.secret ?? hook.secret_hash, payloadStr);
      let success = false;
      let responseStatus: number | null = null;

      try {
        const resp = await fetcher(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Titen-Signature": `sha256=${signature}`,
            "X-Titen-Event": eventKind,
            "X-Titen-Delivery": deliveryId,
          },
          body: payloadStr,
        });
        responseStatus = resp.status;
        success = resp.status >= 200 && resp.status < 300;
      } catch {
        // Network error — treat as failure
        success = false;
      }

      if (success) {
        stmts[0] = {
          sql: `INSERT INTO webhook_deliveries (id, webhook_id, event_id, status, attempts, last_attempt_at, response_status, created_at)
                VALUES (?, ?, ?, 'success', 1, ?, ?, ?)`,
          params: [deliveryId, hook.id, eventKind, nowStr, responseStatus, nowStr],
        };
        stmts.push({
          sql: `UPDATE webhooks SET failure_count = 0, last_delivery_at = ? WHERE id = ?`,
          params: [nowStr, hook.id],
        });
      } else {
        const newFailureCount = hook.failure_count + 1;
        const attempts = 1;
        const nextRetryAt =
          attempts < MAX_ATTEMPTS
            ? new Date(now.getTime() + RETRY_DELAYS_MS[attempts - 1]!).toISOString()
            : null;
        const deliveryStatus = attempts >= MAX_ATTEMPTS ? "failed" : "pending";

        stmts[0] = {
          sql: `INSERT INTO webhook_deliveries (id, webhook_id, event_id, status, attempts, last_attempt_at, next_retry_at, response_status, created_at)
                VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          params: [deliveryId, hook.id, eventKind, deliveryStatus, nowStr, nextRetryAt, responseStatus, nowStr],
        };
        stmts.push({
          sql: `UPDATE webhooks SET failure_count = ?, last_delivery_at = ? WHERE id = ?`,
          params: [newFailureCount, nowStr, hook.id],
        });

        // Disable webhook after too many consecutive failures
        if (newFailureCount >= MAX_CONSECUTIVE_FAILURES) {
          stmts.push({
            sql: `UPDATE webhooks SET status = 'disabled' WHERE id = ?`,
            params: [hook.id],
          });
        }
      }
    }

    await db.batch(stmts);
  }
}

/**
 * POST /v1/webhooks/deliver — drains recorded events to subscribed webhooks.
 *
 * Delivery is pull-driven because a canonical write must not wait on an
 * outbound request, and neither runtime has a background worker in this
 * release. An operator calls this from a cron trigger or systemd timer.
 *
 * ponytail: no background worker. The ceiling is delivery latency equal to the
 * caller's schedule. Upgrade path: a Cloudflare Cron Trigger or a Bun timer
 * calling this same function, which needs no schema change.
 */
export async function drainWebhooks(ctx: RequestContext): Promise<Result> {
  const { orgId } = ctx.principal!;
  const after = ctx.url.searchParams.get("after") ?? "";
  const limitParam = Number(ctx.url.searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limitParam) || limitParam < 1 || limitParam > 200)
    throw validationError('Query "limit" must be an integer between 1 and 200.');

  const events = await ctx.app.db.all<{ id: string; kind: string; payload: string }>(
    `SELECT id, kind, payload FROM events
      WHERE org_id = ? AND id > ? ORDER BY created_at, id LIMIT ?`,
    [orgId, after, limitParam],
  );

  for (const event of events)
    await deliverEvent(
      ctx.app.db,
      orgId,
      event.kind,
      JSON.parse(event.payload),
      ctx.app.now(),
      globalThis.fetch,
    );

  const queued = await first<{ count: number }>(
    ctx.app.db,
    `SELECT COUNT(*) AS count FROM webhook_deliveries d
       JOIN webhooks w ON w.id = d.webhook_id
      WHERE w.org_id = ? AND d.status = 'pending'`,
    [orgId],
  );

  return {
    data: {
      events_drained: events.length,
      cursor: events.length ? events[events.length - 1]!.id : null,
      pending_deliveries: Number(queued?.count ?? 0),
    },
  };
}
