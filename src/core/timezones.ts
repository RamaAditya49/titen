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

const MINUTE_MS = 60_000;

/**
 * Offset of `timeZone` at `date`, rounded to whole minutes. Derived from the
 * zone's wall clock instead of ICU's offset label, because pre-standard-time
 * Local Mean Time offsets carry seconds (Asia/Jakarta 1920 is +07:07:12) and
 * RFC 3339 offsets cannot.
 */
function offsetMinutes(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    era: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const era = parts.find((part) => part.type === "era")?.value;
  const year = era === "BC" ? 1 - pick("year") : pick("year");
  const wall = new Date(0);
  wall.setUTCFullYear(year, pick("month") - 1, pick("day"));
  wall.setUTCHours(pick("hour") % 24, pick("minute"), pick("second"), 0);
  const wholeSecond = date.getTime() - (((date.getTime() % 1000) + 1000) % 1000);
  return Math.round((wall.getTime() - wholeSecond) / MINUTE_MS);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * ISO-8601 local time with a numeric offset. The UTC instant is unchanged:
 * when a historical offset has seconds, the offset is rounded to the minute
 * and the wall clock is shifted with it.
 */
export function formatLocalTimestamp(isoUtc: string, timeZone: string): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) throw new Error("Timestamp is not ISO-8601.");
  const offset = offsetMinutes(timeZone, date);
  const wholeSecond = date.getTime() - (((date.getTime() % 1000) + 1000) % 1000);
  const local = new Date(wholeSecond + offset * MINUTE_MS).toISOString().slice(0, 19);
  const fraction = /\.(\d+)/u.exec(isoUtc)?.[1];
  const fractionSuffix = fraction ? `.${fraction}` : "";
  return `${local}${fractionSuffix}${formatOffset(offset)}`;
}

/** Display only: a value that cannot be presented becomes null, never a failed response. */
function presentLocal(raw: string, timeZone: string): string | null {
  try {
    return formatLocalTimestamp(raw, timeZone);
  } catch {
    return null;
  }
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
    if (typeof raw === "string") extra[`${field}_local`] = presentLocal(raw, timeZone);
    else if (raw === null) extra[`${field}_local`] = null;
  }
  return { ...value, ...extra };
}
