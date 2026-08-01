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
  maxCandidates: 1_000,
  claimsPerConsolidation: 50,
  sourcesPerClaim: 20,
  queryTerms: 16,
} as const;

export const MAX_JSON_DEPTH = 64;

const UNSAFE_TEXT = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

/** Rejects parser-safe JSON before recursive serializers or hashers see it. */
export function assertJsonDepth(value: unknown): void {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 1 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > MAX_JSON_DEPTH)
      throw validationError(`Request body exceeds maximum JSON depth of ${MAX_JSON_DEPTH}.`);
    if (current.value && typeof current.value === "object") {
      for (const child of Object.values(current.value))
        if (child && typeof child === "object")
          stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function assertSafeString(value: string, field: string): void {
  if (!value.isWellFormed())
    throw validationError(`Field "${field}" must contain well-formed Unicode.`);
  if (UNSAFE_TEXT.test(value))
    throw validationError(`Field "${field}" contains an unsafe control character.`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireObject(value: unknown, path?: string): Record<string, unknown> {
  if (!isRecord(value))
    throw validationError(path ? `Field "${path}" must be an object.` : "Request body must be a JSON object.");
  return value;
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
  path = field,
): string {
  const value = body[field];
  if (value === undefined) throw validationError(`Field "${path}" is required.`);
  if (typeof value !== "string") throw validationError(`Field "${path}" must be a string.`);
  if (value.trim() === "") throw validationError(`Field "${path}" must be a non-empty string.`);
  if (value.length > maxLength)
    throw validationError(`Field "${path}" exceeds ${maxLength} characters.`);
  assertSafeString(value, path);
  return value;
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
  path = field,
): string | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw validationError(`Field "${path}" must be a string when present.`);
  if (value.trim() === "")
    throw validationError(`Field "${path}" must be a non-empty string when present.`);
  if (value.length > maxLength)
    throw validationError(`Field "${path}" exceeds ${maxLength} characters.`);
  assertSafeString(value, path);
  return value;
}

export function requireEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  path = field,
): T {
  const value = body[field];
  if (value === undefined) throw validationError(`Field "${path}" is required.`);
  if (typeof value !== "string") throw validationError(`Field "${path}" must be a string.`);
  if (!allowed.includes(value as T))
    throw validationError(`Field "${path}" must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

export function optionalEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  fallback: T,
  path = field,
): T {
  if (body[field] === undefined || body[field] === null) return fallback;
  return requireEnum(body, field, allowed, path);
}

export function requireInteger(
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  path = field,
): number {
  const value = body[field];
  if (value === undefined) throw validationError(`Field "${path}" is required.`);
  if (typeof value !== "number" || !Number.isInteger(value))
    throw validationError(`Field "${path}" must be an integer.`);
  if (value < min || value > max)
    throw validationError(`Field "${path}" must be between ${min} and ${max}.`);
  return value;
}

export function optionalTimestamp(
  body: Record<string, unknown>,
  field: string,
  path = field,
): string | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    throw validationError(`Field "${path}" must be an ISO-8601 timestamp.`);
  const normalized = new Date(value).toISOString();
  if (!/^\d{4}-/u.test(normalized))
    throw validationError(`Field "${path}" must use a four-digit year.`);
  return normalized;
}

export function assertTimestampOrder(
  validFrom: string,
  validTo: string | null,
  fromPath = "valid_from",
  toPath = "valid_to",
): void {
  if (validTo !== null && validTo <= validFrom)
    throw validationError(`Field "${toPath}" must be later than "${fromPath}".`);
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
