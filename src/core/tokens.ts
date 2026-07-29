/**
 * Deterministic token estimation.
 *
 * ponytail: four-characters-per-token heuristic instead of a real tokenizer.
 * The ceiling is accuracy on non-Latin scripts and code, and the estimate is
 * intentionally conservative so a pack never exceeds its declared budget.
 * Upgrade path: swap in the tokenizer of the configured model when Titen gains
 * a model capability, keeping this function as the no-model default.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateJsonTokens(value: unknown): number {
  return estimateTokens(JSON.stringify(value) ?? "");
}
