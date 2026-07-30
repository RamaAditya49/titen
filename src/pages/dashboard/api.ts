/**
 * Dashboard API client. When configured with a real endpoint and key,
 * fetches live data from POST /v1/memory-views/compile.
 * Falls back to synthetic data when not configured.
 */

export interface DashboardConfig {
  endpoint?: string; // e.g. "http://127.0.0.1:8787"
  apiKey?: string;
}

export interface AtlasNode {
  id: string;
  type: "claim" | "observation";
  label: string;
  trust: string;
  status?: string;
  created_at: string;
  freshness?: number;
}

export interface AtlasEdge {
  from: string;
  to: string;
  relation: string;
}

export interface AtlasView {
  lens: string;
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  metadata: Record<string, unknown>;
}

const config: DashboardConfig = {
  endpoint: import.meta.env.PUBLIC_TITEN_ENDPOINT,
  apiKey: import.meta.env.PUBLIC_TITEN_DASHBOARD_KEY,
};

/**
 * Which subject the Atlas lenses describe. Atlas scopes every projection to one
 * subject, so an operator pointing the shell at a real deployment has to say
 * whose memory it is showing.
 */
export function atlasSubject(): string {
  return import.meta.env.PUBLIC_TITEN_SUBJECT ?? "default";
}

export function isConnected(): boolean {
  return Boolean(config.endpoint && config.apiKey);
}

/**
 * Label for the shell's connection row. Reports the configured host, never a
 * key, and says plainly when nothing is configured so the preview cannot imply
 * a live service it does not have.
 */
export function endpointLabel(): string {
  if (!config.endpoint) return "synthetic fixture · no endpoint";
  try {
    return `${new URL(config.endpoint).host} · live`;
  } catch {
    return "invalid endpoint";
  }
}

export async function compileView(
  lens: string,
  options: { subject_id?: string; focus_id?: string; limit?: number } = {},
): Promise<AtlasView | null> {
  if (!config.endpoint || !config.apiKey) return null;
  try {
    const res = await fetch(`${config.endpoint}/v1/memory-views/compile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ lens, ...options }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { data: AtlasView };
    return json.data;
  } catch {
    return null;
  }
}

export async function getScopePreview(subjectId?: string): Promise<Record<string, unknown> | null> {
  const view = await compileView("scope_preview", { subject_id: subjectId ?? "_all" });
  return view?.metadata ?? null;
}
