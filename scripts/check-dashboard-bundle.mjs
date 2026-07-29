#!/usr/bin/env node

import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = "dist";
const budget = 80 * 1024;
const files = [];
const inlineScripts = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(?:css|js)$/.test(name)) files.push(path);
  }
}

walk(root);
const dashboardHtml = readFileSync(
  join(root, "dashboard", "index.html"),
  "utf8",
);
for (const match of dashboardHtml.matchAll(
  /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g,
))
  if (match[1].trim()) inlineScripts.push(match[1]);
const measured = files.map((path) => ({
  file: relative(root, path),
  gzip: gzipSync(readFileSync(path), { level: 9 }).byteLength,
}));
if (inlineScripts.length)
  measured.push({
    file: "dashboard/index.html inline scripts",
    gzip: gzipSync(inlineScripts.join("\n"), { level: 9 }).byteLength,
  });
const total = measured.reduce((sum, item) => sum + item.gzip, 0);

console.log(
  `dashboard CSS + JS: ${(total / 1024).toFixed(1)} KiB gzip / ${(budget / 1024).toFixed(0)} KiB budget`,
);
for (const item of measured)
  console.log(`  ${(item.gzip / 1024).toFixed(1)} KiB  ${item.file}`);

if (total > budget) process.exitCode = 1;
