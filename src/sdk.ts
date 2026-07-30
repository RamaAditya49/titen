/**
 * Titen Agent SDK — minimal TypeScript client for the memory service.
 *
 * Usage:
 *   import { TitenClient } from "titen-memory/sdk";
 *   const titen = new TitenClient({ url: "http://127.0.0.1:8787", key: "titen_sk_..." });
 *   const obs = await titen.observe({ subject_id: "user_x", kind: "tool_result", content: "...", source: { type: "tool", ref: "..." } });
 *   const ctx = await titen.compile({ subject_id: "user_x", task: "...", max_tokens: 900 });
 *   await titen.feedback(ctx.context_id, { outcome: "useful" });
 */

export interface TitenConfig {
  /** Base URL of the Titen API, e.g. "http://127.0.0.1:8787" */
  url: string;
  /** Bearer API key */
  key: string;
  /** Optional fetch implementation (defaults to global fetch) */
  fetch?: typeof fetch;
}

export type TitenHttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface TitenRequestOptions {
  /** JSON request body. Mutually exclusive with `body`. */
  json?: unknown;
  /** Raw request body for contracts such as JSONL import. */
  body?: BodyInit;
  /** Additional headers. Authorization always comes from TitenConfig. */
  headers?: HeadersInit;
  /** Retry-safe mutation identity. */
  idempotencyKey?: string;
}

export interface MutationOptions {
  idempotencyKey?: string;
}

export interface ConsolidateOptions extends MutationOptions {
  workspaceId?: string;
}

export interface Observation {
  subject_id: string;
  kind: "user_statement" | "tool_result" | "imported_source" | "decision" | "system_event";
  content: string;
  source: { type: string; ref?: string };
  trust?: "unverified" | "asserted" | "verified" | "policy_approved";
  visibility?: "private" | "team" | "organization";
  workspace_id?: string;
  project_id?: string;
  agent_id?: string;
  run_id?: string;
  occurred_at?: string;
}

export interface Claim {
  kind: string;
  statement: string;
  confidence?: number;
  sources: { observation_id: string; relation: "supports" | "contradicts" | "qualifies" }[];
  trust?: string;
  visibility?: string;
  valid_from?: string;
  valid_to?: string;
}

export interface CompileOptions {
  subject_id: string;
  task: string;
  max_tokens: number;
  project_id?: string;
  include_checkpoints?: boolean;
}

export interface FeedbackOptions {
  outcome: "used" | "useful" | "irrelevant" | "incorrect" | "harmful";
  claim_id?: string;
  reason_code?: string;
  client_mutation_id?: string;
}

export interface CheckpointOptions {
  subject_id: string;
  kind: "task_state" | "conversation" | "workflow" | "cursor";
  state: unknown;
  ttl_seconds: number;
  agent_id?: string;
  run_id?: string;
}

export interface LeaseOptions {
  resource_type: string;
  resource_id: string;
  purpose: string;
  ttl_seconds: number;
}

export interface HandoffOptions {
  to_principal: string;
  subject_id: string;
  context_id?: string;
  checkpoint_id?: string;
  message?: string;
}

/** Typed convenience methods intentionally kept to the common agent path. */
export const TITEN_SDK_TYPED_ROUTES = [
  ["health", "GET /healthz"],
  ["ready", "GET /readyz"],
  ["resolveProject", "POST /v1/projects/resolve"],
  ["observe", "POST /v1/observations"],
  ["consolidate", "POST /v1/consolidations"],
  ["compile", "POST /v1/context/compile"],
  ["feedback", "POST /v1/context/:id/feedback"],
  ["evidence", "GET /v1/claims/:id/evidence"],
  ["supersede", "POST /v1/claims/:id/supersede"],
  ["revoke", "POST /v1/claims/:id/revoke"],
  ["expire", "POST /v1/claims/:id/expire"],
  ["saveCheckpoint", "POST /v1/checkpoints"],
  ["getCheckpoint", "GET /v1/checkpoints"],
  ["deleteCheckpoint", "DELETE /v1/checkpoints/:id"],
  ["acquireLease", "POST /v1/leases"],
  ["releaseLease", "DELETE /v1/leases/:id"],
  ["createHandoff", "POST /v1/handoffs"],
  ["listHandoffs", "GET /v1/handoffs"],
  ["resolveHandoff", "POST /v1/handoffs/:id/resolve"],
  ["compileView", "POST /v1/memory-views/compile"],
  ["createKey", "POST /v1/keys"],
  ["listKeys", "GET /v1/keys"],
  ["revokeKey", "DELETE /v1/keys/:id"],
] as const;

