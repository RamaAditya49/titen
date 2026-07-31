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
  /** Request timeout in milliseconds (defaults to 20 seconds). */
  timeoutMs?: number;
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
  /** Caller cancellation composed with the configured timeout. */
  signal?: AbortSignal;
}

export interface MutationOptions {
  idempotencyKey?: string;
}

export interface ConsolidateOptions extends MutationOptions {
  workspaceId?: string;
}

export type Trust = "unverified" | "asserted" | "verified" | "policy_approved";
export type Visibility = "private" | "team" | "organization";
export type ObservationKind =
  | "user_statement"
  | "tool_result"
  | "imported_source"
  | "decision"
  | "system_event";

export interface Observation {
  subject_id: string;
  kind: ObservationKind;
  content: string;
  source: { type: string; ref?: string };
  trust?: Trust;
  visibility?: Visibility;
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
  sources: {
    observation_id: string;
    relation: "supports" | "contradicts" | "qualifies";
  }[];
  trust?: string;
  visibility?: string;
  valid_from?: string;
  valid_to?: string;
}

export interface CompileOptions {
  subject_id: string;
  task: string;
  /** JSON token budget accepted by the server: 128 through 32,000. */
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

export interface CreateKeyOptions {
  label: string;
  scopes: string[];
  max_trust?: "unverified" | "asserted" | "verified" | "policy_approved";
  principal_id?: string;
  principal_kind?: "human" | "agent" | "service";
}

export interface CreatedKey {
  key_id: string;
  api_key: string;
  principal_id: string;
  principal_kind: "human" | "agent" | "service";
  label: string;
  scopes: string[];
  max_trust: "unverified" | "asserted" | "verified" | "policy_approved";
  warning: string;
}

export interface TitenResponseMeta extends Record<string, unknown> {
  request_id?: string;
  replayed?: boolean;
}

export interface TitenResponse<T> {
  data: T;
  meta: TitenResponseMeta;
}

export interface ProjectResolution {
  project_id: string;
  reference: string;
  created: boolean;
}

export interface ObservationRecord {
  observation_id: string;
  subject_id: string;
  project_id: string | null;
  workspace_id: string | null;
  agent_id: string | null;
  run_id: string | null;
  kind: ObservationKind;
  trust: Trust;
  visibility: Visibility;
  content_hash: string;
  occurred_at: string | null;
  ingested_at: string;
}

export interface ConsolidationResult {
  subject_id: string;
  project_id: string | null;
  workspace_id: string | null;
  model_used: false;
  claims: Array<{
    claim_id: string;
    kind: string;
    status: string;
    trust: Trust;
    visibility: Visibility;
    confidence: number;
    valid_from: string;
    valid_to: string | null;
    evidence_ids: string[];
  }>;
}

export interface ContextPack {
  context_id: string;
  query: string;
  scope: { subject_id: string; project_id: string | null };
  budget: { max_tokens: number; used_tokens: number };
  items: Array<{
    untrusted: true;
    claim_id: string;
    claim: string;
    kind: string;
    confidence: number;
    trust: Trust;
    status: string;
    observer_id: string | null;
    valid_from: string;
    valid_to: string | null;
    evidence_ids: string[];
    score: number;
    score_components: {
      relevance: number;
      trust: number;
      recency: number;
      utility: number;
      conflict: number;
      confidence: number;
    };
  }>;
  conflicts: Array<{
    claim_id: string;
    reason: string;
    evidence_ids: string[];
  }>;
  policy_snapshot: string;
  instructions: string;
}

export interface FeedbackResult {
  feedback_id: string;
  context_id: string;
  claim_id: string | null;
  outcome: FeedbackOptions["outcome"];
  recorded_at: string;
}

export interface EvidenceObservation {
  untrusted: true;
  observation_id: string;
  kind: string;
  content: string;
  content_hash: string;
  source: { type: string; ref: string | null };
  trust: Trust;
  visibility: Visibility;
  occurred_at: string | null;
  ingested_at: string;
}

export interface EvidenceResult {
  claim: {
    untrusted: true;
    claim_id: string;
    subject_id: string;
    project_id: string | null;
    workspace_id: string | null;
    observer_id: string | null;
    kind: string;
    claim: string;
    confidence: number;
    trust: Trust;
    visibility: Visibility;
    status: string;
    version: number;
    valid_from: string;
    valid_to: string | null;
    created_at: string;
  };
  evidence: {
    supporting: EvidenceObservation[];
    contradicting: EvidenceObservation[];
    qualifying: EvidenceObservation[];
  };
  instructions: string;
}

export interface CheckpointRecord {
  checkpoint_id: string;
  subject_id: string;
  agent_id: string;
  run_id: string | null;
  kind: CheckpointOptions["kind"];
  state: unknown;
  state_hash: string;
  ttl_seconds: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface CheckpointWriteResult {
  checkpoint_id: string;
  subject_id: string;
  agent_id: string;
  kind: CheckpointOptions["kind"];
  state_hash: string;
  expires_at: string;
  updated: boolean;
}

export interface Lease {
  lease_id: string;
  expires_at: string;
  renewed: boolean;
}

export interface Handoff {
  handoff_id: string;
  id: string;
  status: "pending";
  from_principal: string;
  to_principal: string;
  subject_id: string;
  context_id: string | null;
  checkpoint_id: string | null;
  message: string | null;
  created_at: string;
}

export interface CreatedHandoff {
  handoff_id: string;
  status: "pending";
}

export interface ResolvedHandoff {
  handoff_id: string;
  status: "accepted" | "rejected";
  resolved_at: string;
}

export interface ViewResult {
  lens:
    | "evidence_trace"
    | "neighborhood"
    | "conflict_freshness"
    | "review_queue";
  focus_id: string | null;
  nodes: Array<{
    id: string;
    type: "claim" | "observation";
    label: string;
    trust: string;
    status: string;
    created_at: string;
    [key: string]: unknown;
  }>;
  edges: Array<{ from: string; to: string; relation: string }>;
  metadata: Record<string, unknown>;
}

export interface ClaimLifecycleResult {
  claim_id: string;
  status: string;
  version?: number;
  reason?: string | null;
  superseded_by?: string;
  valid_to?: string;
  already_revoked?: boolean;
  already_expired?: boolean;
}

export interface KeyRecord {
  key_id: string;
  principal_id: string;
  principal_kind: "human" | "agent" | "service";
  label: string;
  scopes: string[];
  max_trust: Trust;
  created_at: string;
  revoked_at: string | null;
  status: "active" | "revoked";
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
  requestId?: string;
  meta?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TitenError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.meta =
      meta || requestId
        ? {
            ...meta,
            ...(requestId && typeof meta?.request_id !== "string"
              ? { request_id: requestId }
              : {}),
          }
        : undefined;
  }
}

export class TitenClient {
  private url: string;
  private key: string;
  private f: typeof fetch;
  private timeoutMs: number;

