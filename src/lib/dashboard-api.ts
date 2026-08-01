/** Browser-safe client for the same-origin dashboard adapter. */
export interface AtlasNode {
  id: string;
  type: "claim" | "observation" | "principal" | "release";
  label: string;
  trust: string;
  status: string;
  created_at: string;
  freshness?: number;
  confidence?: number;
  priority?: number;
  reasons?: string[];
  owner_id?: string;
  next_action?: string;
  deadline?: string | null;
  evidence_refs?: string[];
  audit_refs?: string[];
}

export interface AtlasEdge { from: string; to: string; relation: string; }
export interface AtlasView {
  lens: "evidence_trace" | "neighborhood" | "conflict_freshness" | "review_queue" | "scope_preview" | "knowledge_release";
  focus_id: string | null;
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  metadata: Record<string, unknown>;
}

export interface DashboardStatus {
  mode: "live" | "disconnected";
  endpoint: string | null;
}

export interface ServiceCheck {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
}

export class DashboardApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) { super(message); }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => ({}));
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { accept: "application/json", ...init?.headers },
  });
  const payload = await json(response);
  if (!response.ok) {
    const error = payload.error && typeof payload.error === "object"
      ? payload.error as Record<string, unknown>
      : {};
    throw new DashboardApiError(
      response.status,
      typeof error.code === "string" ? error.code : "DASHBOARD_REQUEST_FAILED",
      typeof error.message === "string" ? error.message : "The dashboard request failed.",
    );
  }
  return payload;
}

export async function getDashboardStatus(): Promise<DashboardStatus> {
  const payload = await request("/dashboard-api/status");
  return {
    mode: payload.mode === "live" ? "live" : "disconnected",
    endpoint: typeof payload.endpoint === "string" ? payload.endpoint : null,
  };
}

export async function checkService(path: "health" | "readiness"): Promise<ServiceCheck> {
  const response = await fetch(`/dashboard-api/${path}`, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  return { ok: response.ok, status: response.status, payload: await json(response) };
}

export async function compileView(input: Record<string, unknown>): Promise<AtlasView> {
  const payload = await request("/dashboard-api/atlas/compile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = payload.data;
  if (!data || typeof data !== "object" || !Array.isArray((data as AtlasView).nodes)
    || !Array.isArray((data as AtlasView).edges)) {
    throw new DashboardApiError(502, "INVALID_UPSTREAM_RESPONSE", "Titen returned an invalid Atlas view.");
  }
  return data as AtlasView;
}
