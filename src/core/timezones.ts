import { validationError } from "./errors";

/** Rejects a name Intl cannot resolve as an IANA time zone. */
export function assertIanaTimeZone(value: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
  } catch {
    throw new Error(`Invalid IANA time zone "${value}".`);
  }
}

/**
 * Per-call `tz` wins. A server display time zone is the fallback. Absent both,
 * callers keep UTC-only timestamps.
 */
export function resolveDisplayTimezone(
  body: Record<string, unknown>,
  fallback?: string | null,
): string | null {
  const raw = body.tz === undefined || body.tz === null ? fallback ?? null : body.tz;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") throw validationError('Field "tz" must be an IANA time zone name.');
  try {
    assertIanaTimeZone(raw);
  } catch {
    throw validationError(`Field "tz" must be an IANA time zone name.`);
  }
  return raw;
}

function offsetSuffix(timeZone: string, date: Date): string {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    hour: "2-digit",
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  if (name === "GMT" || name === "UTC") return "+00:00";
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/u.exec(name);
  if (!match) throw new Error(`Time zone "${timeZone}" did not report a numeric offset.`);
  return `${match[1]}${match[2]!.padStart(2, "0")}:${(match[3] ?? "00").padStart(2, "0")}`;
}

/** ISO-8601 local time with a numeric offset. The UTC instant is unchanged. */
export function formatLocalTimestamp(isoUtc: string, timeZone: string): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) throw new Error("Timestamp is not ISO-8601.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  let hour = pick("hour");
  if (hour === "24") hour = "00";
  const fraction = /\.(\d+)/u.exec(isoUtc)?.[1];
  const fractionSuffix = fraction ? `.${fraction}` : "";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${hour}:${pick("minute")}:${pick("second")}${fractionSuffix}${offsetSuffix(timeZone, date)}`;
}

/** Adds parallel `*_local` fields. UTC fields on the record stay as they are. */
export function withLocalTimestamps<T extends Record<string, unknown>>(
  value: T,
  fields: readonly string[],
  timeZone: string | null,
): T {
  if (!timeZone) return value;
  const extra: Record<string, string | null> = {};
  for (const field of fields) {
    const raw = value[field];
    if (typeof raw === "string") extra[`${field}_local`] = formatLocalTimestamp(raw, timeZone);
    else if (raw === null) extra[`${field}_local`] = null;
  }
  return { ...value, ...extra };
}
