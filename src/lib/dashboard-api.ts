/** Browser-safe client for the same-origin dashboard adapter. */
export interface AtlasNode {
  id: string;
  type: "claim" | "observation" | "context" | "principal" | "release";
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

export interface MemoryRecord {
  id: string;
  subject_id: string;
  project_id: string | null;
  kind: string;
  statement: string;
  confidence: number;
  trust: string;
  visibility: string;
  status: string;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
}

export interface MemoryPage {
  items: MemoryRecord[];
  page: { limit: number; has_more: boolean; next_cursor: string | null };
  query: Record<string, unknown>;
  authorization: { principal_id: string; access_mode: "principal" };
}

export interface DashboardStatus {
  mode: "live" | "disconnected";
  endpoint: string | null;
  authentication: "session" | "server";
  authenticated: boolean;
}

export interface DashboardPrincipal {
  organization_id: string;
  principal_id: string;
  principal_kind: "human" | "agent" | "service";
  key_id: string;
  scopes: string[];
  max_trust: string;
  organization_role: "root" | "owner" | "admin" | "member" | "reader" | null;
  password_change_required?: boolean;
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
    authentication: payload.authentication === "session" ? "session" : "server",
    authenticated: payload.authenticated === true,
  };
}

function principal(payload: Record<string, unknown>): DashboardPrincipal {
  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new DashboardApiError(502, "INVALID_UPSTREAM_RESPONSE", "Titen returned invalid principal metadata.");
  return data as DashboardPrincipal;
}

export async function login(username: string, password: string): Promise<DashboardPrincipal> {
  return principal(await request("/dashboard-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  }));
}

export async function getSession(): Promise<DashboardPrincipal> {
  return principal(await request("/dashboard-api/session"));
}

export async function logout(): Promise<void> {
  await request("/dashboard-api/session", { method: "DELETE" });
}

export async function changePassword(password: string): Promise<void> {
  await request("/dashboard-api/password", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export async function getArea(path: string, query?: URLSearchParams): Promise<Record<string, unknown>> {
  return request(`/dashboard-api/${path}${query?.size ? `?${query}` : ""}`);
}

export async function postArea(path: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request(`/dashboard-api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
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

export async function listMemories(query: URLSearchParams = new URLSearchParams()): Promise<MemoryPage> {
  const payload = await request(`/dashboard-api/memories${query.size ? `?${query}` : ""}`);
  const data = payload.data;
  if (!data || typeof data !== "object" || !Array.isArray((data as MemoryPage).items)
    || typeof (data as MemoryPage).page !== "object")
    throw new DashboardApiError(502, "INVALID_UPSTREAM_RESPONSE", "Titen returned an invalid memory page.");
  return data as MemoryPage;
}
