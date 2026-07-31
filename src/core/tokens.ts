/**
 * Deterministic token estimation.
 *
 * ponytail: four-characters-per-token heuristic instead of a real tokenizer.
 * The ceiling is accuracy on non-Latin scripts and code, and the estimate is
 * intentionally conservative so a pack never exceeds its declared budget.
 * Upgrade path: use the configured model's tokenizer only when its provider
 * exposes an exact tokenizer contract, keeping this as the no-model default.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateJsonTokens(value: unknown): number {
  return estimateTokens(JSON.stringify(value) ?? "");
}
