#!/usr/bin/env bun
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type Options = { out: string; host: string; intervalMs: number; containers: string[] };
type Sample = { container: string; cpu_percent: number; memory_usage_bytes: number; at_ms: number };
type Stats = { p50: number | null; p95: number | null; p99: number | null; max: number | null };

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const UNITS: Record<string, number> = {
  b: 1,
  kb: 1_000,
  mb: 1_000_000,
  gb: 1_000_000_000,
  tb: 1_000_000_000_000,
  kib: 1_024,
  mib: 1_048_576,
  gib: 1_073_741_824,
  tib: 1_099_511_627_776,
};

function parseArgs(argv: string[]): Options | "help" | "self-test" {
  if (argv.length === 1 && argv[0] === "--self-test") return "self-test";
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return "help";
  let out = "";
  let host = "deployment-host";
  let intervalMs = 500;
  let containers: string[] = [];
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !["--out", "--host", "--interval-ms", "--containers"].includes(flag))
      throw new Error("unknown argument");
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (flag === "--out") out = resolve(value);
    if (flag === "--host") host = value;
    if (flag === "--interval-ms") intervalMs = Number(value);
    if (flag === "--containers") containers = value.split(",").map((name) => name.trim());
  }
  if (!out) throw new Error("--out is required");
  if (!NAME.test(host)) throw new Error("--host must be a safe SSH alias");
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1)
    throw new Error("--interval-ms must be a positive integer");
  if (containers.length === 0 || containers.some((name) => !NAME.test(name)))
    throw new Error("--containers must be a comma-separated list of safe container names");
  if (new Set(containers).size !== containers.length) throw new Error("--containers must be unique");
  return { out, host, intervalMs, containers };
}

function parseCpu(value: unknown): number {
  const match = typeof value === "string" ? /^\s*(\d+(?:\.\d+)?)%\s*$/.exec(value) : null;
  const parsed = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(parsed)) throw new Error("invalid CPU sample");
  return parsed;
}

function parseBytes(value: unknown): number {
  const current = typeof value === "string" ? value.split("/", 1)[0]!.trim() : "";
  const match = /^(\d+(?:\.\d+)?)\s*([KMGT]?i?B)$/i.exec(current);
  const bytes = match ? Number(match[1]) * (UNITS[match[2]!.toLowerCase()] ?? NaN) : NaN;
  if (!Number.isFinite(bytes) || bytes < 0) throw new Error("invalid memory sample");
  return Math.round(bytes);
}

function parseSample(line: string, allowed: Set<string>, atMs: number): Sample {
  const value = JSON.parse(line) as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid sample");
  const container = typeof value.Name === "string" ? value.Name.replace(/^\//, "") : "";
  if (!allowed.has(container)) throw new Error("unexpected container");
  return {
    container,
    cpu_percent: parseCpu(value.CPUPerc),
    memory_usage_bytes: parseBytes(value.MemUsage),
    at_ms: atMs,
  };
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

function stats(values: number[]): Stats {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: values.length === 0 ? null : values.reduce((maximum, value) => Math.max(maximum, value)),
  };
}

async function writeAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function sample(options: Options) {
  if (existsSync(options.out)) throw new Error("output already exists");
  const startedAtMs = Date.now();
  const samples: Sample[] = [];
  const aggregateMemory: number[] = [];
  const pending = new Map<string, Sample>();
  const allowed = new Set(options.containers);
  let rejectedLineCount = 0;
  const finishSweep = () => {
    if (pending.size === options.containers.length)
      aggregateMemory.push([...pending.values()].reduce((total, item) => total + item.memory_usage_bytes, 0));
    pending.clear();
  };
  const accept = (line: string) => {
    if (!line.trim()) return;
    try {
      const parsed = parseSample(line, allowed, Date.now());
      if (pending.has(parsed.container)) finishSweep();
      pending.set(parsed.container, parsed);
      samples.push(parsed);
      if (pending.size === options.containers.length) finishSweep();
    } catch {
      rejectedLineCount += 1;
    }
  };

  const delay = (options.intervalMs / 1_000).toFixed(3);
  const remote = `while :; do docker stats --no-stream --format '{{json .}}' ${options.containers.join(" ")}; sleep ${delay}; done`;
  const child = Bun.spawn(["ssh", "-T", options.host, remote], { stdout: "pipe", stderr: "ignore" });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    child.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const read = (async () => {
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) accept(line);
    }
    buffer += decoder.decode();
    accept(buffer);
  })();

  const exitCode = await child.exited;
  await read;
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  const endedAtMs = Date.now();
  const perContainer = options.containers.map((container) => {
    const own = samples.filter((item) => item.container === container);
    return {
      container,
      sample_count: own.length,
      cpu_percent: stats(own.map((item) => item.cpu_percent)),
      memory_usage_bytes: stats(own.map((item) => item.memory_usage_bytes)),
    };
  });
  await writeAtomic(options.out, {
    schema: "titen.docker-resource-samples.v1",
    timestamps: {
      started_at: new Date(startedAtMs).toISOString(),
      ended_at: new Date(endedAtMs).toISOString(),
    },
    interval_ms: options.intervalMs,
    host: options.host,
    containers: options.containers,
    rejected_line_count: rejectedLineCount,
    per_container: perContainer,
    aggregate_memory_usage_bytes: { sample_count: aggregateMemory.length, ...stats(aggregateMemory) },
    samples,
  });
  if (!stopping) throw new Error(`remote sampler exited unexpectedly (${exitCode})`);
}

function selfTest() {
  assert.deepEqual(parseArgs(["--out", "x", "--containers", "a,b"]), {
    out: resolve("x"),
    host: "deployment-host",
    intervalMs: 500,
    containers: ["a", "b"],
  });
  assert.throws(() => parseArgs(["--out", "x", "--containers", "a;id"]));
  assert.equal(parseCpu(" 123.45% "), 123.45);
  assert.equal(parseBytes("1.5MiB / 512MiB"), 1_572_864);
  assert.equal(parseBytes("2 MB / 1 GB"), 2_000_000);
  assert.deepEqual(stats([4, 1, 2, 3]), { p50: 2, p95: 4, p99: 4, max: 4 });
  assert.deepEqual(parseSample('{"Name":"/a","CPUPerc":"1.2%","MemUsage":"2KiB / 1GiB"}', new Set(["a"]), 7), {
    container: "a",
    cpu_percent: 1.2,
    memory_usage_bytes: 2_048,
    at_ms: 7,
  });
  assert.throws(() => parseSample("not-json", new Set(["a"]), 7));
  console.log("sample-docker-resources self-test: ok");
}

const usage = "Usage: bun scripts/sample-docker-resources.ts --out FILE --containers NAME[,NAME] [--host deployment-host] [--interval-ms 500]";

try {
  const options = parseArgs(process.argv.slice(2));
  if (options === "help") console.log(usage);
  else if (options === "self-test") selfTest();
  else await sample(options);
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : "unknown failure"}`);
  process.exitCode = 1;
}
