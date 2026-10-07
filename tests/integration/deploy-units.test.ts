import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("the dashboard unit restarts with titen instead of staying down", () => {
  const unit = readFileSync(join(import.meta.dir, "../../deploy/titen-dashboard.service"), "utf8");
  assert.match(unit, /^PartOf=titen\.service$/m);
  assert.match(unit, /^Wants=titen\.service$/m);
  assert.match(unit, /^After=titen\.service$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  assert.doesNotMatch(unit, /^Requires=/m);
});