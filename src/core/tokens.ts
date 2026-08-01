/** Portable deterministic budget units; exact provider tokens stay provider-owned. */
export function estimateTokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).byteLength / 3);
}

export function estimateJsonTokens(value: unknown): number {
  return estimateTokens(JSON.stringify(value) ?? "");
}
