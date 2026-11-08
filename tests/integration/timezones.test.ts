import { test } from "bun:test";
import assert from "node:assert/strict";
import { formatLocalTimestamp, withLocalTimestamps } from "../../src/core/timezones";

test("local timestamps keep the UTC instant and add a numeric offset", () => {
  assert.equal(
    formatLocalTimestamp("2026-01-01T01:00:00.000Z", "Asia/Bangkok"),
    "2026-01-01T08:00:00.000+07:00",
  );
  assert.equal(
    formatLocalTimestamp("2026-01-01T00:00:00Z", "UTC"),
    "2026-01-01T00:00:00+00:00",
  );
});
test("local timestamps survive second-precision LMT offsets and keep the instant", () => {
  const cases: Array<[string, string, string]> = [
    ["1920-01-01T00:00:00Z", "Asia/Jakarta", "1920-01-01T07:07:00+07:07"],
    ["1900-01-01T00:00:00Z", "Asia/Kolkata", "1900-01-01T05:21:00+05:21"],
    ["1905-01-01T00:00:00Z", "Europe/Paris", "1905-01-01T00:09:00+00:09"],
    ["1880-01-01T00:00:00Z", "America/New_York", "1879-12-31T19:04:00-04:56"],
  ];
  for (const [utc, zone, expected] of cases) {
    const local = formatLocalTimestamp(utc, zone);
    assert.equal(local, expected, zone);
    assert.equal(Date.parse(local), Date.parse(utc), zone);
  }
});

test("local timestamps keep fractions and DST offsets", () => {
  assert.equal(
    formatLocalTimestamp("2026-03-29T01:30:00.250Z", "Europe/London"),
    "2026-03-29T02:30:00.250+01:00",
  );
  assert.equal(
    formatLocalTimestamp("2026-07-01T12:00:00Z", "America/St_Johns"),
    "2026-07-01T09:30:00-02:30",
  );
});

test("withLocalTimestamps never throws for a presentable record", () => {
  // The helper adds *_local fields that its generic return type does not name.
  const out: Record<string, unknown> = withLocalTimestamps(
    { occurred_at: "1900-01-01T00:00:00Z", ingested_at: "not-a-time" },
    ["occurred_at", "ingested_at"],
    "Asia/Jakarta",
  );
  assert.equal(out.occurred_at_local, "1900-01-01T07:07:00+07:07");
  assert.equal(out.ingested_at_local, null);
});
