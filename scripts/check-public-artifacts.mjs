#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const RULES = [
  {
    rule: "host",
    pattern: /\b(?:ssh\s+|connect(?:\s+to)?\s+|host\s+)(?:server|host|node|workstation)-[a-z0-9-]+\b/giu,
  },
  {
    rule: "domain",
    pattern: /https?:\/\/[a-z0-9.-]+\.(?:local|lan)(?=[:/]|$)/giu,
  },
  {
    rule: "network",
    pattern: /\b(?!example\.)(?!placeholder\.)(?!tailnet\.)[a-z0-9-]+\.ts\.net\b/giu,
  },
  {
    rule: "home_path",
    pattern: /\/home\/[a-z0-9._-]+\//giu,
  },
  {
    rule: "secret_path",
    pattern: /\/etc\/[a-z0-9._-]+\/(?!titen\.env\b)[a-z0-9._-]+\.env\b/giu,
  },
  {
    rule: "cloud_account_id",
    pattern: /"account_id"\s*:\s*"[a-f0-9]{32}"/giu,
  },
  {
    rule: "cloud_resource_id",
    pattern: /"database_id"\s*:\s*"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"/giu,
  },
];

const EXCLUDED_PATHS = new Set(["scripts/check-public-artifacts.mjs"]);

export function scanPublicText(file, text) {
  const matches = [];
  for (const { rule, pattern } of RULES) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const line = text.slice(0, match.index).split("\n").length;
      matches.push({ file, line, rule });
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
  return matches;
}

export function scanTrackedFiles(root = process.cwd()) {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  const matches = [];
  for (const file of output.split("\0").filter(Boolean)) {
    if (EXCLUDED_PATHS.has(file)) continue;
    let content;
    try {
      content = readFileSync(new URL(file, pathToFileURL(`${root}/`)), "utf8");
    } catch {
      continue;
    }
    if (content.includes("\0")) continue;
    matches.push(...scanPublicText(file, content));
  }
  return matches;
}

export function scanDirectory(root) {
  const matches = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile() || lstatSync(path).isSymbolicLink()) continue;
      let content;
      try { content = readFileSync(path, "utf8"); } catch { continue; }
      if (content.includes("\0")) continue;
      matches.push(...scanPublicText(relative(root, path), content));
    }
  };
  visit(root);
  return matches;
}

function main() {
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
  if (rootIndex >= 0 && !root) throw new Error("--root requires a directory.");
  const matches = root ? scanDirectory(root) : scanTrackedFiles();
  for (const match of matches)
    process.stderr.write(`${match.file}:${match.line}: forbidden public artifact rule ${match.rule}\n`);
  if (matches.length > 0) {
    process.stderr.write(`public artifact check failed (${matches.length} matches)\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("public artifacts OK\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
