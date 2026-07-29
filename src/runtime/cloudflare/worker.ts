import { createApp } from "../../core/app";
import { migrate } from "../../core/migrations";
import { createD1Db, type D1Database } from "./d1";

export interface Env {
  DB: D1Database;
  /** Non-secret build marker surfaced by health and readiness. */
  TITEN_REVISION?: string;
  /** Set to "1" to apply pending migrations from the Worker itself. */
  TITEN_AUTO_MIGRATE?: string;
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
    const app = createApp({
      db,
      revision: env.TITEN_REVISION ?? "dev",
      runtime: "cloudflare-d1",
    });
    return app(request);
  },
};
