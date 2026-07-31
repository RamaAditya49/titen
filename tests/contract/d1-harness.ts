import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createServer, connect, type Server } from "node:net";
import { basename } from "node:path";
import type { Readable } from "node:stream";

export const D1_LANE_PORT = 49_357;
const DIAGNOSTIC_LIMIT = 16 * 1024;
const LOOPBACK = "127.0.0.1";

export type D1LaneOwner = {
  run_id: string;
  pid: number;
  worktree: string;
  started_at: string;
};

export type D1Lane = {
  owner: D1LaneOwner;
  port: number;
  release(): Promise<void>;
};

export class D1LaneBusyError extends Error {
  readonly code = "TITEN_D1_LANE_BUSY";
}

function parseOwner(value: string): D1LaneOwner | undefined {
  try {
    const owner = JSON.parse(value) as Partial<D1LaneOwner>;
    if (
      typeof owner.run_id !== "string" ||
      typeof owner.pid !== "number" ||
      typeof owner.worktree !== "string" ||
      typeof owner.started_at !== "string"
    ) return undefined;
    return owner as D1LaneOwner;
  } catch {
    return undefined;
  }
}

async function readOwner(port: number): Promise<D1LaneOwner | undefined> {
  return new Promise((resolve) => {
    let body = "";
    const socket = connect({ host: LOOPBACK, port });
    const done = () => {
      socket.destroy();
      resolve(parseOwner(body));
    };
    socket.setEncoding("utf8");
    socket.setTimeout(250, done);
    socket.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) done();
    });
    socket.once("end", done);
    socket.once("error", () => resolve(undefined));
  });
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: LOOPBACK, port, exclusive: true }, () => {
      server.off("error", reject);
      const address = server.address();
      assert(typeof address === "object" && address !== null);
      resolve(address.port);
    });
  });
}

/** Host-wide manual-test lane. The kernel releases it if the owner exits. */
export async function acquireD1Lane(port = D1_LANE_PORT): Promise<D1Lane> {
  const owner: D1LaneOwner = {
    run_id: randomUUID(),
    pid: process.pid,
    worktree: basename(process.cwd()),
    started_at: new Date().toISOString(),
  };
  const payload = `${JSON.stringify(owner)}\n`;
  const server = createServer((socket) => socket.end(payload));

  let actualPort: number;
  try {
    actualPort = await listen(server, port);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    const current = await readOwner(port);
    const identity = current
      ? `run=${current.run_id} pid=${current.pid} worktree=${current.worktree} started_at=${current.started_at}`
      : `port=${port} owner=unavailable`;
    throw new D1LaneBusyError(`D1 contract lane is busy (${identity})`);
  }
  server.unref();

  let released = false;
  return {
    owner,
    port: actualPort,
    async release() {
      if (released) return;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()));
      released = true;
    },
  };
}

function redact(value: string, secrets: readonly string[]) {
  let safe = value;
  for (const secret of secrets) {
    if (secret) safe = safe.replaceAll(secret, "[redacted]");
  }
  return safe
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1[redacted]")
    .replace(/((?:api[_-]?key|secret|token)\s*[:=]\s*)[^\s,;}]+/gi, "$1[redacted]");
}

/** Adds bounded, redacted workerd context without changing assertion objects. */
export class D1RunDiagnostics {
  readonly handleRuntimeStdio: (stdout: Readable, stderr: Readable) => void;
  #phase = "startup";
  #stderr = Buffer.alloc(0);
  #emitted = 0;

  constructor(
    readonly owner: D1LaneOwner,
    readonly secrets: readonly string[] = [],
    readonly limit = DIAGNOSTIC_LIMIT,
    readonly emit: (value: string) => void = (value) => process.stderr.write(value),
  ) {
    this.handleRuntimeStdio = (stdout, stderr) => {
      stdout.resume();
      stderr.on("data", (chunk) => this.recordStderr(String(chunk)));
    };
  }

  recordStderr(value: string) {
    const safe = Buffer.from(redact(value, this.secrets));
    const combined = Buffer.concat([this.#stderr, safe]);
    this.#stderr = Buffer.from(combined.subarray(Math.max(0, combined.length - this.limit)));

    const remaining = this.limit - this.#emitted;
    if (remaining <= 0) return;
    const output = safe.subarray(0, remaining).toString("utf8");
    if (this.#emitted === 0) {
      this.emit(`[d1-contract run=${this.owner.run_id} phase=${this.#phase} workerd-stderr]\n`);
    }
    this.emit(output);
    this.#emitted += Buffer.byteLength(output);
  }

  async run<T>(phase: string, operation: () => T | Promise<T>): Promise<T> {
    this.#phase = phase;
    this.#stderr = Buffer.alloc(0);
    this.#emitted = 0;
    try {
      return await operation();
    } catch (error) {
      const context = `[d1-contract run=${this.owner.run_id} phase=${phase}] workerd stderr (bounded):\n${this.#stderr.toString("utf8").trim() || "<none captured>"}`;
      if (error instanceof Error) {
        error.message = `${redact(error.message, this.secrets)}\n${context}`;
        if (error.stack) error.stack = `${redact(error.stack, this.secrets)}\n${context}`;
        throw error;
      }
      throw new Error(`${redact(String(error), this.secrets)}\n${context}`);
    }
  }
}
