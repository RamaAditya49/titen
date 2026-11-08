/**
 * Every Memory Atlas lens the server accepts. Kept free of imports so the SDK
 * type contract can pin `ViewLens` to it without compiling the rest of core.
 */
export const LENSES = ["evidence_trace", "neighborhood", "conflict_freshness", "review_queue", "scope_preview", "workspace_graph", "knowledge_release"] as const;
