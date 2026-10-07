#!/usr/bin/env node
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const migrations = readFileSync(new URL("../src/core/migrations.ts", import.meta.url), "utf8");
const versions = [...migrations.matchAll(/^\s*version:\s*(\d+),/gm)].map((match) => Number(match[1]));
const schema = Math.max(...versions);
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const released = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((match) => match[1]);
const heading = released.includes(pkg.version) ? `## [${pkg.version}]` : "## [Unreleased]";
const section = changelog.split(heading)[1]?.split(/^## \[/m)[0] ?? "";
if (!section.includes(`schema ${schema}`)) {
  console.error(
    `${pkg.version} documents schema ${schema} in ${heading}. A new migration requires a package version bump and that token.`,
  );
  process.exit(1);
}
console.log(`schema version OK (${pkg.version} ${heading} schema ${schema})`);
