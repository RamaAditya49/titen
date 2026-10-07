import { test } from "bun:test";
import assert from "node:assert/strict";
import { formatLocalTimestamp } from "../../src/core/timezones";

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