export class TitenError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TitenError";
    this.status = status;
    this.code = code;
  }
}

export class TitenClient {
  private url: string;
  private key: string;
  private f: typeof fetch;

  constructor(config: TitenConfig) {
    if (!config || typeof config !== "object") throw new TypeError("config is required");
    if (typeof config.url !== "string" || config.url.trim() === "")
      throw new TypeError("url is required and must be an absolute http(s) URL");
    let parsed: URL;
    try {
      parsed = new URL(config.url);
    } catch {
      throw new TypeError("url is required and must be an absolute http(s) URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new TypeError("url is required and must be an absolute http(s) URL");
    if (typeof config.key !== "string" || config.key.trim() === "")
      throw new TypeError("key is required");
    const configuredFetch = config.fetch === undefined ? globalThis.fetch : config.fetch;
    if (typeof configuredFetch !== "function") throw new TypeError("fetch must be a function");

    this.url = parsed.href.replace(/\/+$/, "");
    this.key = config.key;
    this.f = configuredFetch;
  }

  /**
   * Generic authenticated JSON access for stable routes without a convenience
   * method. Authorization cannot be overridden by callers.
   */
  async request<T = any>(
    method: TitenHttpMethod,
    path: string,
    options: TitenRequestOptions = {},
  ): Promise<T> {
    const res = await this.requestRaw(method, path, options);
    if (res.status === 204 || res.status === 205) return undefined as T;
    const text = await res.text();
    if (text === "") return undefined as T;
    if (!isJson(res))
      throw new TitenError(res.status, "INVALID_RESPONSE", "Response was not valid JSON.");
    try {
      const json = JSON.parse(text) as { data?: T };
      return json.data as T;
    } catch {
      throw new TitenError(res.status, "INVALID_RESPONSE", "Response was not valid JSON.");
    }
  }

  /** Raw authenticated access for streaming/JSONL responses. */
  async requestRaw(
    method: TitenHttpMethod,
    path: string,
    options: TitenRequestOptions = {},
  ): Promise<Response> {
    const allowed = new Set<TitenHttpMethod>(["GET", "POST", "PATCH", "PUT", "DELETE"]);
    if (!allowed.has(method)) throw new TypeError("method is not supported");
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//"))
      throw new TypeError("path must be an absolute API path");
    if (options.json !== undefined && options.body !== undefined)
      throw new TypeError("json and body are mutually exclusive");

    const headers = new Headers(options.headers);
    if (headers.has("authorization")) throw new TypeError("authorization cannot be overridden");
    if (options.idempotencyKey !== undefined) {
      if (
        typeof options.idempotencyKey !== "string" ||
        options.idempotencyKey.trim() === "" ||
        options.idempotencyKey.length > 200
      ) throw new TypeError("idempotencyKey must contain 1 to 200 characters");
      if (headers.has("idempotency-key"))
        throw new TypeError("idempotencyKey must be provided only once");
      headers.set("idempotency-key", options.idempotencyKey.trim());
    }
    headers.set("authorization", `Bearer ${this.key}`);
    if (options.json !== undefined) headers.set("content-type", "application/json");

    const target = new URL(`${this.url}${path}`);
    if (target.origin !== new URL(this.url).origin)
      throw new TypeError("path must remain on the configured origin");
    const res = await this.f(target, {
      method,
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    });
    if (!res.ok) await throwResponseError(res);
    return res;
  }

  // --- Core operations ---

  async health() { return this.request("GET", "/healthz"); }
  async ready() { return this.request("GET", "/readyz"); }

  async resolveProject(reference: string, create = false) {
    return this.request("POST", "/v1/projects/resolve", { json: { reference, create } });
  }

  async observe(observation: Observation, options: MutationOptions = {}) {
    return this.request("POST", "/v1/observations", {
      json: observation,
      idempotencyKey: options.idempotencyKey,
    });
  }

  async consolidate(
    subject_id: string,
    claims: Claim[],
    project_id?: string,
    options: ConsolidateOptions = {},
  ) {
    return this.request("POST", "/v1/consolidations", {
      json: { subject_id, claims, project_id, workspace_id: options.workspaceId },
      idempotencyKey: options.idempotencyKey,
    });
  }

  async compile(options: CompileOptions) {
    return this.request("POST", "/v1/context/compile", { json: options });
  }

  async feedback(
    contextId: string,
    feedback: FeedbackOptions,
    options: MutationOptions = {},
  ) {
    return this.request("POST", `/v1/context/${contextId}/feedback`, {
      json: feedback,
      idempotencyKey: options.idempotencyKey,
    });
  }

  async evidence(claimId: string) {
    return this.request("GET", `/v1/claims/${claimId}/evidence`);
  }

  // --- Lifecycle ---

  async supersede(claimId: string, supersededBy: string, expectedVersion: number, reason?: string) {
    return this.request("POST", `/v1/claims/${claimId}/supersede`, {
      json: { superseded_by: supersededBy, expected_version: expectedVersion, reason },
    });
  }

  async revoke(claimId: string, expectedVersion: number, reason?: string) {
    return this.request("POST", `/v1/claims/${claimId}/revoke`, {
      json: { expected_version: expectedVersion, reason },
    });
  }

  async expire(claimId: string, expectedVersion: number, reason?: string) {
    return this.request("POST", `/v1/claims/${claimId}/expire`, {
      json: { expected_version: expectedVersion, reason },
    });
  }

  // --- Checkpoints ---

  async saveCheckpoint(options: CheckpointOptions) {
    return this.request("POST", "/v1/checkpoints", { json: options });
  }

  async getCheckpoint(subject_id: string, kind: string, agent_id?: string) {
    const params = new URLSearchParams({ subject_id, kind });
    if (agent_id) params.set("agent_id", agent_id);
    return this.request("GET", `/v1/checkpoints?${params}`);
  }

  async deleteCheckpoint(checkpointId: string) {
    return this.request("DELETE", `/v1/checkpoints/${checkpointId}`);
  }

  // --- Coordination (records work; does not schedule it) ---

  async acquireLease(options: LeaseOptions) {
    return this.request("POST", "/v1/leases", { json: options });
  }

  async releaseLease(leaseId: string) {
    return this.request("DELETE", `/v1/leases/${leaseId}`);
  }

  async createHandoff(options: HandoffOptions) {
    return this.request("POST", "/v1/handoffs", { json: options });
  }

  async listHandoffs(status?: "pending" | "accepted" | "rejected") {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request("GET", `/v1/handoffs${query}`);
  }

  async resolveHandoff(handoffId: string, status: "accepted" | "rejected") {
    return this.request("POST", `/v1/handoffs/${handoffId}/resolve`, { json: { status } });
  }

  async compileView(
    lens: "evidence_trace" | "neighborhood" | "conflict_freshness" | "review_queue",
    options: {
      subject_id?: string;
      focus_id?: string;
      owner_id?: string;
      review_reason?: "all" | "disputed" | "contradiction" | "low_confidence" | "negative_feedback";
      cursor?: string;
      limit?: number;
    } = {},
  ) {
    return this.request("POST", "/v1/memory-views/compile", { json: { lens, ...options } });
  }

  // --- Keys ---

  async createKey(options: { label: string; scopes: string[]; max_trust?: string }) {
    return this.request("POST", "/v1/keys", { json: options });
  }

  async listKeys() {
    return this.request("GET", "/v1/keys");
  }

  async revokeKey(keyId: string) {
    return this.request("DELETE", `/v1/keys/${keyId}`);
  }
}

function isJson(response: Response): boolean {
  return /(^|[+/])json\b/i.test(response.headers.get("content-type") ?? "");
}

async function throwResponseError(response: Response): Promise<never> {
  if (isJson(response)) {
    try {
      const json = JSON.parse(await response.text()) as {
        error?: { code?: string; message?: string };
      };
      throw new TitenError(
        response.status,
        json.error?.code ?? "HTTP_ERROR",
        json.error?.message ?? `Request failed with status ${response.status}.`,
      );
    } catch (error) {
      if (error instanceof TitenError) throw error;
    }
  }
  throw new TitenError(
    response.status,
    "HTTP_ERROR",
    `Request failed with status ${response.status}.`,
  );
}
