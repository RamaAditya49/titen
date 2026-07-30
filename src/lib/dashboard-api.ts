/** Browser-safe dashboard API client. Canonical credentials stay in the server adapter. */
export interface AtlasNode { id: string; type: "claim" | "observation"; label: string; trust: string; status?: string; created_at: string; freshness?: number; }
export interface AtlasEdge { from: string; to: string; relation: string; }
export interface AtlasView { lens: string; nodes: AtlasNode[]; edges: AtlasEdge[]; metadata: Record<string, unknown>; }

export function atlasSubject(): string { return "default"; }
export function isConnected(): boolean { return false; }
export function endpointLabel(): string { return "synthetic demo · no live connection"; }
export async function compileView(): Promise<AtlasView | null> { return null; }
export async function getScopePreview(): Promise<null> { return null; }
