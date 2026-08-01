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

function identifierParts(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_$.-]+/)
    .filter(Boolean);
}

function isAuthorizationIdentifier(value: string) {
  return identifierParts(value).at(-1) === "authorization";
}

function isSensitiveIdentifier(value: string) {
  const parts = identifierParts(value);
  const last = parts.at(-1);
  const previous = parts.at(-2);
  const compoundValue = (last === "header" || last === "value") &&
    parts.some((part, index) =>
      part === "authorization" || part === "token" || part === "secret" ||
      (part === "key" && ["api", "secret", "access"].includes(parts[index - 1] ?? ""))
    );
  return last === "authorization" || last === "token" || last === "secret" ||
    (last === "key" && (previous === "api" || previous === "secret")) ||
    (last === "key" && parts.includes("secret") && parts.includes("access")) ||
    (parts.length === 1 && last === "apikey") || compoundValue;
}

function findQuotedValueEnd(value: string, start: number, opener: string) {
  const quote = opener.at(-1);
  const escapedOuter = opener.length === 2;
  for (let index = start; index < value.length; index++) {
    const character = value[index];
    if (character === "\r" || character === "\n") return -1;
    if (character !== quote) continue;
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= start && value[cursor] === "\\"; cursor--) {
      backslashes++;
    }
    const closes = (!escapedOuter && backslashes % 2 === 0) ||
      (escapedOuter && backslashes % 4 === 1);
    if (closes && !/[A-Za-z0-9_$]/.test(value[index + 1] ?? "")) {
      return index + 1;
    }
  }
  return -1;
}

function redactQuotedAssignments(value: string) {
  const assignments = /(^|[^A-Za-z0-9_$.-])((?:\\?["'])?)([A-Za-z0-9_$.-]+)((?:\\?["'])?\s*[:=]\s*)((?:\\?["']))/gi;
  let cursor = 0;
  let safe = "";
  for (let match = assignments.exec(value); match; match = assignments.exec(value)) {
    if (!isSensitiveIdentifier(match[3])) continue;
    const contentStart = match.index + match[0].length;
    const closeEnd = findQuotedValueEnd(value, contentStart, match[5]);
    safe += `${value.slice(cursor, contentStart)}[redacted]`;
    if (closeEnd === -1) {
      const carriage = value.indexOf("\r", contentStart);
      const newline = value.indexOf("\n", contentStart);
      const candidates = [carriage, newline].filter((index) => index !== -1);
      cursor = candidates.length ? Math.min(...candidates) : value.length;
    } else {
      safe += match[5];
      cursor = closeEnd;
    }
    assignments.lastIndex = cursor;
  }
  return `${safe}${value.slice(cursor)}`;
}