  constructor(config: TitenConfig) {
    if (!config || typeof config !== "object")
      throw new TypeError("config is required");
    if (typeof config.url !== "string" || config.url.trim() === "")
      throw new TypeError(
        "url is required and must be an absolute http(s) URL",
      );
    let parsed: URL;
    try {
      parsed = new URL(config.url);
    } catch {
      throw new TypeError(
        "url is required and must be an absolute http(s) URL",
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new TypeError(
        "url is required and must be an absolute http(s) URL",
      );
    if (typeof config.key !== "string" || config.key.trim() === "")
      throw new TypeError("key is required");
    const configuredFetch =
      config.fetch === undefined ? globalThis.fetch : config.fetch;
    if (typeof configuredFetch !== "function")
      throw new TypeError("fetch must be a function");
    const timeoutMs = config.timeoutMs ?? 20_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
      throw new TypeError("timeoutMs must be a positive safe integer");

    this.url = parsed.href.replace(/\/+$/, "");
    this.key = config.key;
    this.f = configuredFetch;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Generic authenticated JSON access for stable routes without a convenience
   * method. Authorization cannot be overridden by callers.
   */
  async request<T = unknown>(
    method: TitenHttpMethod,
    path: string,
    options: TitenRequestOptions = {},
  ): Promise<T> {
    return (await this.requestWithMeta<T>(method, path, options)).data;
  }

  /** Authenticated JSON access that preserves response metadata such as replay state. */
  async requestWithMeta<T = unknown>(
    method: TitenHttpMethod,
    path: string,
    options: TitenRequestOptions = {},
  ): Promise<TitenResponse<T>> {
    const res = await this.requestRaw(method, path, options);
    if (res.status === 204 || res.status === 205)
      return { data: undefined as T, meta: responseMeta(res) };
    const text = await res.text();
    if (text === "") return { data: undefined as T, meta: responseMeta(res) };
    if (!isJson(res))
      throw new TitenError(
        res.status,
        "INVALID_RESPONSE",
        "Response was not valid JSON.",
        responseRequestId(res),
      );
    try {
      const json = JSON.parse(text) as { data?: T; meta?: unknown };
      return { data: json.data as T, meta: responseMeta(res, json.meta) };
    } catch {
      throw new TitenError(
        res.status,
        "INVALID_RESPONSE",
        "Response was not valid JSON.",
        responseRequestId(res),
      );
    }
  }

  /** Raw authenticated access for streaming/JSONL responses. */
  async requestRaw(
    method: TitenHttpMethod,
    path: string,
    options: TitenRequestOptions = {},
  ): Promise<Response> {
    const allowed = new Set<TitenHttpMethod>([
      "GET",
      "POST",
      "PATCH",
      "PUT",
      "DELETE",
    ]);
    if (!allowed.has(method)) throw new TypeError("method is not supported");
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      path.startsWith("//")
    )
      throw new TypeError("path must be an absolute API path");
    if (options.json !== undefined && options.body !== undefined)
      throw new TypeError("json and body are mutually exclusive");

    const headers = new Headers(options.headers);
    if (headers.has("authorization"))
      throw new TypeError("authorization cannot be overridden");
    if (options.idempotencyKey !== undefined) {
      if (
        typeof options.idempotencyKey !== "string" ||
        options.idempotencyKey.trim() === "" ||
        options.idempotencyKey.length > 200
      )
        throw new TypeError("idempotencyKey must contain 1 to 200 characters");
      if (headers.has("idempotency-key"))
        throw new TypeError("idempotencyKey must be provided only once");
      headers.set("idempotency-key", options.idempotencyKey.trim());
    }
    headers.set("authorization", `Bearer ${this.key}`);
    if (options.json !== undefined)
      headers.set("content-type", "application/json");

    const target = new URL(`${this.url}${path}`);
    if (target.origin !== new URL(this.url).origin)
      throw new TypeError("path must remain on the configured origin");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const res = await this.f(target, {
      method,
      headers,
      body:
        options.json !== undefined
          ? JSON.stringify(options.json)
          : options.body,
      signal: options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout,
    });
    if (!res.ok) await throwResponseError(res);
    return res;
  }

  // --- Core operations ---

  async health(): Promise<{ status: "ok"; runtime: string; revision: string }> {
    return this.request("GET", "/healthz");
  }

  async ready(): Promise<{
    ready: boolean;
    runtime: string;
    revision: string;
    schema: { applied: number; expected: number; verified: boolean };
    checks: Record<string, string>;
    capabilities: Record<string, unknown>;
  }> {
    return this.request("GET", "/readyz");
  }

  async resolveProject(
    reference: string,
    create = false,
  ): Promise<ProjectResolution> {
    return this.request("POST", "/v1/projects/resolve", {
      json: { reference, create },
    });
  }

  async observe(
    observation: Observation,
    options: MutationOptions = {},
  ): Promise<ObservationRecord> {
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
  ): Promise<ConsolidationResult> {
    if (typeof subject_id !== "string")
      throw new TypeError(
        "consolidate() takes (subject_id, claims) — pass the subject id as the first argument.",
      );
    return this.request("POST", "/v1/consolidations", {
      json: {
        subject_id,
        claims,
        project_id,
        workspace_id: options.workspaceId,
      },
      idempotencyKey: options.idempotencyKey,
    });
  }

  async compile(options: CompileOptions): Promise<ContextPack> {
    return this.request("POST", "/v1/context/compile", { json: options });
  }

  async feedback(
    contextId: string,
    feedback: FeedbackOptions,
    options: MutationOptions = {},
  ): Promise<FeedbackResult> {
    return this.request("POST", `/v1/context/${contextId}/feedback`, {
      json: feedback,
      idempotencyKey: options.idempotencyKey,
    });
  }

  async evidence(claimId: string): Promise<EvidenceResult> {
    return this.request("GET", `/v1/claims/${claimId}/evidence`);
  }

  // --- Lifecycle ---

  async supersede(
    claimId: string,
    supersededBy: string,
    expectedVersion: number,
    reason?: string,
  ): Promise<ClaimLifecycleResult> {
    return this.request("POST", `/v1/claims/${claimId}/supersede`, {
      json: {
        superseded_by: supersededBy,
        expected_version: expectedVersion,
        reason,
      },
    });
  }

  async revoke(
    claimId: string,
    expectedVersion: number,
    reason?: string,
  ): Promise<ClaimLifecycleResult> {
    return this.request("POST", `/v1/claims/${claimId}/revoke`, {
      json: { expected_version: expectedVersion, reason },
    });
  }

  async expire(
    claimId: string,
    expectedVersion: number,
    reason?: string,
  ): Promise<ClaimLifecycleResult> {
    return this.request("POST", `/v1/claims/${claimId}/expire`, {
      json: { expected_version: expectedVersion, reason },
    });
  }

  // --- Checkpoints ---

  async saveCheckpoint(
    options: CheckpointOptions,
  ): Promise<CheckpointWriteResult> {
    return this.request("POST", "/v1/checkpoints", { json: options });
  }

  async getCheckpoint(
    subject_id: string,
    kind: CheckpointOptions["kind"],
    agent_id?: string,
  ): Promise<CheckpointRecord> {
    const params = new URLSearchParams({ subject_id, kind });
    if (agent_id) params.set("agent_id", agent_id);
    return this.request("GET", `/v1/checkpoints?${params}`);
  }

  async deleteCheckpoint(
    checkpointId: string,
  ): Promise<{ checkpoint_id: string; deleted: true }> {
    return this.request("DELETE", `/v1/checkpoints/${checkpointId}`);
  }

  // --- Coordination (records work; does not schedule it) ---

  async acquireLease(options: LeaseOptions): Promise<Lease> {
    return this.request("POST", "/v1/leases", { json: options });
  }

  async releaseLease(
    leaseId: string,
  ): Promise<{ lease_id: string; released_at: string }> {
    return this.request("DELETE", `/v1/leases/${leaseId}`);
  }

  async createHandoff(options: HandoffOptions): Promise<CreatedHandoff> {
    return this.request("POST", "/v1/handoffs", { json: options });
  }

  async listHandoffs(
    status?: "pending" | "accepted" | "rejected",
  ): Promise<{ handoffs: Handoff[] }> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request("GET", `/v1/handoffs${query}`);
  }

  async resolveHandoff(
    handoffId: string,
    status: "accepted" | "rejected",
  ): Promise<ResolvedHandoff> {
    return this.request("POST", `/v1/handoffs/${handoffId}/resolve`, {
      json: { status },
    });
  }

  async compileView(
    lens:
      | "evidence_trace"
      | "neighborhood"
      | "conflict_freshness"
      | "review_queue",
    options: {
      subject_id?: string;
      focus_id?: string;
      owner_id?: string;
      review_reason?:
        | "all"
        | "disputed"
        | "contradiction"
        | "low_confidence"
        | "negative_feedback";
      cursor?: string;
      limit?: number;
    } = {},
  ): Promise<ViewResult> {
    return this.request("POST", "/v1/memory-views/compile", {
      json: { lens, ...options },
    });
  }

  // --- Keys ---

  async createKey(options: CreateKeyOptions): Promise<CreatedKey> {
    return this.request<CreatedKey>("POST", "/v1/keys", { json: options });
  }

  async listKeys(): Promise<{ keys: KeyRecord[] }> {
    return this.request("GET", "/v1/keys");
  }

  async revokeKey(
    keyId: string,
  ): Promise<{ key_id: string; revoked_at: string; revoked: true }> {
    return this.request("DELETE", `/v1/keys/${keyId}`);
  }
}

function isJson(response: Response): boolean {
  return /(^|[+/])json\b/i.test(response.headers.get("content-type") ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseRequestId(
  response: Response,
  meta?: Record<string, unknown>,
): string | undefined {
  return typeof meta?.request_id === "string"
    ? meta.request_id
    : (response.headers.get("x-request-id") ?? undefined);
}

function responseMeta(response: Response, value?: unknown): TitenResponseMeta {
  const meta: TitenResponseMeta = isRecord(value) ? { ...value } : {};
  const requestId = responseRequestId(response, meta);
  if (requestId) meta.request_id = requestId;
  return meta;
}

async function throwResponseError(response: Response): Promise<never> {
  if (isJson(response)) {
    try {
      const json = JSON.parse(await response.text()) as {
        error?: { code?: string; message?: string; meta?: unknown };
        meta?: unknown;
      };
      const responseMetadata = isRecord(json.meta) ? json.meta : undefined;
      const errorMetadata = isRecord(json.error?.meta)
        ? json.error.meta
        : undefined;
      const requestId = responseRequestId(response, responseMetadata);
      const meta =
        responseMetadata || errorMetadata || requestId
          ? {
              ...errorMetadata,
              ...responseMetadata,
              ...(requestId ? { request_id: requestId } : {}),
            }
          : undefined;
      throw new TitenError(
        response.status,
        json.error?.code ?? "HTTP_ERROR",
        json.error?.message ?? `Request failed with status ${response.status}.`,
        requestId,
        meta,
      );
    } catch (error) {
      if (error instanceof TitenError) throw error;
    }
  }
  throw new TitenError(
    response.status,
    "HTTP_ERROR",
    `Request failed with status ${response.status}.`,
    responseRequestId(response),
  );
}
