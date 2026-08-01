#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const marker = String.raw`(^|[[:space:]])(//|/\*|\*|<!--|#)[[:space:]]*ponytail:`;
const scan = spawnSync(
  "git",
  ["grep", "-n", "-E", marker, "--", ":!PONYTAIL-DEBT.md", ":!dist"],
  { encoding: "utf8" },
);
assert(scan.status === 0 || scan.status === 1, scan.stderr || "Ponytail marker scan failed");
const output = scan.stdout.trim();
const live = (output ? output.split("\n") : []).map((line) => {
  const match = line.match(/^(.+?):(\d+):/);
  assert(match, `unparseable Ponytail marker: ${line}`);
  return `${match[1]}:${match[2]}`;
});

const ledger = readFileSync("PONYTAIL-DEBT.md", "utf8");
const recorded = [...ledger.matchAll(/`((?:docs|plugins|scripts|src)\/[^`\n]+:\d+)`/g)]
  .map((match) => match[1]);
assert.deepEqual(recorded.sort(), [...live].sort(), "Ponytail ledger locations are stale");
assert.equal(new Set(recorded).size, recorded.length, "Ponytail ledger has duplicate locations");

const markerCount = Number(ledger.match(/^- Markers: (\d+)\.$/m)?.[1]);
const noTriggerCount = Number(
  ledger.match(/^- Markers without a source trigger: (\d+)\.$/m)?.[1],
);
assert.equal(markerCount, live.length, "Ponytail marker summary is stale");
assert.equal(
  noTriggerCount,
  (ledger.match(/\*\*No source trigger\.\*\*/g) ?? []).length,
  "Ponytail no-trigger summary is stale",
);

console.log(`Ponytail debt ledger OK (${live.length} tracked markers).`);
