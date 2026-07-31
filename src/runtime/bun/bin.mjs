#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync(
  "bun",
  [fileURLToPath(new URL("./cli.ts", import.meta.url)), ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  if (result.error.code === "ENOENT") {
    console.error("Titen CLI requires Bun (it uses bun:sqlite).\nInstall: https://bun.sh/docs/installation");
    process.exit(127);
  }
  console.error(`error: unable to start Bun: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
