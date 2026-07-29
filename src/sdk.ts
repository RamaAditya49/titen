/**
 * Titen Agent SDK — minimal TypeScript client for the memory service.
 *
 * Usage:
 *   import { TitenClient } from "titen/sdk";
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

export interface Observation {
  subject_id: string;
  kind: "user_statement" | "tool_result" | "imported_source" | "decision" | "system_event";
  content: string;
  source: { type: string; ref?: string };
  trust?: "unverified" | "asserted" | "verified" | "policy_approved";
  visibility?: "private" | "team" | "organization";
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
    this.url = config.url.replace(/\/+$/, "");
    this.key = config.key;
    this.f = config.fetch ?? globalThis.fetch;
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.key}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await this.f(`${this.url}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json() as any;
    if (!res.ok) throw new TitenError(res.status, json?.error?.code ?? "UNKNOWN", json?.error?.message ?? "Request failed");
    return json.data;
  }

  // --- Core operations ---

  async health() { return this.request("GET", "/healthz"); }
  async ready() { return this.request("GET", "/readyz"); }

  async resolveProject(reference: string, create = false) {
    return this.request("POST", "/v1/projects/resolve", { reference, create });
  }

  async observe(observation: Observation) {
    return this.request("POST", "/v1/observations", observation);
  }

  async consolidate(subject_id: string, claims: Claim[], project_id?: string) {
    return this.request("POST", "/v1/consolidations", { subject_id, claims, project_id });
  }

  async compile(options: CompileOptions) {
    return this.request("POST", "/v1/context/compile", options);
  }

  async feedback(contextId: string, options: FeedbackOptions) {
    return this.request("POST", `/v1/context/${contextId}/feedback`, options);
  }

  async evidence(claimId: string) {
    return this.request("GET", `/v1/claims/${claimId}/evidence`);
  }

  // --- Lifecycle ---

  async supersede(claimId: string, supersededBy: string, reason?: string) {
    return this.request("POST", `/v1/claims/${claimId}/supersede`, { superseded_by: supersededBy, reason });
  }

  async revoke(claimId: string, reason?: string) {
    return this.request("POST", `/v1/claims/${claimId}/revoke`, { reason });
  }

  async expire(claimId: string, reason?: string) {
    return this.request("POST", `/v1/claims/${claimId}/expire`, { reason });
  }

  // --- Checkpoints ---

  async saveCheckpoint(options: CheckpointOptions) {
    return this.request("POST", "/v1/checkpoints", options);
  }

  async getCheckpoint(subject_id: string, kind: string, agent_id?: string) {
    const params = new URLSearchParams({ subject_id, kind });
    if (agent_id) params.set("agent_id", agent_id);
    return this.request("GET", `/v1/checkpoints?${params}`);
  }

  async deleteCheckpoint(checkpointId: string) {
    return this.request("DELETE", `/v1/checkpoints/${checkpointId}`);
  }

  // --- Keys ---

  async createKey(options: { label: string; scopes: string[]; max_trust?: string }) {
    return this.request("POST", "/v1/keys", options);
  }

  async listKeys() {
    return this.request("GET", "/v1/keys");
  }

  async revokeKey(keyId: string) {
    return this.request("DELETE", `/v1/keys/${keyId}`);
  }
}
