import { validationError } from "./errors";

export const TRUST_LEVELS = ["unverified", "asserted", "verified", "policy_approved"] as const;
export type Trust = (typeof TRUST_LEVELS)[number];
export const TRUST_RANK: Record<Trust, number> = {
  unverified: 0,
  asserted: 1,
  verified: 2,
  policy_approved: 3,
};

export const VISIBILITIES = ["private", "team", "organization"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const OBSERVATION_KINDS = [
  "user_statement",
  "tool_result",
  "imported_source",
  "decision",
  "system_event",
] as const;

export const CLAIM_KINDS = [
  "semantic_fact",
  "episodic_event",
  "preference",
  "procedural",
  "decision",
  "relationship",
] as const;

export const CLAIM_RELATIONS = ["supports", "contradicts", "qualifies"] as const;

export const FEEDBACK_OUTCOMES = ["used", "useful", "irrelevant", "incorrect", "harmful"] as const;

export const LIMITS = {
  content: 32_000,
  statement: 4_000,
  identifier: 200,
  label: 120,
  reasonCode: 64,
  maxTokens: 32_000,
  candidates: 200,
  claimsPerConsolidation: 50,
  sourcesPerClaim: 20,
  queryTerms: 16,
} as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw validationError("Request body must be a JSON object.");
  return value;
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "")
    throw validationError(`Field "${field}" must be a non-empty string.`);
  if (value.length > maxLength)
    throw validationError(`Field "${field}" exceeds ${maxLength} characters.`);
  return value;
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
): string | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "")
    throw validationError(`Field "${field}" must be a non-empty string when present.`);
  if (value.length > maxLength)
    throw validationError(`Field "${field}" exceeds ${maxLength} characters.`);
  return value;
}

export function requireEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = body[field];
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw validationError(`Field "${field}" must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

export function optionalEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (body[field] === undefined || body[field] === null) return fallback;
  return requireEnum(body, field, allowed);
}

export function requireInteger(
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw validationError(`Field "${field}" must be an integer between ${min} and ${max}.`);
  return value;
}

export function optionalTimestamp(
  body: Record<string, unknown>,
  field: string,
): string | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    throw validationError(`Field "${field}" must be an ISO-8601 timestamp.`);
  return new Date(value).toISOString();
}

export function optionalBoolean(
  body: Record<string, unknown>,
  field: string,
  fallback = false,
): boolean {
  const value = body[field];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw validationError(`Field "${field}" must be a boolean.`);
  return value;
}