function redactAuthorizationAssignments(value: string) {
  const assignments = /(^|[^A-Za-z0-9_$.-])((?:\\?["'])?)([A-Za-z0-9_$.-]+)((?:\\?["'])?\s*[:=]\s*)/gi;
  let cursor = 0;
  let safe = "";
  for (let match = assignments.exec(value); match; match = assignments.exec(value)) {
    if (!isAuthorizationIdentifier(match[3])) continue;
    const valueStart = match.index + match[0].length;
    const carriage = value.indexOf("\r", valueStart);
    const newline = value.indexOf("\n", valueStart);
    const candidates = [carriage, newline].filter((index) => index !== -1);
    const valueEnd = candidates.length ? Math.min(...candidates) : value.length;
    const credential = value.slice(valueStart, valueEnd);
    if (!credential.trim() || /^(?:\\?["'])/.test(credential)) continue;
    safe += `${value.slice(cursor, valueStart)}[redacted]`;
    cursor = valueEnd;
    assignments.lastIndex = cursor;
  }
  return `${safe}${value.slice(cursor)}`;
}

function redactStructured(value: string, secrets: readonly string[]) {
  let safe = value;
  const normalizedSecrets = [...new Set(secrets.filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  for (const secret of normalizedSecrets) {
    safe = safe.replaceAll(secret, "[redacted]");
  }
  safe = redactQuotedAssignments(safe);
  safe = redactAuthorizationAssignments(safe);
  return safe.replace(
    /(^|[^A-Za-z0-9_$.-])((?:\\?["'])?)([A-Za-z0-9_$.-]+)((?:\\?["'])?\s*[:=]\s*)(?:bearer\s+)?(?:\[redacted\]|[^\\\s"',;}\])>]+)/gi,
    (match, boundary: string, keyQuote: string, identifier: string, assignment: string) =>
      isSensitiveIdentifier(identifier)
        ? `${boundary}${keyQuote}${identifier}${assignment}[redacted]`
        : match,
  );
}

type PendingSensitiveLabel = false | "folded" | "value";

function redactLine(
  value: string,
  secrets: readonly string[],
  pendingSensitiveLabel: PendingSensitiveLabel,
) {
  const carriage = value.endsWith("\r") ? "\r" : "";
  const body = carriage ? value.slice(0, -1) : value;
  if (pendingSensitiveLabel && /^[ \t]/.test(body)) {
    return {
      safe: `${body.match(/^[ \t]*/)?.[0] ?? ""}[redacted]${carriage}`,
      pending: "folded" as const,
    };
  }
  if (pendingSensitiveLabel === "value" && body.trim()) {
    return { safe: `[redacted]${carriage}`, pending: false };
  }
  const label = /(?:^|[^A-Za-z0-9_$.-])(?:\\?["'])?([A-Za-z0-9_$.-]+)(?:\\?["'])?[ \t]*:[ \t]*$/.exec(body);
  return {
    safe: redactStructured(value, secrets),
    pending: label && isSensitiveIdentifier(label[1])
      ? (isAuthorizationIdentifier(label[1]) ? "folded" : "value")
      : false,
  };
}

function redact(value: string, secrets: readonly string[]) {
  let offset = 0;
  let pending: PendingSensitiveLabel = false;
  let safe = "";
  while (offset < value.length) {
    const newline = value.indexOf("\n", offset);
    const end = newline === -1 ? value.length : newline;
    const line = redactLine(value.slice(offset, end), secrets, pending);
    safe += `${line.safe}${newline === -1 ? "" : "\n"}`;
    pending = line.pending;
    if (newline === -1) break;
    offset = newline + 1;
  }
  return safe;
}

type D1LineState = {
  line: string;
  lineOverflow: boolean;
  pendingSensitiveLabel: PendingSensitiveLabel;
};

type D1StderrState = D1LineState & {
  decoder: TextDecoder;
};

function lineState(): D1LineState {
  return { line: "", lineOverflow: false, pendingSensitiveLabel: false };
}

/** Adds bounded, redacted workerd context without changing assertion objects. */
export class D1RunDiagnostics {
  readonly handleRuntimeStdio: (stdout: Readable, stderr: Readable) => void;
  #phase = "startup";
  #stderr = Buffer.alloc(0);
  #direct = lineState();
  #streams = new Map<Readable, D1StderrState>();

  constructor(
    readonly owner: D1LaneOwner,
    readonly secrets: readonly string[] = [],
    readonly limit = DIAGNOSTIC_LIMIT,
    readonly emit: (value: string) => void = (value) => process.stderr.write(value),
  ) {
    this.handleRuntimeStdio = (stdout, stderr) => {
      stdout.resume();
      const state = { ...lineState(), decoder: new TextDecoder() };
      this.#streams.set(stderr, state);
      stderr.on("data", (chunk) => {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        const decoded = state.decoder.decode(bytes, { stream: true });
        if (decoded) this.#recordStderr(state, decoded);
      });
      const finish = () => {
        if (this.#streams.get(stderr) !== state) return;
        const decoded = state.decoder.decode();
        if (decoded) this.#recordStderr(state, decoded);
        this.#flushLine(state, false);
        this.#streams.delete(stderr);
      };
      stderr.once("end", finish);
      stderr.once("close", finish);
    };
  }

  recordStderr(value: string) {
    this.#recordStderr(this.#direct, value);
  }

  #recordStderr(state: D1LineState, value: string) {
    let offset = 0;
    while (offset < value.length) {
      const newline = value.indexOf("\n", offset);
      const end = newline === -1 ? value.length : newline;
      this.#appendLine(state, value.slice(offset, end));
      if (newline === -1) return;
      this.#flushLine(state, true);
      offset = newline + 1;
    }
  }

  #appendLine(state: D1LineState, value: string) {
    if (state.lineOverflow) return;
    if (Buffer.byteLength(state.line) + Buffer.byteLength(value) > this.limit) {
      state.line = "";
      state.lineOverflow = true;
      return;
    }
    state.line += value;
  }

  #appendOutput(value: string) {
    const combined = Buffer.concat([this.#stderr, Buffer.from(value)]);
    let start = Math.max(0, combined.length - this.limit);
    while (start < combined.length && (combined[start] & 0xc0) === 0x80) start++;
    this.#stderr = Buffer.from(combined.subarray(start));
  }

  #appendSanitized(value: string) {
    const separator = this.#stderr.length && this.#stderr.at(-1) !== 0x0a ? "\n" : "";
    this.#appendOutput(`${separator}${value}`);
  }

  #flushLine(state: D1LineState, newline: boolean) {
    if (!newline && !state.line && !state.lineOverflow) return;
    const line = state.lineOverflow
      ? { safe: "[redacted oversized stderr line]", pending: "folded" as const }
      : redactLine(state.line, this.secrets, state.pendingSensitiveLabel);
    state.pendingSensitiveLabel = line.pending;
    this.#appendSanitized(`${line.safe}${newline ? "\n" : ""}`);
    state.line = "";
    state.lineOverflow = false;
  }

  #snapshotLine(state: D1LineState) {
    if (!state.line && !state.lineOverflow) return;
    const line = state.lineOverflow
      ? { safe: "[redacted oversized stderr line]" }
      : redactLine(state.line, this.secrets, state.pendingSensitiveLabel);
    this.#appendSanitized(line.safe);
  }

  async run<T>(phase: string, operation: () => T | Promise<T>): Promise<T> {
    this.#phase = phase;
    this.#stderr = Buffer.alloc(0);
    try {
      return await operation();
    } catch (error) {
      this.#snapshotLine(this.#direct);
      for (const state of this.#streams.values()) this.#snapshotLine(state);
      const context = `[d1-contract run=${this.owner.run_id} phase=${phase}] workerd stderr (bounded):\n${this.#stderr.toString("utf8").trim() || "<none captured>"}`;
      this.emit(`${context}\n`);
      if (error instanceof Error) {
        error.message = `${redact(error.message, this.secrets)}\n${context}`;
        if (error.stack) error.stack = `${redact(error.stack, this.secrets)}\n${context}`;
        throw error;
      }
      throw new Error(`${redact(String(error), this.secrets)}\n${context}`);
    }
  }
}
