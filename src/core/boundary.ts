import { forbidden } from "./errors";

export type DecisionEffect = "allow" | "deny" | "abstain";
export type BoundaryKind = "tenant" | "scope" | "policy" | "visibility" | "trust" | "release_filter";

export interface BoundaryDecision {
  kind: BoundaryKind;
  effect: DecisionEffect;
  reason: string;
}

export const allow = (kind: BoundaryKind, reason = "satisfied"): BoundaryDecision => ({ kind, effect: "allow", reason });
export const deny = (kind: BoundaryKind, reason: string): BoundaryDecision => ({ kind, effect: "deny", reason });
export const abstain = (kind: BoundaryKind, reason: string): BoundaryDecision => ({ kind, effect: "abstain", reason });

/**
 * Complete decision contract: permit iff every required crossing explicitly
 * allows. Deny overrides, and abstain is incomplete rather than implicit allow.
 */
export function requireBoundary(decisions: readonly BoundaryDecision[]): void {
  const rejected = decisions.find((decision) => decision.effect === "deny") ??
    decisions.find((decision) => decision.effect === "abstain");
  if (rejected) throw forbidden(`Boundary denied at ${rejected.kind}.`);
  if (decisions.length === 0 || decisions.some((decision) => decision.effect !== "allow"))
    throw forbidden("Boundary decision is incomplete.");
}

/** Guard effects so denial cannot accidentally be followed by I/O. */
export async function crossBoundary<T>(
  decisions: readonly BoundaryDecision[],
  downstream: () => Promise<T>,
): Promise<T> {
  requireBoundary(decisions);
  return downstream();
}
