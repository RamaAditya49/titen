import { createApp } from "../../core/app";
import { migrate } from "../../core/migrations";
import { createD1Db, type D1Database } from "./d1";
import { runMaintenance } from "../../core/maintenance";
import { tryCreateVectorize } from "./vectors";

export interface Env {
  DB: D1Database;
  /** Non-secret build marker surfaced by health and readiness. */
  TITEN_REVISION?: string;
  /** Set to "1" to apply pending migrations from the Worker itself. */
  TITEN_AUTO_MIGRATE?: string;
  VECTORIZE?: unknown;
  AI?: unknown;
  TITEN_EMBED_MODEL?: string;
  TITEN_EMBED_DIMS?: string;
}

let migration: Promise<unknown> | undefined;

/**
 * The Worker owns bindings and nothing else. All behavior lives in the shared
 * core, so Cloudflare and Bun cannot drift apart.
 *
 * No account API token is present: D1 is reached through its native binding.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const db = createD1Db(env.DB);
    if (env.TITEN_AUTO_MIGRATE === "1") {
      // One attempt per isolate. A concurrent isolate that loses the race is
      // caught here and continues; readiness still reports the real version.
      migration ??= migrate(db).catch(() => undefined);
      await migration;
    }
    const vectors = tryCreateVectorize(env as any);
    const app = createApp({
      db,
      revision: env.TITEN_REVISION ?? "dev",
      runtime: "cloudflare-d1",
      vectors,
      // The request isolate cannot observe whether its external Cron Trigger exists.
      backgroundRepair: "external",
    });
    return app(request);
  },

  /**
   * Cron Trigger entry point. Cloudflare has no in-process timer, so the same
   * maintenance the Bun runtime runs on an interval is driven here by a schedule.
   * Configure it in wrangler.jsonc under `triggers.crons`; without one, indexing
   * and webhook delivery must be driven by calling their endpoints.
   */
  async scheduled(_event: unknown, env: Env, context: { waitUntil(p: Promise<unknown>): void }) {
    const db = createD1Db(env.DB);
    const vectors = tryCreateVectorize(env as never);
    // waitUntil so the platform does not cancel the pass when the handler returns.
    context.waitUntil(
      runMaintenance({ db, vectors }).then((result) => {
        if (result.indexed || result.delivered || result.errors.length)
          console.log(
            `maintenance indexed=${result.indexed} delivered=${result.delivered}${
              result.errors.length ? ` errors=${result.errors.join(",")}` : ""
            }`,
          );
      }),
    );
  },
};
